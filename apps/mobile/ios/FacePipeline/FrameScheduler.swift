import Foundation

final class FrameScheduler {
    private let detectEveryN: Int
    private var frameCount: Int = 0

    init(detectEveryNFrames: Int = 4) {
        self.detectEveryN = max(1, detectEveryNFrames)
    }

    /// Returns true on frames where full detection should run.
    /// Tracking runs on every frame regardless.
    func shouldDetect() -> Bool {
        frameCount += 1
        return frameCount % detectEveryN == 0
    }

    func reset() {
        frameCount = 0
    }
}
