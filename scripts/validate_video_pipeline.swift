import Foundation
import AVFoundation
import CoreMedia

private struct EnrollmentVideo {
    let identityId: String
    let displayName: String
    let url: URL
}

private struct ConflictStats {
    let observed: Int
    let resolved: Int
    let suppressed: Int
}

private struct RecognitionRunSummary {
    let videoName: String
    let events: [PersonEvent]
    let inferenceLatenciesMs: [Double]
    let idLatenciesByIdentity: [String: [Double]]
    let identityChangeMoments: [(timestamp: TimeInterval, trackId: String, from: String, to: String)]
    let maxConcurrentTracks: Int
    let lifecycleCountsByTrack: [String: (entered: Int, left: Int)]
    let conflictStats: ConflictStats
    let switchPairs: [(timestamp: TimeInterval, trackId: String, from: String, to: String)]
}

private enum ValidationError: Error, LocalizedError {
    case missingVideoTrack(URL)
    case readerFailed(URL, Error?)
    case enrollmentFailed(String)

    var errorDescription: String? {
        switch self {
        case .missingVideoTrack(let url):
            return "No video track found in \(url.path)"
        case .readerFailed(let url, let error):
            return "AVAssetReader failed for \(url.lastPathComponent): \(error?.localizedDescription ?? "unknown error")"
        case .enrollmentFailed(let identityId):
            return "Enrollment failed for \(identityId)"
        }
    }
}

private final class VideoFrameReader {
    private let url: URL

    init(url: URL) {
        self.url = url
    }

    @discardableResult
    func readAll(_ onSample: (CMSampleBuffer) -> Void) throws -> TimeInterval {
        let asset = AVAsset(url: url)
        guard let track = asset.tracks(withMediaType: .video).first else {
            throw ValidationError.missingVideoTrack(url)
        }

        let reader = try AVAssetReader(asset: asset)
        let outputSettings: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA)
        ]
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: outputSettings)
        output.alwaysCopiesSampleData = false

        guard reader.canAdd(output) else {
            throw ValidationError.readerFailed(url, reader.error)
        }
        reader.add(output)

        guard reader.startReading() else {
            throw ValidationError.readerFailed(url, reader.error)
        }

        var lastTimestamp: TimeInterval = 0
        while let sampleBuffer = output.copyNextSampleBuffer() {
            let timestamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer).seconds
            lastTimestamp = timestamp
            onSample(sampleBuffer)
        }

        guard reader.status == .completed else {
            throw ValidationError.readerFailed(url, reader.error)
        }

        return lastTimestamp
    }
}

private final class EnrollmentCollector: NSObject, VisionPipelineDelegate {
    var alignedSamples: [(image: CGImage, quality: Float)] = []

    func visionPipeline(
        _ pipeline: VisionPipeline,
        didOutput samples: [TrackedFaceSample],
        in sampleBuffer: CMSampleBuffer,
        timestamp: TimeInterval
    ) {
        for sample in samples {
            guard let aligned = sample.alignedFace else { continue }
            alignedSamples.append((image: aligned, quality: sample.quality))
        }
    }
}

private final class RecognitionSession: NSObject, VisionPipelineDelegate, TrackManagerDelegate {
    private let embedder: FaceEmbedder
    private let trackManager: TrackManager
    private let visionPipeline: VisionPipeline

    private(set) var events: [PersonEvent] = []
    private(set) var inferenceLatenciesMs: [Double] = []
    private(set) var idLatenciesByIdentity: [String: [Double]] = [:]
    private(set) var identityChangeMoments: [(timestamp: TimeInterval, trackId: String, from: String, to: String)] = []
    private(set) var maxConcurrentTracks: Int = 0
    private(set) var lifecycleCountsByTrack: [String: (entered: Int, left: Int)] = [:]

    private var firstSeenByTrack: [String: TimeInterval] = [:]
    private var currentIdentityByTrack: [String: String] = [:]
    private var lastTimestamp: TimeInterval = 0

    init(config: PipelineConfig, embedder: FaceEmbedder, galleryStore: GalleryStore) {
        self.embedder = embedder
        let matcher = FaceMatcher(
            similarityThreshold: config.similarityThreshold,
            marginThreshold: config.marginThreshold
        )
        self.trackManager = TrackManager(config: config, galleryStore: galleryStore, faceMatcher: matcher)
        self.visionPipeline = VisionPipeline(config: config)
        super.init()
        self.trackManager.delegate = self
        self.visionPipeline.delegate = self
    }

