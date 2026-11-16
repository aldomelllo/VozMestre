import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEffectiveStylePrompt,
  computeAcousticMetricsFromPcm,
  concatWavBuffers,
  encodeFloat32ToWav,
  generateSyntheticStudioSampleWav,
  splitScriptIntoChunks,
} from './audioProcessing';
import type { NarratorProfile } from '../types/voice';

test('splitScriptIntoChunks preserves short text as single chunk', () => {
  const result = splitScriptIntoChunks('Olá, bem-vindo ao estúdio de narração profissional.', 200);
  assert.deepEqual(result, ['Olá, bem-vindo ao estúdio de narração profissional.']);
});

test('splitScriptIntoChunks splits long paragraphs cleanly at sentence boundaries', () => {
  const text =
    'Primeira frase completa para narração humana. Segunda frase com pausas naturais e entonação calma. Terceira frase encerrando o parágrafo com fidelidade.';
  const chunks = splitScriptIntoChunks(text, 75);
  assert.equal(chunks.length >= 2, true);
  for (const chunk of chunks) {
    assert.equal(chunk.length <= 75, true);
  }
  assert.equal(chunks.join(' '), text);
});

test('concatWavBuffers merges multiple WAV clips with accurate RIFF and data chunk sizes', () => {
  const sr = 24000;
  const clipA = encodeFloat32ToWav(new Float32Array(2400).fill(0.1), sr); // 4800 PCM bytes
  const clipB = encodeFloat32ToWav(new Float32Array(1200).fill(-0.1), sr); // 2400 PCM bytes

  const merged = concatWavBuffers([clipA, clipB]);
  assert.equal(merged.length, 44 + 4800 + 2400);

  const view = new DataView(merged.buffer, merged.byteOffset, merged.byteLength);
  assert.equal(view.getUint32(4, true), merged.length - 8);
  assert.equal(view.getUint32(40, true), 4800 + 2400);
});

test('computeAcousticMetricsFromPcm extracts accurate F0 pitch and pause ratio from synthetic studio sample', () => {
  const wav = generateSyntheticStudioSampleWav('baritono');
  // Decode 16-bit PCM starting at byte 44
  const view = new DataView(wav.buffer, wav.byteOffset + 44, wav.length - 44);
  const sampleCount = (wav.length - 44) / 2;
  const pcm = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    pcm[i] = view.getInt16(i * 2, true) / 0x8000;
  }

  const metrics = computeAcousticMetricsFromPcm(pcm, 24000, 64);
  assert.equal(metrics.durationSec, 4.5);
  assert.equal(metrics.waveformPeaks.length, 64);
  assert.equal(metrics.estimatedF0Hz >= 95 && metrics.estimatedF0Hz <= 140, true);
  assert.equal(metrics.pauseRatioPercent >= 10 && metrics.pauseRatioPercent <= 50, true);
});

test('buildEffectiveStylePrompt embeds narrator DNA, emotion directive, and fidelity level', () => {
  const mockProfile: NarratorProfile = {
    id: 'n1',
    name: 'Ricardo Mendes',
    role: 'Documentário',
    createdAt: '2026-11-16T00:00:00Z',
    sampleCount: 1,
    totalReferenceDurationSec: 18,
    baseVoice: 'Charon',
    acousticMetrics: {
      durationSec: 18,
      estimatedF0Hz: 116,
      pitchMinHz: 94,
      pitchMaxHz: 145,
      pauseRatioPercent: 22,
      estimatedWpm: 132,
      dynamicRangeDb: 26,
      warmthIndex: 74,
      waveformPeaks: [0.2, 0.5, 0.8],
    },
    dna: {
      toneSummary: 'Grave acolhedor e firme',
      timbreCharacteristics: 'Timbre barítono com ressonância peitoral quente',
      cadenceAndRhythm: 'Cadência pausada e reflexiva',
      pauseAndBreathHabits: 'Respirações suaves antes de substantivos-chave',
      emotionalSignature: 'Autoridade serena com calor humano',
      regionalDiction: 'Português brasileiro neutro de locução',
      prosodyRules: ['Pausa de 400ms após vírgulas narrativas'],
      stylePrompt: 'Warm baritone Brazilian Portuguese narrator with deliberate breath pauses.',
      recommendedBaseVoice: 'Charon',
      transcript: 'Amostra de locução.',
    },
    calibration: {
      pitchSemitones: 0,
      rateMultiplier: 1,
      warmthDb: 1.5,
      studioCompression: true,
    },
    referenceSamples: [],
  };

  const directive = buildEffectiveStylePrompt(mockProfile, 'storytelling', 92);
  assert.match(directive, /Ricardo Mendes/);
  assert.match(directive, /116 Hz/);
  assert.match(directive, /Storytelling Emocional/);
  assert.match(directive, /92%/);
});
