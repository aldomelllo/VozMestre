import type { AcousticMetrics, EmotionPreset, NarratorProfile } from '../types/voice';

export const EMOTION_LABELS: Record<EmotionPreset, { label: string; directive: string }> = {
  natural: {
    label: 'Natural da Voz',
    directive: 'Preserve the speaker baseline conversational warmth, authentic pauses, and natural organic inflection.',
  },
  documentario: {
    label: 'Documentário',
    directive: 'Authoritative, unhurried documentary cadence with contemplative pauses and rich chest resonance.',
  },
  storytelling: {
    label: 'Storytelling Emocional',
    directive: 'Intimate, emotionally resonant storytelling with dynamic pitch swells, subtle vulnerability, and deliberate breaths.',
  },
  comercial: {
    label: 'Comercial & Convite',
    directive: 'Warm, confident, persuasive delivery with crisp articulation, buoyant mid-phrase energy, and smiling timbre.',
  },
  jornalistico: {
    label: 'Jornalístico',
    directive: 'Measured, articulate broadcast precision with balanced phrasing, clear consonant attack, and calm authority.',
  },
  intimo: {
    label: 'Íntimo & Sussurrado',
    directive: 'Close-mic, warm, velvety low-volume proximity with soft breathy tails and unhurried phrasing.',
  },
};

export function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/**
 * Splits a long narration script into synthesis-friendly chunks at sentence or clause
 * boundaries without breaking prosody markers like <breath> or ellipses.
 */
export function splitScriptIntoChunks(text: string, maxChars = 420): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const paragraphs = normalized.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];

  for (const para of paragraphs) {
    if (para.length <= maxChars) {
      chunks.push(para);
      continue;
    }

    // Split on sentence boundaries keeping punctuation attached
    const sentences = para.match(/[^.!?]+(?:[.!?]+|\.{3})?(?:\s+|$)/g) ?? [para];
    let current = '';

    for (const rawSentence of sentences) {
      const sentence = rawSentence.trim();
      if (!sentence) continue;

      if (sentence.length > maxChars) {
        if (current) {
          chunks.push(current.trim());
          current = '';
        }
        // Fallback split on commas/semicolons or spaces
        const words = sentence.split(/\s+/);
        let sub = '';
        for (const word of words) {
          if ((sub + ' ' + word).trim().length > maxChars) {
            if (sub) chunks.push(sub.trim());
            sub = word;
          } else {
            sub = sub ? `${sub} ${word}` : word;
          }
        }
        if (sub) chunks.push(sub.trim());
        continue;
      }

      if ((current + ' ' + sentence).trim().length > maxChars) {
        if (current) chunks.push(current.trim());
        current = sentence;
      } else {
        current = current ? `${current} ${sentence}` : sentence;
      }
    }

    if (current) {
      chunks.push(current.trim());
    }
  }

  return chunks;
}

/**
 * Concatenates multiple Gemini unary WAV buffers (44-byte RIFF header, 24kHz mono 16-bit)
 * into a single valid WAV buffer by stripping headers after the first clip and updating
 * RIFF and data chunk byte lengths.
 */
