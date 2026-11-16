export type BaseVoiceId = 'Charon' | 'Fenrir' | 'Kore' | 'Puck' | 'Zephyr';

export type EmotionPreset =
  | 'natural'
  | 'documentario'
  | 'storytelling'
  | 'comercial'
  | 'jornalistico'
  | 'intimo';

export type WorkspaceTab = 'studio' | 'learn' | 'history';

export interface AcousticMetrics {
  durationSec: number;
  estimatedF0Hz: number;
  pitchMinHz: number;
  pitchMaxHz: number;
  pauseRatioPercent: number;
  estimatedWpm: number;
  dynamicRangeDb: number;
  warmthIndex: number; // 0-100 ratio of low-mid vs high frequency energy
  waveformPeaks: number[]; // Normalized 0..1 amplitude peaks
}

export interface VocalDnaProfile {
  toneSummary: string;
  timbreCharacteristics: string;
  cadenceAndRhythm: string;
  pauseAndBreathHabits: string;
  emotionalSignature: string;
  regionalDiction: string;
  prosodyRules: string[];
  stylePrompt: string;
  recommendedBaseVoice: BaseVoiceId;
  transcript: string;
}

export interface StudioCalibration {
  pitchSemitones: number; // -4.0 to +4.0
  rateMultiplier: number; // 0.80 to 1.20
  warmthDb: number; // -3 to +6 dB
  studioCompression: boolean;
}

export interface ReferenceSampleMeta {
  id: string;
  fileName: string;
  mimeType: string;
  durationSec: number;
  base64Audio?: string; // Optional stored reference preview for A/B comparison
}

export interface NarratorProfile {
  id: string;
  name: string;
  role: string;
  avatarUrl?: string;
  createdAt: string;
  sampleCount: number;
  totalReferenceDurationSec: number;
  baseVoice: BaseVoiceId;
  acousticMetrics: AcousticMetrics;
  dna: VocalDnaProfile;
  calibration: StudioCalibration;
  referenceSamples: ReferenceSampleMeta[];
  isBuiltIn?: boolean;
}

export interface NarrationTake {
  id: string;
  narratorId: string;
  narratorName: string;
  createdAt: string;
  rawText: string;
  directedText: string;
  emotionPreset: EmotionPreset;
  fidelityLevel: number;
  audioBase64Wav: string;
  durationSec: number;
  waveformPeaks: number[];
  fileName: string;
  effectiveStyle: string;
}
