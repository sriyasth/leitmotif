import {
  NativeEventEmitter,
  NativeModules,
  Platform,
  type EmitterSubscription,
} from 'react-native';

// --- Types ---

export interface UserIdJson {
  type: 'enrolled' | 'unknown';
  id: string;
  source: 'identity' | 'track';
}

export interface PersonEvent {
  event_type: 'person_entered' | 'person_updated' | 'person_left';
  track_id: string;
  user_id: UserIdJson;
  confidence: number;
  bearing: number;
  distance_proxy: number;
  similarity_top1?: number;
  similarity_top2?: number;
  margin?: number;
  timestamp_ms: number;
}

export interface StartPipelineConfig {
  detectEveryNFrames?: number;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}

export interface EnrollContactInput {
  owner_user_id: string;
  contact_external_id: string;
  display_name: string;
  burst_seconds?: number;
}

export interface EnrollmentResult {
  identity_id: string;
  templates_added: number;
  centroid_id?: string;
}

export interface EnrollmentProgress {
  captured: number;
  target: number;
}

export interface PipelineErrorEvent {
  message: string;
}

// Maps to existing Supabase tables.
export interface ContactRow {
  user_id: string;
  name: string;
  leitmotif_id: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface FaceEmbeddingRow {
  id: string;
  user_id: string;
  embedding: number[];
  quality_score: number;
  created_at: string;
}

interface NativeFacePipelineModule {
  startPipeline(config: StartPipelineConfig): Promise<{ status: string } | void>;
  stopPipeline(): Promise<{ status: string } | void>;
  enrollContact(input: EnrollContactInput): Promise<EnrollmentResult>;
  loadGallery(): Promise<{ contacts_loaded: number }>;
}

const nativeModule = NativeModules.FacePipelineModule as NativeFacePipelineModule | undefined;

function ensureNativeModule(): NativeFacePipelineModule {
  if (!nativeModule || Platform.OS !== 'ios') {
    throw new Error('FacePipelineModule is only available on iOS and is not linked.');
  }
  return nativeModule;
}

const emitter =
  Platform.OS === 'ios' && nativeModule ? new NativeEventEmitter(nativeModule) : null;

type PersonEventListener = (event: PersonEvent) => void;
type EnrollmentProgressListener = (progress: EnrollmentProgress) => void;
type EnrollmentCompleteListener = (result: EnrollmentResult) => void;
type ErrorListener = (error: PipelineErrorEvent) => void;

export const FacePipeline = {
  startPipeline: async (config: StartPipelineConfig = {}): Promise<void> => {
    await ensureNativeModule().startPipeline({
      detectEveryNFrames: config.detectEveryNFrames ?? 4,
      supabaseUrl: config.supabaseUrl,
      supabaseAnonKey: config.supabaseAnonKey,
    });
  },

  stopPipeline: async (): Promise<void> => {
    await ensureNativeModule().stopPipeline();
  },

  enrollContact: (input: EnrollContactInput): Promise<EnrollmentResult> => {
    return ensureNativeModule().enrollContact(input);
  },

  loadGallery: (): Promise<{ contacts_loaded: number }> => {
    return ensureNativeModule().loadGallery();
  },

  onPersonEvent: (listener: PersonEventListener): EmitterSubscription | undefined => {
    return emitter?.addListener('onPersonEvent', listener);
  },

  onEnrollmentProgress: (
    listener: EnrollmentProgressListener
  ): EmitterSubscription | undefined => {
    return emitter?.addListener('onEnrollmentProgress', listener);
  },

  onEnrollmentComplete: (
    listener: EnrollmentCompleteListener
  ): EmitterSubscription | undefined => {
    return emitter?.addListener('onEnrollmentComplete', listener);
  },

  onError: (listener: ErrorListener): EmitterSubscription | undefined => {
    return emitter?.addListener('onPipelineError', listener);
  },
};

export default FacePipeline;
