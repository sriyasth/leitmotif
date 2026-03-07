import Foundation

/// Handles read/write to existing Supabase `contacts` and `face_embeddings` tables via REST.
final class SupabaseSync {
    private let supabaseUrl: String
    private let supabaseAnonKey: String
    private let session: URLSession

    init(supabaseUrl: String, supabaseAnonKey: String) {
        self.supabaseUrl = supabaseUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        self.supabaseAnonKey = supabaseAnonKey
        self.session = URLSession(configuration: .default)
    }

    // MARK: - Load Gallery

    /// Fetch enrolled embeddings joined with contacts to hydrate the local gallery.
    func loadGallery(completion: @escaping (Result<[GalleryStore.GalleryEntry], Error>) -> Void) {
        let urlString = "\(supabaseUrl)/rest/v1/face_embeddings?select=user_id,embedding,quality_score,contacts(user_id,name)&order=created_at.desc"
        guard let url = URL(string: urlString) else {
            completion(.failure(SyncError.invalidURL))
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        applyAuthHeaders(&request)
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        session.dataTask(with: request) { data, response, error in
            if let error {
                completion(.failure(error))
                return
            }

            guard let data else {
                completion(.failure(SyncError.noData))
                return
            }

            guard let httpResponse = response as? HTTPURLResponse else {
                completion(.failure(SyncError.httpError(statusCode: -1, body: nil)))
                return
            }

            guard (200...299).contains(httpResponse.statusCode) else {
                completion(.failure(SyncError.httpError(statusCode: httpResponse.statusCode, body: String(data: data, encoding: .utf8))))
                return
            }

            do {
                let rows = try JSONDecoder().decode([EmbeddingJoinRow].self, from: data)
                let entries = self.buildGalleryEntries(from: rows)
                completion(.success(entries))
            } catch {
                completion(.failure(error))
            }
        }.resume()
    }

    // MARK: - Write Contact

    /// Upsert a contact row.
    func insertContact(
        userId: String,
        name: String,
        leitmotifId: String?,
        metadata: [String: Any]?,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        let urlString = "\(supabaseUrl)/rest/v1/contacts?on_conflict=user_id"
        guard let url = URL(string: urlString) else {
            completion(.failure(SyncError.invalidURL))
            return
        }

        var body: [String: Any] = [
            "user_id": userId,
            "name": name,
            "leitmotif_id": leitmotifId ?? NSNull()
        ]
        if let metadata {
            body["metadata"] = metadata
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        applyAuthHeaders(&request)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("resolution=merge-duplicates,return=minimal", forHTTPHeaderField: "Prefer")

        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        } catch {
            completion(.failure(error))
            return
        }

        performWrite(request: request, completion: completion)
    }

    // MARK: - Write Embedding

    /// Insert a face embedding row.
    func insertFaceEmbedding(
        id: String,
        userId: String,
        embedding: [Float],
        qualityScore: Float,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        let urlString = "\(supabaseUrl)/rest/v1/face_embeddings"
        guard let url = URL(string: urlString) else {
            completion(.failure(SyncError.invalidURL))
            return
        }

        let embeddingVector = "[" + embedding.map { String(format: "%.8f", $0) }.joined(separator: ",") + "]"
        let body: [String: Any] = [
            "id": id,
            "user_id": userId,
            "embedding": embeddingVector,
            "quality_score": qualityScore
        ]

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        applyAuthHeaders(&request)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("return=minimal", forHTTPHeaderField: "Prefer")

        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        } catch {
            completion(.failure(error))
            return
        }

        performWrite(request: request, completion: completion)
    }

    // MARK: - Person Event Sync

    /// Insert a person event row (fire-and-forget).
    func insertPersonEvent(_ event: PersonEvent) {
        let urlString = "\(supabaseUrl)/rest/v1/person_events"
        guard let url = URL(string: urlString) else { return }

        let body: [String: Any] = [
            "track_id": event.trackId,
            "event_type": event.eventType.rawValue,
            "user_type": event.userId.type.rawValue,
            "user_id": event.userId.id,
            "source": event.userId.source.rawValue,
            "confidence": event.confidence,
            "bearing": event.bearing,
            "distance_proxy": event.distanceProxy,
            "similarity_top1": event.similarityTop1,
            "similarity_top2": event.similarityTop2,
            "margin": event.margin,
            "timestamp_ms": event.timestampMs
        ]

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        applyAuthHeaders(&request)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("return=minimal", forHTTPHeaderField: "Prefer")

        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        } catch { return }