export function concatWavBuffers(wavBuffers: Uint8Array[]): Uint8Array {
  const valid = wavBuffers.filter((b) => b.length > 44);
  if (valid.length === 0) {
    throw new Error('Nenhum buffer WAV válido recebido para concatenação.');
  }
  if (valid.length === 1) {
    return valid[0];
  }

  // Locate the 'data' subchunk offset in each buffer (usually 44 bytes, but handle extra subchunks safely)
  const findDataOffset = (buf: Uint8Array): { dataOffset: number; dataSize: number } => {
    let offset = 12;
    while (offset + 8 <= buf.length) {
      const id = String.fromCharCode(buf[offset], buf[offset + 1], buf[offset + 2], buf[offset + 3]);
      const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      const size = view.getUint32(offset + 4, true);
      if (id === 'data') {
        const clampedSize = Math.min(size, buf.length - (offset + 8));
        return { dataOffset: offset + 8, dataSize: clampedSize };
      }
      offset += 8 + size;
    }
    return { dataOffset: 44, dataSize: buf.length - 44 };
  };

  const firstInfo = findDataOffset(valid[0]);
  const header = valid[0].slice(0, firstInfo.dataOffset);
  const pcmSegments: Uint8Array[] = [
    valid[0].subarray(firstInfo.dataOffset, firstInfo.dataOffset + firstInfo.dataSize),
  ];

  let totalPcmBytes = pcmSegments[0].length;
  for (let i = 1; i < valid.length; i++) {
    const info = findDataOffset(valid[i]);
    const seg = valid[i].subarray(info.dataOffset, info.dataOffset + info.dataSize);
    pcmSegments.push(seg);
    totalPcmBytes += seg.length;
  }

  const out = new Uint8Array(header.length + totalPcmBytes);
  out.set(header, 0);

  let writePos = header.length;
  for (const seg of pcmSegments) {
    out.set(seg, writePos);
    writePos += seg.length;
  }

  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  // Update RIFF chunk size (total length - 8)
  view.setUint32(4, out.length - 8, true);
  // Update data subchunk size (last 4 bytes of header)
  view.setUint32(header.length - 4, totalPcmBytes, true);

  return out;
}

/**
 * Estimates fundamental frequency (F0) on a voiced frame using normalized autocorrelation.
 */
export function estimateFramePitchHz(frame: Float32Array, sampleRate: number): number | null {
  let energy = 0;
  for (let i = 0; i < frame.length; i++) {
    energy += frame[i] * frame[i];
  }
  const rms = Math.sqrt(energy / frame.length);
  if (rms < 0.015) return null; // unvoiced / silence

  const minLag = Math.max(20, Math.floor(sampleRate / 340)); // max 340 Hz
  const maxLag = Math.min(Math.floor(frame.length / 2), Math.floor(sampleRate / 65)); // min 65 Hz
  if (maxLag <= minLag) return null;

  let bestLag = -1;
  let bestCorr = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0;
    let denA = 0;
    let denB = 0;
    for (let i = 0; i < frame.length - lag; i++) {
      const a = frame[i];
      const b = frame[i + lag];
      num += a * b;
      denA += a * a;
      denB += b * b;
    }
    const denom = Math.sqrt(denA * denB);
    const corr = denom > 0 ? num / denom : 0;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  if (bestLag <= 0 || bestCorr < 0.45) return null;
  return sampleRate / bestLag;
}

/**
 * Extracts real acoustic metrics and normalized waveform peaks from mono PCM samples.
 */
