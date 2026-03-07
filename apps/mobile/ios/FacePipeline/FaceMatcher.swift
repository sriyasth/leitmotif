import Foundation

final class FaceMatcher {
    private let similarityThreshold: Float
    private let marginThreshold: Float

    init(similarityThreshold: Float = 0.52, marginThreshold: Float = 0.06) {
        self.similarityThreshold = similarityThreshold
        self.marginThreshold = marginThreshold
    }

    /// Match an embedding against the gallery using centroid cosine similarity.
    /// Applies threshold + margin gating.
    func match(embedding: [Float], in gallery: GalleryStore) -> MatchResult {
        guard !gallery.isEmpty else {
            return MatchResult(
                identityId: nil, confidence: 0,
                similarityTop1: 0, similarityTop2: 0, margin: 0,
                reason: .noGallery
            )
        }

        let topResults = gallery.search(query: embedding, topK: 3)

        guard let top1 = topResults.first else {
            return MatchResult(
                identityId: nil, confidence: 0,
                similarityTop1: 0, similarityTop2: 0, margin: 0,
                reason: .noGallery
            )
        }

        let top2Similarity = topResults.count > 1 ? topResults[1].similarity : 0.0
        let margin = top1.similarity - top2Similarity

        // Gate A: similarity threshold
        guard top1.similarity >= similarityThreshold else {
            return MatchResult(
                identityId: nil,
                confidence: top1.similarity,
                similarityTop1: top1.similarity,
                similarityTop2: top2Similarity,
                margin: margin,
                reason: .belowThreshold
            )
        }

        // Gate B: margin between top1 and top2
        guard margin >= marginThreshold else {
            return MatchResult(
                identityId: nil,
                confidence: top1.similarity,
                similarityTop1: top1.similarity,
                similarityTop2: top2Similarity,
                margin: margin,
                reason: .lowMargin
            )
        }

        return MatchResult(
            identityId: top1.identityId,
            confidence: top1.similarity,
            similarityTop1: top1.similarity,
            similarityTop2: top2Similarity,
            margin: margin,
            reason: .matched
        )
    }
}
