import Foundation
import Accelerate

/// In-memory gallery of enrolled face embeddings, backed by Supabase sync.
final class GalleryStore {
    struct GalleryEntry {
        let identityId: String
        let displayName: String
        let centroid: [Float]       // L2-normalized 512-dim
        let qualityScore: Float
    }

    private var entries: [String: GalleryEntry] = [:]  // keyed by identityId
    private let lock = NSLock()

    var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return entries.count
    }

    var isEmpty: Bool { count == 0 }

    // MARK: - Gallery Operations

    func addEntry(_ entry: GalleryEntry) {
        lock.lock()
        entries[entry.identityId] = entry
        lock.unlock()
    }

    func removeEntry(identityId: String) {
        lock.lock()
        entries.removeValue(forKey: identityId)
        lock.unlock()
    }

    func getEntry(identityId: String) -> GalleryEntry? {
        lock.lock()
        defer { lock.unlock() }
        return entries[identityId]
    }

    func allEntries() -> [GalleryEntry] {
        lock.lock()
        defer { lock.unlock() }
        return Array(entries.values)
    }

    func clear() {
        lock.lock()
        entries.removeAll()
        lock.unlock()
    }

    // MARK: - Search

    struct SearchResult {
        let identityId: String
        let displayName: String
        let similarity: Float
    }

    /// Find top-k matches by cosine similarity against all centroids.
    func search(query: [Float], topK: Int = 3) -> [SearchResult] {
        lock.lock()
        let currentEntries = Array(entries.values)
        lock.unlock()

        guard !currentEntries.isEmpty else { return [] }

        var results: [SearchResult] = currentEntries.map { entry in
            let sim = Self.cosineSimilarity(query, entry.centroid)
            return SearchResult(identityId: entry.identityId, displayName: entry.displayName, similarity: sim)
        }

        results.sort { $0.similarity > $1.similarity }
        return Array(results.prefix(topK))
    }

    // MARK: - Cosine Similarity (SIMD-accelerated)

    static func cosineSimilarity(_ a: [Float], _ b: [Float]) -> Float {
        guard a.count == b.count, !a.isEmpty else { return 0 }
        // Both vectors are already L2-normalized, so dot product = cosine similarity
        var dotProduct: Float = 0
        vDSP_dotpr(a, 1, b, 1, &dotProduct, vDSP_Length(a.count))
        return dotProduct
    }

    /// Compute centroid from multiple embeddings by averaging and re-normalizing.
    static func computeCentroid(from embeddings: [[Float]]) -> [Float]? {
        guard let first = embeddings.first else { return nil }
        let dim = first.count
        var sum = [Float](repeating: 0, count: dim)

        for emb in embeddings {
            guard emb.count == dim else { continue }
            vDSP_vadd(sum, 1, emb, 1, &sum, 1, vDSP_Length(dim))
        }

        var count = Float(embeddings.count)
        vDSP_vsdiv(sum, 1, &count, &sum, 1, vDSP_Length(dim))

        return FaceEmbedder.l2Normalize(sum)
    }
}