    func process(_ sampleBuffer: CMSampleBuffer) {
        let timestamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer).seconds
        lastTimestamp = timestamp
        visionPipeline.processFrame(sampleBuffer, timestamp: timestamp)
        trackManager.pruneStale(currentTime: timestamp)
    }

    func finishSession() {
        trackManager.pruneStale(currentTime: lastTimestamp + 2.0)
    }

    func conflictStats() -> ConflictStats {
        ConflictStats(
            observed: trackManager.identityConflictsObserved,
            resolved: trackManager.identityConflictsResolved,
            suppressed: trackManager.identityConflictsSuppressed
        )
    }

    func switchPairs() -> [(timestamp: TimeInterval, trackId: String, from: String, to: String)] {
        let sorted = events.sorted { $0.timestampMs < $1.timestampMs }
        guard sorted.count >= 2 else { return [] }

        var pairs: [(timestamp: TimeInterval, trackId: String, from: String, to: String)] = []
        for i in 0..<(sorted.count - 1) {
            let left = sorted[i]
            let enter = sorted[i + 1]
            guard left.trackId == enter.trackId else { continue }
            guard left.eventType == .personLeft, enter.eventType == .personEntered else { continue }
            guard left.userId.type == .enrolled, enter.userId.type == .enrolled else { continue }
            guard left.userId.id != enter.userId.id else { continue }

            let dtMs = abs(enter.timestampMs - left.timestampMs)
            guard dtMs <= 200 else { continue }
            pairs.append(
                (
                    timestamp: Double(enter.timestampMs) / 1000.0,
                    trackId: enter.trackId,
                    from: left.userId.id,
                    to: enter.userId.id
                )
            )
        }

        return pairs
    }

    func visionPipeline(
        _ pipeline: VisionPipeline,
        didOutput samples: [TrackedFaceSample],
        in sampleBuffer: CMSampleBuffer,
        timestamp: TimeInterval
    ) {
        for sample in samples {
            _ = trackManager.upsertTrack(
                trackId: sample.trackId,
                observation: sample.observation,
                timestamp: timestamp
            )

            if firstSeenByTrack[sample.trackId] == nil {
                firstSeenByTrack[sample.trackId] = timestamp
            }

            guard let alignedFace = sample.alignedFace else { continue }
            let t0 = CFAbsoluteTimeGetCurrent()

            do {
                let embedding = try embedder.extractEmbeddingSync(from: alignedFace)
                let inferMs = (CFAbsoluteTimeGetCurrent() - t0) * 1000.0
                inferenceLatenciesMs.append(inferMs)
                trackManager.updateTrackEmbedding(
                    trackId: sample.trackId,
                    embedding: embedding,
                    quality: sample.quality,
                    timestamp: timestamp
                )
            } catch {
                continue
            }
        }
        maxConcurrentTracks = max(maxConcurrentTracks, trackManager.tracks.count)
    }

    func trackManager(_ manager: TrackManager, didEmitEvent event: PersonEvent) {
        events.append(event)

        let eventTimeSec = Double(event.timestampMs) / 1000.0
        let trackId = event.trackId
        let toIdentity = event.userId.id
        let fromIdentity = currentIdentityByTrack[trackId]

        if event.eventType == .personEntered {
            var lifecycle = lifecycleCountsByTrack[trackId] ?? (entered: 0, left: 0)
            lifecycle.entered += 1
            lifecycleCountsByTrack[trackId] = lifecycle
        } else if event.eventType == .personLeft {
            var lifecycle = lifecycleCountsByTrack[trackId] ?? (entered: 0, left: 0)
            lifecycle.left += 1
            lifecycleCountsByTrack[trackId] = lifecycle
        }

        if event.userId.type == .enrolled && event.eventType == .personEntered {
            if let firstSeen = firstSeenByTrack[trackId] {
                let latency = max(0, eventTimeSec - firstSeen)
                idLatenciesByIdentity[toIdentity, default: []].append(latency)
            }

            if let from = fromIdentity, from != toIdentity {
                identityChangeMoments.append((eventTimeSec, trackId, from, toIdentity))
            }
            currentIdentityByTrack[trackId] = toIdentity
        } else if event.eventType == .personLeft {
            currentIdentityByTrack.removeValue(forKey: trackId)
            firstSeenByTrack.removeValue(forKey: trackId)
        }
    }
}

