import type { SupabaseClient } from "@supabase/supabase-js"
import type { SceneContextResponse, SceneEntity } from "@sensible/shared-types"
import type { PersistenceStrategy } from "./persistence-strategy"

export class SupabasePersistence implements PersistenceStrategy {
  constructor(private client: SupabaseClient) {}

  async logSceneContext(response: SceneContextResponse): Promise<void> {
    try {
      const { error } = await this.client.from("scene_context_logs").insert({
        scene_id: response.scene_id,
        environment_label: response.environment_label,
        events: response.events,
        timestamp: response.timestamp,
        raw_summary: response.raw_summary,
      })
      if (error) console.error("Failed to log scene context:", error)
    } catch (err) {
      console.error("Failed to log scene context:", err)
    }
  }

  async logObjectSightings(
    sceneId: string,
    objects: SceneEntity[],
    timestamp: number
  ): Promise<void> {
    if (objects.length === 0) return
    try {
      const rows = objects.map((obj) => ({
        scene_id: sceneId,
        temp_id: obj.temp_id,
        label: obj.label,
        confidence: obj.confidence,
        x: obj.position.x,
        y: obj.position.y,
        z: obj.position.z,
        distance_meters: Math.sqrt(
          obj.position.x ** 2 + obj.position.y ** 2 + obj.position.z ** 2
        ),
        importance: obj.importance,
        timestamp,
      }))
      const { error } = await this.client.from("object_sightings").insert(rows)
      if (error) console.error("Failed to log object sightings:", error)
    } catch (err) {
      console.error("Failed to log object sightings:", err)
    }
  }
}
