import Foundation
import AVFoundation
import CoreImage
import UIKit

protocol SceneDescriberDelegate: AnyObject {
    func sceneDescriber(_ describer: SceneDescriber, didDescribeScene description: SceneDescription)
    func sceneDescriber(_ describer: SceneDescriber, didFailWithError error: Error)
}

final class SceneDescriber {
    weak var delegate: SceneDescriberDelegate?

    private let apiKey: String
    private let model: String
    private let intervalSeconds: TimeInterval
    private let session: URLSession

    private var timer: DispatchSourceTimer?
    private let describeQueue = DispatchQueue(label: "com.sensible.sceneDescriber", qos: .utility)
    private let bufferLock = NSLock()
    private var latestJPEGData: Data?
    private var isDescribing = false

    init(apiKey: String, intervalSeconds: TimeInterval = 15.0, model: String = "gemini-2.0-flash") {
        self.apiKey = apiKey
        self.intervalSeconds = intervalSeconds
        self.model = model
        self.session = URLSession(configuration: .default)
    }

    // MARK: - Public

    /// Call from the capture callback to store the latest frame as JPEG.
    func updateLatestFrame(_ pixelBuffer: CVPixelBuffer) {
        let jpegData = convertToJPEG(pixelBuffer)
        bufferLock.lock()
        latestJPEGData = jpegData
        bufferLock.unlock()
    }

    func start() {
        let timer = DispatchSource.makeTimerSource(queue: describeQueue)
        timer.schedule(deadline: .now() + intervalSeconds, repeating: intervalSeconds)
        timer.setEventHandler { [weak self] in
            self?.describeCurrentScene()
        }
        timer.resume()
        self.timer = timer
    }

    func stop() {
        timer?.cancel()
        timer = nil
        bufferLock.lock()
        latestJPEGData = nil
        bufferLock.unlock()
    }

    // MARK: - Private

    private func describeCurrentScene() {
        guard !isDescribing else { return }

        bufferLock.lock()
        let jpegData = latestJPEGData
        bufferLock.unlock()

        guard let jpegData, !jpegData.isEmpty else { return }

        isDescribing = true
        let base64 = jpegData.base64EncodedString()
        callGeminiAPI(imageBase64: base64)
    }

    private func callGeminiAPI(imageBase64: String) {
        let urlString = "https://generativelanguage.googleapis.com/v1beta/models/\(model):generateContent?key=\(apiKey)"
        guard let url = URL(string: urlString) else {
            isDescribing = false
            return
        }

        let body: [String: Any] = [
            "contents": [
                [
                    "parts": [
                        ["text": "Describe the vibe of this scene in 1-2 sentences. Focus on the mood, atmosphere, and what people seem to be doing. Be concise."],
                        ["inline_data": ["mime_type": "image/jpeg", "data": imageBase64]]
                    ]
                ]
            ],
            "generationConfig": [
                "maxOutputTokens": 1024,
                "temperature": 0.7
            ]
        ]

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        } catch {
            isDescribing = false
            delegate?.sceneDescriber(self, didFailWithError: error)
            return
        }

        session.dataTask(with: request) { [weak self] data, response, error in
            guard let self else { return }
            defer { self.isDescribing = false }

            if let error {
                self.delegate?.sceneDescriber(self, didFailWithError: error)
                return
            }

            guard let data else {
                self.delegate?.sceneDescriber(self, didFailWithError: SceneDescriberError.noData)
                return
            }

            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode) else {
                let statusCode = (response as? HTTPURLResponse)?.statusCode ?? -1
                let body = String(data: data, encoding: .utf8)
                self.delegate?.sceneDescriber(self, didFailWithError: SceneDescriberError.httpError(statusCode: statusCode, body: body))
                return
            }

            do {
                let text = try self.parseGeminiResponse(data)
                let scene = SceneDescription(
                    description: text,
                    timestampMs: Int64(Date().timeIntervalSince1970 * 1000),
                    model: self.model
                )
                self.delegate?.sceneDescriber(self, didDescribeScene: scene)
            } catch {
                self.delegate?.sceneDescriber(self, didFailWithError: error)
            }
        }.resume()
    }

    private func parseGeminiResponse(_ data: Data) throws -> String {
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let candidates = json["candidates"] as? [[String: Any]],
              let firstCandidate = candidates.first,
              let content = firstCandidate["content"] as? [String: Any],
              let parts = content["parts"] as? [[String: Any]],
              let firstPart = parts.first,
              let text = firstPart["text"] as? String else {
            throw SceneDescriberError.invalidResponse
        }
        return text
    }

    private func convertToJPEG(_ pixelBuffer: CVPixelBuffer) -> Data? {
        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        let context = CIContext()
        guard let cgImage = context.createCGImage(ciImage, from: ciImage.extent) else { return nil }
        let uiImage = UIImage(cgImage: cgImage)
        return uiImage.jpegData(compressionQuality: 0.6)
    }

}

enum SceneDescriberError: LocalizedError {
    case noData
    case httpError(statusCode: Int, body: String?)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .noData:
            return "No data returned from Gemini API"
        case .httpError(let statusCode, let body):
            if let body, !body.isEmpty {
                return "Gemini API error \(statusCode): \(body)"
            }
            return "Gemini API error: \(statusCode)"
        case .invalidResponse:
            return "Could not parse Gemini API response"
        }
    }
}
