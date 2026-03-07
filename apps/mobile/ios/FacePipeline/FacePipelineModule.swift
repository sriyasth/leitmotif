import Foundation
import React
import AVFoundation

@objc(FacePipelineModule)
class FacePipelineModule: RCTEventEmitter {
    private var config = PipelineConfig()
    private var captureManager: CaptureManager?
    private var visionPipeline: VisionPipeline?
    private var trackManager: TrackManager?
    private var embedder: FaceEmbedder?
    private var galleryStore: GalleryStore?
    private var faceMatcher: FaceMatcher?
    private var enrollmentManager: EnrollmentManager?
    private var supabaseSync: SupabaseSync?
    private var sceneDescriber: SceneDescriber?

    private var isRunning = false
    private var hasListeners = false
    private var visibleUserIds: [String: String] = [:] // trackId -> userId
    private var currentSceneDescription: String = ""

    private var enrollmentResolver: RCTPromiseResolveBlock?
    private var enrollmentRejecter: RCTPromiseRejectBlock?

    // MARK: - RCTEventEmitter

    override static func requiresMainQueueSetup() -> Bool { false }

    override func supportedEvents() -> [String] {
        ["onPersonEvent", "onPipelineError", "onEnrollmentProgress", "onEnrollmentComplete", "onSceneDescription"]
    }

    override func startObserving() { hasListeners = true }
    override func stopObserving() { hasListeners = false }

    // MARK: - JS-Exposed Methods

    @objc func startPipeline(
        _ options: NSDictionary,
        resolver: @escaping RCTPromiseResolveBlock,
        rejecter: @escaping RCTPromiseRejectBlock
    ) {
        guard !isRunning else {
            resolver(["status": "already_running"])
            return
        }

        if let detectN = options["detectEveryNFrames"] as? Int {
            config.detectEveryNFrames = max(1, min(10, detectN))
        }

        if let supabaseConfig = resolveSupabaseConfig(from: options) {
            supabaseSync = SupabaseSync(
                supabaseUrl: supabaseConfig.url,
                supabaseAnonKey: supabaseConfig.anonKey
            )
        } else {
            supabaseSync = nil
        }

        galleryStore = GalleryStore()
        faceMatcher = FaceMatcher(
            similarityThreshold: config.similarityThreshold,
            marginThreshold: config.marginThreshold
        )
        trackManager = TrackManager(config: config, galleryStore: galleryStore!, faceMatcher: faceMatcher!)
        trackManager?.delegate = self

        embedder = FaceEmbedder()
        do {
            try embedder?.loadModel()
        } catch {
            emitError("Failed to load embedding backend: \(error.localizedDescription)")
        }

        enrollmentManager = EnrollmentManager(
            embedder: embedder!,
            galleryStore: galleryStore!,
            supabaseSync: supabaseSync,
            config: config
        )
        enrollmentManager?.delegate = self

        if let geminiKey = resolveGeminiApiKey(from: options) {
            let interval = options["sceneDescriptionIntervalSeconds"] as? TimeInterval ?? config.sceneDescriptionIntervalSeconds
            let model = options["geminiModel"] as? String ?? config.geminiModel
            sceneDescriber = SceneDescriber(apiKey: geminiKey, intervalSeconds: interval, model: model)
            sceneDescriber?.delegate = self
        }

        visionPipeline = VisionPipeline(config: config)
        visionPipeline?.delegate = self

        captureManager = CaptureManager()
        captureManager?.delegate = self

        do {
            try captureManager?.configure(resolution: .hd1280x720)
            captureManager?.start()
            sceneDescriber?.start()
            isRunning = true
            resolver(["status": "started"])
        } catch {
            rejecter("CAPTURE_ERROR", error.localizedDescription, error)
        }
    }

    @objc func stopPipeline(
        _ resolver: @escaping RCTPromiseResolveBlock,
        rejecter: @escaping RCTPromiseRejectBlock
    ) {
        captureManager?.stop()
        sceneDescriber?.stop()
        visionPipeline?.reset()
        trackManager?.reset()
        enrollmentManager?.cancelEnrollment()

        isRunning = false
        resolver(["status": "stopped"])
    }

