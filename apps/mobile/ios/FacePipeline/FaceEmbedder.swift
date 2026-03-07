import Foundation
import CoreML
import Vision
import CoreGraphics
import Accelerate

final class FaceEmbedder {
    private enum Backend {
        case coreML(VNCoreMLModel)
        case visionFeaturePrint
    }

    private var backend: Backend?
    private let inferenceQueue = DispatchQueue(label: "com.sensible.face_embedder", qos: .userInitiated)

    private(set) var currentModelName: String = "none"
    private(set) var currentModelVersion: String = "0"

    /// Whether the embedder is ready to produce embeddings.
    var isReady: Bool { backend != nil }

    /// Load the best available embedding backend.
    /// Priority: AdaFace IR-SE-50 -> EdgeFace XS -> MobileFaceNet -> Vision FeaturePrint.
    func loadModel() throws {
        if tryLoadCoreMLModel(named: "AdaFace_IR50", version: "ir-se50") {
            return
        }

        if tryLoadCoreMLModel(named: "EdgeFaceXS", version: "xs") {
            return
        }

        if tryLoadCoreMLModel(named: "MobileFaceNet", version: "1.0") {
            return
        }

        // Last-resort fallback available on-device without bundled model.
        backend = .visionFeaturePrint
        currentModelName = "VisionFeaturePrint"
        currentModelVersion = "ios"
    }

    /// Extract a normalized embedding from an aligned face image.
    func extractEmbedding(from faceImage: CGImage, completion: @escaping (Result<[Float], Error>) -> Void) {
        inferenceQueue.async { [weak self] in
            guard let self else { return }
            do {
                let embedding = try self.extractEmbeddingSync(from: faceImage)
                completion(.success(embedding))
            } catch {
                completion(.failure(error))
            }
        }
    }

    /// Synchronous extraction path used by enrollment.
    func extractEmbeddingSync(from faceImage: CGImage) throws -> [Float] {
        guard let backend else {
            throw EmbedderError.modelNotLoaded
        }

        switch backend {
        case .coreML(let model):
            return try extractCoreMLEmbedding(from: faceImage, model: model)
        case .visionFeaturePrint:
            return try extractFeaturePrintEmbedding(from: faceImage)
        }
    }

    // MARK: - CoreML Path

    private func loadCoreMLModel(named resourceName: String, version: String) throws -> Bool {
        let candidateURL = resolveModelURL(resourceName: resourceName)

        guard let modelURL = candidateURL else { return false }

        let loadURL: URL
        if modelURL.pathExtension == "mlpackage" {
            loadURL = try MLModel.compileModel(at: modelURL)
        } else {
            loadURL = modelURL
        }

        let mlModel = try MLModel(contentsOf: loadURL)
        let visionModel = try VNCoreMLModel(for: mlModel)
        backend = .coreML(visionModel)
        currentModelName = resourceName
        currentModelVersion = version
        return true
    }

    private func tryLoadCoreMLModel(named resourceName: String, version: String) -> Bool {
        do {
            return try loadCoreMLModel(named: resourceName, version: version)
        } catch {
            print("[FaceEmbedder] Failed loading \(resourceName): \(error.localizedDescription)")
            return false
        }
    }

    private func resolveModelURL(resourceName: String) -> URL? {
        if let bundled =
            Bundle.main.url(forResource: resourceName, withExtension: "mlmodelc")
            ?? Bundle.main.url(forResource: resourceName, withExtension: "mlpackage") {
            return bundled
        }

        let envDir = ProcessInfo.processInfo.environment["FACE_EMBEDDER_MODEL_DIR"]
        let cwd = FileManager.default.currentDirectoryPath
        let searchDirs = [envDir, "\(cwd)/models"].compactMap { $0 }

        for dir in searchDirs {
            let modelc = URL(fileURLWithPath: dir).appendingPathComponent("\(resourceName).mlmodelc")
            if FileManager.default.fileExists(atPath: modelc.path) {
                return modelc
            }
            let mlpackage = URL(fileURLWithPath: dir).appendingPathComponent("\(resourceName).mlpackage")
            if FileManager.default.fileExists(atPath: mlpackage.path) {
                return mlpackage
            }
        }

        return nil
    }