export function computeAcousticMetricsFromPcm(
  samples: Float32Array,
  sampleRate: number,
  peakBins = 96
): AcousticMetrics {
  const durationSec = samples.length > 0 && sampleRate > 0 ? Number((samples.length / sampleRate).toFixed(2)) : 0;
  if (samples.length === 0 || sampleRate <= 0) {
    return {
      durationSec: 0,
      estimatedF0Hz: 140,
      pitchMinHz: 110,
      pitchMaxHz: 175,
      pauseRatioPercent: 18,
      estimatedWpm: 135,
      dynamicRangeDb: 24,
      warmthIndex: 62,
      waveformPeaks: Array.from({ length: peakBins }, () => 0.1),
    };
  }

  // 1. Normalized waveform peaks
  const binSize = Math.max(1, Math.floor(samples.length / peakBins));
  const rawPeaks: number[] = [];
  let globalMax = 0;
  for (let b = 0; b < peakBins; b++) {
    const start = b * binSize;
    const end = Math.min(samples.length, start + binSize);
    let maxAbs = 0;
    for (let i = start; i < end; i++) {
      const v = Math.abs(samples[i]);
      if (v > maxAbs) maxAbs = v;
    }
    rawPeaks.push(maxAbs);
    if (maxAbs > globalMax) globalMax = maxAbs;
  }
  const normFactor = globalMax > 0.0001 ? 1 / globalMax : 1;
  const waveformPeaks = rawPeaks.map((p) => Number(Math.min(1, Math.max(0.03, p * normFactor)).toFixed(3)));

  // 2. Frame-based energy, pause ratio, dynamic range, and F0 pitch tracking
  const frameLen = Math.min(samples.length, Math.max(512, Math.floor(sampleRate * 0.03))); // 30ms frames
  const frameStep = Math.max(256, Math.floor(frameLen / 2));
  const frameRmsValues: number[] = [];
  const pitches: number[] = [];
  let zcrSum = 0;
  let voicedFrames = 0;

  for (let start = 0; start + frameLen <= samples.length; start += frameStep) {
    let sumSq = 0;
    let zeroCrossings = 0;
    const frame = samples.subarray(start, start + frameLen);
    for (let i = 0; i < frameLen; i++) {
      sumSq += frame[i] * frame[i];
      if (i > 0 && ((frame[i] >= 0 && frame[i - 1] < 0) || (frame[i] < 0 && frame[i - 1] >= 0))) {
        zeroCrossings++;
      }
    }
    const rms = Math.sqrt(sumSq / frameLen);
    frameRmsValues.push(rms);

    if (rms > 0.015) {
      voicedFrames++;
      zcrSum += zeroCrossings / frameLen;
      if (pitches.length < 180) {
        const f0 = estimateFramePitchHz(frame, sampleRate);
        if (f0 !== null) pitches.push(f0);
      }
    }
  }

  const maxRms = frameRmsValues.reduce((a, b) => Math.max(a, b), 0.001);
  const pauseThreshold = Math.max(0.008, maxRms * 0.12);
  const silentFrames = frameRmsValues.filter((r) => r < pauseThreshold).length;
  const pauseRatioPercent =
    frameRmsValues.length > 0 ? Math.round((silentFrames / frameRmsValues.length) * 100) : 18;

  // Dynamic range in dB between 95th percentile and 20th percentile active frames
  const sortedRms = [...frameRmsValues].filter((r) => r > 0.001).sort((a, b) => a - b);
  let dynamicRangeDb = 24;
  if (sortedRms.length >= 5) {
    const lowRms = sortedRms[Math.floor(sortedRms.length * 0.15)];
    const highRms = sortedRms[Math.floor(sortedRms.length * 0.95)];
    dynamicRangeDb = Math.round(Math.min(48, Math.max(8, 20 * Math.log10(highRms / Math.max(lowRms, 0.0005)))));
  }

  // Median F0 + 10th/90th bounds
  let estimatedF0Hz = 138;
  let pitchMinHz = 112;
  let pitchMaxHz = 172;
  if (pitches.length >= 3) {
    const sortedPitches = [...pitches].sort((a, b) => a - b);
    estimatedF0Hz = Math.round(sortedPitches[Math.floor(sortedPitches.length * 0.5)]);
    pitchMinHz = Math.round(sortedPitches[Math.floor(sortedPitches.length * 0.12)]);
    pitchMaxHz = Math.round(sortedPitches[Math.floor(sortedPitches.length * 0.88)]);
  }

  // Warmth index inversely correlated with average voiced zero-crossing rate
  const avgZcr = voicedFrames > 0 ? zcrSum / voicedFrames : 0.08;
  const warmthIndex = Math.round(Math.min(95, Math.max(25, 92 - avgZcr * 320)));

  // Estimate speaking rate (WPM) from speech density & envelope syllabic transitions
  let syllablePeaks = 0;
  let wasAbove = false;
  const sylThreshold = maxRms * 0.28;
  for (const r of frameRmsValues) {
    if (r >= sylThreshold && !wasAbove) {
      syllablePeaks++;
      wasAbove = true;
    } else if (r < sylThreshold * 0.7) {
      wasAbove = false;
    }
  }
  const activeSeconds = Math.max(0.5, durationSec * (1 - pauseRatioPercent / 100));
  const rawWpm = Math.round((syllablePeaks / activeSeconds) * 24); // ~2.5 syllables/word -> *60/2.5 = *24
  const estimatedWpm = Math.min(205, Math.max(92, rawWpm || 136));

  return {
    durationSec,
    estimatedF0Hz,
    pitchMinHz,
    pitchMaxHz,
    pauseRatioPercent,
    estimatedWpm,
    dynamicRangeDb,
    warmthIndex,
    waveformPeaks,
  };
}