    @objc func enrollContact(
        _ options: NSDictionary,
        resolver: @escaping RCTPromiseResolveBlock,
        rejecter: @escaping RCTPromiseRejectBlock
    ) {
        guard let ownerUserId = options["owner_user_id"] as? String,
              let contactExternalId = options["contact_external_id"] as? String,
              let displayName = options["display_name"] as? String else {
            rejecter(
                "INVALID_INPUT",
                "Missing required fields: owner_user_id, contact_external_id, display_name",
                nil
            )
            return
        }

        guard isRunning else {
            rejecter("PIPELINE_NOT_RUNNING", "Pipeline must be started before enrollment", nil)
            return
        }

        guard embedder?.isReady == true else {
            rejecter("MODEL_NOT_READY", "Face embedding backend is not ready", nil)
            return
        }

        let burstSeconds = options["burst_seconds"] as? Double ?? config.enrollmentBurstSeconds
        let input = EnrollContactInput(
            ownerUserId: ownerUserId,
            contactExternalId: contactExternalId,
            displayName: displayName,
            burstSeconds: burstSeconds
        )

        enrollmentResolver = resolver
        enrollmentRejecter = rejecter
        enrollmentManager?.startEnrollment(input: input)
    }

    @objc func loadGallery(
        _ resolver: @escaping RCTPromiseResolveBlock,
        rejecter: @escaping RCTPromiseRejectBlock
    ) {
        guard let sync = supabaseSync, let gallery = galleryStore else {
            rejecter("NOT_CONFIGURED", "Supabase not configured or pipeline not started", nil)
            return
        }

        sync.loadGallery { result in
            switch result {
            case .success(let entries):
                gallery.clear()
                entries.forEach { gallery.addEntry($0) }
                resolver(["contacts_loaded": entries.count])
            case .failure(let error):
                rejecter("LOAD_FAILED", error.localizedDescription, error)
            }
        }
    }

    // MARK: - Private

    private func emitEvent(name: String, body: [String: Any]) {
        guard hasListeners else { return }
        sendEvent(withName: name, body: body)
    }

    private func emitError(_ message: String) {
        emitEvent(name: "onPipelineError", body: ["message": message])
    }

    private func resolveGeminiApiKey(from options: NSDictionary) -> String? {
        let optionKey = options["geminiApiKey"] as? String
        let envKey = ProcessInfo.processInfo.environment["EXPO_PUBLIC_GEMINI_API_KEY"]
        guard let key = optionKey ?? envKey, !key.isEmpty else { return nil }
        return key
    }

    private func resolveSupabaseConfig(from options: NSDictionary) -> (url: String, anonKey: String)? {
        let optionUrl = options["supabaseUrl"] as? String
        let optionKey = options["supabaseAnonKey"] as? String

        let envUrl = ProcessInfo.processInfo.environment["EXPO_PUBLIC_SUPABASE_URL"]
        let envKey = ProcessInfo.processInfo.environment["EXPO_PUBLIC_SUPABASE_ANON_KEY"]

        guard let url = optionUrl ?? envUrl,
              let anonKey = optionKey ?? envKey,
              !url.isEmpty,
              !anonKey.isEmpty else {
            return nil
        }

        return (url, anonKey)
    }
}

// MARK: - CaptureManagerDelegate

extension FacePipelineModule: CaptureManagerDelegate {
    func captureManager(_ manager: CaptureManager, didOutput sampleBuffer: CMSampleBuffer) {
        let timestamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer).seconds
        visionPipeline?.processFrame(sampleBuffer, timestamp: timestamp)
        trackManager?.pruneStale(currentTime: timestamp)

        if let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) {
            sceneDescriber?.updateLatestFrame(pixelBuffer)
        }
    }
}

// MARK: - VisionPipelineDelegate

