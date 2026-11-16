import type { NarratorProfile } from '../types/voice';

export const SEED_NARRATORS: NarratorProfile[] = [
  {
    id: 'narrator-ricardo-mendes',
    name: 'Ricardo Mendes',
    role: 'Documentário & Institucional',
    avatarUrl: '/src/assets/images/narrator_ricardo_portrait_1794843344719.jpg',
    createdAt: '2026-11-10T14:20:00.000Z',
    sampleCount: 2,
    totalReferenceDurationSec: 42.6,
    baseVoice: 'Charon',
    acousticMetrics: {
      durationSec: 42.6,
      estimatedF0Hz: 114,
      pitchMinHz: 92,
      pitchMaxHz: 146,
      pauseRatioPercent: 24,
      estimatedWpm: 128,
      dynamicRangeDb: 28,
      warmthIndex: 78,
      waveformPeaks: [
        0.18, 0.42, 0.71, 0.88, 0.64, 0.53, 0.79, 0.91, 0.45, 0.14, 0.08, 0.36, 0.68, 0.84, 0.77, 0.59,
        0.82, 0.95, 0.71, 0.49, 0.21, 0.11, 0.44, 0.76, 0.89, 0.67, 0.54, 0.73, 0.86, 0.62, 0.31, 0.09,
        0.39, 0.72, 0.93, 0.81, 0.58, 0.66, 0.84, 0.75, 0.41, 0.15, 0.07, 0.48, 0.77, 0.9, 0.63, 0.52,
        0.69, 0.85, 0.74, 0.46, 0.24, 0.08, 0.33, 0.65, 0.82, 0.7, 0.55, 0.78, 0.89, 0.58, 0.27, 0.12,
      ],
    },
    dna: {
      toneSummary: 'Barítono quente, sereno e envolvente',
      timbreCharacteristics:
        'Ressonância peitoral encorpada com graves limpos (114 Hz), leve textura aveludada nas vogais abertas e ausência de estridência nos agudos.',
      cadenceAndRhythm:
        'Ritmo pausado de 128 palavras por minuto; desacelera sutilmente nos últimos três termos de cada período para dar peso conclusivo.',
      pauseAndBreathHabits:
        'Respirações audíveis porém discretas a cada duas frases; sustenta pausas dramáticas de 450–600 ms antes de revelações ou contrastes.',
      emotionalSignature:
        'Autoridade empática e intimista — transmite confiança sem soar rígido ou artificialmente locutado.',
      regionalDiction:
        'Português brasileiro culto com articulação nítida de consoantes oclusivas e sotaque sudeste suavizado.',
      prosodyRules: [
        'Inserir micro-respiração natural (<breath>) antes de frases de abertura longas',
        'Manter entonação descendente suave em finais assertivos',
        'Alongar levemente sílabas tônicas em palavras de carga emocional',
        'Evitar aceleração excessiva após vírgulas enumerativas',
      ],
      stylePrompt:
        'Experienced Brazilian Portuguese baritone documentary narrator. Warm chest resonance, unhurried 128 WPM pacing, subtle organic breath intakes between clauses, downward grounded cadence at sentence endings, intimate studio close-mic realism.',
      recommendedBaseVoice: 'Charon',
      transcript:
        'Toda grande história começa no silêncio antes da primeira palavra. Quando respiramos fundo e deixamos o tempo assentar, a voz encontra o seu verdadeiro peso.',
    },
    calibration: {
      pitchSemitones: 0,
      rateMultiplier: 1.0,
      warmthDb: 1.5,
      studioCompression: true,
    },
    referenceSamples: [
      {
        id: 'seed-ricardo-1',
        fileName: 'ricardo_referencia_estudio.wav',
        mimeType: 'audio/wav',
        durationSec: 42.6,
      },
    ],
    isBuiltIn: true,
  },
  {
    id: 'narrator-clara-vasconcelos',
    name: 'Clara Vasconcelos',
    role: 'Audiolivros & Storytelling',
    avatarUrl: '/src/assets/images/narrator_clara_portrait_1794843342026.jpg',
    createdAt: '2026-11-12T09:45:00.000Z',
    sampleCount: 2,
    totalReferenceDurationSec: 36.4,
    baseVoice: 'Kore',
    acousticMetrics: {
      durationSec: 36.4,
      estimatedF0Hz: 196,
      pitchMinHz: 158,
      pitchMaxHz: 248,
      pauseRatioPercent: 21,
      estimatedWpm: 142,
      dynamicRangeDb: 25,
      warmthIndex: 66,
      waveformPeaks: [
        0.14, 0.38, 0.65, 0.84, 0.72, 0.48, 0.69, 0.9, 0.62, 0.29, 0.09, 0.34, 0.61, 0.87, 0.79, 0.54,
        0.74, 0.92, 0.68, 0.41, 0.16, 0.07, 0.42, 0.75, 0.88, 0.63, 0.49, 0.71, 0.85, 0.59, 0.25, 0.1,
        0.37, 0.69, 0.91, 0.76, 0.52, 0.67, 0.83, 0.7, 0.38, 0.13, 0.08, 0.45, 0.78, 0.89, 0.61, 0.47,
        0.64, 0.82, 0.69, 0.43, 0.19, 0.09, 0.31, 0.63, 0.8, 0.68, 0.51, 0.73, 0.86, 0.53, 0.22, 0.11,
      ],
    },
    dna: {
      toneSummary: 'Mezzo-soprano expressivo, cristalino e acolhedor',
      timbreCharacteristics:
        'Voz média-aguda equilibrada (196 Hz) com brilho natural nas consoantes sibilantes e finalizações suaves com leve soprosidade emotiva.',
      cadenceAndRhythm:
        'Ritmo fluido de 142 palavras por minuto com variações melódicas orgânicas que acompanham a intenção de cada cena.',
      pauseAndBreathHabits:
        'Pausas curtas e musicais entre diálogos; respirações sutis que sinalizam mudança de perspectiva emocional.',
      emotionalSignature:
        'Sensibilidade narrativa elevada — alterna ternura, curiosidade e firmeza com transição imperceptível.',
      regionalDiction:
        'Português brasileiro fluido, pronúncia natural e espontânea sem afetação teatral exagerada.',
      prosodyRules: [
        'Preservar inflexões ascendentes sutis em perguntas e aberturas de cena',
        'Suavizar finais de frase com queda gradual de volume',
        'Manter transições fluidas entre descrição e discurso direto',
      ],
      stylePrompt:
        'Expressive Brazilian Portuguese mezzo-soprano audiobook narrator. Clear warm mid-range timbre around 196 Hz, melodic pitch variation, natural breathiness at emotional phrase endings, 142 WPM fluid literary cadence, lifelike human spontaneity.',
      recommendedBaseVoice: 'Kore',
      transcript:
        'Às vezes a memória guarda não o que foi dito, mas a maneira exata como a luz entrava pela janela naquele instante.',
    },
    calibration: {
      pitchSemitones: 0,
      rateMultiplier: 1.0,
      warmthDb: 1.0,
      studioCompression: true,
    },
    referenceSamples: [
      {
        id: 'seed-clara-1',
        fileName: 'clara_leitura_literaria.wav',
        mimeType: 'audio/wav',
        durationSec: 36.4,
      },
    ],
    isBuiltIn: true,
  },
];