    private func extractCoreMLEmbedding(from faceImage: CGImage, model: VNCoreMLModel) throws -> [Float] {
        let request = VNCoreMLRequest(model: model)
        request.imageCropAndScaleOption = .scaleFill

        let handler = VNImageRequestHandler(cgImage: faceImage, options: [:])
        try handler.perform([request])

        guard let results = request.results else {
            throw EmbedderError.noResults
        }

        for result in results {
            guard let featureResult = result as? VNCoreMLFeatureValueObservation else { continue }
            guard let multiArray = featureResult.featureValue.multiArrayValue else { continue }
            let embedding = Self.multiArrayToFloatArray(multiArray)
            guard !embedding.isEmpty else { continue }
            return Self.l2Normalize(embedding)
        }

        throw EmbedderError.unexpectedOutputFormat
    }

    // MARK: - Vision Feature Print Fallback

    private func extractFeaturePrintEmbedding(from faceImage: CGImage) throws -> [Float] {
        let request = VNGenerateImageFeaturePrintRequest()
        let handler = VNImageRequestHandler(cgImage: faceImage, options: [:])
        try handler.perform([request])

        guard let observation = request.results?.first as? VNFeaturePrintObservation else {
            throw EmbedderError.noResults
        }

        guard let rawData = rawFeaturePrintData(from: observation) else {
            throw EmbedderError.unexpectedOutputFormat
        }

        var embedding = bytesToFloatVector(rawData)
        if embedding.isEmpty {
            throw EmbedderError.unexpectedOutputFormat
        }

        // Normalize dimensionality for gallery compatibility.
        if embedding.count > 512 {
            embedding = Array(embedding.prefix(512))
        } else if embedding.count < 512 {
            embedding.append(contentsOf: [Float](repeating: 0, count: 512 - embedding.count))
        }

        return Self.l2Normalize(embedding)
    }

    private func rawFeaturePrintData(from observation: VNFeaturePrintObservation) -> Data? {
        let selectors = [
            NSSelectorFromString("data"),
            NSSelectorFromString("featurePrintData")
        ]

        for selector in selectors where observation.responds(to: selector) {
            guard let unmanaged = observation.perform(selector) else { continue }
            let value = unmanaged.takeUnretainedValue()
            if let data = value as? Data {
                return data
            }
            if let nsData = value as? NSData {
                return nsData as Data
            }
        }

        return nil
    }

    private func bytesToFloatVector(_ data: Data) -> [Float] {
        if data.count.isMultiple(of: MemoryLayout<Float>.size) {
            let count = data.count / MemoryLayout<Float>.size
            return data.withUnsafeBytes { raw in
                guard let base = raw.baseAddress?.assumingMemoryBound(to: Float.self) else {
                    return []
                }
                return Array(UnsafeBufferPointer(start: base, count: count))
            }
        }

        return data.map { Float($0) / 255.0 }
    }

    // MARK: - Helpers

    private static func multiArrayToFloatArray(_ multiArray: MLMultiArray) -> [Float] {
        guard multiArray.count > 0 else { return [] }
        let count = multiArray.count

        switch multiArray.dataType {
        case .float32:
            let ptr = multiArray.dataPointer.bindMemory(to: Float32.self, capacity: count)
            return Array(UnsafeBufferPointer(start: ptr, count: count)).map { Float($0) }
        case .double:
            let ptr = multiArray.dataPointer.bindMemory(to: Double.self, capacity: count)
            return Array(UnsafeBufferPointer(start: ptr, count: count)).map { Float($0) }
        case .int32:
            let ptr = multiArray.dataPointer.bindMemory(to: Int32.self, capacity: count)
            return Array(UnsafeBufferPointer(start: ptr, count: count)).map { Float($0) }
        default:
            let ptr = multiArray.dataPointer.bindMemory(to: Float32.self, capacity: count)
            return Array(UnsafeBufferPointer(start: ptr, count: count)).map { Float($0) }
        }
    }

    static func l2Normalize(_ vector: [Float]) -> [Float] {
        var sumSquares: Float = 0
        vDSP_dotpr(vector, 1, vector, 1, &sumSquares, vDSP_Length(vector.count))
        let norm = sqrt(sumSquares)
        guard norm > 1e-10 else { return vector }
        var result = [Float](repeating: 0, count: vector.count)
        var normVal = norm
        vDSP_vsdiv(vector, 1, &normVal, &result, 1, vDSP_Length(vector.count))
        return result
    }
}

enum EmbedderError: LocalizedError {
    case modelNotLoaded
    case noResults
    case unexpectedOutputFormat

    var errorDescription: String? {
        switch self {
        case .modelNotLoaded:
            return "Face embedding backend not loaded"
        case .noResults:
            return "Embedding request produced no results"
        case .unexpectedOutputFormat:
            return "Embedding output format is unsupported"
        }
    }
}