private func enroll(
    from video: EnrollmentVideo,
    config: PipelineConfig,
    embedder: FaceEmbedder
) throws -> GalleryStore.GalleryEntry {
    let pipeline = VisionPipeline(config: config)
    let collector = EnrollmentCollector()
    pipeline.delegate = collector

    let reader = VideoFrameReader(url: video.url)
    _ = try reader.readAll { sampleBuffer in
        let timestamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer).seconds
        pipeline.processFrame(sampleBuffer, timestamp: timestamp)
    }

    let bestSamples = collector.alignedSamples
        .sorted { $0.quality > $1.quality }
        .prefix(config.maxEnrollmentExemplars)

    var embeddings: [[Float]] = []
    var qualityAccumulator: Float = 0
    for sample in bestSamples {
        let embedding = try embedder.extractEmbeddingSync(from: sample.image)
        embeddings.append(embedding)
        qualityAccumulator += sample.quality
    }

    guard !embeddings.isEmpty, let centroid = GalleryStore.computeCentroid(from: embeddings) else {
        throw ValidationError.enrollmentFailed(video.identityId)
    }

    let avgQuality = qualityAccumulator / Float(embeddings.count)
    return GalleryStore.GalleryEntry(
        identityId: video.identityId,
        displayName: video.displayName,
        centroid: centroid,
        qualityScore: avgQuality
    )
}

private func mean(_ values: [Double]) -> Double {
    guard !values.isEmpty else { return 0 }
    return values.reduce(0, +) / Double(values.count)
}

private func percentile(_ values: [Double], p: Double) -> Double {
    guard !values.isEmpty else { return 0 }
    let sorted = values.sorted()
    let idx = min(sorted.count - 1, max(0, Int(Double(sorted.count - 1) * p)))
    return sorted[idx]
}

private func runRecognition(
    videoURL: URL,
    config: PipelineConfig,
    embedder: FaceEmbedder,
    gallery: GalleryStore
) throws -> RecognitionRunSummary {
    let recognition = RecognitionSession(config: config, embedder: embedder, galleryStore: gallery)
    let reader = VideoFrameReader(url: videoURL)
    _ = try reader.readAll { sampleBuffer in
        recognition.process(sampleBuffer)
    }
    recognition.finishSession()

    return RecognitionRunSummary(
        videoName: videoURL.lastPathComponent,
        events: recognition.events,
        inferenceLatenciesMs: recognition.inferenceLatenciesMs,
        idLatenciesByIdentity: recognition.idLatenciesByIdentity,
        identityChangeMoments: recognition.identityChangeMoments,
        maxConcurrentTracks: recognition.maxConcurrentTracks,
        lifecycleCountsByTrack: recognition.lifecycleCountsByTrack,
        conflictStats: recognition.conflictStats(),
        switchPairs: recognition.switchPairs()
    )
}

