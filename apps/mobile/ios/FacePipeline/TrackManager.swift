import Foundation
import Vision

/// Represents a tracked face across frames.
final class FaceTrack {
    let trackId: String
    var state: TrackState = .new
    var observation: VNFaceObservation
    var embedding: [Float]?
    var qualityScore: Float = 0.0
    var matchedIdentityId: String?
    var consecutiveMatches: Int = 0
    var consecutiveMatchIdentity: String?
    var lastSeenTime: TimeInterval
    var firstSeenTime: TimeInterval
    var unknownSessionId: String?
    var didEmitEnteredEvent = false

    init(trackId: String, observation: VNFaceObservation, timestamp: TimeInterval) {
        self.trackId = trackId
        self.observation = observation
        self.lastSeenTime = timestamp
        self.firstSeenTime = timestamp
    }
}

protocol TrackManagerDelegate: AnyObject {
    func trackManager(_ manager: TrackManager, didEmitEvent event: PersonEvent)
}

final class TrackManager {
    weak var delegate: TrackManagerDelegate?

    private var activeTracks: [String: FaceTrack] = [:]
    private let config: PipelineConfig
    private let galleryStore: GalleryStore
    private let faceMatcher: FaceMatcher

    init(config: PipelineConfig, galleryStore: GalleryStore, faceMatcher: FaceMatcher) {
        self.config = config
        self.galleryStore = galleryStore
        self.faceMatcher = faceMatcher
    }

    var tracks: [String: FaceTrack] { activeTracks }

    // MARK: - Track Lifecycle

    @discardableResult
    func upsertTrack(trackId: String, observation: VNFaceObservation, timestamp: TimeInterval) -> FaceTrack {
        if let existingTrack = activeTracks[trackId] {
            existingTrack.observation = observation
            existingTrack.lastSeenTime = timestamp
            if existingTrack.state == .new {
                existingTrack.state = .candidate
            } else if existingTrack.state == .lost {
                existingTrack.state = existingTrack.matchedIdentityId == nil ? .candidate : .known
            }
            return existingTrack
        }

        let track = FaceTrack(trackId: trackId, observation: observation, timestamp: timestamp)
        track.state = .candidate
        activeTracks[track.trackId] = track
        return track
    }

    func updateTrackEmbedding(trackId: String, embedding: [Float], quality: Float, timestamp: TimeInterval) {
        guard let track = activeTracks[trackId] else { return }

        track.embedding = embedding
        track.qualityScore = quality
        track.lastSeenTime = max(track.lastSeenTime, timestamp)

        let matchResult = faceMatcher.match(embedding: embedding, in: galleryStore)

        if matchResult.reason == .matched, let identityId = matchResult.identityId {
            applyKnownMatch(
                track: track,
                identityId: identityId,
                matchResult: matchResult,
                timestamp: timestamp
            )
            return
        }

        applyUnknownResult(track: track, matchResult: matchResult, timestamp: timestamp)
    }

    /// Check for lost/exited tracks based on timeout.
    func pruneStale(currentTime: TimeInterval) {
        let lostTimeout = Double(config.lostTimeoutMs) / 1000.0
        var exitedTrackIds: [String] = []

        for (trackId, track) in activeTracks {
            let elapsed = currentTime - track.lastSeenTime
            guard elapsed >= lostTimeout else { continue }

            if track.state != .lost && track.state != .exited {
                track.state = .lost
                let userId = resolvedUserId(for: track)
                let matchResult = MatchResult(
                    identityId: track.matchedIdentityId,
                    confidence: track.qualityScore,
                    similarityTop1: 0,
                    similarityTop2: 0,
                    margin: 0,
                    reason: track.matchedIdentityId == nil ? .belowThreshold : .matched
                )
                emitEvent(
                    track: track,
                    eventType: .personLeft,
                    userId: userId,
                    matchResult: matchResult,
                    timestamp: currentTime
                )
                track.state = .exited
            }

            exitedTrackIds.append(trackId)
        }

        for trackId in exitedTrackIds {
            activeTracks.removeValue(forKey: trackId)
        }
    }

