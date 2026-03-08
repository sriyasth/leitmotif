import React, { createContext, useContext, type Dispatch } from 'react';

// ── Types ──────────────────────────────────────────────────────

export interface Contact {
  id: string;
  name: string;
  status: 'connected' | 'standby' | 'disconnected';
  motifFreq: number;
  motifDescription: string;
  image?: string | null;
}

export interface EntityPosition {
  angle_deg: number;
  distance_m: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Entity {
  id: string;
  type: 'known_person' | 'unknown_person' | 'object';
  name: string;
  motifFreq: number;
  color: string;
  position: EntityPosition;
  boundingBox: BoundingBox;
  state: 'entering' | 'present' | 'exiting';
}

export interface Session {
  id: string;
  status: 'idle' | 'live';
  fps: number;
  mode: string;
  recording: boolean;
  recordTime: number;
}

export interface AudioEngineSettings {
  masterVolume: number;
  spatializationEnabled: boolean;
  crowdThreshold: number;
  crowdModeActive: boolean;
}

export interface AppState {
  currentScreen: string;
  session: Session;
  entities: Record<string, Entity>;
  departedEntities: string[];
  contacts: Record<string, Contact>;
  audioEngine: AudioEngineSettings;
  connections: {
    vision: { status: string; latency: number | null };
    audio: { status: string; latency: number | null };
    ws: { status: string };
  };
  demoMode: boolean;
  demoTime: number;
}

export type AppAction =
  | { type: 'SET_SCREEN'; payload: string }
  | { type: 'SET_SESSION'; payload: Partial<Session> }
  | { type: 'UPDATE_ENTITIES'; payload: { entities: Record<string, Entity>; departed?: string[] } }
  | { type: 'SET_AUDIO'; payload: Partial<AudioEngineSettings> }
  | { type: 'SET_CONNECTIONS'; payload: Partial<AppState['connections']> }
  | { type: 'TOGGLE_DEMO' }
  | { type: 'SET_DEMO_TIME'; payload: number }
  | { type: 'ADD_CONTACT'; payload: Contact }
  | { type: 'SET_RECORDING'; payload: boolean }
  | { type: 'SET_RECORD_TIME'; payload: number };

// ── Initial state ──────────────────────────────────────────────

export const initialState: AppState = {
  currentScreen: 'monitor',
  session: {
    id: Math.random().toString(36).slice(2),
    status: 'idle',
    fps: 0,
    mode: 'live',
    recording: false,
    recordTime: 0,
  },
  entities: {},
  departedEntities: [],
  contacts: {
    contact_sarah: {
      id: 'contact_sarah',
      name: 'Sarah',
      status: 'connected',
      motifFreq: 440,
      motifDescription: 'Warm piano in C major',
    },
    contact_marcus: {
      id: 'contact_marcus',
      name: 'Marcus',
      status: 'standby',
      motifFreq: 523,
      motifDescription: 'Bright xylophone in G major',
    },
    contact_elena: {
      id: 'contact_elena',
      name: 'Elena',
      status: 'disconnected',
      motifFreq: 349,
      motifDescription: 'Gentle strings in F major',
    },
  },
  audioEngine: {
    masterVolume: 0.82,
    spatializationEnabled: true,
    crowdThreshold: 5,
    crowdModeActive: false,
  },
  connections: {
    vision: { status: 'disconnected', latency: null },
    audio: { status: 'disconnected', latency: null },
    ws: { status: 'disconnected' },
  },
  demoMode: true,
  demoTime: 0,
};

// ── Reducer ────────────────────────────────────────────────────

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_SCREEN':
      return { ...state, currentScreen: action.payload };
    case 'SET_SESSION':
      return { ...state, session: { ...state.session, ...action.payload } };
    case 'UPDATE_ENTITIES':
      return {
        ...state,
        entities: action.payload.entities,
        departedEntities: action.payload.departed ?? [],
      };
    case 'SET_AUDIO':
      return { ...state, audioEngine: { ...state.audioEngine, ...action.payload } };
    case 'SET_CONNECTIONS':
      return { ...state, connections: { ...state.connections, ...action.payload } };
    case 'TOGGLE_DEMO':
      return { ...state, demoMode: !state.demoMode };
    case 'SET_DEMO_TIME':
      return { ...state, demoTime: action.payload };
    case 'ADD_CONTACT':
      return { ...state, contacts: { ...state.contacts, [action.payload.id]: action.payload } };
    case 'SET_RECORDING':
      return { ...state, session: { ...state.session, recording: action.payload } };
    case 'SET_RECORD_TIME':
      return { ...state, session: { ...state.session, recordTime: action.payload } };
    default:
      return state;
  }
}

