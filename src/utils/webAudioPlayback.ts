import type { AcousticMetrics, StudioCalibration } from '../types/voice';
import {
  base64ToUint8Array,
  computeAcousticMetricsFromPcm,
  encodeFloat32ToWav,
  uint8ArrayToBase64,
} from './audioProcessing';

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedAudioCtx = new AudioCtx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    void sharedAudioCtx.resume();
  }
  return sharedAudioCtx;
}

/**
 * Decodes any browser-supported audio File/Blob or base64 WAV into mono Float32Array
 * and computes real client-side acoustic metrics (F0 pitch, pause %, WPM, dynamic range, peaks).
 */
export async function analyzeAudioBlobClient(blob: Blob): Promise<AcousticMetrics> {
  const arrayBuf = await blob.arrayBuffer();
  const ctx = getAudioContext();
  const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
  const mono = mixToMono(decoded);
  return computeAcousticMetricsFromPcm(mono, decoded.sampleRate, 96);
}

export async function analyzeBase64WavClient(base64Wav: string): Promise<{ durationSec: number; waveformPeaks: number[] }> {
  const bytes = base64ToUint8Array(base64Wav);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/wav' });
  const metrics = await analyzeAudioBlobClient(blob);
  return {
    durationSec: metrics.durationSec,
    waveformPeaks: metrics.waveformPeaks,
  };
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) {
    return buffer.getChannelData(0);
  }
  const len = buffer.length;
  const out = new Float32Array(len);
  const chCount = buffer.numberOfChannels;
  for (let ch = 0; ch < chCount; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      out[i] += data[i] / chCount;
    }
  }
  return out;
}

/**
 * Renders a WAV base64 buffer through OfflineAudioContext applying studio calibration
 * (pitch/speed calibration, low-shelf warmth EQ, and broadcast gentle compression)
 * and returns a mastered WAV Blob ready for playback or download.
 */
export async function renderCalibratedWavBlob(
  base64Wav: string,
  calibration: StudioCalibration
): Promise<Blob> {
  const bytes = base64ToUint8Array(base64Wav);

  // Fast path if all calibration controls are neutral
  const isNeutral =
    Math.abs(calibration.pitchSemitones) < 0.05 &&
    Math.abs(calibration.rateMultiplier - 1) < 0.01 &&
    Math.abs(calibration.warmthDb) < 0.1 &&
    !calibration.studioCompression;

  if (isNeutral) {
    return new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/wav' });
  }

  const ctx = getAudioContext();
  const decoded = await ctx.decodeAudioData(bytes.buffer.slice(0) as ArrayBuffer);

  // Combine playback rate & subtle pitch shift ratio
  const pitchFactor = Math.pow(2, calibration.pitchSemitones / 12);
  const effectiveRate = Math.max(0.65, Math.min(1.45, calibration.rateMultiplier * pitchFactor));
  const outLength = Math.max(1, Math.ceil(decoded.length / effectiveRate));

  const offline = new OfflineAudioContext(1, outLength, decoded.sampleRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.playbackRate.value = effectiveRate;

  let lastNode: AudioNode = source;

  // Low-shelf warmth EQ around 220 Hz
  if (Math.abs(calibration.warmthDb) >= 0.1) {
    const warmthFilter = offline.createBiquadFilter();
    warmthFilter.type = 'lowshelf';
    warmthFilter.frequency.value = 220;
    warmthFilter.gain.value = calibration.warmthDb;
    lastNode.connect(warmthFilter);
    lastNode = warmthFilter;

    // Gentle presence clarity around 3.2 kHz
    const presenceFilter = offline.createBiquadFilter();
    presenceFilter.type = 'peaking';
    presenceFilter.frequency.value = 3200;
    presenceFilter.Q.value = 1.1;
    presenceFilter.gain.value = Math.max(0, calibration.warmthDb * 0.35);
    lastNode.connect(presenceFilter);
    lastNode = presenceFilter;
  }

  // Broadcast studio dynamics compressor
  if (calibration.studioCompression) {
    const comp = offline.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 14;
    comp.ratio.value = 3.2;
    comp.attack.value = 0.008;
    comp.release.value = 0.16;
    lastNode.connect(comp);
    lastNode = comp;
  }

  lastNode.connect(offline.destination);
  source.start(0);

  const rendered = await offline.startRendering();
  const mono = rendered.getChannelData(0);
  const wavBytes = encodeFloat32ToWav(mono, rendered.sampleRate);
  return new Blob([wavBytes.buffer as ArrayBuffer], { type: 'audio/wav' });
}

export async function fileToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  return uint8ArrayToBase64(new Uint8Array(buf));
}
