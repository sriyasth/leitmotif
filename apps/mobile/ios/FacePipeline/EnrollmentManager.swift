import Foundation
import CoreGraphics

protocol EnrollmentManagerDelegate: AnyObject {
    func enrollmentManager(_ manager: EnrollmentManager, didComplete result: EnrollmentResult)
    func enrollmentManager(_ manager: EnrollmentManager, didFail error: Error)
    func enrollmentManager(_ manager: EnrollmentManager, didCaptureSample count: Int, of total: Int)
}

final class EnrollmentManager {
    weak var delegate: EnrollmentManagerDelegate?

    private let embedder: FaceEmbedder
    private let galleryStore: GalleryStore
    private let supabaseSync: SupabaseSync?
    private let config: PipelineConfig

    private var isEnrolling = false
    private var currentInput: EnrollContactInput?
    private var capturedSamples: [(image: CGImage, quality: Float)] = []
    private var enrollmentTimer: Timer?

    init(embedder: FaceEmbedder, galleryStore: GalleryStore, supabaseSync: SupabaseSync?, config: PipelineConfig) {
        self.embedder = embedder
        self.galleryStore = galleryStore
        self.supabaseSync = supabaseSync
        self.config = config
    }

    var enrolling: Bool { isEnrolling }

    /// Start burst enrollment. Collects quality-ranked face crops for burst_seconds.
    func startEnrollment(input: EnrollContactInput) {
        guard !isEnrolling else { return }

        cancelEnrollment()
        isEnrolling = true
        currentInput = input

        let duration = max(2.0, min(5.0, input.burstSeconds))
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.enrollmentTimer = Timer.scheduledTimer(withTimeInterval: duration, repeats: false) { [weak self] _ in
                self?.finishEnrollment()
            }
        }
    }

    /// Called by the pipeline when a quality-gated aligned face is available during enrollment.
    func addSample(faceImage: CGImage, quality: Float) {
        guard isEnrolling else { return }
        capturedSamples.append((image: faceImage, quality: quality))
        delegate?.enrollmentManager(
            self,
            didCaptureSample: min(capturedSamples.count, config.maxEnrollmentExemplars),
            of: config.maxEnrollmentExemplars
        )
    }

    func cancelEnrollment() {
        isEnrolling = false
        currentInput = nil
        capturedSamples.removeAll()
        enrollmentTimer?.invalidate()
        enrollmentTimer = nil
    }

    // MARK: - Private

    private func finishEnrollment() {
        enrollmentTimer?.invalidate()
        enrollmentTimer = nil

        guard isEnrolling, let input = currentInput else {
            cancelEnrollment()
            return
        }

        isEnrolling = false

        // Select top-quality samples.
        let sorted = capturedSamples.sorted { $0.quality > $1.quality }
        let selected = Array(sorted.prefix(config.maxEnrollmentExemplars))
        let qualityScores = selected.map(\.quality)

        guard !selected.isEmpty else {
            resetEnrollmentState()
            delegate?.enrollmentManager(self, didFail: EnrollmentError.noSamplesCaptured)
            return
        }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }

            var embeddings: [[Float]] = []
            var usedQualityScores: [Float] = []

            for sample in selected {
                do {
                    let embedding = try self.embedder.extractEmbeddingSync(from: sample.image)
                    embeddings.append(embedding)
                    usedQualityScores.append(sample.quality)
                } catch {
                    continue
                }
            }

            guard !embeddings.isEmpty else {
                DispatchQueue.main.async {
                    self.resetEnrollmentState()
                    self.delegate?.enrollmentManager(self, didFail: EnrollmentError.embeddingFailed)
                }
                return
            }

            guard let centroid = GalleryStore.computeCentroid(from: embeddings) else {
                DispatchQueue.main.async {
                    self.resetEnrollmentState()
                    self.delegate?.enrollmentManager(self, didFail: EnrollmentError.centroidFailed)
                }
                return
            }

            let identityId = input.contactExternalId
            let avgQuality = usedQualityScores.reduce(0, +) / Float(max(1, usedQualityScores.count))
            let centroidId = UUID().uuidString

            let entry = GalleryStore.GalleryEntry(
                identityId: identityId,
                displayName: input.displayName,
                centroid: centroid,
                qualityScore: avgQuality
            )
            self.galleryStore.addEntry(entry)

            self.persistToSupabase(
                input: input,
                identityId: identityId,
                centroidId: centroidId,
                centroid: centroid,
                qualityScore: avgQuality,
                qualityScores: qualityScores
            ) { result in
                DispatchQueue.main.async {
                    defer { self.resetEnrollmentState() }

                    switch result {
                    case .success:
                        let completion = EnrollmentResult(
                            identityId: identityId,
                            templatesAdded: embeddings.count,
                            centroidId: centroidId
                        )
                        self.delegate?.enrollmentManager(self, didComplete: completion)
                    case .failure(let error):
                        self.galleryStore.removeEntry(identityId: identityId)
                        self.delegate?.enrollmentManager(self, didFail: error)
                    }
                }
            }
        }
    }

    private func persistToSupabase(
        input: EnrollContactInput,
        identityId: String,
        centroidId: String,
        centroid: [Float],
        qualityScore: Float,
        qualityScores: [Float],
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        guard let sync = supabaseSync else {
            completion(.success(()))
            return
        }

        let metadata: [String: Any] = [
            "owner_user_id": input.ownerUserId,
            "contact_external_id": input.contactExternalId,
            "display_name": input.displayName,
            "burst_seconds": input.burstSeconds,
            "quality_scores": qualityScores,
            "quality_avg": qualityScore,
            "model_name": embedder.currentModelName,
            "model_version": embedder.currentModelVersion,
            "centroid_id": centroidId
        ]

        sync.insertContact(
            userId: identityId,
            name: input.displayName,
            leitmotifId: nil,
            metadata: metadata
        ) { [weak self] contactResult in
            guard let self else { return }

            switch contactResult {
            case .failure(let error):
                completion(.failure(error))
            case .success:
                sync.insertFaceEmbedding(
                    id: centroidId,
                    userId: identityId,
                    embedding: centroid,
                    qualityScore: qualityScore
                ) { embeddingResult in
                    switch embeddingResult {
                    case .success:
                        completion(.success(()))
                    case .failure(let error):
                        completion(.failure(error))
                    }
                }
            }
        }
    }

    private func resetEnrollmentState() {
        currentInput = nil
        capturedSamples.removeAll()
        enrollmentTimer?.invalidate()
        enrollmentTimer = nil
        isEnrolling = false
    }
}

enum EnrollmentError: LocalizedError {
    case noSamplesCaptured
    case embeddingFailed
    case centroidFailed

    var errorDescription: String? {
        switch self {
        case .noSamplesCaptured:
            return "No face samples captured during enrollment burst"
        case .embeddingFailed:
            return "Failed to extract embeddings from captured samples"
        case .centroidFailed:
            return "Failed to compute centroid from captured embeddings"
        }
    }
}
