import type { PersistenceStrategy } from "./persistence-strategy"

export class NullPersistence implements PersistenceStrategy {
  async logSceneContext(): Promise<void> {}
  async logObjectSightings(): Promise<void> {}
}
