import Vision
import CoreGraphics

struct QualityAssessment {
    let qualityScore: Float
    let faceWidth: CGFloat
    let passesGate: Bool
}

final class QualityGate {
    private let minQuality: Float
    private let minFaceWidth: CGFloat

    init(minQuality: Float = 0.35, minFaceWidth: CGFloat = 80.0) {
        self.minQuality = minQuality
        self.minFaceWidth = minFaceWidth
    }

    /// Assess face quality using capture quality and face box size.
    /// - Parameters:
    ///   - qualityScore: Capture quality score from Vision (0..1)
    ///   - faceBoundingBox: Normalized Vision bounding box (0..1)
    ///   - imageWidth: Width of the source image in pixels
    /// - Returns: Quality assessment with pass/fail
    func assess(qualityScore: Float, faceBoundingBox: CGRect, imageWidth: CGFloat) -> QualityAssessment {
        let faceWidth = faceBoundingBox.width * imageWidth

        let passes = qualityScore >= minQuality && faceWidth >= minFaceWidth
        return QualityAssessment(
            qualityScore: qualityScore,
            faceWidth: faceWidth,
            passesGate: passes
        )
    }

    /// Run VNDetectFaceCaptureQualityRequest to populate quality scores on observations.
    func qualityRequest() -> VNDetectFaceCaptureQualityRequest {
        VNDetectFaceCaptureQualityRequest()
    }
}
