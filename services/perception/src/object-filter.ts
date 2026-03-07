import { DEMO_OBJECT_CLASSES, MIN_CONFIDENCE_THRESHOLD } from "./constants"

type ObjectCandidate = {
  label: string
  confidence: number
  bounding_box: { x: number; y: number; w: number; h: number }
  importance?: number
}

export function filterToVocabulary(
  candidates: ObjectCandidate[] | undefined
): ObjectCandidate[] {
  if (!candidates) return []
  return candidates.filter(
    (c) =>
      (DEMO_OBJECT_CLASSES as readonly string[]).includes(c.label) &&
      c.confidence >= MIN_CONFIDENCE_THRESHOLD
  )
}
