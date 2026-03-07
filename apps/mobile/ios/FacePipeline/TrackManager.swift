import Foundation
import Vision

/// Represents a tracked face across frames.
final class FaceTrack {
    let trackId: String
    var state: TrackState = .new
    var observation: VNFaceObservation
    var embedding: [Float]?
    var qualityScore: Float = 0.0
    var recognitionConfidence: Float = 0.0
    var matchedIdentityId: String?
    var consecutiveMatches: Int = 0
    var consecutiveMatchIdentity: String?
    var lastSeenTime: TimeInterval
    var firstSeenTime: TimeInterval
    var unknownSessionId: String?
    var unknownIdSource: UserIdJson.Source = .track
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
    private struct UnknownProfile {
        let id: String
        var centroid: [Float]     // L2-normalized
        var samples: Int
        var lastSeenTime: TimeInterval
        var averageQuality: Float
    }

    weak var delegate: TrackManagerDelegate?

    private var activeTracks: [String: FaceTrack] = [:]
    private var identityOwner: [String: String] = [:] // identityId -> trackId
    private var unknownProfiles: [String: UnknownProfile] = [:]
    private var unknownOwner: [String: String] = [:]   // unknownId -> trackId
    private(set) var identityConflictsObserved: Int = 0
    private(set) var identityConflictsResolved: Int = 0
    private(set) var identityConflictsSuppressed: Int = 0
    private let unknownSimilarityThreshold: Float = 0.58
    private let unknownMarginThreshold: Float = 0.04
    private let unknownProfileTtlSec: TimeInterval = 300
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
            if !canAssignIdentity(identityId, to: track, with: matchResult) {
                applyUnknownResult(
                    track: track,
                    embedding: embedding,
                    quality: quality,
                    matchResult: matchResult,
                    timestamp: timestamp
                )
                return
            }
            applyKnownMatch(
                track: track,
                identityId: identityId,
                matchResult: matchResult,
                timestamp: timestamp
            )
            return
        }

        applyUnknownResult(
            track: track,
            embedding: embedding,
            quality: quality,
            matchResult: matchResult,
            timestamp: timestamp
        )
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
                clearIdentityOwnership(for: track.trackId)
                clearUnknownOwnership(for: track.trackId)
                track.state = .exited
            }

            exitedTrackIds.append(trackId)
        }

        for trackId in exitedTrackIds {
            activeTracks.removeValue(forKey: trackId)
        }
        pruneStaleUnknownProfiles(currentTime: currentTime)
    }

    func reset() {
        activeTracks.removeAll()
        identityOwner.removeAll()
        unknownOwner.removeAll()
        unknownProfiles.removeAll()
        identityConflictsObserved = 0
        identityConflictsResolved = 0
        identityConflictsSuppressed = 0
    }

    // MARK: - Match Handling

    private func applyKnownMatch(
        track: FaceTrack,
        identityId: String,
        matchResult: MatchResult,
        timestamp: TimeInterval
    ) {
        let previousIdentity = track.matchedIdentityId
        let previousUnknownId = track.unknownSessionId

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
        if let previousUnknownId {
            let oldUnknownUser = UserIdJson(type: .unknown, id: previousUnknownId, source: track.unknownIdSource)
            emitEvent(
                track: track,
                eventType: .personLeft,
                userId: oldUnknownUser,
                matchResult: matchResult,
                timestamp: timestamp
            )
            clearUnknownOwnership(for: track.trackId)
            track.unknownSessionId = nil
            track.unknownIdSource = .track
            track.didEmitEnteredEvent = false
        }
        if let previousIdentity, previousIdentity != identityId {
            // Explicit identity transition: close old identity session before opening new one.
            let oldUserId = UserIdJson(type: .enrolled, id: previousIdentity, source: .identity)
            emitEvent(
                track: track,
                eventType: .personLeft,
                userId: oldUserId,
                matchResult: matchResult,
                timestamp: timestamp
            )
            clearIdentityOwnership(for: track.trackId)
        }
        track.matchedIdentityId = identityId
        track.recognitionConfidence = matchResult.confidence
        identityOwner[identityId] = track.trackId

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

    private func applyUnknownResult(
        track: FaceTrack,
        embedding: [Float],
        quality: Float,
        matchResult: MatchResult,
        timestamp: TimeInterval
    ) {
        let previousIdentity = track.matchedIdentityId
        let hadKnownIdentity = previousIdentity != nil
        let previousUnknownId = track.unknownSessionId
        let previousUnknownSource = track.unknownIdSource
        track.consecutiveMatches = 0
        track.consecutiveMatchIdentity = nil
        if hadKnownIdentity {
            let leftUserId = UserIdJson(type: .enrolled, id: previousIdentity!, source: .identity)
            emitEvent(
                track: track,
                eventType: .personLeft,
                userId: leftUserId,
                matchResult: matchResult,
                timestamp: timestamp
            )
            clearIdentityOwnership(for: track.trackId)
            track.matchedIdentityId = nil
            track.recognitionConfidence = 0
            track.didEmitEnteredEvent = false
        }

        // Avoid flipping known tracks back to unknown on temporary low-confidence frames.
        // If identity was explicitly cleared (e.g., ownership transfer), continue to unknown path.
        if track.state == .known && !hadKnownIdentity {
            return
        }

        let unknown = resolveUnknownIdentity(
            track: track,
            embedding: embedding,
            quality: quality,
            timestamp: timestamp
        )
        if previousUnknownId != nil, previousUnknownId != unknown.id {
            let leftUnknown = UserIdJson(type: .unknown, id: previousUnknownId!, source: previousUnknownSource)
            emitEvent(
                track: track,
                eventType: .personLeft,
                userId: leftUnknown,
                matchResult: matchResult,
                timestamp: timestamp
            )
            clearUnknownOwnership(for: track.trackId)
            track.didEmitEnteredEvent = false
        }

        track.unknownSessionId = unknown.id
        track.unknownIdSource = unknown.source
        track.state = .unknown
        track.recognitionConfidence = unknown.similarityTop1
        let userId = UserIdJson(type: .unknown, id: unknown.id, source: unknown.source)
        let unknownMatchResult = MatchResult(
            identityId: nil,
            confidence: unknown.confidence,
            similarityTop1: unknown.similarityTop1,
            similarityTop2: unknown.similarityTop2,
            margin: unknown.margin,
            reason: matchResult.reason
        )

        if !track.didEmitEnteredEvent {
            emitEvent(
                track: track,
                eventType: .personEntered,
                userId: userId,
                matchResult: unknownMatchResult,
                timestamp: timestamp
            )
            track.didEmitEnteredEvent = true
        } else {
            emitEvent(
                track: track,
                eventType: .personUpdated,
                userId: userId,
                matchResult: unknownMatchResult,
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
            track.unknownIdSource = .track
        }
        return UserIdJson(type: .unknown, id: track.unknownSessionId!, source: track.unknownIdSource)
    }

    private func clearIdentityOwnership(for trackId: String) {
        let ownedIdentityIds = identityOwner
            .filter { $0.value == trackId }
            .map(\.key)
        for identityId in ownedIdentityIds {
            identityOwner.removeValue(forKey: identityId)
        }
    }

    private func clearUnknownOwnership(for trackId: String) {
        let ownedUnknownIds = unknownOwner
            .filter { $0.value == trackId }
            .map(\.key)
        for unknownId in ownedUnknownIds {
            unknownOwner.removeValue(forKey: unknownId)
        }
    }

    private func pruneStaleUnknownProfiles(currentTime: TimeInterval) {
        for (unknownId, profile) in unknownProfiles {
            let isOwned = unknownOwner[unknownId] != nil
            if isOwned { continue }
            if currentTime - profile.lastSeenTime > unknownProfileTtlSec {
                unknownProfiles.removeValue(forKey: unknownId)
            }
        }
    }

    private struct UnknownIdentityMatch {
        let id: String
        let source: UserIdJson.Source
        let confidence: Float
        let similarityTop1: Float
        let similarityTop2: Float
        let margin: Float
    }

    private func resolveUnknownIdentity(
        track: FaceTrack,
        embedding: [Float],
        quality: Float,
        timestamp: TimeInterval
    ) -> UnknownIdentityMatch {
        if let currentUnknownId = track.unknownSessionId,
           var profile = unknownProfiles[currentUnknownId] {
            profile = updateUnknownProfile(profile, with: embedding, quality: quality, timestamp: timestamp)
            unknownProfiles[currentUnknownId] = profile
            unknownOwner[currentUnknownId] = track.trackId
            return UnknownIdentityMatch(
                id: currentUnknownId,
                source: .identity,
                confidence: profile.averageQuality,
                similarityTop1: track.recognitionConfidence,
                similarityTop2: 0,
                margin: 0
            )
        }

        let candidates = unknownProfiles.values.map { profile -> (id: String, similarity: Float) in
            (profile.id, GalleryStore.cosineSimilarity(embedding, profile.centroid))
        }
        let sortedCandidates = candidates.sorted { $0.similarity > $1.similarity }
        let top1 = sortedCandidates.first
        let top2 = sortedCandidates.count > 1 ? sortedCandidates[1] : (id: "", similarity: 0)
        let margin = (top1?.similarity ?? 0) - top2.similarity

        if let top1,
           top1.similarity >= unknownSimilarityThreshold,
           margin >= unknownMarginThreshold,
           canAssignUnknown(top1.id, to: track.trackId) {
            var profile = unknownProfiles[top1.id]!
            profile = updateUnknownProfile(profile, with: embedding, quality: quality, timestamp: timestamp)
            unknownProfiles[top1.id] = profile
            unknownOwner[top1.id] = track.trackId
            return UnknownIdentityMatch(
                id: top1.id,
                source: .identity,
                confidence: top1.similarity,
                similarityTop1: top1.similarity,
                similarityTop2: top2.similarity,
                margin: margin
            )
        }

        let newUnknownId = "unknown_\(UUID().uuidString.prefix(8))"
        unknownProfiles[newUnknownId] = UnknownProfile(
            id: newUnknownId,
            centroid: embedding,
            samples: 1,
            lastSeenTime: timestamp,
            averageQuality: quality
        )
        unknownOwner[newUnknownId] = track.trackId
        return UnknownIdentityMatch(
            id: newUnknownId,
            source: .identity,
            confidence: quality,
            similarityTop1: top1?.similarity ?? 0,
            similarityTop2: top2.similarity,
            margin: margin
        )
    }

    private func canAssignUnknown(_ unknownId: String, to trackId: String) -> Bool {
        guard let ownerTrackId = unknownOwner[unknownId] else { return true }
        if ownerTrackId == trackId { return true }
        if activeTracks[ownerTrackId] == nil {
            unknownOwner[unknownId] = trackId
            return true
        }
        return false
    }

    private func updateUnknownProfile(
        _ profile: UnknownProfile,
        with embedding: [Float],
        quality: Float,
        timestamp: TimeInterval
    ) -> UnknownProfile {
        let sampleCount = max(1, profile.samples)
        let alpha = 1.0 / Float(sampleCount + 1)
        let centroid = blendEmbeddings(
            old: profile.centroid,
            next: embedding,
            alpha: alpha
        )
        let avgQuality = ((profile.averageQuality * Float(sampleCount)) + quality) / Float(sampleCount + 1)
        return UnknownProfile(
            id: profile.id,
            centroid: centroid,
            samples: sampleCount + 1,
            lastSeenTime: timestamp,
            averageQuality: avgQuality
        )
    }

    private func blendEmbeddings(old: [Float], next: [Float], alpha: Float) -> [Float] {
        guard old.count == next.count, !old.isEmpty else { return next }
        var blended = [Float](repeating: 0, count: old.count)
        for idx in old.indices {
            blended[idx] = ((1.0 - alpha) * old[idx]) + (alpha * next[idx])
        }
        return FaceEmbedder.l2Normalize(blended)
    }

    private func canAssignIdentity(_ identityId: String, to track: FaceTrack, with match: MatchResult) -> Bool {
        guard let ownerTrackId = identityOwner[identityId] else {
            return true
        }
        guard ownerTrackId != track.trackId else {
            return true
        }
        identityConflictsObserved += 1
        guard let ownerTrack = activeTracks[ownerTrackId], ownerTrack.state != .exited else {
            identityOwner[identityId] = track.trackId
            identityConflictsResolved += 1
            return true
        }

        // Single-owner policy: higher confidence claim wins.
        let ownerConfidence = ownerTrack.recognitionConfidence
        if match.confidence > ownerConfidence + 0.01 {
            let leftResult = MatchResult(
                identityId: identityId,
                confidence: ownerTrack.recognitionConfidence,
                similarityTop1: ownerTrack.recognitionConfidence,
                similarityTop2: 0,
                margin: 0,
                reason: .matched
            )
            let leftUserId = UserIdJson(type: .enrolled, id: identityId, source: .identity)
            emitEvent(
                track: ownerTrack,
                eventType: .personLeft,
                userId: leftUserId,
                matchResult: leftResult,
                timestamp: max(ownerTrack.lastSeenTime, track.lastSeenTime)
            )
            clearIdentityOwnership(for: ownerTrackId)
            ownerTrack.matchedIdentityId = nil
            ownerTrack.recognitionConfidence = 0
            ownerTrack.consecutiveMatches = 0
            ownerTrack.consecutiveMatchIdentity = nil
            ownerTrack.state = .candidate
            ownerTrack.didEmitEnteredEvent = false
            identityOwner[identityId] = track.trackId
            identityConflictsResolved += 1
            return true
        }

        identityConflictsSuppressed += 1
        return false
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
