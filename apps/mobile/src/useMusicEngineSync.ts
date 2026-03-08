import { useEffect, useRef } from 'react';
import FacePipeline, { type PersonEvent, type SceneDescriptionEvent } from './FacePipeline';

/**
 * Subscribes to the face pipeline's person events and scene descriptions,
 * maintains the current visible_users + vibe, and POSTs to the music engine
 * whenever either changes.
 *
 * @param musicEngineUrl - e.g. "http://192.168.1.42:3001" (the machine running the music engine)
 */
export function useMusicEngineSync(musicEngineUrl: string) {
  const visibleUsers = useRef<Map<string, string>>(new Map()); // trackId -> userId
  const currentVibe = useRef<string>('');
  const pendingUpdate = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const url = musicEngineUrl.replace(/\/$/, '');

    function postUpdate() {
      // Debounce: multiple events can fire in quick succession from the same frame
      if (pendingUpdate.current) clearTimeout(pendingUpdate.current);
      pendingUpdate.current = setTimeout(() => {
        const userIds = [...new Set(visibleUsers.current.values())];
        const body = {
          vibe: currentVibe.current,
          visible_users: userIds,
        };
        console.log('[MusicEngineSync] posting update:', body);
        fetch(`${url}/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).catch((err) => {
          console.warn('[MusicEngineSync] failed to reach music engine:', err);
        });
      }, 150);
    }

    const personSub = FacePipeline.onPersonEvent((event: PersonEvent) => {
      const { event_type, track_id, user_id } = event;

      switch (event_type) {
        case 'person_entered':
        case 'person_updated':
          visibleUsers.current.set(track_id, user_id.id);
          break;
        case 'person_left':
          visibleUsers.current.delete(track_id);
          break;
      }

      postUpdate();
    });

    const sceneSub = FacePipeline.onSceneDescription((event: SceneDescriptionEvent) => {
      currentVibe.current = event.description;
      postUpdate();
    });

    return () => {
      personSub?.remove();
      sceneSub?.remove();
      if (pendingUpdate.current) clearTimeout(pendingUpdate.current);
    };
  }, [musicEngineUrl]);
}
