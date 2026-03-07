import { useEffect, useRef, useState } from 'react';
import FacePipeline, {
  type StartPipelineConfig,
  type PersonEvent,
  type SceneDescriptionEvent,
} from './FacePipeline';

interface LeitmotifConfig {
  /** URL of the machine running the music engine, e.g. "http://192.168.1.42:3001" */
  musicEngineUrl: string;
  /** Passed through to FacePipeline.startPipeline() */
  pipeline?: StartPipelineConfig;
}

interface LeitmotifStatus {
  pipelineRunning: boolean;
  galleryLoaded: boolean;
  visibleUsers: string[];
  vibe: string;
  error: string | null;
}

/**
 * One-shot hook that starts the face pipeline, loads the gallery,
 * and forwards person events + scene descriptions to the music engine.
 */
export function useLeitmotif(config: LeitmotifConfig) {
  const [status, setStatus] = useState<LeitmotifStatus>({
    pipelineRunning: false,
    galleryLoaded: false,
    visibleUsers: [],
    vibe: '',
    error: null,
  });

  const visibleUsers = useRef<Map<string, string>>(new Map()); // trackId -> userId
  const currentVibe = useRef('');
  const pendingUpdate = useRef<ReturnType<typeof setTimeout> | null>(null);
  const url = config.musicEngineUrl.replace(/\/$/, '');

  function postUpdate() {
    if (pendingUpdate.current) clearTimeout(pendingUpdate.current);
    pendingUpdate.current = setTimeout(() => {
      const userIds = [...new Set(visibleUsers.current.values())];
      const body = { vibe: currentVibe.current, visible_users: userIds };
      console.log('[Leitmotif] posting:', body);

      setStatus((s) => ({ ...s, visibleUsers: userIds, vibe: currentVibe.current }));

      fetch(`${url}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch((err) => {
        console.warn('[Leitmotif] music engine unreachable:', err);
      });
    }, 150);
  }

  useEffect(() => {
    let stopped = false;

    async function boot() {
      try {
        // 1. Start the face pipeline
        await FacePipeline.startPipeline(config.pipeline ?? {});
        if (stopped) return;
        setStatus((s) => ({ ...s, pipelineRunning: true }));
        console.log('[Leitmotif] pipeline started');

        // 2. Load enrolled faces from Supabase
        try {
          const result = await FacePipeline.loadGallery();
          console.log('[Leitmotif] gallery loaded:', result.contacts_loaded, 'contacts');
          if (!stopped) setStatus((s) => ({ ...s, galleryLoaded: true }));
        } catch (galleryErr) {
          console.warn('[Leitmotif] gallery load failed (will use unknown IDs):', galleryErr);
        }
      } catch (err) {
        console.error('[Leitmotif] failed to start pipeline:', err);
        if (!stopped) setStatus((s) => ({ ...s, error: String(err) }));
      }
    }

    boot();

    // 3. Subscribe to person events
    const personSub = FacePipeline.onPersonEvent((event: PersonEvent) => {
      switch (event.event_type) {
        case 'person_entered':
        case 'person_updated':
          visibleUsers.current.set(event.track_id, event.user_id.id);
          break;
        case 'person_left':
          visibleUsers.current.delete(event.track_id);
          break;
      }
      postUpdate();
    });

    // 4. Subscribe to scene descriptions (vibe)
    const sceneSub = FacePipeline.onSceneDescription((event: SceneDescriptionEvent) => {
      currentVibe.current = event.description;
      postUpdate();
    });

    const errorSub = FacePipeline.onError((err) => {
      console.warn('[Leitmotif] pipeline error:', err.message);
    });

    return () => {
      stopped = true;
      personSub?.remove();
      sceneSub?.remove();
      errorSub?.remove();
      if (pendingUpdate.current) clearTimeout(pendingUpdate.current);
      FacePipeline.stopPipeline().catch(() => {});
    };
  }, [url]);

  return status;
}
