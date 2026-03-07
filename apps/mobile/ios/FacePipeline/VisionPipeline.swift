import Vision
import CoreMedia
import CoreImage
import CoreGraphics

struct TrackedFaceSample {
    let trackId: String
    let observation: VNFaceObservation
    let quality: Float
    let alignedFace: CGImage?
}

protocol VisionPipelineDelegate: AnyObject {
    func visionPipeline(
        _ pipeline: VisionPipeline,
        didOutput samples: [TrackedFaceSample],
        in sampleBuffer: CMSampleBuffer,
        timestamp: TimeInterval
    )
}

final class VisionPipeline {
    weak var delegate: VisionPipelineDelegate?

    private struct VisionTrack {
        var trackId: String
        var request: VNTrackObjectRequest
        var lastObservation: VNDetectedObjectObservation
        var lastSeenTimestamp: TimeInterval
    }

    private let frameScheduler: FrameScheduler
    private let qualityGate: QualityGate
    private var sequenceHandler = VNSequenceRequestHandler()
    private var activeTracks: [String: VisionTrack] = [:]

    // Per-track embedding cooldown
    private var lastEmbedTime: [String: TimeInterval] = [:]
    private var lastEmbedQuality: [String: Float] = [:]
    private let embeddingCooldownMs: Int
    private let qualityImprovementThreshold: Float = 0.08

    private let trackingConfidenceThreshold: VNConfidence = 0.3
    private let detectionToTrackIoUThreshold: CGFloat = 0.35
    private let trackRetentionSec: TimeInterval = 2.0

    init(config: PipelineConfig) {
        self.frameScheduler = FrameScheduler(detectEveryNFrames: config.detectEveryNFrames)
        self.qualityGate = QualityGate(minQuality: config.qualityThreshold, minFaceWidth: config.minFaceWidth)
        self.embeddingCooldownMs = config.embeddingCooldownMs
    }

    func processFrame(_ sampleBuffer: CMSampleBuffer, timestamp: TimeInterval) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let imageWidth = CGFloat(CVPixelBufferGetWidth(pixelBuffer))

