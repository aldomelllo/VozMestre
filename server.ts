import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import {
  base64ToUint8Array,
  buildEffectiveStylePrompt,
  concatWavBuffers,
  EMOTION_LABELS,
  splitScriptIntoChunks,
  uint8ArrayToBase64,
} from './src/utils/audioProcessing';
import {
  executeWithRetryAndFallback,
  extractFriendlyGeminiError,
} from './src/utils/geminiRetry';
import type { AcousticMetrics, EmotionPreset, NarratorProfile } from './src/types/voice';

const PORT = 3000;

function getAiClient(apiVersion?: string): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY não configurada no servidor.');
  }
  return new GoogleGenAI({
    apiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      ...(apiVersion ? { apiVersion } : {}),
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function normalizeAudioMimeType(mimeType: string): string {
  const base = mimeType.split(';')[0].trim().toLowerCase();
  if (base === 'audio/x-wav' || base === 'audio/wave') return 'audio/wav';
  if (base === 'audio/mpeg') return 'audio/mp3';
  if (base === 'audio/x-m4a') return 'audio/mp4';
  return base || 'audio/wav';
}

async function main() {
  const app = express();
  app.use(express.json({ limit: '60mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  /**
   * POST /api/voices/analyze
   * Learns the speaker's vocal timbre, tone, pauses, breathing rhythm, and emotional
   * prosody from one or more uploaded/recorded reference audio samples.
   */
  app.post('/api/voices/analyze', async (req, res) => {
    try {
      const { audios, speakerName, clientMetrics } = req.body as {
        audios?: Array<{ base64: string; mimeType: string; fileName: string }>;
        speakerName?: string;
        clientMetrics?: AcousticMetrics;
      };

      if (!audios || !Array.isArray(audios) || audios.length === 0) {
        return res.status(400).json({ error: 'Envie ao menos um áudio de referência para análise vocal.' });
      }

      const ai = getAiClient();

      // Step 1: Transcribe the primary reference audio using gemini-3.5-transcribe
      const primaryAudio = audios[0];
      let transcript = '';
      try {
        const { result: transcribeRes } = await executeWithRetryAndFallback({
          models: ['gemini-3.5-transcribe'],
          maxRetriesPerModel: 1,
          baseDelayMs: 600,
          run: (model) =>
            ai.models.generateContent({
              model,
              contents: {
                parts: [
                  {
                    inlineData: {
                      mimeType: normalizeAudioMimeType(primaryAudio.mimeType),
                      data: primaryAudio.base64,
                    },
                  },
                  {
                    text: 'Transcreva fielmente este áudio no idioma falado, preservando pontuação e hesitações naturais.',
                  },
                ],
              },
            }),
        });
        transcript = (transcribeRes.text ?? '').trim();
      } catch {
        transcript = '';
      }

      // Step 2: Deep multimodal acoustic & prosodic analysis with gemini-4-hydrogen
      const audioParts = audios.slice(0, 4).map((a) => ({
        inlineData: {
          mimeType: normalizeAudioMimeType(a.mimeType),
          data: a.base64,
        },
      }));

      const metricsContext = clientMetrics
        ? `Medições acústicas reais extraídas via DSP da amostra: F0 médio ${clientMetrics.estimatedF0Hz} Hz (faixa ${clientMetrics.pitchMinHz}–${clientMetrics.pitchMaxHz} Hz), taxa de pausas ${clientMetrics.pauseRatioPercent}%, cadência estimada ${clientMetrics.estimatedWpm} palavras/min, faixa dinâmica ${clientMetrics.dynamicRangeDb} dB, índice de calor espectral ${clientMetrics.warmthIndex}/100.`
        : '';

      const analysisPrompt = `Você é um engenheiro de som, fonoaudiólogo e diretor de dublagem especialista em análise prosódica humana.
Analise atentamente os áudios enviados${speakerName ? ` do locutor "${speakerName}"` : ''}.
${metricsContext}
${transcript ? `Transcrição detectada: "${transcript}"` : ''}

Estude como essa pessoa realmente fala:
- Timbre vocal (grave/médio/agudo, ressonância peitoral ou nasal, rouquidão/soprosidade, calor)
- Tom de voz e personalidade vocal
- Pausas, silêncios, ritmo silábico e respiração
- Entonação emocional, curvas melódicas e ênfases características
- Dicção e sotaque regional

Escolha também qual voz base de síntese neural melhor corresponde ao registro fundamental do falante:
- "Charon": Masculina grave/barítono, autoridade serena e documental
- "Fenrir": Masculina intensa, dramática e profunda
- "Puck": Masculina ou juvenil versátil, articulada e expressiva
- "Kore": Feminina média-grave/mezzo-soprano acolhedora e narrativa
- "Zephyr": Feminina leve, cristalina e suave

Retorne em JSON estrito no idioma português (exceto o campo "stylePrompt", que deve ser escrito em inglês técnico hiper-descritivo de direção vocal para o sintetizador neural reproduzir com máxima fidelidade humana).`;

      const { result: analysisRes } = await executeWithRetryAndFallback({
        models: ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'],
        maxRetriesPerModel: 2,
        baseDelayMs: 700,
        run: (model) =>
          ai.models.generateContent({
            model,
            contents: {
              parts: [...audioParts, { text: analysisPrompt }],
            },
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  toneSummary: {
                    type: Type.STRING,
                    description: 'Resumo curto do tom de voz (ex: Barítono acolhedor e firme).',
                  },
                  timbreCharacteristics: {
                    type: Type.STRING,
                    description: 'Descrição detalhada do timbre, ressonância e textura vocal.',
                  },
                  cadenceAndRhythm: {
                    type: Type.STRING,
                    description: 'Como a pessoa acelera, desacelera e organiza o ritmo das frases.',
                  },
                  pauseAndBreathHabits: {
                    type: Type.STRING,
                    description: 'Padrão de pausas, silêncios e respirações naturais entre frases.',
                  },
                  emotionalSignature: {
                    type: Type.STRING,
                    description: 'Como a pessoa expressa emoção, empatia e intenção na voz.',
                  },
                  regionalDiction: {
                    type: Type.STRING,
                    description: 'Idioma, sotaque regional e clareza articulatória.',
                  },
                  prosodyRules: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: '3 a 5 regras práticas de prosódia observadas nesta voz.',
                  },
                  stylePrompt: {
                    type: Type.STRING,
                    description:
                      'Detailed English Voice Design style prompt capturing exact pitch, warmth, breath habits, cadence, pauses, and human acoustic realism.',
                  },
                  recommendedBaseVoice: {
                    type: Type.STRING,
                    description: 'Must be exactly one of: Charon, Fenrir, Kore, Puck, Zephyr.',
                  },
                  transcript: {
                    type: Type.STRING,
                    description: 'Transcrição limpa da amostra se não tiver sido informada antes.',
                  },
                },
                required: [
                  'toneSummary',
                  'timbreCharacteristics',
                  'cadenceAndRhythm',
                  'pauseAndBreathHabits',
                  'emotionalSignature',
                  'regionalDiction',
                  'prosodyRules',
                  'stylePrompt',
                  'recommendedBaseVoice',
                ],
              },
            },
          }),
      });

      const parsed = JSON.parse((analysisRes.text ?? '{}').trim());
      const validVoices = ['Charon', 'Fenrir', 'Kore', 'Puck', 'Zephyr'];
      const recommendedBaseVoice = validVoices.includes(parsed.recommendedBaseVoice)
        ? parsed.recommendedBaseVoice
        : clientMetrics && clientMetrics.estimatedF0Hz > 165
          ? 'Kore'
          : 'Charon';

      res.json({
        dna: {
          toneSummary: parsed.toneSummary || 'Timbre natural expressivo',
          timbreCharacteristics: parsed.timbreCharacteristics || 'Voz equilibrada com boa presença vocal.',
          cadenceAndRhythm: parsed.cadenceAndRhythm || 'Ritmo conversacional natural e constante.',
          pauseAndBreathHabits: parsed.pauseAndBreathHabits || 'Pausas orgânicas entre períodos.',
          emotionalSignature: parsed.emotionalSignature || 'Entonação humana e acolhedora.',
          regionalDiction: parsed.regionalDiction || 'Português brasileiro natural.',
          prosodyRules: Array.isArray(parsed.prosodyRules) ? parsed.prosodyRules : [],
          stylePrompt:
            parsed.stylePrompt ||
            'Natural human narrator with organic breath pauses, authentic inflection, and studio close-mic warmth.',
          recommendedBaseVoice,
          transcript: transcript || parsed.transcript || '',
        },
      });
    } catch (err) {
      const { status, message } = extractFriendlyGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  /**
   * POST /api/narrate/adapt
   * Adapts the user's raw script with organic breathing (<breath>) and prosodic pauses
   * matching the learned speaker's habits without changing the user's words.
   */
  app.post('/api/narrate/adapt', async (req, res) => {
    try {
      const { rawText, profile, emotion } = req.body as {
        rawText?: string;
        profile?: NarratorProfile;
        emotion?: EmotionPreset;
      };

      if (!rawText || !rawText.trim()) {
        return res.status(400).json({ error: 'Digite um texto para adaptar à prosódia do narrador.' });
      }
      if (!profile) {
        return res.status(400).json({ error: 'Selecione um perfil de narrador.' });
      }

      const ai = getAiClient();
      const emotionSpec = EMOTION_LABELS[emotion ?? 'natural'];

      const { result: response } = await executeWithRetryAndFallback({
        models: ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'],
        maxRetriesPerModel: 2,
        baseDelayMs: 700,
        run: (model) =>
          ai.models.generateContent({
            model,
            contents: `Você é um diretor de locução preparando um roteiro para o narrador "${profile.name}".
Características aprendidas desta voz:
- Cadência: ${profile.dna.cadenceAndRhythm}
- Pausas e respiração: ${profile.dna.pauseAndBreathHabits}
- Assinatura emocional: ${profile.dna.emotionalSignature}
- Regras de prosódia: ${profile.dna.prosodyRules.join('; ')}
- Intenção escolhida para este take: ${emotionSpec.label}

Reescreva a pontuação e insira marcações sutis de respiração humana ("<breath>") e pausas ("..." ou "—") no texto abaixo para que a locução soe indistinguível de uma gravação humana real deste narrador.
REGRAS ESTRITAS:
1. NÃO adicione, remova ou troque nenhuma palavra do texto original do usuário.
2. Use apenas marcações discretas de "<breath>" (no máximo 1 a cada 2 ou 3 frases, onde um humano realmente puxaria o ar), reticências "..." ou travessões "—" para modular ritmo e emoção.
3. Retorne APENAS o roteiro pronto para leitura, sem comentários extras ou aspas.

Texto original:
${rawText.trim()}`,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          }),
      });

      const directedText = (response.text ?? rawText).trim();
      res.json({ directedText });
    } catch (err) {
      const { status, message } = extractFriendlyGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  /**
   * POST /api/narrate/synthesize
   * Generates faithful, human-like narration audio using gemini-3.8-flash-tts
   * conditioned on the narrator's learned Vocal DNA and emotional direction.
   */
  app.post('/api/narrate/synthesize', async (req, res) => {
    try {
      const { text, profile, emotion, fidelityLevel } = req.body as {
        text?: string;
        profile?: NarratorProfile;
        emotion?: EmotionPreset;
        fidelityLevel?: number;
      };

      if (!text || !text.trim()) {
        return res.status(400).json({ error: 'O texto da narração não pode estar vazio.' });
      }
      if (!profile) {
        return res.status(400).json({ error: 'Selecione um perfil de narrador.' });
      }

      const ttsAi = getAiClient('v1beta');
      const effectiveStyle = buildEffectiveStylePrompt(
        profile,
        emotion ?? 'natural',
        typeof fidelityLevel === 'number' ? fidelityLevel : 90
      );

      const chunks = splitScriptIntoChunks(text.trim(), 420);
      const wavBuffers: Uint8Array[] = [];

      const synthesizeChunkViaGenerateContent = async (chunk: string): Promise<string> => {
        const { result: ttsResponse } = await executeWithRetryAndFallback({
          models: ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'],
          maxRetriesPerModel: 2,
          baseDelayMs: 700,
          run: (model) =>
            ttsAi.models.generateContent({
              model,
              contents: [
                {
                  role: 'user',
                  parts: [
                    {
                      text: chunk,
                      speechMetadata: {
                        style: effectiveStyle,
                      },
                    },
                  ],
                },
              ],
              config: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName: profile.baseVoice,
                    },
                  },
                },
              },
            }),
        });

        const base64Chunk = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64Chunk) {
          throw new Error('O motor de síntese não retornou dados de áudio para o trecho enviado.');
        }
        return base64Chunk;
      };

      const synthesizeChunkViaInteractions = async (chunk: string): Promise<string> => {
        const { result: interaction } = await executeWithRetryAndFallback({
          models: ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'],
          maxRetriesPerModel: 2,
          baseDelayMs: 700,
          run: (model) =>
            ttsAi.interactions.create({
              model,
              input: [
                {
                  type: 'text',
                  text: chunk,
                  annotations: [
                    {
                      type: 'speech_metadata',
                      style: effectiveStyle,
                    },
                  ],
                },
              ],
              response_format: { type: 'audio' },
              generation_config: {
                speech_config: [
                  {
                    language: 'pt-BR',
                    voice: profile.baseVoice,
                  },
                ],
              },
            }),
        });

        const audioData = interaction.output_audio?.data;
        if (!audioData) {
          throw new Error('O motor de síntese não retornou dados de áudio para o trecho enviado.');
        }
        return audioData;
      };

      for (const chunk of chunks) {
        let base64Chunk: string;
        try {
          base64Chunk = await synthesizeChunkViaGenerateContent(chunk);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('Unknown name') || msg.includes('Cannot find field')) {
            base64Chunk = await synthesizeChunkViaInteractions(chunk);
          } else {
            throw err;
          }
        }
        wavBuffers.push(base64ToUint8Array(base64Chunk));
      }

      const mergedWav = concatWavBuffers(wavBuffers);
      const audioBase64Wav = uint8ArrayToBase64(mergedWav);

      res.json({
        audioBase64Wav,
        chunkCount: chunks.length,
        effectiveStyle,
      });
    } catch (err) {
      const { status, message } = extractFriendlyGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`VozMestre Studio server listening on http://0.0.0.0:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