        session.dataTask(with: request) { _, _, _ in }.resume()
    }

    /// Upsert a persons registry row (fire-and-forget).
    func upsertPerson(userId: String, userType: String, displayName: String?, confidence: Float) {
        let urlString = "\(supabaseUrl)/rest/v1/persons?on_conflict=user_id"
        guard let url = URL(string: urlString) else { return }

        var body: [String: Any] = [
            "user_id": userId,
            "user_type": userType,
            "last_seen_at": ISO8601DateFormatter().string(from: Date()),
            "last_confidence": confidence
        ]
        if let displayName {
            body["display_name"] = displayName
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        applyAuthHeaders(&request)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("resolution=merge-duplicates,return=minimal", forHTTPHeaderField: "Prefer")

        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        } catch { return }

        session.dataTask(with: request) { _, _, _ in }.resume()
    }

    /// Update the visible_users ledger: upsert on entered/updated, delete on left (fire-and-forget).
    func syncVisibleUser(_ event: PersonEvent) {
        let userId = event.userId.id

        if event.eventType == .personLeft {
            // DELETE from visible_users
            let urlString = "\(supabaseUrl)/rest/v1/visible_users?user_id=eq.\(userId)"
            guard let url = URL(string: urlString) else { return }

            var request = URLRequest(url: url)
            request.httpMethod = "DELETE"
            applyAuthHeaders(&request)

            session.dataTask(with: request) { _, _, _ in }.resume()
            return
        }

        // On person_entered, clear any previous visible_user for this track (handles identity transitions)
        if event.eventType == .personEntered {
            let clearUrlString = "\(supabaseUrl)/rest/v1/visible_users?track_id=eq.\(event.trackId)"
            if let clearUrl = URL(string: clearUrlString) {
                var clearRequest = URLRequest(url: clearUrl)
                clearRequest.httpMethod = "DELETE"
                applyAuthHeaders(&clearRequest)
                session.dataTask(with: clearRequest) { _, _, _ in }.resume()
            }
        }

        // UPSERT for entered/updated
        let urlString = "\(supabaseUrl)/rest/v1/visible_users?on_conflict=user_id"
        guard let url = URL(string: urlString) else { return }

        let body: [String: Any] = [
            "user_id": userId,
            "user_type": event.userId.type.rawValue,
            "track_id": event.trackId,
            "confidence": event.confidence,
            "bearing": event.bearing,
            "distance_proxy": event.distanceProxy,
            "updated_at": ISO8601DateFormatter().string(from: Date())
        ]

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        applyAuthHeaders(&request)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("resolution=merge-duplicates,return=minimal", forHTTPHeaderField: "Prefer")

        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        } catch { return }

        session.dataTask(with: request) { _, _, _ in }.resume()
    }

    // MARK: - Scene Description Sync

    /// Upsert the current scene description (fire-and-forget).
    func syncSceneDescription(_ scene: SceneDescription) {
        let urlString = "\(supabaseUrl)/rest/v1/scene_descriptions?on_conflict=id"
        guard let url = URL(string: urlString) else { return }

        let body: [String: Any] = [
            "id": 1,
            "description": scene.description,
            "model": scene.model,
            "timestamp_ms": scene.timestampMs,
            "updated_at": ISO8601DateFormatter().string(from: Date())
        ]

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        applyAuthHeaders(&request)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("resolution=merge-duplicates,return=minimal", forHTTPHeaderField: "Prefer")

        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        } catch { return }

        session.dataTask(with: request) { _, _, _ in }.resume()
    }

    // MARK: - Helpers

    private func applyAuthHeaders(_ request: inout URLRequest) {
        request.setValue("Bearer \(supabaseAnonKey)", forHTTPHeaderField: "Authorization")
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
    }

    private func performWrite(request: URLRequest, completion: @escaping (Result<Void, Error>) -> Void) {
        session.dataTask(with: request) { data, response, error in
            if let error {
                completion(.failure(error))
                return
            }

            guard let httpResponse = response as? HTTPURLResponse else {
                completion(.failure(SyncError.httpError(statusCode: -1, body: nil)))
                return
            }

            guard (200...299).contains(httpResponse.statusCode) else {
                let body = data.flatMap { String(data: $0, encoding: .utf8) }
                completion(.failure(SyncError.httpError(statusCode: httpResponse.statusCode, body: body)))
                return
            }

            completion(.success(()))
        }.resume()
    }

    private func buildGalleryEntries(from rows: [EmbeddingJoinRow]) -> [GalleryStore.GalleryEntry] {
        // Keep one centroid per identity (highest quality row).
        var bestRowsByUser: [String: EmbeddingJoinRow] = [:]

        for row in rows {
            guard row.parsedEmbedding != nil else { continue }
            let existing = bestRowsByUser[row.userId]
            if existing == nil || (row.qualityScore ?? 0) > (existing?.qualityScore ?? 0) {
                bestRowsByUser[row.userId] = row
            }
        }

        return bestRowsByUser.values.compactMap { row in
            guard let embedding = row.parsedEmbedding else { return nil }
            let normalized = FaceEmbedder.l2Normalize(embedding)
            let displayName = row.contactName ?? row.userId
            return GalleryStore.GalleryEntry(
                identityId: row.userId,
                displayName: displayName,
                centroid: normalized,
                qualityScore: row.qualityScore ?? 0
            )
        }
    }

    // MARK: - Decoding Types

    private struct EmbeddingJoinRow: Decodable {
        let userId: String
        let embeddingPayload: EmbeddingPayload
        let qualityScore: Float?
        let contactsPayload: ContactsPayload?

        enum CodingKeys: String, CodingKey {
            case userId = "user_id"
            case embeddingPayload = "embedding"
            case qualityScore = "quality_score"
            case contactsPayload = "contacts"
        }

        var parsedEmbedding: [Float]? { embeddingPayload.asFloatArray() }

        var contactName: String? {
            switch contactsPayload {
            case .none:
                return nil
            case .one(let contact):
                return contact.name
            case .many(let contacts):
                return contacts.first?.name
            }
        }
    }

    private enum ContactsPayload: Decodable {
        case one(ContactInfo)
        case many([ContactInfo])

        init(from decoder: Decoder) throws {
            let container = try decoder.singleValueContainer()
            if let single = try? container.decode(ContactInfo.self) {
                self = .one(single)
                return
            }
            if let many = try? container.decode([ContactInfo].self) {
                self = .many(many)
                return
            }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid contacts payload")
        }
    }

    private struct ContactInfo: Decodable {
        let userId: String?
        let name: String

        enum CodingKeys: String, CodingKey {
            case userId = "user_id"
            case name
        }
    }

    private enum EmbeddingPayload: Decodable {
        case vector([Float])
        case vectorString(String)

        init(from decoder: Decoder) throws {
            let container = try decoder.singleValueContainer()
            if let vector = try? container.decode([Float].self) {
                self = .vector(vector)
                return
            }
            if let vectorDoubles = try? container.decode([Double].self) {
                self = .vector(vectorDoubles.map(Float.init))
                return
            }
            if let raw = try? container.decode(String.self) {
                self = .vectorString(raw)
                return
            }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid embedding payload")
        }

        func asFloatArray() -> [Float]? {
            switch self {
            case .vector(let vec):
                return vec
            case .vectorString(let raw):
                return Self.parseVectorString(raw)
            }
        }

        private static func parseVectorString(_ raw: String) -> [Float]? {
            // Supports "[0.1,0.2]" and "{0.1,0.2}" variants.
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            let withoutBrackets = trimmed
                .replacingOccurrences(of: "[", with: "")
                .replacingOccurrences(of: "]", with: "")
                .replacingOccurrences(of: "{", with: "")
                .replacingOccurrences(of: "}", with: "")

            let parts = withoutBrackets
                .split(separator: ",")
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }

            guard !parts.isEmpty else { return nil }

            var vector: [Float] = []
            vector.reserveCapacity(parts.count)
            for part in parts {
                guard let value = Float(part) else { return nil }
                vector.append(value)
            }
            return vector
        }
    }
}

enum SyncError: LocalizedError {
    case invalidURL
    case noData
    case httpError(statusCode: Int, body: String?)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid Supabase URL"
        case .noData:
            return "No data returned from Supabase"
        case .httpError(let statusCode, let body):
            if let body, !body.isEmpty {
                return "Supabase HTTP error \(statusCode): \(body)"
            }
            return "Supabase HTTP error: \(statusCode)"
        }
    }
}
