import Foundation
import CoreGraphics

// MARK: - User ID

struct UserIdJson: Codable {
    enum IdType: String, Codable {
        case enrolled
        case unknown
    }
    enum Source: String, Codable {
        case identity
        case track
    }
    let type: IdType
    let id: String
    let source: Source

    func toDictionary() -> [String: String] {
        ["type": type.rawValue, "id": id, "source": source.rawValue]
    }
}

// MARK: - Person Event

struct PersonEvent {
    enum EventType: String {
        case personEntered = "person_entered"
        case personUpdated = "person_updated"
        case personLeft = "person_left"
    }

    let eventType: EventType
    let trackId: String
    let userId: UserIdJson
    let confidence: Float
    let bearing: Float          // -1..1 (left to right)
    let distanceProxy: Float    // estimated from face box size
    let similarityTop1: Float
    let similarityTop2: Float
    let margin: Float
    let timestampMs: Int64

    func toDictionary() -> [String: Any] {
        [
            "event_type": eventType.rawValue,
            "track_id": trackId,
            "user_id": userId.toDictionary(),
            "confidence": confidence,
            "bearing": bearing,
            "distance_proxy": distanceProxy,
            "similarity_top1": similarityTop1,
            "similarity_top2": similarityTop2,
            "margin": margin,
            "timestamp_ms": timestampMs
        ]
    }
}

// MARK: - Enrollment

struct EnrollContactInput {
    let ownerUserId: String
    let contactExternalId: String
    let displayName: String
    let burstSeconds: Double // default 3, allowed 2..5
}

struct EnrollmentResult {
    let identityId: String
    let templatesAdded: Int
    let centroidId: String

    func toDictionary() -> [String: Any] {
        [
            "identity_id": identityId,
            "templates_added": templatesAdded,
            "centroid_id": centroidId
        ]
    }
}

// MARK: - Track State

enum TrackState: String {
    case new
    case candidate
    case known
    case unknown
    case lost
    case exited
}

// MARK: - Match Result

struct MatchResult {
    let identityId: String?
    let confidence: Float
    let similarityTop1: Float
    let similarityTop2: Float
    let margin: Float
    let reason: MatchReason
}

enum MatchReason: String {
    case matched
    case belowThreshold = "below_threshold"
    case lowMargin = "low_margin"
    case lowQuality = "low_quality"
    case noGallery = "no_gallery"
}

// MARK: - Pipeline Config

struct PipelineConfig {
    var resolution: (width: Int, height: Int) = (1280, 720)
    var fps: Int = 30
    var detectEveryNFrames: Int = 4
    var qualityThreshold: Float = 0.35
    var minFaceWidth: CGFloat = 80.0
    var similarityThreshold: Float = 0.52
    var marginThreshold: Float = 0.06
    var embeddingCooldownMs: Int = 300
    var lostTimeoutMs: Int = 700
    var consecutiveMatchesRequired: Int = 2
    var enrollmentBurstSeconds: Double = 3.0
    var maxEnrollmentExemplars: Int = 6
}

// MARK: - Supabase Row Types

struct ContactRow: Codable {
    let userId: String
    let name: String
    let leitmotifId: String?
    let createdAt: String
    let metadata: [String: AnyCodable]?

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case name
        case leitmotifId = "leitmotif_id"
        case createdAt = "created_at"
        case metadata
    }
}

struct FaceEmbeddingRow: Codable {
    let id: String
    let userId: String
    let embedding: [Float]
    let qualityScore: Float
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case embedding
        case qualityScore = "quality_score"
        case createdAt = "created_at"
    }
}

// MARK: - AnyCodable (lightweight wrapper for JSON metadata)

struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let s = try? container.decode(String.self) { value = s }
        else if let i = try? container.decode(Int.self) { value = i }
        else if let d = try? container.decode(Double.self) { value = d }
        else if let b = try? container.decode(Bool.self) { value = b }
        else { value = NSNull() }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case let s as String: try container.encode(s)
        case let i as Int: try container.encode(i)
        case let d as Double: try container.encode(d)
        case let b as Bool: try container.encode(b)
        default: try container.encodeNil()
        }
    }
}
