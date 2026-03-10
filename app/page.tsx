'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { MusicState, TrackedPerson } from '@/lib/types'

// ── Constants ──────────────────────────────────────────────────────
const PEOPLE_INTERVAL_MS = 1000
const SCENE_INTERVAL_MS = 20000
const MOTIF_COOLDOWN_MS = 4000
const LEAVE_THRESHOLD = 2

const CONTACTS = [
  { userId: 'alice_chen', name: 'Alice Chen', sub: 'Motif A' },
  { userId: 'marcus_johnson', name: 'Marcus Johnson', sub: 'Motif B' },
  { userId: 'priya_patel', name: 'Priya Patel', sub: 'Motif C' },
  { userId: 'james_obrien', name: "James O'Brien", sub: 'Motif D' },
  { userId: 'sofia_rivera', name: 'Sofia Rivera', sub: 'Motif E' },
]

// ── Types ──────────────────────────────────────────────────────────
interface EventItem { type: string; icon: string; msg: string; ts: string }
interface PersonDisplay { id: string; status: 'entered' | 'present' | 'left' }

// ── Audio Helpers ──────────────────────────────────────────────────
function stripWavHeader(data: ArrayBuffer): ArrayBuffer {
  if (data.byteLength > 44) {
    const view = new DataView(data)
    const hdr = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
    if (hdr === 'RIFF') return data.slice(44)
  }
  return data
}

function formatEnv(env: string) {
  return (env || 'unknown').replace(/_/g, ' ')
}

function ts() {
  return new Date().toLocaleTimeString('en-US', { hour12: false })
}

// ── Music Note SVG ─────────────────────────────────────────────────
const MusicNote = () => (
  <svg viewBox="0 0 24 24"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" /></svg>
)
const PlayIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
)

