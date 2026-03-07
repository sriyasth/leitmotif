import { describe, it, expect } from "vitest"
import { estimatePosition } from "../src/position-estimator"

describe("estimatePosition", () => {
  it("converts centered bounding box to origin-ish position", () => {
    const pos = estimatePosition({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 })
    expect(pos.x).toBeCloseTo(0)
    expect(pos.z).toBeCloseTo(2)
    expect(pos.y).toBe(0)
  })

  it("converts left-side bounding box to negative x", () => {
    const pos = estimatePosition({ x: 0, y: 0, w: 0.2, h: 0.25 })
    expect(pos.x).toBeLessThan(0)
    expect(pos.z).toBeCloseTo(4)
  })

  it("converts right-side bounding box to positive x", () => {
    const pos = estimatePosition({ x: 0.8, y: 0, w: 0.2, h: 1.0 })
    expect(pos.x).toBeGreaterThan(0)
    expect(pos.z).toBeCloseTo(1)
  })
})
