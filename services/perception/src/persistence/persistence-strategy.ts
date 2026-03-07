import type { SceneContextResponse, SceneEntity } from "@sensible/shared-types"

export interface PersistenceStrategy {
  logSceneContext(response: SceneContextResponse): Promise<void>
  logObjectSightings(sceneId: string, objects: SceneEntity[], timestamp: number): Promise<void>
}