        if frameScheduler.shouldDetect() {
            runDetection(
                pixelBuffer: pixelBuffer,
                imageWidth: imageWidth,
                sampleBuffer: sampleBuffer,
                timestamp: timestamp
            )
        } else {
            runTracking(
                pixelBuffer: pixelBuffer,
                sampleBuffer: sampleBuffer,
                timestamp: timestamp
            )
        }
    }

    func reset() {
        frameScheduler.reset()
        sequenceHandler = VNSequenceRequestHandler()
        activeTracks.removeAll()
        lastEmbedTime.removeAll()
        lastEmbedQuality.removeAll()
    }

    // MARK: - Detection

    private func runDetection(
        pixelBuffer: CVPixelBuffer,
        imageWidth: CGFloat,
        sampleBuffer: CMSampleBuffer,
        timestamp: TimeInterval
    ) {
        let detectRequest = VNDetectFaceRectanglesRequest()
        let qualityRequest = qualityGate.qualityRequest()
        let landmarksRequest = VNDetectFaceLandmarksRequest()

        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, options: [:])
        do {
            try handler.perform([detectRequest, qualityRequest, landmarksRequest])
        } catch {
            return
        }

        let detectedFaces = detectRequest.results ?? []
        if detectedFaces.isEmpty {
            pruneInactiveVisionTracks(currentTimestamp: timestamp)
            return
        }

        let qualityObservations = qualityRequest.results ?? []
        let landmarkObservations = landmarksRequest.results ?? []
        var samples: [TrackedFaceSample] = []

        for face in detectedFaces {
            let trackId = resolveTrackId(for: face)
            refreshVisionTrack(trackId: trackId, with: face, timestamp: timestamp)

            let qualityScore = qualityForFace(face, qualityObservations: qualityObservations)
            let qualityAssessment = qualityGate.assess(
                qualityScore: qualityScore,
                faceBoundingBox: face.boundingBox,
                imageWidth: imageWidth
            )

            var alignedFace: CGImage?
            if qualityAssessment.passesGate && shouldEmbed(trackId: trackId, quality: qualityScore, timestamp: timestamp) {
                let landmarkFace = bestMatchingLandmark(for: face, landmarkObservations: landmarkObservations)
                alignedFace = extractAlignedFace(
                    from: pixelBuffer,
                    observation: face,
                    landmarkObservation: landmarkFace
                )

                if alignedFace != nil {
                    lastEmbedTime[trackId] = timestamp
                    lastEmbedQuality[trackId] = qualityScore
                }
            }

            samples.append(
                TrackedFaceSample(
                    trackId: trackId,
                    observation: face,
                    quality: qualityScore,
                    alignedFace: alignedFace
                )
            )
        }

        pruneInactiveVisionTracks(currentTimestamp: timestamp)
        delegate?.visionPipeline(self, didOutput: samples, in: sampleBuffer, timestamp: timestamp)
    }

    // MARK: - Tracking

    private func runTracking(pixelBuffer: CVPixelBuffer, sampleBuffer: CMSampleBuffer, timestamp: TimeInterval) {
        guard !activeTracks.isEmpty else { return }

        var updatedTracks: [String: VisionTrack] = [:]
        var samples: [TrackedFaceSample] = []

        for (trackId, track) in activeTracks {
            let request = track.request

            do {
                try sequenceHandler.perform([request], on: pixelBuffer)
            } catch {
                continue
            }

            guard let result = request.results?.first, result.confidence >= trackingConfidenceThreshold else {
                continue
            }

            let nextRequest = VNTrackObjectRequest(detectedObjectObservation: result)
            nextRequest.trackingLevel = .fast

            let updatedTrack = VisionTrack(
                trackId: trackId,
                request: nextRequest,
                lastObservation: result,
                lastSeenTimestamp: timestamp
            )
            updatedTracks[trackId] = updatedTrack

            let faceObservation = VNFaceObservation(boundingBox: result.boundingBox)
            samples.append(
                TrackedFaceSample(
                    trackId: trackId,
                    observation: faceObservation,
                    quality: 0.0,
                    alignedFace: nil
                )
            )
        }

        activeTracks = updatedTracks
        pruneInactiveVisionTracks(currentTimestamp: timestamp)

        if !samples.isEmpty {
            delegate?.visionPipeline(self, didOutput: samples, in: sampleBuffer, timestamp: timestamp)
        }
    }

    // MARK: - Track Mapping

    private func resolveTrackId(for observation: VNFaceObservation) -> String {
        let incomingBox = observation.boundingBox
        var bestTrackId: String?
        var bestIoU: CGFloat = detectionToTrackIoUThreshold

        for (trackId, track) in activeTracks {
            let iou = computeIoU(incomingBox, track.lastObservation.boundingBox)
            if iou > bestIoU {
                bestIoU = iou
                bestTrackId = trackId
            }
        }

        return bestTrackId ?? UUID().uuidString
    }

    private func refreshVisionTrack(trackId: String, with observation: VNFaceObservation, timestamp: TimeInterval) {
        let request = VNTrackObjectRequest(detectedObjectObservation: observation)
        request.trackingLevel = .fast

        activeTracks[trackId] = VisionTrack(
            trackId: trackId,
            request: request,
            lastObservation: observation,
            lastSeenTimestamp: timestamp
        )
    }

    private func pruneInactiveVisionTracks(currentTimestamp: TimeInterval) {
        for (trackId, track) in activeTracks {
            if currentTimestamp - track.lastSeenTimestamp > trackRetentionSec {
                activeTracks.removeValue(forKey: trackId)
                lastEmbedTime.removeValue(forKey: trackId)
                lastEmbedQuality.removeValue(forKey: trackId)
            }
        }
    }

    private func computeIoU(_ a: CGRect, _ b: CGRect) -> CGFloat {
        let intersection = a.intersection(b)
        guard !intersection.isNull else { return 0 }
        let intersectionArea = intersection.width * intersection.height
        let unionArea = (a.width * a.height) + (b.width * b.height) - intersectionArea
        guard unionArea > 0 else { return 0 }
        return intersectionArea / unionArea
    }

    // MARK: - Quality + Landmarks

    private func qualityForFace(_ face: VNFaceObservation, qualityObservations: [VNFaceObservation]) -> Float {
        var bestQuality: Float = face.faceCaptureQuality ?? 0.0
        var bestIoU: CGFloat = 0.0

        for qualityObs in qualityObservations {
            let iou = computeIoU(face.boundingBox, qualityObs.boundingBox)
            if iou > bestIoU {
                bestIoU = iou
                bestQuality = qualityObs.faceCaptureQuality ?? bestQuality
            }
        }

        return bestQuality
    }

    private func bestMatchingLandmark(
        for face: VNFaceObservation,
        landmarkObservations: [VNFaceObservation]
    ) -> VNFaceObservation? {
        var best: VNFaceObservation?
        var bestIoU: CGFloat = 0.0

        for landmarkObs in landmarkObservations {
            let iou = computeIoU(face.boundingBox, landmarkObs.boundingBox)
            if iou > bestIoU {
                bestIoU = iou
                best = landmarkObs
            }
        }

        return best
    }

    // MARK: - Embedding Cooldown

    private func shouldEmbed(trackId: String, quality: Float, timestamp: TimeInterval) -> Bool {
        let cooldownSec = Double(embeddingCooldownMs) / 1000.0

        guard let lastTime = lastEmbedTime[trackId] else {
            return true
        }

        let elapsed = timestamp - lastTime
        if elapsed >= cooldownSec {
            return true
        }

        let lastQuality = lastEmbedQuality[trackId] ?? 0.0
        if quality - lastQuality >= qualityImprovementThreshold {
            return true
        }

        return false
    }

    // MARK: - Face Alignment

    private func extractAlignedFace(
        from pixelBuffer: CVPixelBuffer,
        observation: VNFaceObservation,
        landmarkObservation: VNFaceObservation?
    ) -> CGImage? {
        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        let imageWidth = CGFloat(CVPixelBufferGetWidth(pixelBuffer))
        let imageHeight = CGFloat(CVPixelBufferGetHeight(pixelBuffer))
        let fullBounds = CGRect(x: 0, y: 0, width: imageWidth, height: imageHeight)

        // Fallback crop from bounding box.
        let faceRect = denormalizedRect(observation.boundingBox, imageWidth: imageWidth, imageHeight: imageHeight)
        var cropRect = faceRect.insetBy(dx: -faceRect.width * 0.2, dy: -faceRect.height * 0.2)

        // Landmark-informed crop center/scale if available.
        if let landmarks = landmarkObservation?.landmarks,
           let landmarkRect = landmarkAlignedRect(
                landmarks: landmarks,
                faceBox: observation.boundingBox,
                imageWidth: imageWidth,
                imageHeight: imageHeight
           ) {
            cropRect = landmarkRect
        }

        cropRect = cropRect.intersection(fullBounds)
        guard cropRect.width > 1, cropRect.height > 1 else { return nil }

        let cropped = ciImage.cropped(to: cropRect)
        let targetSize: CGFloat = 112
        let scale = max(targetSize / cropped.extent.width, targetSize / cropped.extent.height)
        let scaled = cropped.transformed(by: CGAffineTransform(scaleX: scale, y: scale))

        let centeredRect = CGRect(
            x: scaled.extent.midX - targetSize / 2.0,
            y: scaled.extent.midY - targetSize / 2.0,
            width: targetSize,
            height: targetSize
        )
        let centered = scaled.cropped(to: centeredRect)
        let translated = centered.transformed(
            by: CGAffineTransform(
                translationX: -centered.extent.origin.x,
                y: -centered.extent.origin.y
            )
        )

        let context = CIContext(options: [.useSoftwareRenderer: false])
        return context.createCGImage(translated, from: CGRect(x: 0, y: 0, width: targetSize, height: targetSize))
    }

    private func denormalizedRect(_ normalized: CGRect, imageWidth: CGFloat, imageHeight: CGFloat) -> CGRect {
        CGRect(
            x: normalized.origin.x * imageWidth,
            y: normalized.origin.y * imageHeight,
            width: normalized.width * imageWidth,
            height: normalized.height * imageHeight
        )
    }

    private func landmarkAlignedRect(
        landmarks: VNFaceLandmarks2D,
        faceBox: CGRect,
        imageWidth: CGFloat,
        imageHeight: CGFloat
    ) -> CGRect? {
        let points = landmarkAnchorPoints(
            landmarks: landmarks,
            faceBox: faceBox,
            imageWidth: imageWidth,
            imageHeight: imageHeight
        )
        guard points.count >= 2 else { return nil }

        let center = averagePoint(points)
        let minX = points.map(\.x).min() ?? center.x
        let maxX = points.map(\.x).max() ?? center.x
        let minY = points.map(\.y).min() ?? center.y
        let maxY = points.map(\.y).max() ?? center.y

        let faceRect = denormalizedRect(faceBox, imageWidth: imageWidth, imageHeight: imageHeight)
        let landmarkSpan = max(maxX - minX, maxY - minY)
        let side = max(faceRect.width, faceRect.height, landmarkSpan * 2.2)

        return CGRect(
            x: center.x - side / 2.0,
            y: center.y - side / 2.0,
            width: side,
            height: side
        )
    }

    private func landmarkAnchorPoints(
        landmarks: VNFaceLandmarks2D,
        faceBox: CGRect,
        imageWidth: CGFloat,
        imageHeight: CGFloat
    ) -> [CGPoint] {
        var points: [CGPoint] = []

        if let p = regionCenter(landmarks.leftEye, faceBox: faceBox, imageWidth: imageWidth, imageHeight: imageHeight) {
            points.append(p)
        }
        if let p = regionCenter(landmarks.rightEye, faceBox: faceBox, imageWidth: imageWidth, imageHeight: imageHeight) {
            points.append(p)
        }
        if let p = regionCenter(landmarks.nose, faceBox: faceBox, imageWidth: imageWidth, imageHeight: imageHeight) {
            points.append(p)
        }
        if let p = regionCenter(landmarks.outerLips, faceBox: faceBox, imageWidth: imageWidth, imageHeight: imageHeight) {
            points.append(p)
        }
        if let p = regionCenter(landmarks.innerLips, faceBox: faceBox, imageWidth: imageWidth, imageHeight: imageHeight) {
            points.append(p)
        }

        return points
    }

    private func regionCenter(
        _ region: VNFaceLandmarkRegion2D?,
        faceBox: CGRect,
        imageWidth: CGFloat,
        imageHeight: CGFloat
    ) -> CGPoint? {
        guard let region else { return nil }
        let count = region.pointCount
        guard count > 0 else { return nil }
        let normalizedPoints = region.normalizedPoints

        var converted: [CGPoint] = []
        converted.reserveCapacity(count)

        for i in 0..<count {
            let point = normalizedPoints[i]
            let xNorm = faceBox.origin.x + CGFloat(point.x) * faceBox.width
            let yNorm = faceBox.origin.y + CGFloat(point.y) * faceBox.height
            converted.append(
                CGPoint(
                    x: xNorm * imageWidth,
                    y: yNorm * imageHeight
                )
            )
        }

        return averagePoint(converted)
    }

    private func averagePoint(_ points: [CGPoint]) -> CGPoint {
        guard !points.isEmpty else { return .zero }
        let sum = points.reduce(CGPoint.zero) { partial, point in
            CGPoint(x: partial.x + point.x, y: partial.y + point.y)
        }
        let invCount = 1.0 / CGFloat(points.count)
        return CGPoint(x: sum.x * invCount, y: sum.y * invCount)
    }
}