@main
struct VideoPipelineValidator {
    static func main() throws {
        let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        let videoDir = root.appendingPathComponent("testvideos")

        let enrollVideos: [EnrollmentVideo] = [
            .init(identityId: "profile1", displayName: "Profile 1", url: videoDir.appendingPathComponent("profile1enroll.MOV")),
            .init(identityId: "profile2", displayName: "Profile 2", url: videoDir.appendingPathComponent("profile2enroll.MOV")),
            .init(identityId: "profile3", displayName: "Profile 3", url: videoDir.appendingPathComponent("profile3enroll.MOV"))
        ]

        let candidateFeeds = [
            videoDir.appendingPathComponent("testvideofeed.MOV"),
            videoDir.appendingPathComponent("testvideofeed2.MOV")
        ]
        let testFeeds = candidateFeeds.filter { FileManager.default.fileExists(atPath: $0.path) }

        for video in enrollVideos {
            guard FileManager.default.fileExists(atPath: video.url.path) else {
                throw ValidationError.missingVideoTrack(video.url)
            }
        }
        guard !testFeeds.isEmpty else {
            throw ValidationError.missingVideoTrack(videoDir.appendingPathComponent("testvideofeed.MOV"))
        }

        let embedder = FaceEmbedder()
        try embedder.loadModel()

        var config = PipelineConfig()
        config.detectEveryNFrames = 4

        let gallery = GalleryStore()
        var enrollmentSummary: [(id: String, samplesUsed: Int, quality: Float)] = []
        for video in enrollVideos {
            let entry = try enroll(from: video, config: config, embedder: embedder)
            gallery.addEntry(entry)
            enrollmentSummary.append((video.identityId, config.maxEnrollmentExemplars, entry.qualityScore))
        }

        print("=== Enrollment Summary ===")
        print("embedder_model=\(embedder.currentModelName) version=\(embedder.currentModelVersion)")
        for item in enrollmentSummary {
            print("identity=\(item.id) selected_top_samples=\(item.samplesUsed) avg_quality=\(String(format: "%.3f", item.quality))")
        }

        for feedURL in testFeeds {
            let summary = try runRecognition(videoURL: feedURL, config: config, embedder: embedder, gallery: gallery)

            print("\n=== Recognition Report: \(summary.videoName) ===")
            print("max_concurrent_tracks=\(summary.maxConcurrentTracks)")
            print(
                "identity_conflicts observed=\(summary.conflictStats.observed) resolved=\(summary.conflictStats.resolved) suppressed=\(summary.conflictStats.suppressed)"
            )

            print("\n-- Per-Track Lifecycle Counts --")
            for (trackId, counts) in summary.lifecycleCountsByTrack.sorted(by: { $0.key < $1.key }) {
                print("track=\(trackId) entered=\(counts.entered) left=\(counts.left)")
            }

            print("\n-- Recognition Timeline (PersonEvents) --")
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            for event in summary.events.sorted(by: { $0.timestampMs < $1.timestampMs }) {
                let date = Date(timeIntervalSince1970: Double(event.timestampMs) / 1000.0)
                let tsIso = formatter.string(from: date)
                print(
                    "ts=\(tsIso) event=\(event.eventType.rawValue) track=\(event.trackId) user_type=\(event.userId.type.rawValue) user_id=\(event.userId.id) source=\(event.userId.source.rawValue) conf=\(String(format: "%.3f", event.confidence)) bearing=\(String(format: "%.3f", event.bearing)) distance=\(String(format: "%.3f", event.distanceProxy)) top1=\(String(format: "%.3f", event.similarityTop1)) top2=\(String(format: "%.3f", event.similarityTop2)) margin=\(String(format: "%.3f", event.margin))"
                )
            }

            print("\n-- Identification Latency (first_seen -> person_entered enrolled) --")
            for (identity, latencies) in summary.idLatenciesByIdentity.sorted(by: { $0.key < $1.key }) {
                let avg = mean(latencies)
                let p95 = percentile(latencies, p: 0.95)
                let samples = latencies.map { String(format: "%.3fs", $0) }.joined(separator: ", ")
                print("identity=\(identity) count=\(latencies.count) avg=\(String(format: "%.3fs", avg)) p95=\(String(format: "%.3fs", p95)) samples=[\(samples)]")
            }

            print("\n-- Identity Change Moments --")
            if summary.identityChangeMoments.isEmpty {
                print("none")
            } else {
                for change in summary.identityChangeMoments {
                    print("t=\(String(format: "%.3f", change.timestamp))s track=\(change.trackId) from=\(change.from) to=\(change.to)")
                }
            }

            print("\n-- Switch Pairs (left+entered same track) --")
            if summary.switchPairs.isEmpty {
                print("none")
            } else {
                for pair in summary.switchPairs {
                    print("t=\(String(format: "%.3f", pair.timestamp))s track=\(pair.trackId) from=\(pair.from) to=\(pair.to)")
                }
            }

            let infer = summary.inferenceLatenciesMs
            if !infer.isEmpty {
                print("\n-- Embedding Inference Latency --")
                print(
                    "samples=\(infer.count) avg=\(String(format: "%.2fms", mean(infer))) p95=\(String(format: "%.2fms", percentile(infer, p: 0.95))) max=\(String(format: "%.2fms", infer.max() ?? 0))"
                )
            }
        }
    }
}