/**
 * Encodes mono Float32Array PCM samples into a 16-bit RIFF WAV Uint8Array.
 */
export function encodeFloat32ToWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

/**
 * Generates a realistic synthetic vocal-cadence demo WAV buffer with formant harmonics,
 * syllabic phrasing, and natural breath pauses for zero-friction studio testing.
 */
export function generateSyntheticStudioSampleWav(kind: 'baritono' | 'soprano' = 'baritono'): Uint8Array {
  const sampleRate = 24000;
  const durationSec = 4.5;
  const totalSamples = Math.floor(sampleRate * durationSec);
  const samples = new Float32Array(totalSamples);
  const baseF0 = kind === 'baritono' ? 116 : 208;

  // Phrase windows with realistic pauses between clauses
  const phrases: Array<[number, number]> = [
    [0.15, 1.45],
    [1.82, 3.05],
    [3.42, 4.35],
  ];

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    let activeEnv = 0;

    for (const [start, end] of phrases) {
      if (t >= start && t <= end) {
        const localT = t - start;
        const phraseLen = end - start;
        const attack = Math.min(1, localT / 0.06);
        const release = Math.min(1, (phraseLen - localT) / 0.09);
        const syllabic = 0.55 + 0.45 * Math.sin(2 * Math.PI * 3.8 * localT);
        activeEnv = attack * release * syllabic;
        break;
      }
    }

    if (activeEnv > 0.001) {
      // Natural prosodic pitch contour (gentle rise then cadence drop)
      const f0 = baseF0 * (1 + 0.07 * Math.sin(2 * Math.PI * 0.45 * t) - 0.04 * (t / durationSec));
      const harmonic1 = Math.sin(2 * Math.PI * f0 * t);
      const harmonic2 = 0.48 * Math.sin(2 * Math.PI * f0 * 2 * t);
      const harmonic3 = 0.22 * Math.sin(2 * Math.PI * f0 * 3 * t);
      const harmonic4 = 0.1 * Math.sin(2 * Math.PI * f0 * 4 * t);
      samples[i] = activeEnv * 0.42 * (harmonic1 + harmonic2 + harmonic3 + harmonic4);
    } else {
      // Subtle room floor / breath texture
      samples[i] = (Math.sin(i * 12.9898) * 0.0015);
    }
  }

  return encodeFloat32ToWav(samples, sampleRate);
}

/**
 * Builds the authoritative `speechMetadata.style` directive for Gemini 3.8 TTS
 * combining the learned vocal DNA, acoustic pitch/cadence cues, emotional intention,
 * and user fidelity slider.
 */
export function buildEffectiveStylePrompt(
  profile: NarratorProfile,
  emotion: EmotionPreset,
  fidelityLevel: number
): string {
  const emotionSpec = EMOTION_LABELS[emotion];
  const fidelityNote =
    fidelityLevel >= 80
      ? 'Strictly preserve the exact vocal timbre, micro-pauses, breath placement, and pitch cadence of the learned speaker.'
      : fidelityLevel >= 50
        ? 'Balance the learned speaker timbre and phrasing with subtle expressive flexibility for the chosen emotion.'
        : 'Prioritize expressive emotional delivery while retaining the core tonal warmth of the narrator.';

  return [
    `Narrator Persona: ${profile.name} (${profile.role}).`,
    `Core Timbre & Pitch: ${profile.dna.timbreCharacteristics} (Center F0 around ${profile.acousticMetrics.estimatedF0Hz} Hz, ${profile.acousticMetrics.estimatedWpm} words/min).`,
    `Cadence & Pauses: ${profile.dna.cadenceAndRhythm} ${profile.dna.pauseAndBreathHabits}.`,
    `Regional Diction: ${profile.dna.regionalDiction}.`,
    `Style Blueprint: ${profile.dna.stylePrompt}`,
    `Emotional Direction (${emotionSpec.label}): ${emotionSpec.directive}`,
    `Fidelity Directive (${fidelityLevel}%): ${fidelityNote}`,
  ]
    .join(' ')
    .trim();
}
