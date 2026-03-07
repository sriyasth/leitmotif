import type { Vec3 } from "@sensible/shared-types"

type BoundingBox = { x: number; y: number; w: number; h: number }

export function estimatePosition(bbox: BoundingBox): Vec3 {
  const x = (bbox.x + bbox.w / 2) * 2 - 1
  const z = 1 / bbox.h
  const y = 0
  return { x, y, z }
}
