import { describe, it, expect } from "vitest"
import { filterToVocabulary } from "../src/object-filter"

describe("filterToVocabulary", () => {
  it("keeps only objects in DEMO_OBJECT_CLASSES", () => {
    const candidates = [
      { label: "couch", confidence: 0.9, bounding_box: { x: 0, y: 0, w: 0.5, h: 0.5 } },
      { label: "cat", confidence: 0.8, bounding_box: { x: 0, y: 0, w: 0.2, h: 0.2 } },
      { label: "lamp", confidence: 0.7, bounding_box: { x: 0, y: 0, w: 0.1, h: 0.3 } },
    ]
    const result = filterToVocabulary(candidates)
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.label)).toEqual(["couch", "lamp"])
  })

  it("removes objects below confidence threshold", () => {
    const candidates = [
      { label: "couch", confidence: 0.3, bounding_box: { x: 0, y: 0, w: 0.5, h: 0.5 } },
      { label: "lamp", confidence: 0.8, bounding_box: { x: 0, y: 0, w: 0.1, h: 0.3 } },
    ]
    const result = filterToVocabulary(candidates)
    expect(result).toHaveLength(1)
    expect(result[0].label).toBe("lamp")
  })

  it("returns empty array when no candidates match", () => {
    const candidates = [
      { label: "piano", confidence: 0.95, bounding_box: { x: 0, y: 0, w: 0.3, h: 0.5 } },
    ]
    expect(filterToVocabulary(candidates)).toEqual([])
  })

  it("returns empty array for undefined input", () => {
    expect(filterToVocabulary(undefined)).toEqual([])
  })
})
