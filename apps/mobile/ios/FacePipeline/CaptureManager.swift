import AVFoundation
import UIKit

protocol CaptureManagerDelegate: AnyObject {
    func captureManager(_ manager: CaptureManager, didOutput sampleBuffer: CMSampleBuffer)
}

final class CaptureManager: NSObject {
    weak var delegate: CaptureManagerDelegate?

    private let session = AVCaptureSession()
    private let videoOutput = AVCaptureVideoDataOutput()
    private let processingQueue = DispatchQueue(label: "com.sensible.capture", qos: .userInteractive)

    private(set) var isRunning = false

    func configure(resolution: AVCaptureSession.Preset = .hd1280x720) throws {
        session.beginConfiguration()
        session.sessionPreset = resolution

        guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
            throw CaptureError.noCameraAvailable
        }

        let input = try AVCaptureDeviceInput(device: camera)
        guard session.canAddInput(input) else {
            throw CaptureError.cannotAddInput
        }
        session.addInput(input)

        // Configure for 30 fps
        try camera.lockForConfiguration()
        camera.activeVideoMinFrameDuration = CMTime(value: 1, timescale: 30)
        camera.activeVideoMaxFrameDuration = CMTime(value: 1, timescale: 30)
        camera.unlockForConfiguration()

        videoOutput.alwaysDiscardsLateVideoFrames = true
        videoOutput.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
        ]
        videoOutput.setSampleBufferDelegate(self, queue: processingQueue)

        guard session.canAddOutput(videoOutput) else {
            throw CaptureError.cannotAddOutput
        }
        session.addOutput(videoOutput)

        // Lock orientation to portrait for consistent coordinate space
        if let connection = videoOutput.connection(with: .video) {
            if connection.isVideoRotationAngleSupported(90) {
                connection.videoRotationAngle = 90
            }
        }

        session.commitConfiguration()
    }

    func start() {
        guard !isRunning else { return }
        processingQueue.async { [weak self] in
            self?.session.startRunning()
        }
        isRunning = true
    }

    func stop() {
        guard isRunning else { return }
        processingQueue.async { [weak self] in
            self?.session.stopRunning()
        }
        isRunning = false
    }
}

// MARK: - AVCaptureVideoDataOutputSampleBufferDelegate

extension CaptureManager: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        delegate?.captureManager(self, didOutput: sampleBuffer)
    }
}

// MARK: - Errors

enum CaptureError: LocalizedError {
    case noCameraAvailable
    case cannotAddInput
    case cannotAddOutput

    var errorDescription: String? {
        switch self {
        case .noCameraAvailable: return "No rear camera available"
        case .cannotAddInput: return "Cannot add camera input to session"
        case .cannotAddOutput: return "Cannot add video output to session"
        }
    }
}
