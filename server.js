// server.ts
import "dotenv/config";
import express from "express";
import path from "node:path";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";

// src/utils/audioProcessing.ts
var EMOTION_LABELS = {
  natural: {
    label: "Natural da Voz",
    directive: "Preserve the speaker baseline conversational warmth, authentic pauses, and natural organic inflection."
  },
  documentario: {
    label: "Document\xE1rio",
    directive: "Authoritative, unhurried documentary cadence with contemplative pauses and rich chest resonance."
  },
  storytelling: {
    label: "Storytelling Emocional",
    directive: "Intimate, emotionally resonant storytelling with dynamic pitch swells, subtle vulnerability, and deliberate breaths."
  },
  comercial: {
    label: "Comercial & Convite",
    directive: "Warm, confident, persuasive delivery with crisp articulation, buoyant mid-phrase energy, and smiling timbre."
  },
  jornalistico: {
    label: "Jornal\xEDstico",
    directive: "Measured, articulate broadcast precision with balanced phrasing, clear consonant attack, and calm authority."
  },
  intimo: {
    label: "\xCDntimo & Sussurrado",
    directive: "Close-mic, warm, velvety low-volume proximity with soft breathy tails and unhurried phrasing."
  }
};
function base64ToUint8Array(base64) {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
function uint8ArrayToBase64(bytes) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  const chunkSize = 32768;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}
function splitScriptIntoChunks(text, maxChars = 420) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];
  const paragraphs = normalized.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  for (const para of paragraphs) {
    if (para.length <= maxChars) {
      chunks.push(para);
      continue;
    }
    const sentences = para.match(/[^.!?]+(?:[.!?]+|\.{3})?(?:\s+|$)/g) ?? [para];
    let current = "";
    for (const rawSentence of sentences) {
      const sentence = rawSentence.trim();
      if (!sentence) continue;
      if (sentence.length > maxChars) {
        if (current) {
          chunks.push(current.trim());
          current = "";
        }
        const words = sentence.split(/\s+/);
        let sub = "";
        for (const word of words) {
          if ((sub + " " + word).trim().length > maxChars) {
            if (sub) chunks.push(sub.trim());
            sub = word;
          } else {
            sub = sub ? `${sub} ${word}` : word;
          }
        }
        if (sub) chunks.push(sub.trim());
        continue;
      }
      if ((current + " " + sentence).trim().length > maxChars) {
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
function concatWavBuffers(wavBuffers) {
  const valid = wavBuffers.filter((b) => b.length > 44);
  if (valid.length === 0) {
    throw new Error("Nenhum buffer WAV v\xE1lido recebido para concatena\xE7\xE3o.");
  }
  if (valid.length === 1) {
    return valid[0];
  }
  const findDataOffset = (buf) => {
    let offset = 12;
    while (offset + 8 <= buf.length) {
      const id = String.fromCharCode(buf[offset], buf[offset + 1], buf[offset + 2], buf[offset + 3]);
      const view2 = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      const size = view2.getUint32(offset + 4, true);
      if (id === "data") {
        const clampedSize = Math.min(size, buf.length - (offset + 8));
        return { dataOffset: offset + 8, dataSize: clampedSize };
      }
      offset += 8 + size;
    }
    return { dataOffset: 44, dataSize: buf.length - 44 };
  };
  const firstInfo = findDataOffset(valid[0]);
  const header = valid[0].slice(0, firstInfo.dataOffset);
  const pcmSegments = [
    valid[0].subarray(firstInfo.dataOffset, firstInfo.dataOffset + firstInfo.dataSize)
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
  view.setUint32(4, out.length - 8, true);
  view.setUint32(header.length - 4, totalPcmBytes, true);
  return out;
}
function buildEffectiveStylePrompt(profile, emotion, fidelityLevel) {
  const emotionSpec = EMOTION_LABELS[emotion];
  const fidelityNote = fidelityLevel >= 80 ? "Strictly preserve the exact vocal timbre, micro-pauses, breath placement, and pitch cadence of the learned speaker." : fidelityLevel >= 50 ? "Balance the learned speaker timbre and phrasing with subtle expressive flexibility for the chosen emotion." : "Prioritize expressive emotional delivery while retaining the core tonal warmth of the narrator.";
  return [
    `Narrator Persona: ${profile.name} (${profile.role}).`,
    `Core Timbre & Pitch: ${profile.dna.timbreCharacteristics} (Center F0 around ${profile.acousticMetrics.estimatedF0Hz} Hz, ${profile.acousticMetrics.estimatedWpm} words/min).`,
    `Cadence & Pauses: ${profile.dna.cadenceAndRhythm} ${profile.dna.pauseAndBreathHabits}.`,
    `Regional Diction: ${profile.dna.regionalDiction}.`,
    `Style Blueprint: ${profile.dna.stylePrompt}`,
    `Emotional Direction (${emotionSpec.label}): ${emotionSpec.directive}`,
    `Fidelity Directive (${fidelityLevel}%): ${fidelityNote}`
  ].join(" ").trim();
}

// src/utils/geminiRetry.ts
function getErrorText(err) {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
function isTransientGeminiError(err) {
  const text = getErrorText(err).toLowerCase();
  return text.includes("503") || text.includes("unavailable") || text.includes("high demand") || text.includes("overloaded") || text.includes("try again later") || text.includes("429") || text.includes("resource_exhausted") || text.includes("econnreset") || text.includes("etimedout") || text.includes("fetch failed");
}
function extractFriendlyGeminiError(err) {
  const raw = getErrorText(err);
  if (raw.includes("403") || raw.includes("PERMISSION_DENIED") || raw.includes("API_KEY_INVALID")) {
    return {
      status: 403,
      message: "Chave da API Gemini ausente ou inv\xE1lida. Verifique Settings > Secrets."
    };
  }
  if (raw.includes("503") || raw.includes("UNAVAILABLE") || raw.toLowerCase().includes("high demand")) {
    return {
      status: 503,
      message: "Os servidores de an\xE1lise vocal est\xE3o com pico moment\xE2neo de demanda (503). Tentamos automaticamente modelos alternativos, mas o servi\xE7o segue congestionado \u2014 aguarde alguns segundos e tente novamente."
    };
  }
  if (raw.includes("429") || raw.includes("RESOURCE_EXHAUSTED")) {
    return {
      status: 429,
      message: "Limite tempor\xE1rio de requisi\xE7\xF5es atingido. Aguarde alguns segundos e tente novamente."
    };
  }
  try {
    const parsed = JSON.parse(raw);
    const cleanMsg = parsed?.error?.message || parsed?.message;
    if (cleanMsg) {
      return { status: 500, message: cleanMsg };
    }
  } catch {
  }
  return {
    status: 500,
    message: raw || "Falha inesperada ao processar \xE1udio no servidor."
  };
}
var defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function executeWithRetryAndFallback({
  models,
  run,
  maxRetriesPerModel = 2,
  baseDelayMs = 800,
  sleepFn = defaultSleep
}) {
  if (models.length === 0) {
    throw new Error("Nenhum modelo especificado para execu\xE7\xE3o.");
  }
  let lastError;
  for (let mIdx = 0; mIdx < models.length; mIdx++) {
    const model = models[mIdx];
    for (let attempt = 0; attempt <= maxRetriesPerModel; attempt++) {
      try {
        const result = await run(model);
        return { result, usedModel: model };
      } catch (err) {
        lastError = err;
        const transient = isTransientGeminiError(err);
        if (!transient) {
          throw err;
        }
        const hasMoreAttemptsOnSameModel = attempt < maxRetriesPerModel;
        if (hasMoreAttemptsOnSameModel) {
          const delay = baseDelayMs * Math.pow(2, attempt);
          await sleepFn(delay);
        }
      }
    }
  }
  throw lastError;
}

// server.ts
var PORT = 3e3;
function getAiClient(apiVersion) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY n\xE3o configurada no servidor.");
  }
  return new GoogleGenAI({
    apiKey,
    ...apiVersion ? { apiVersion } : {},
    httpOptions: {
      ...apiVersion ? { apiVersion } : {},
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
}
function normalizeAudioMimeType(mimeType) {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  if (base === "audio/x-wav" || base === "audio/wave") return "audio/wav";
  if (base === "audio/mpeg") return "audio/mp3";
  if (base === "audio/x-m4a") return "audio/mp4";
  return base || "audio/wav";
}
async function main() {
  const app = express();
  app.use(express.json({ limit: "60mb" }));
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.post("/api/voices/analyze", async (req, res) => {
    try {
      const { audios, speakerName, clientMetrics } = req.body;
      if (!audios || !Array.isArray(audios) || audios.length === 0) {
        return res.status(400).json({ error: "Envie ao menos um \xE1udio de refer\xEAncia para an\xE1lise vocal." });
      }
      const ai = getAiClient();
      const primaryAudio = audios[0];
      let transcript = "";
      try {
        const { result: transcribeRes } = await executeWithRetryAndFallback({
          models: ["gemini-3.5-transcribe"],
          maxRetriesPerModel: 1,
          baseDelayMs: 600,
          run: (model) => ai.models.generateContent({
            model,
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType: normalizeAudioMimeType(primaryAudio.mimeType),
                    data: primaryAudio.base64
                  }
                },
                {
                  text: "Transcreva fielmente este \xE1udio no idioma falado, preservando pontua\xE7\xE3o e hesita\xE7\xF5es naturais."
                }
              ]
            }
          })
        });
        transcript = (transcribeRes.text ?? "").trim();
      } catch {
        transcript = "";
      }
      const audioParts = audios.slice(0, 4).map((a) => ({
        inlineData: {
          mimeType: normalizeAudioMimeType(a.mimeType),
          data: a.base64
        }
      }));
      const metricsContext = clientMetrics ? `Medi\xE7\xF5es ac\xFAsticas reais extra\xEDdas via DSP da amostra: F0 m\xE9dio ${clientMetrics.estimatedF0Hz} Hz (faixa ${clientMetrics.pitchMinHz}\u2013${clientMetrics.pitchMaxHz} Hz), taxa de pausas ${clientMetrics.pauseRatioPercent}%, cad\xEAncia estimada ${clientMetrics.estimatedWpm} palavras/min, faixa din\xE2mica ${clientMetrics.dynamicRangeDb} dB, \xEDndice de calor espectral ${clientMetrics.warmthIndex}/100.` : "";
      const analysisPrompt = `Voc\xEA \xE9 um engenheiro de som, fonoaudi\xF3logo e diretor de dublagem especialista em an\xE1lise pros\xF3dica humana.
Analise atentamente os \xE1udios enviados${speakerName ? ` do locutor "${speakerName}"` : ""}.
${metricsContext}
${transcript ? `Transcri\xE7\xE3o detectada: "${transcript}"` : ""}

Estude como essa pessoa realmente fala:
- Timbre vocal (grave/m\xE9dio/agudo, resson\xE2ncia peitoral ou nasal, rouquid\xE3o/soprosidade, calor)
- Tom de voz e personalidade vocal
- Pausas, sil\xEAncios, ritmo sil\xE1bico e respira\xE7\xE3o
- Entona\xE7\xE3o emocional, curvas mel\xF3dicas e \xEAnfases caracter\xEDsticas
- Dic\xE7\xE3o e sotaque regional

Escolha tamb\xE9m qual voz base de s\xEDntese neural melhor corresponde ao registro fundamental do falante:
- "Charon": Masculina grave/bar\xEDtono, autoridade serena e documental
- "Fenrir": Masculina intensa, dram\xE1tica e profunda
- "Puck": Masculina ou juvenil vers\xE1til, articulada e expressiva
- "Kore": Feminina m\xE9dia-grave/mezzo-soprano acolhedora e narrativa
- "Zephyr": Feminina leve, cristalina e suave

Retorne em JSON estrito no idioma portugu\xEAs (exceto o campo "stylePrompt", que deve ser escrito em ingl\xEAs t\xE9cnico hiper-descritivo de dire\xE7\xE3o vocal para o sintetizador neural reproduzir com m\xE1xima fidelidade humana).`;
      const { result: analysisRes } = await executeWithRetryAndFallback({
        models: ["gemini-4-hydrogen", "gemini-3.1-flash-lite"],
        maxRetriesPerModel: 2,
        baseDelayMs: 700,
        run: (model) => ai.models.generateContent({
          model,
          contents: {
            parts: [...audioParts, { text: analysisPrompt }]
          },
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                toneSummary: {
                  type: Type.STRING,
                  description: "Resumo curto do tom de voz (ex: Bar\xEDtono acolhedor e firme)."
                },
                timbreCharacteristics: {
                  type: Type.STRING,
                  description: "Descri\xE7\xE3o detalhada do timbre, resson\xE2ncia e textura vocal."
                },
                cadenceAndRhythm: {
                  type: Type.STRING,
                  description: "Como a pessoa acelera, desacelera e organiza o ritmo das frases."
                },
                pauseAndBreathHabits: {
                  type: Type.STRING,
                  description: "Padr\xE3o de pausas, sil\xEAncios e respira\xE7\xF5es naturais entre frases."
                },
                emotionalSignature: {
                  type: Type.STRING,
                  description: "Como a pessoa expressa emo\xE7\xE3o, empatia e inten\xE7\xE3o na voz."
                },
                regionalDiction: {
                  type: Type.STRING,
                  description: "Idioma, sotaque regional e clareza articulat\xF3ria."
                },
                prosodyRules: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "3 a 5 regras pr\xE1ticas de pros\xF3dia observadas nesta voz."
                },
                stylePrompt: {
                  type: Type.STRING,
                  description: "Detailed English Voice Design style prompt capturing exact pitch, warmth, breath habits, cadence, pauses, and human acoustic realism."
                },
                recommendedBaseVoice: {
                  type: Type.STRING,
                  description: "Must be exactly one of: Charon, Fenrir, Kore, Puck, Zephyr."
                },
                transcript: {
                  type: Type.STRING,
                  description: "Transcri\xE7\xE3o limpa da amostra se n\xE3o tiver sido informada antes."
                }
              },
              required: [
                "toneSummary",
                "timbreCharacteristics",
                "cadenceAndRhythm",
                "pauseAndBreathHabits",
                "emotionalSignature",
                "regionalDiction",
                "prosodyRules",
                "stylePrompt",
                "recommendedBaseVoice"
              ]
            }
          }
        })
      });
      const parsed = JSON.parse((analysisRes.text ?? "{}").trim());
      const validVoices = ["Charon", "Fenrir", "Kore", "Puck", "Zephyr"];
      const recommendedBaseVoice = validVoices.includes(parsed.recommendedBaseVoice) ? parsed.recommendedBaseVoice : clientMetrics && clientMetrics.estimatedF0Hz > 165 ? "Kore" : "Charon";
      res.json({
        dna: {
          toneSummary: parsed.toneSummary || "Timbre natural expressivo",
          timbreCharacteristics: parsed.timbreCharacteristics || "Voz equilibrada com boa presen\xE7a vocal.",
          cadenceAndRhythm: parsed.cadenceAndRhythm || "Ritmo conversacional natural e constante.",
          pauseAndBreathHabits: parsed.pauseAndBreathHabits || "Pausas org\xE2nicas entre per\xEDodos.",
          emotionalSignature: parsed.emotionalSignature || "Entona\xE7\xE3o humana e acolhedora.",
          regionalDiction: parsed.regionalDiction || "Portugu\xEAs brasileiro natural.",
          prosodyRules: Array.isArray(parsed.prosodyRules) ? parsed.prosodyRules : [],
          stylePrompt: parsed.stylePrompt || "Natural human narrator with organic breath pauses, authentic inflection, and studio close-mic warmth.",
          recommendedBaseVoice,
          transcript: transcript || parsed.transcript || ""
        }
      });
    } catch (err) {
      const { status, message } = extractFriendlyGeminiError(err);
      res.status(status).json({ error: message });
    }
  });
  app.post("/api/narrate/adapt", async (req, res) => {
    try {
      const { rawText, profile, emotion } = req.body;
      if (!rawText || !rawText.trim()) {
        return res.status(400).json({ error: "Digite um texto para adaptar \xE0 pros\xF3dia do narrador." });
      }
      if (!profile) {
        return res.status(400).json({ error: "Selecione um perfil de narrador." });
      }
      const ai = getAiClient();
      const emotionSpec = EMOTION_LABELS[emotion ?? "natural"];
      const { result: response } = await executeWithRetryAndFallback({
        models: ["gemini-4-hydrogen", "gemini-3.1-flash-lite"],
        maxRetriesPerModel: 2,
        baseDelayMs: 700,
        run: (model) => ai.models.generateContent({
          model,
          contents: `Voc\xEA \xE9 um diretor de locu\xE7\xE3o preparando um roteiro para o narrador "${profile.name}".
Caracter\xEDsticas aprendidas desta voz:
- Cad\xEAncia: ${profile.dna.cadenceAndRhythm}
- Pausas e respira\xE7\xE3o: ${profile.dna.pauseAndBreathHabits}
- Assinatura emocional: ${profile.dna.emotionalSignature}
- Regras de pros\xF3dia: ${profile.dna.prosodyRules.join("; ")}
- Inten\xE7\xE3o escolhida para este take: ${emotionSpec.label}

Reescreva a pontua\xE7\xE3o e insira marca\xE7\xF5es sutis de respira\xE7\xE3o humana ("<breath>") e pausas ("..." ou "\u2014") no texto abaixo para que a locu\xE7\xE3o soe indistingu\xEDvel de uma grava\xE7\xE3o humana real deste narrador.
REGRAS ESTRITAS:
1. N\xC3O adicione, remova ou troque nenhuma palavra do texto original do usu\xE1rio.
2. Use apenas marca\xE7\xF5es discretas de "<breath>" (no m\xE1ximo 1 a cada 2 ou 3 frases, onde um humano realmente puxaria o ar), retic\xEAncias "..." ou travess\xF5es "\u2014" para modular ritmo e emo\xE7\xE3o.
3. Retorne APENAS o roteiro pronto para leitura, sem coment\xE1rios extras ou aspas.

Texto original:
${rawText.trim()}`,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
          }
        })
      });
      const directedText = (response.text ?? rawText).trim();
      res.json({ directedText });
    } catch (err) {
      const { status, message } = extractFriendlyGeminiError(err);
      res.status(status).json({ error: message });
    }
  });
  app.post("/api/narrate/synthesize", async (req, res) => {
    try {
      const { text, profile, emotion, fidelityLevel } = req.body;
      if (!text || !text.trim()) {
        return res.status(400).json({ error: "O texto da narra\xE7\xE3o n\xE3o pode estar vazio." });
      }
      if (!profile) {
        return res.status(400).json({ error: "Selecione um perfil de narrador." });
      }
      const ttsAi = getAiClient("v1beta");
      const effectiveStyle = buildEffectiveStylePrompt(
        profile,
        emotion ?? "natural",
        typeof fidelityLevel === "number" ? fidelityLevel : 90
      );
      const chunks = splitScriptIntoChunks(text.trim(), 420);
      const wavBuffers = [];
      const synthesizeChunkViaGenerateContent = async (chunk) => {
        const { result: ttsResponse } = await executeWithRetryAndFallback({
          models: ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"],
          maxRetriesPerModel: 2,
          baseDelayMs: 700,
          run: (model) => ttsAi.models.generateContent({
            model,
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: chunk,
                    speechMetadata: {
                      style: effectiveStyle
                    }
                  }
                ]
              }
            ],
            config: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: profile.baseVoice
                  }
                }
              }
            }
          })
        });
        const base64Chunk = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64Chunk) {
          throw new Error("O motor de s\xEDntese n\xE3o retornou dados de \xE1udio para o trecho enviado.");
        }
        return base64Chunk;
      };
      const synthesizeChunkViaInteractions = async (chunk) => {
        const { result: interaction } = await executeWithRetryAndFallback({
          models: ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"],
          maxRetriesPerModel: 2,
          baseDelayMs: 700,
          run: (model) => ttsAi.interactions.create({
            model,
            input: [
              {
                type: "text",
                text: chunk,
                annotations: [
                  {
                    type: "speech_metadata",
                    style: effectiveStyle
                  }
                ]
              }
            ],
            response_format: { type: "audio" },
            generation_config: {
              speech_config: [
                {
                  language: "pt-BR",
                  voice: profile.baseVoice
                }
              ]
            }
          })
        });
        const audioData = interaction.output_audio?.data;
        if (!audioData) {
          throw new Error("O motor de s\xEDntese n\xE3o retornou dados de \xE1udio para o trecho enviado.");
        }
        return audioData;
      };
      for (const chunk of chunks) {
        let base64Chunk;
        try {
          base64Chunk = await synthesizeChunkViaGenerateContent(chunk);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("Unknown name") || msg.includes("Cannot find field")) {
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
        effectiveStyle
      });
    } catch (err) {
      const { status, message } = extractFriendlyGeminiError(err);
      res.status(status).json({ error: message });
    }
  });
  if (process.env.NODE_ENV === "production") {
    const distDir = path.resolve(process.cwd(), "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`VozMestre Studio server listening on http://0.0.0.0:${PORT}`);
  });
}
main().catch((err) => {
  console.error("Fatal server startup error:", err);
  process.exit(1);
});
