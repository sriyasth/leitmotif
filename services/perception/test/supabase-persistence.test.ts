import { describe, it, expect, vi, beforeEach } from "vitest"
import { SupabasePersistence } from "../src/persistence/supabase-persistence"
import type { SceneContextResponse, SceneEntity } from "@sensible/shared-types"

const mockInsert = vi.fn().mockResolvedValue({ error: null })
const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert })
const mockClient = { from: mockFrom } as any

describe("SupabasePersistence", () => {
  let persistence: SupabasePersistence

  beforeEach(() => {
    persistence = new SupabasePersistence(mockClient)
    vi.clearAllMocks()
  })

  it("inserts scene context log with correct shape", async () => {
    const response: SceneContextResponse = {
      scene_id: "scene_001",
      environment_label: "living_room",
      objects: [],
      events: ["object_detected"],
      timestamp: 1720000000,
    }
    await persistence.logSceneContext(response)
    expect(mockFrom).toHaveBeenCalledWith("scene_context_logs")
    expect(mockInsert).toHaveBeenCalledWith({
      scene_id: "scene_001",
      environment_label: "living_room",
      events: ["object_detected"],
      timestamp: 1720000000,
      raw_summary: undefined,
    })
  })

  it("inserts one row per object sighting", async () => {
    const objects: SceneEntity[] = [
      {
        temp_id: "obj_0", type: "object", label: "couch", confidence: 0.9,
        position: { x: 0.5, y: 0, z: 3.3 }, importance: 0.9, recognized: false,
      },
      {
        temp_id: "obj_1", type: "object", label: "lamp", confidence: 0.8,
        position: { x: -0.4, y: 0, z: 2.5 }, importance: 0.8, recognized: false,
      },
    ]
    await persistence.logObjectSightings("scene_001", objects, 1720000000)
    expect(mockFrom).toHaveBeenCalledWith("object_sightings")
    expect(mockInsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ label: "couch", scene_id: "scene_001" }),
        expect.objectContaining({ label: "lamp", scene_id: "scene_001" }),
      ])
    )
  })

  it("computes distance_meters from position", async () => {
    const objects: SceneEntity[] = [
      {
        temp_id: "obj_0", type: "object", label: "couch", confidence: 0.9,
        position: { x: 3, y: 0, z: 4 }, importance: 0.9, recognized: false,
      },
    ]
    await persistence.logObjectSightings("scene_001", objects, 1720000000)
    const insertedRow = mockInsert.mock.calls[0][0][0]
    expect(insertedRow.distance_meters).toBeCloseTo(5) // sqrt(9+0+16)
  })

  it("skips insert when objects array is empty", async () => {
    await persistence.logObjectSightings("scene_001", [], 1720000000)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it("catches and logs errors without throwing", async () => {
    mockInsert.mockResolvedValueOnce({ error: new Error("DB error") })
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    await persistence.logSceneContext({
      scene_id: "s", environment_label: "unknown", objects: [], events: [], timestamp: 0,
    })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