// ── Main Component ─────────────────────────────────────────────────
export default function Home() {
  // UI state
  const [events, setEvents] = useState<EventItem[]>([])
  const [curVibe, setCurVibe] = useState('--')
  const [curEnv, setCurEnv] = useState('--')
  const [curPeopleCount, setCurPeopleCount] = useState(0)
  const [curMotifs, setCurMotifs] = useState(0)
  const [sceneDesc, setSceneDesc] = useState('Waiting for first frame...')
  const [peopleInScene, setPeopleInScene] = useState<PersonDisplay[]>([])
  const [playingContacts, setPlayingContacts] = useState<Set<string>>(new Set())
  const [cooldownContacts, setCooldownContacts] = useState<Set<string>>(new Set())
  const [statusText, setStatusText] = useState('Requesting camera...')

  // Loading state
  const [started, setStarted] = useState(false)
  const [loadingDone, setLoadingDone] = useState(false)
  const [stepEngine, setStepEngine] = useState<'active' | 'done' | 'error' | ''>('')
  const [stepLyria, setStepLyria] = useState<'active' | 'done' | 'error' | ''>('')
  const [stepCamera, setStepCamera] = useState<'active' | 'done' | 'error' | ''>('')
  const [stepEngineText, setStepEngineText] = useState('Connecting to music engine...')
  const [stepLyriaText, setStepLyriaText] = useState('Initializing Lyria audio...')
  const [stepCameraText, setStepCameraText] = useState('Starting camera...')

  // Refs for mutable state (no re-renders needed)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const lyriaSessionRef = useRef<any>(null)
  const scheduledTimeRef = useRef(0)
  const musicStateRef = useRef<MusicState | null>(null)
  const trackedPeopleRef = useRef(new Map<string, TrackedPerson>())
  const nextPersonIdRef = useRef(1)
  const prevVibeRef = useRef<string | null>(null)
  const prevEnvRef = useRef<string | null>(null)
  const cachedVibeRef = useRef('calm')
  const cachedEnvRef = useRef('unknown')
  const cooldownUntilRef = useRef(0)
  const pendingInputRef = useRef<any>(null)
  const engineStartedRef = useRef(false)
  const runningRef = useRef(false)
  const frameInProgressRef = useRef(false)
  const sceneInProgressRef = useRef(false)
  const intervalsRef = useRef<ReturnType<typeof setInterval>[]>([])
  const mountedRef = useRef(true)

  // ── Event Logger ───────────────────────────────────────────────
  const addEvent = useCallback((type: string, icon: string, msg: string) => {
    setEvents(prev => [{ type, icon, msg, ts: ts() }, ...prev].slice(0, 100))
  }, [])

  // ── Frame Capture ──────────────────────────────────────────────
  const captureFrame = useCallback((): string => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return ''
    const ctx = canvas.getContext('2d')!
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.7).split(',')[1]
  }, [])

  // ── PCM Audio Playback ─────────────────────────────────────────
  const playPcmChunk = useCallback((pcmData: ArrayBuffer) => {
    const ctx = audioCtxRef.current
    if (!ctx || pcmData.byteLength === 0) return

    const int16 = new Int16Array(pcmData)
    const numSamples = Math.floor(int16.length / 2)
    if (numSamples === 0) return

    const buffer = ctx.createBuffer(2, numSamples, 48000)
    const left = buffer.getChannelData(0)
    const right = buffer.getChannelData(1)
    for (let i = 0; i < numSamples; i++) {
      left[i] = int16[i * 2] / 32768
      right[i] = int16[i * 2 + 1] / 32768
    }

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)

    const now = ctx.currentTime
    if (scheduledTimeRef.current < now) scheduledTimeRef.current = now
    source.start(scheduledTimeRef.current)
    scheduledTimeRef.current += buffer.duration
  }, [])

  // ── Lyria Connection ───────────────────────────────────────────
  const connectLyria = useCallback(async (): Promise<boolean> => {
    const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY
    if (!apiKey) {
      console.error('NEXT_PUBLIC_GEMINI_API_KEY not set')
      return false
    }

    try {
      const { GoogleGenAI } = await import('@google/genai')
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { apiVersion: 'v1alpha' },
      })

      const session = await (ai.live as any).music.connect({
        model: 'models/lyria-realtime-exp',
        callbacks: {
          onmessage: (message: any) => {
            const audioChunks = message.serverContent?.audioChunks ?? message.audioChunks
            if (audioChunks) {
              for (const chunk of audioChunks) {
                const data = chunk.data
                let bytes: Uint8Array
                if (typeof data === 'string') {
                  const binary = atob(data)
                  bytes = new Uint8Array(binary.length)
                  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
                } else {
                  bytes = new Uint8Array(data)
                }
                const pcm = stripWavHeader(bytes.buffer)
                if (pcm.byteLength > 0) playPcmChunk(pcm)
              }
            }
          },
          onerror: (error: any) => {
            console.error('[Lyria] error:', error)
          },
        },
      })

      lyriaSessionRef.current = session
      console.log('[Lyria] connected')
      return true
    } catch (err) {
      console.error('[Lyria] connection failed:', err)
      return false
    }
  }, [playPcmChunk])

  // ── Music Engine Cycle ─────────────────────────────────────────
  const runMusicCycle = useCallback(async (vibe: string, environment: string, visibleUsers: string[]) => {
    try {
      const res = await fetch('/api/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vibe,
          environment,
          visible_users: visibleUsers,
          previousState: musicStateRef.current,
        }),
      })
      const { lyriaPrompt, newMusicState } = await res.json()
      if (!lyriaPrompt) return

      const previouslyActive = musicStateRef.current?.active_motifs ?? []
      const entering = visibleUsers.filter(id => !previouslyActive.includes(id))
      const leaving = previouslyActive.filter(id => !visibleUsers.includes(id))
      const hasMotifChange = entering.length > 0 || leaving.length > 0

      musicStateRef.current = newMusicState

      const session = lyriaSessionRef.current
      if (session) {
        try {
          await session.setWeightedPrompts({
            weightedPrompts: [{ text: lyriaPrompt.text, weight: 1.0 }],
          })
          await session.setMusicGenerationConfig({ config: { bpm: lyriaPrompt.bpm } })
          await session.play()
        } catch (err) {
          console.error('[MusicEngine] Lyria update error:', err)
        }
      }

      if (hasMotifChange) {
        cooldownUntilRef.current = Date.now() + MOTIF_COOLDOWN_MS
        pendingInputRef.current = null
        setTimeout(async () => {
          if (pendingInputRef.current && runningRef.current) {
            const pending = pendingInputRef.current
            pendingInputRef.current = null
            await runMusicCycle(pending.vibe, pending.environment, pending.visible_users)
          }
        }, MOTIF_COOLDOWN_MS)
      }
    } catch (err) {
      console.error('[MusicEngine] cycle error:', err)
    }
  }, [])

  const updateMusic = useCallback(async (vibe: string, environment: string, visibleUsers: string[]) => {
    if (!runningRef.current) return
    if (Date.now() < cooldownUntilRef.current) {
      pendingInputRef.current = { vibe, environment, visible_users: visibleUsers }
      return
    }
    await runMusicCycle(vibe, environment, visibleUsers)
  }, [runMusicCycle])

  // ── Person Tracking (client-side) ──────────────────────────────
  const processPeopleResult = useCallback((rawPeople: { id: string; description: string }[], peopleCount: number) => {
    const tracked = trackedPeopleRef.current
    const framePeople: { id: string; description: string }[] = []
    for (const p of rawPeople) {
      if (tracked.has(p.id)) {
        framePeople.push({ id: p.id, description: p.description })
      } else {
        const newId = `person_${nextPersonIdRef.current++}`
        framePeople.push({ id: newId, description: p.description })
      }
    }

    const effectivePeople = peopleCount === 0 ? [] : framePeople
    const currentIds = new Set(effectivePeople.map(p => p.id))
    const entered: string[] = []
    const left: string[] = []

    for (const p of effectivePeople) {
      const existing = tracked.get(p.id)
      if (!existing) {
        entered.push(p.id)
      } else if (!existing.present) {
        entered.push(p.id)
      }
      tracked.set(p.id, { id: p.id, description: p.description, missedFrames: 0, present: true })
    }

    for (const [id, person] of tracked) {
      if (!currentIds.has(id) && person.present) {
        person.missedFrames++
        if (person.missedFrames >= LEAVE_THRESHOLD) {
          person.present = false
          left.push(id)
        }
      }
    }

    return { visible_users: [...currentIds], entered, left }
  }, [])

  // ── API Calls ──────────────────────────────────────────────────
  const sendPeopleFrame = useCallback(async () => {
    if (frameInProgressRef.current) return
    frameInProgressRef.current = true
    try {
      const base64 = captureFrame()
      if (!base64) return

      const trackedArray = [...trackedPeopleRef.current.values()].map(p => ({
        id: p.id, description: p.description, present: p.present,
      }))

      const res = await fetch('/api/frame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, trackedPeople: trackedArray }),
      })
      const data = await res.json()

      const { visible_users, entered, left } = processPeopleResult(data.people ?? [], data.people_count ?? 0)

      setCurPeopleCount(visible_users.length)
      setCurMotifs(visible_users.length)

      const display: PersonDisplay[] = []
      for (const u of visible_users) {
        display.push({ id: u, status: entered.includes(u) ? 'entered' : 'present' })
      }
      for (const u of left) {
        display.push({ id: u, status: 'left' })
      }
      setPeopleInScene(display)

      for (const u of entered) {
        addEvent('person-enter', '\u25B2', `${u} entered the scene`)
        addEvent('motif-change', '\u266B', `Entry motif playing for ${u}`)
      }
      for (const u of left) {
        addEvent('person-leave', '\u25BC', `${u} left the scene`)
        addEvent('motif-change', '\u266B', `Exit motif (inverted) playing for ${u}`)
      }

      updateMusic(cachedVibeRef.current, cachedEnvRef.current, visible_users)
    } catch (err) {
      addEvent('error', '\u2716', 'People tracking error: ' + (err as Error).message)
    } finally {
      frameInProgressRef.current = false
    }
  }, [captureFrame, processPeopleResult, addEvent, updateMusic])

  const sendSceneFrame = useCallback(async () => {
    if (sceneInProgressRef.current) return
    sceneInProgressRef.current = true
    try {
      const base64 = captureFrame()
      if (!base64) return

      const res = await fetch('/api/scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64 }),
      })
      const data = await res.json()

      if (data.vibe) {
        const vibeChanged = prevVibeRef.current !== null && prevVibeRef.current !== data.vibe
        const envChanged = prevEnvRef.current !== null && prevEnvRef.current !== data.environment
        if (vibeChanged) addEvent('vibe-change', '\u25C9', `Vibe changed: ${prevVibeRef.current} \u2192 ${data.vibe}`)
        if (envChanged) addEvent('env-change', '\u25A3', `Environment changed: ${formatEnv(prevEnvRef.current!)} \u2192 ${formatEnv(data.environment)}`)

        setCurVibe(data.vibe)
        setCurEnv(formatEnv(data.environment))
        setSceneDesc(data.scene_description || 'No description')

        prevVibeRef.current = data.vibe
        prevEnvRef.current = data.environment
        cachedVibeRef.current = data.vibe
        cachedEnvRef.current = data.environment
      }
      addEvent('scene', '\u25A3', `Scene refreshed: ${data.vibe}, ${formatEnv(data.environment)}`)
    } catch (err) {
      addEvent('error', '\u2716', 'Scene analysis error: ' + (err as Error).message)
    } finally {
      sceneInProgressRef.current = false
    }
  }, [captureFrame, addEvent])

  // ── Contact Motif Trigger ──────────────────────────────────────
  const playMotif = useCallback(async (userId: string) => {
    if (cooldownContacts.has(userId)) return

    setPlayingContacts(prev => new Set(prev).add(userId))
    setCooldownContacts(prev => new Set(prev).add(userId))
    addEvent('motif-change', '\u266B', `Playing motif for ${CONTACTS.find(c => c.userId === userId)?.name ?? userId}`)

    const currentVisible = [...trackedPeopleRef.current.values()].filter(p => p.present).map(p => p.id)
    const withContact = [...new Set([...currentVisible, userId])]
    updateMusic(cachedVibeRef.current, cachedEnvRef.current, withContact)

    setTimeout(() => {
      const stillVisible = [...trackedPeopleRef.current.values()].filter(p => p.present).map(p => p.id)
      const without = stillVisible.filter(id => id !== userId)
      updateMusic(cachedVibeRef.current, cachedEnvRef.current, without)
    }, 4500)

    setTimeout(() => setPlayingContacts(prev => { const n = new Set(prev); n.delete(userId); return n }), 3000)
    setTimeout(() => setCooldownContacts(prev => { const n = new Set(prev); n.delete(userId); return n }), 5000)
  }, [cooldownContacts, addEvent, updateMusic])

  // ── Start Button Handler ───────────────────────────────────────
  const handleStart = useCallback(async () => {
    setStarted(true)

    // Step 1: Music engine / Lyria
    setStepEngine('active')
    audioCtxRef.current = new AudioContext({ sampleRate: 48000 })
    if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume()
    }

    const lyriaOk = await connectLyria()
    if (!mountedRef.current) return

    if (lyriaOk) {
      setStepEngine('done')
      setStepEngineText('Music engine connected')
      setStepLyria('done')
      setStepLyriaText('Lyria audio ready')
      runningRef.current = true

      // Warm up with empty scene
      await runMusicCycle('calm', 'unknown', [])
      engineStartedRef.current = true
    } else {
      setStepEngine('done')
      setStepEngineText('Music engine ready (no Lyria)')
      setStepLyria('error')
      setStepLyriaText('Lyria unavailable - vision-only mode')
      addEvent('error', '\u2716', 'Lyria not available \u2014 running without music')
    }

    // Step 2: Camera
    setStepCamera('active')
    setStepCameraText('Starting camera...')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
      })
      if (!mountedRef.current) return

      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }

      setStepCamera('done')
      setStepCameraText('Camera ready')
      await new Promise(r => setTimeout(r, 600))
      if (!mountedRef.current) return

      setLoadingDone(true)
      setStatusText('Camera active \u2014 people every 1s, scene every 20s')
      addEvent('scene', '\u25CF', 'System ready \u2014 camera started')

      // Start analysis loops
      sendSceneFrame()
      intervalsRef.current.push(setInterval(sendPeopleFrame, PEOPLE_INTERVAL_MS))
      intervalsRef.current.push(setInterval(sendSceneFrame, SCENE_INTERVAL_MS))
    } catch (err) {
      setStepCamera('error')
      setStepCameraText('Camera error: ' + (err as Error).message)
      addEvent('error', '\u2716', 'Camera error: ' + (err as Error).message)
    }
  }, [connectLyria, runMusicCycle, addEvent, sendPeopleFrame, sendSceneFrame])

  // ── Cleanup ────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      intervalsRef.current.forEach(clearInterval)
      lyriaSessionRef.current?.close?.().catch(() => {})
      audioCtxRef.current?.close?.().catch(() => {})
    }
  }, [])

  // ── Render ─────────────────────────────────────────────────────
  return (
    <>
      {/* Loading Overlay */}
      {!loadingDone && (
        <div className="loading-overlay">
          <div className="loading-title">LEITMOTIF</div>
          {!started ? (
            <>
              <button className="start-btn" onClick={handleStart}>
                Start Experience
              </button>
              <div className="loading-subtitle">
                Adaptive audio for the visually impaired. Uses your camera and AI to generate real-time music that reflects your surroundings.
              </div>
            </>
          ) : (
            <>
              <div className="loading-spinner" />
              <div className="loading-status">
                <div className={`loading-step ${stepEngine}`}>{stepEngineText}</div>
                <div className={`loading-step ${stepLyria}`}>{stepLyriaText}</div>
                <div className={`loading-step ${stepCamera}`}>{stepCameraText}</div>
              </div>
            </>
          )}
        </div>
      )}

      <header>
        <h1>LEITMOTIF</h1>
        <span className="status-text">{statusText}</span>
      </header>

      <div className="main">
        {/* Left Panel — Camera + Contacts */}
        <div className="cam-panel">
          <video ref={videoRef} autoPlay playsInline muted />
          <canvas ref={canvasRef} className="hidden-canvas" />

          <div className="contacts-panel">
            <h3>Contacts</h3>
            {CONTACTS.map(contact => (
              <div
                key={contact.userId}
                className={`contact-card${playingContacts.has(contact.userId) ? ' playing' : ''}${cooldownContacts.has(contact.userId) ? ' cooldown' : ''}`}
              >
                <div className="contact-avatar"><MusicNote /></div>
                <div className="contact-info">
                  <div className="contact-name">{contact.name}</div>
                  <div className="contact-sub">{contact.sub}</div>
                </div>
                <button className="play-btn" title="Play motif" onClick={() => playMotif(contact.userId)}>
                  <PlayIcon />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Right Panel — Engine Output */}
        <div className="engine-panel">
          <div className="state-bar">
            <div className="state-card">
              <div className="label">Vibe</div>
              <div className="value vibe">{curVibe}</div>
            </div>
            <div className="state-card">
              <div className="label">Environment</div>
              <div className="value env">{curEnv}</div>
            </div>
            <div className="state-card">
              <div className="label">People</div>
              <div className="value people">{curPeopleCount}</div>
            </div>
            <div className="state-card">
              <div className="label">Active Motifs</div>
              <div className="value motifs">{curMotifs}</div>
            </div>
          </div>

          <div className="scene-desc">{sceneDesc}</div>

          <div className="people-section">
            <h3>People in Scene</h3>
            <div>
              {peopleInScene.length === 0 ? (
                <span className="no-people">None detected</span>
              ) : (
                peopleInScene.map(p => (
                  <span key={p.id} className={`person-tag ${p.status}`}>{p.id}</span>
                ))
              )}
            </div>
          </div>

          <div className="event-log">
            {events.map((e, i) => (
              <div key={i} className={`event ${e.type}`}>
                <span className="ts">{e.ts}</span>
                <span className="icon">{e.icon}</span>
                <span className="msg">{e.msg}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