extension FacePipelineModule: VisionPipelineDelegate {
    func visionPipeline(
        _ pipeline: VisionPipeline,
        didOutput samples: [TrackedFaceSample],
        in sampleBuffer: CMSampleBuffer,
        timestamp: TimeInterval
    ) {
        for sample in samples {
            _ = trackManager?.upsertTrack(
                trackId: sample.trackId,
                observation: sample.observation,
                timestamp: timestamp
            )

            guard let alignedFace = sample.alignedFace else { continue }

            if enrollmentManager?.enrolling == true {
                enrollmentManager?.addSample(faceImage: alignedFace, quality: sample.quality)
                continue
            }

            guard embedder?.isReady == true else { continue }

            let trackId = sample.trackId
            let quality = sample.quality
            embedder?.extractEmbedding(from: alignedFace) { [weak self] result in
                switch result {
                case .success(let embedding):
                    self?.trackManager?.updateTrackEmbedding(
                        trackId: trackId,
                        embedding: embedding,
                        quality: quality,
                        timestamp: timestamp
                    )
                case .failure(let error):
                    self?.emitError("Embedding extraction failed: \(error.localizedDescription)")
                }
            }
        }
    }

    private func writeVisibleUsersFile() {
        guard let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
        let fileUrl = docs.appendingPathComponent("visible_users.txt")
        let csv = visibleUserIds.values.joined(separator: ",")
        let content = "visible_users: \(csv)\nscene_description: \(currentSceneDescription)"
        try? content.write(to: fileUrl, atomically: true, encoding: .utf8)
    }
}

// MARK: - TrackManagerDelegate

extension FacePipelineModule: TrackManagerDelegate {
    func trackManager(_ manager: TrackManager, didEmitEvent event: PersonEvent) {
        emitEvent(name: "onPersonEvent", body: event.toDictionary())

        // Sync to Supabase (fire-and-forget)
        supabaseSync?.insertPersonEvent(event)
        supabaseSync?.upsertPerson(
            userId: event.userId.id,
            userType: event.userId.type.rawValue,
            displayName: nil,
            confidence: event.confidence
        )
        supabaseSync?.syncVisibleUser(event)

        // Update local visible_users file
        switch event.eventType {
        case .personEntered, .personUpdated:
            visibleUserIds[event.trackId] = event.userId.id
        case .personLeft:
            visibleUserIds.removeValue(forKey: event.trackId)
        }
        writeVisibleUsersFile()
    }
}

// MARK: - EnrollmentManagerDelegate

extension FacePipelineModule: EnrollmentManagerDelegate {
    func enrollmentManager(_ manager: EnrollmentManager, didComplete result: EnrollmentResult) {
        emitEvent(name: "onEnrollmentComplete", body: result.toDictionary())
        enrollmentResolver?(result.toDictionary())
        enrollmentResolver = nil
        enrollmentRejecter = nil
    }

    func enrollmentManager(_ manager: EnrollmentManager, didFail error: Error) {
        emitError("Enrollment failed: \(error.localizedDescription)")
        enrollmentRejecter?("ENROLLMENT_FAILED", error.localizedDescription, error)
        enrollmentResolver = nil
        enrollmentRejecter = nil
    }

    func enrollmentManager(_ manager: EnrollmentManager, didCaptureSample count: Int, of total: Int) {
        emitEvent(name: "onEnrollmentProgress", body: ["captured": count, "target": total])
    }
}

// MARK: - SceneDescriberDelegate

extension FacePipelineModule: SceneDescriberDelegate {
    func sceneDescriber(_ describer: SceneDescriber, didDescribeScene description: SceneDescription) {
        emitEvent(name: "onSceneDescription", body: description.toDictionary())
        supabaseSync?.syncSceneDescription(description)
        currentSceneDescription = description.description
        writeVisibleUsersFile()
    }

    func sceneDescriber(_ describer: SceneDescriber, didFailWithError error: Error) {
        emitError("Scene description failed: \(error.localizedDescription)")
    }
}