// ── Context ────────────────────────────────────────────────────

interface AppContextType {
  state: AppState;
  dispatch: Dispatch<AppAction>;
}

export const AppContext = createContext<AppContextType>(null!);
export const useApp = () => useContext(AppContext);

// ── Demo simulation ────────────────────────────────────────────

const DEMO_DEFS = {
  sarah: { id: 'demo_sarah', type: 'known_person' as const, name: 'Sarah', motifFreq: 440, color: 'blue' },
  marcus: { id: 'demo_marcus', type: 'known_person' as const, name: 'Marcus', motifFreq: 523, color: 'blue' },
  unknown: { id: 'demo_unknown', type: 'unknown_person' as const, name: 'Unknown', motifFreq: 659, color: 'amber' },
  crowd1: { id: 'demo_c1', type: 'unknown_person' as const, name: 'Person 4', motifFreq: 587, color: 'amber' },
  crowd2: { id: 'demo_c2', type: 'unknown_person' as const, name: 'Person 5', motifFreq: 698, color: 'amber' },
  crowd3: { id: 'demo_c3', type: 'unknown_person' as const, name: 'Person 6', motifFreq: 784, color: 'amber' },
  table: { id: 'demo_table', type: 'object' as const, name: 'Table', motifFreq: 220, color: 'gray' },
};

export function getDemoState(t: number): { entities: Record<string, Entity>; departed: string[] } {
  const entities: Record<string, Entity> = {};
  const departed: string[] = [];

  entities.demo_table = {
    ...DEMO_DEFS.table,
    position: { angle_deg: 5, distance_m: 1.2 },
    boundingBox: { x: 40, y: 55, w: 25, h: 15 },
    state: 'present',
  };

  if (t >= 3 && t < 18) {
    const dist = t < 6 ? 3 - (t - 3) * 0.5 : 1.5;
    const angle = t < 6 ? -30 + (t - 3) * 5 : -15;
    entities.demo_sarah = {
      ...DEMO_DEFS.sarah,
      position: { angle_deg: angle, distance_m: dist },
      boundingBox: { x: 15, y: 20, w: 20, h: 40 },
      state: t < 6 ? 'entering' : 'present',
    };
  }
  if (t >= 18 && t < 21) departed.push('demo_sarah');

  if (t >= 10 && t < 30) {
    entities.demo_marcus = {
      ...DEMO_DEFS.marcus,
      position: { angle_deg: 25, distance_m: t < 13 ? 4 - (t - 10) * 0.5 : 2.5 },
      boundingBox: { x: 65, y: 30, w: 18, h: 38 },
      state: t < 13 ? 'entering' : 'present',
    };
  }

  if (t >= 21 && t < 30) {
    entities.demo_unknown = {
      ...DEMO_DEFS.unknown,
      position: { angle_deg: 0, distance_m: 2 },
      boundingBox: { x: 42, y: 25, w: 16, h: 35 },
      state: t < 23 ? 'entering' : 'present',
    };
  }

  if (t >= 25) {
    entities.demo_c1 = { ...DEMO_DEFS.crowd1, position: { angle_deg: -40, distance_m: 3.5 }, boundingBox: { x: 5, y: 35, w: 14, h: 30 }, state: 'entering' };
    entities.demo_c2 = { ...DEMO_DEFS.crowd2, position: { angle_deg: 35, distance_m: 4 }, boundingBox: { x: 80, y: 40, w: 14, h: 30 }, state: 'entering' };
    entities.demo_c3 = { ...DEMO_DEFS.crowd3, position: { angle_deg: -10, distance_m: 4.5 }, boundingBox: { x: 30, y: 45, w: 14, h: 28 }, state: 'entering' };
  }

  return { entities, departed };
}

// ── Helpers ────────────────────────────────────────────────────

export function getEntityColor(e: Entity): string {
  if (e.color === 'blue' || e.type === 'known_person') return '#00d4ff';
  if (e.color === 'amber' || e.type === 'unknown_person') return '#f59e0b';
  return '#9ca3af';
}

export function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