    func reset() {
        activeTracks.removeAll()
    }

    // MARK: - Match Handling

    private func applyKnownMatch(
        track: FaceTrack,
        identityId: String,
        matchResult: MatchResult,
        timestamp: TimeInterval
    ) {
        let previousIdentity = track.matchedIdentityId

        if track.consecutiveMatchIdentity == identityId {
            track.consecutiveMatches += 1
        } else {
            track.consecutiveMatches = 1
            track.consecutiveMatchIdentity = identityId
        }

        guard track.consecutiveMatches >= config.consecutiveMatchesRequired else {
            track.state = .candidate
            return
        }

        track.state = .known
        track.matchedIdentityId = identityId

        let userId = UserIdJson(type: .enrolled, id: identityId, source: .identity)
        let shouldEnter = !track.didEmitEnteredEvent || previousIdentity != identityId

        if shouldEnter {
            emitEvent(
                track: track,
                eventType: .personEntered,
                userId: userId,
                matchResult: matchResult,
                timestamp: timestamp
            )
            track.didEmitEnteredEvent = true
        } else {
            emitEvent(
                track: track,
                eventType: .personUpdated,
                userId: userId,
                matchResult: matchResult,
                timestamp: timestamp
            )
        }
    }

    private func applyUnknownResult(track: FaceTrack, matchResult: MatchResult, timestamp: TimeInterval) {
        track.consecutiveMatches = 0
        track.consecutiveMatchIdentity = nil

        // Avoid flipping known tracks back to unknown on temporary low-confidence frames.
        if track.state == .known {
            return
        }

        if track.unknownSessionId == nil {
            track.unknownSessionId = UUID().uuidString
        }

        track.state = .unknown
        let userId = UserIdJson(type: .unknown, id: track.unknownSessionId!, source: .track)

        if !track.didEmitEnteredEvent {
            emitEvent(
                track: track,
                eventType: .personEntered,
                userId: userId,
                matchResult: matchResult,
                timestamp: timestamp
            )
            track.didEmitEnteredEvent = true
        } else {
            emitEvent(
                track: track,
                eventType: .personUpdated,
                userId: userId,
                matchResult: matchResult,
                timestamp: timestamp
            )
        }
    }

    // MARK: - Event Helpers

    private func resolvedUserId(for track: FaceTrack) -> UserIdJson {
        if let identityId = track.matchedIdentityId {
            return UserIdJson(type: .enrolled, id: identityId, source: .identity)
        }

        if track.unknownSessionId == nil {
            track.unknownSessionId = UUID().uuidString
        }
        return UserIdJson(type: .unknown, id: track.unknownSessionId!, source: .track)
    }

    private func emitEvent(
        track: FaceTrack,
        eventType: PersonEvent.EventType,
        userId: UserIdJson,
        matchResult: MatchResult,
        timestamp: TimeInterval
    ) {
        let bearing = computeBearing(boundingBox: track.observation.boundingBox)
        let distanceProxy = computeDistanceProxy(boundingBox: track.observation.boundingBox)

        let event = PersonEvent(
            eventType: eventType,
            trackId: track.trackId,
            userId: userId,
            confidence: matchResult.confidence,
            bearing: bearing,
            distanceProxy: distanceProxy,
            similarityTop1: matchResult.similarityTop1,
            similarityTop2: matchResult.similarityTop2,
            margin: matchResult.margin,
            timestampMs: Int64(timestamp * 1000)
        )
        delegate?.trackManager(self, didEmitEvent: event)
    }

    /// Bearing: face center X relative to frame center, mapped to -1..1.
    private func computeBearing(boundingBox: CGRect) -> Float {
        let centerX = boundingBox.midX
        return Float((centerX - 0.5) * 2.0)
    }

    /// Distance proxy: larger face box means closer face.
    private func computeDistanceProxy(boundingBox: CGRect) -> Float {
        let faceSize = max(boundingBox.width, boundingBox.height)
        guard faceSize > 0 else { return 10.0 }
        return Float(0.15 / faceSize)
    }
}
