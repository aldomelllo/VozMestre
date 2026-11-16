import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  Pause,
  Play,
  SlidersHorizontal,
  Sparkles,
  UserPlus,
  Volume2,
} from 'lucide-react';
import type {
  EmotionPreset,
  NarrationTake,
  NarratorProfile,
  StudioCalibration,
} from '../types/voice';
import { base64ToUint8Array, EMOTION_LABELS } from '../utils/audioProcessing';
import {
  analyzeBase64WavClient,
  renderCalibratedWavBlob,
} from '../utils/webAudioPlayback';
import { WaveformCanvas } from './WaveformCanvas';

interface NarrationStudioProps {
  narrator: NarratorProfile;
  latestTake: NarrationTake | null;
  onUpdateCalibration: (narratorId: string, calibration: StudioCalibration) => void;
  onTakeGenerated: (take: NarrationTake) => void;
  onTrainNewVoice: () => void;
}

const SAMPLE_SCRIPTS: string[] = [
  'Existem momentos em que o silêncio diz muito mais do que qualquer discurso apressado. <breath> Quando você reduz o ritmo, respira com calma e escolhe cada palavra... o público sente a verdade na sua voz.',
  'Bem-vindos de volta. Hoje vamos explorar como pequenas pausas, mudanças sutis de intenção e um timbre acolhedor transformam um simples texto em uma história inesquecível.',
];

export function NarrationStudio({
  narrator,
  latestTake,
  onUpdateCalibration,
  onTakeGenerated,
  onTrainNewVoice,
}: NarrationStudioProps) {
  const [scriptText, setScriptText] = useState(
    'Quando contamos uma história com verdade, cada pausa carrega um significado próprio. <breath> Não é apenas sobre ler palavras em voz alta... é sobre fazer quem ouve sentir cada instante.'
  );
  const [emotion, setEmotion] = useState<EmotionPreset>('natural');
  const [fidelityLevel, setFidelityLevel] = useState(92);
  const [showDnaDetails, setShowDnaDetails] = useState(false);
  const [showCalibration, setShowCalibration] = useState(true);
  const [avatarError, setAvatarError] = useState(false);

  const [isAdapting, setIsAdapting] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Audio playback state (Master Take + Reference A/B comparison)
  const [activeTake, setActiveTake] = useState<NarrationTake | null>(latestTake);
  const [playbackMode, setPlaybackMode] = useState<'master' | 'reference'>('master');
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    setAvatarError(false);
  }, [narrator.id]);

  useEffect(() => {
    if (latestTake) {
      setActiveTake(latestTake);
    }
  }, [latestTake]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const wordCount = scriptText.trim() ? scriptText.trim().split(/\s+/).length : 0;
  const charCount = scriptText.length;

  const insertCue = (cue: string) => {
    setScriptText((prev) => {
      const trimmed = prev.trimEnd();
      return trimmed ? `${trimmed} ${cue} ` : `${cue} `;
    });
  };

  const handleAdaptProsody = async () => {
    setErrorMsg(null);
    if (!scriptText.trim()) {
      setErrorMsg('Escreva o roteiro antes de adaptar a prosódia.');
      return;
    }

    setIsAdapting(true);
    try {
      const res = await fetch('/api/narrate/adapt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText: scriptText,
          profile: narrator,
          emotion,
        }),
      });
      const rawBody = await res.text();
      let data: { directedText?: string; error?: string } = {};
      try {
        data = JSON.parse(rawBody) as { directedText?: string; error?: string };
      } catch {
        throw new Error(`Servidor indisponível (${res.status}). Tente novamente em instantes.`);
      }
      if (!res.ok) throw new Error(data.error || 'Não foi possível adaptar o roteiro.');
      if (data.directedText) {
        setScriptText(data.directedText);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao adaptar prosódia.');
    } finally {
      setIsAdapting(false);
    }
  };

  const handleSynthesize = async () => {
    setErrorMsg(null);
    if (!scriptText.trim()) {
      setErrorMsg('Digite o texto que deseja narrar antes de gerar o áudio.');
      return;
    }

    // Stop any current audio
    audioRef.current?.pause();
    setIsPlaying(false);
    setProgress(0);

    setIsSynthesizing(true);
    try {
      const res = await fetch('/api/narrate/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: scriptText,
          profile: narrator,
          emotion,
          fidelityLevel,
        }),
      });

      const rawBody = await res.text();
      let data: { audioBase64Wav?: string; effectiveStyle?: string; error?: string } = {};
      try {
        data = JSON.parse(rawBody) as {
          audioBase64Wav?: string;
          effectiveStyle?: string;
          error?: string;
        };
      } catch {
        throw new Error(`Servidor indisponível (${res.status}). Tente novamente em instantes.`);
      }
      if (!res.ok || !data.audioBase64Wav) {
        throw new Error(data.error || 'Falha ao gerar narração.');
      }

      const base64Wav = data.audioBase64Wav;
      const analyzed = await analyzeBase64WavClient(base64Wav);

      const newTake: NarrationTake = {
        id: `take-${Date.now()}`,
        narratorId: narrator.id,
        narratorName: narrator.name,
        createdAt: new Date().toISOString(),
        rawText: scriptText.trim(),
        directedText: scriptText.trim(),
        emotionPreset: emotion,
        fidelityLevel,
        audioBase64Wav: base64Wav,
        durationSec: analyzed.durationSec,
        waveformPeaks: analyzed.waveformPeaks,
        fileName: `${narrator.name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}.wav`,
        effectiveStyle: data.effectiveStyle || '',
      };

      setActiveTake(newTake);
      setPlaybackMode('master');
      onTakeGenerated(newTake);
      await startPlaybackForMode('master', newTake);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro durante a síntese de voz.');
    } finally {
      setIsSynthesizing(false);
    }
  };

  const startPlaybackForMode = async (mode: 'master' | 'reference', takeOverride?: NarrationTake) => {
    const targetTake = takeOverride ?? activeTake;
    audioRef.current?.pause();
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    let blob: Blob | null = null;
    if (mode === 'master' && targetTake) {
      blob = await renderCalibratedWavBlob(targetTake.audioBase64Wav, narrator.calibration);
    } else if (mode === 'reference') {
      const refSample = narrator.referenceSamples.find((s) => Boolean(s.base64Audio));
      if (refSample?.base64Audio) {
        const bytes = base64ToUint8Array(refSample.base64Audio);
        blob = new Blob([bytes.buffer as ArrayBuffer], { type: refSample.mimeType || 'audio/wav' });
      }
    }

    if (!blob) {
      setIsPlaying(false);
      return;
    }

    const url = URL.createObjectURL(blob);
    objectUrlRef.current = url;
    const audio = new Audio(url);
    audioRef.current = audio;

    audio.onloadedmetadata = () => {
      setDurationSec(audio.duration || 0);
    };
    audio.ontimeupdate = () => {
      if (audio.duration > 0) {
        setCurrentTimeSec(audio.currentTime);
        setProgress(audio.currentTime / audio.duration);
      }
    };
    audio.onended = () => {
      setIsPlaying(false);
      setProgress(0);
      setCurrentTimeSec(0);
    };

    setPlaybackMode(mode);
    setIsPlaying(true);
    await audio.play();
  };

  const togglePlayPause = async () => {
    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
      return;
    }
    if (audioRef.current && audioRef.current.src && progress > 0 && progress < 1) {
      setIsPlaying(true);
      await audioRef.current.play();
      return;
    }
    await startPlaybackForMode(playbackMode);
  };

  const handleSeek = (ratio: number) => {
    if (audioRef.current && audioRef.current.duration > 0) {
      audioRef.current.currentTime = ratio * audioRef.current.duration;
      setProgress(ratio);
      setCurrentTimeSec(audioRef.current.currentTime);
    }
  };

  const handleDownloadMaster = async () => {
    if (!activeTake) return;
    const blob = await renderCalibratedWavBlob(activeTake.audioBase64Wav, narrator.calibration);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeTake.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const hasReferenceAudio = narrator.referenceSamples.some((s) => Boolean(s.base64Audio));
  const initials = narrator.name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="max-w-5xl mx-auto py-6 lg:py-8 px-4 lg:px-8 space-y-6">
      {/* Active Narrator Persona Header */}
      <section className="border border-white/[0.08] rounded-lg bg-[#12151C] p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            {narrator.avatarUrl && !avatarError ? (
              <img
                src={narrator.avatarUrl}
                alt={`Retrato de ${narrator.name}`}
                referrerPolicy="no-referrer"
                onError={() => setAvatarError(true)}
                className="w-14 h-14 rounded-md object-cover border border-white/10 shrink-0"
              />
            ) : (
              <div
                aria-hidden="true"
                className="w-14 h-14 rounded-md bg-[#191E29] border border-white/10 flex items-center justify-center shrink-0 font-display text-base font-semibold text-[#E58E26]"
              >
                {initials}
              </div>
            )}

            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h1 className="font-display text-xl font-semibold text-[#F1F3F7] truncate">
                  {narrator.name}
                </h1>
                <span className="text-xs text-[#9BA3B4]">{narrator.role}</span>
              </div>
              <p className="font-mono text-xs text-[#9BA3B4] tabular-nums mt-1">
                {narrator.acousticMetrics.estimatedF0Hz} Hz · {narrator.acousticMetrics.estimatedWpm} ppm · Pausas {narrator.acousticMetrics.pauseRatioPercent}% · Núcleo {narrator.baseVoice}
              </p>
              <p className="text-xs text-[#D6DCE6] mt-1 line-clamp-1">
                {narrator.dna.toneSummary}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowDnaDetails((v) => !v)}
              aria-expanded={showDnaDetails}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-white/[0.1] hover:bg-white/[0.04] text-xs font-medium text-[#D6DCE6] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>DNA Vocal</span>
              {showDnaDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={onTrainNewVoice}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-white/[0.1] hover:border-[#E58E26]/60 text-xs font-medium text-[#F1F3F7] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5 text-[#E58E26]" />
              <span>Clonar Outra Voz</span>
            </button>
          </div>
        </div>

        {showDnaDetails && (
          <div className="mt-5 pt-5 border-t border-white/[0.08] grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <span className="block font-semibold text-[#9BA3B4] mb-1">Timbre &amp; Ressonância</span>
              <p className="text-[#D6DCE6] leading-relaxed">{narrator.dna.timbreCharacteristics}</p>
            </div>
            <div>
              <span className="block font-semibold text-[#9BA3B4] mb-1">Cadência &amp; Pausas</span>
              <p className="text-[#D6DCE6] leading-relaxed">
                {narrator.dna.cadenceAndRhythm} {narrator.dna.pauseAndBreathHabits}
              </p>
            </div>
            <div>
              <span className="block font-semibold text-[#9BA3B4] mb-1">Assinatura Emocional</span>
              <p className="text-[#D6DCE6] leading-relaxed">{narrator.dna.emotionalSignature}</p>
            </div>
            <div>
              <span className="block font-semibold text-[#9BA3B4] mb-1">Dicção &amp; Sotaque</span>
              <p className="text-[#D6DCE6] leading-relaxed">{narrator.dna.regionalDiction}</p>
            </div>
          </div>
        )}
      </section>

      {/* Script & Emotion Studio Console */}
      <section className="border border-white/[0.08] rounded-lg bg-[#12151C] p-6 space-y-5">
        {/* Emotion Segmented Bar */}
        <div>
          <span className="block text-xs font-medium text-[#9BA3B4] mb-2.5">
            Intenção Emocional da Narração
          </span>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Intenção emocional">
            {(Object.keys(EMOTION_LABELS) as EmotionPreset[]).map((preset) => {
              const active = emotion === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setEmotion(preset)}
                  aria-pressed={active}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#E58E26] text-[#0B0D12] font-semibold'
                      : 'bg-[#0B0D12] text-[#9BA3B4] hover:text-[#F1F3F7] border border-white/[0.08]'
                  }`}
                >
                  {EMOTION_LABELS[preset].label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Script Textarea + Prosody Cues */}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <label htmlFor="narration-script-input" className="text-xs font-medium text-[#D6DCE6]">
              Roteiro para Narração
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => insertCue('<breath>')}
                className="px-2.5 py-1 rounded bg-[#0B0D12] border border-white/[0.08] hover:border-[#E58E26]/60 text-[11px] font-mono text-[#D6DCE6] whitespace-nowrap shrink-0 cursor-pointer"
              >
                + Respiração
              </button>
              <button
                type="button"
                onClick={() => insertCue('...')}
                className="px-2.5 py-1 rounded bg-[#0B0D12] border border-white/[0.08] hover:border-[#E58E26]/60 text-[11px] font-mono text-[#D6DCE6] whitespace-nowrap shrink-0 cursor-pointer"
              >
                + Pausa Curta
              </button>
              <button
                type="button"
                onClick={() =>
                  setScriptText(
                    SAMPLE_SCRIPTS[Math.floor(Math.random() * SAMPLE_SCRIPTS.length)]
                  )
                }
                className="px-2.5 py-1 rounded text-[11px] text-[#9BA3B4] hover:text-[#F1F3F7] whitespace-nowrap shrink-0 cursor-pointer"
              >
                Exemplo de Roteiro
              </button>
            </div>
          </div>

          <textarea
            id="narration-script-input"
            rows={6}
            value={scriptText}
            onChange={(e) => setScriptText(e.target.value)}
            placeholder="Digite ou cole aqui o texto que deseja ouvir na voz deste narrador..."
            className="w-full bg-[#0B0D12] border border-white/[0.1] rounded-md p-4 text-[15px] leading-relaxed text-[#F1F3F7] placeholder:text-[#6E7789] focus:outline-none focus:border-[#E58E26]"
          />

          <div className="flex flex-wrap items-center justify-between gap-3 mt-2">
            <span className="font-mono text-xs text-[#6E7789] tabular-nums">
              {wordCount} palavras · {charCount} caracteres
            </span>

            <button
              type="button"
              disabled={isAdapting || !scriptText.trim()}
              onClick={() => void handleAdaptProsody()}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#E58E26] hover:text-[#FBBF24] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isAdapting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Aplicando cadência da voz...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Adaptar Texto à Prosódia Original</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Acoustic Fidelity & Mastering Calibration Rack */}
        <div className="border-t border-white/[0.08] pt-4">
          <button
            type="button"
            onClick={() => setShowCalibration((v) => !v)}
            aria-expanded={showCalibration}
            className="inline-flex items-center gap-2 text-xs font-medium text-[#D6DCE6] hover:text-[#F1F3F7] cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-[#E58E26]" />
            <span>Calibração Acústica &amp; Masterização de Estúdio</span>
          </button>

          {showCalibration && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mt-4">
              <div>
                <div className="flex items-center justify-between text-xs mb-2">
                  <label htmlFor="fidelity-slider" className="text-[#9BA3B4]">
                    Fidelidade Prosódica
                  </label>
                  <span className="font-mono text-[#F1F3F7] tabular-nums">{fidelityLevel}%</span>
                </div>
                <input
                  id="fidelity-slider"
                  type="range"
                  min={40}
                  max={100}
                  step={2}
                  value={fidelityLevel}
                  onChange={(e) => setFidelityLevel(Number(e.target.value))}
                  className="w-full studio-slider"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-2">
                  <label htmlFor="pitch-slider" className="text-[#9BA3B4]">
                    Ajuste de Tom (Semitons)
                  </label>
                  <span className="font-mono text-[#F1F3F7] tabular-nums">
                    {narrator.calibration.pitchSemitones > 0 ? '+' : ''}
                    {narrator.calibration.pitchSemitones.toFixed(1)} st
                  </span>
                </div>
                <input
                  id="pitch-slider"
                  type="range"
                  min={-4}
                  max={4}
                  step={0.5}
                  value={narrator.calibration.pitchSemitones}
                  onChange={(e) =>
                    onUpdateCalibration(narrator.id, {
                      ...narrator.calibration,
                      pitchSemitones: Number(e.target.value),
                    })
                  }
                  className="w-full studio-slider"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-2">
                  <label htmlFor="rate-slider" className="text-[#9BA3B4]">
                    Velocidade de Fala
                  </label>
                  <span className="font-mono text-[#F1F3F7] tabular-nums">
                    {narrator.calibration.rateMultiplier.toFixed(2)}x
                  </span>
                </div>
                <input
                  id="rate-slider"
                  type="range"
                  min={0.8}
                  max={1.2}
                  step={0.02}
                  value={narrator.calibration.rateMultiplier}
                  onChange={(e) =>
                    onUpdateCalibration(narrator.id, {
                      ...narrator.calibration,
                      rateMultiplier: Number(e.target.value),
                    })
                  }
                  className="w-full studio-slider"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-2">
                  <label htmlFor="warmth-slider" className="text-[#9BA3B4]">
                    Presença &amp; Calor Vocal
                  </label>
                  <span className="font-mono text-[#F1F3F7] tabular-nums">
                    {narrator.calibration.warmthDb > 0 ? '+' : ''}
                    {narrator.calibration.warmthDb.toFixed(1)} dB
                  </span>
                </div>
                <input
                  id="warmth-slider"
                  type="range"
                  min={-3}
                  max={6}
                  step={0.5}
                  value={narrator.calibration.warmthDb}
                  onChange={(e) =>
                    onUpdateCalibration(narrator.id, {
                      ...narrator.calibration,
                      warmthDb: Number(e.target.value),
                    })
                  }
                  className="w-full studio-slider"
                />
              </div>
            </div>
          )}
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="border border-[#EF4444]/40 bg-[#EF4444]/10 rounded-md px-4 py-3 text-sm text-[#FCA5A5]"
          >
            {errorMsg}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
          <label className="inline-flex items-center gap-2 text-xs text-[#9BA3B4] cursor-pointer">
            <input
              type="checkbox"
              checked={narrator.calibration.studioCompression}
              onChange={(e) =>
                onUpdateCalibration(narrator.id, {
                  ...narrator.calibration,
                  studioCompression: e.target.checked,
                })
              }
              className="accent-[#E58E26] w-4 h-4 rounded"
            />
            <span>Compressão vocal de estúdio (nivelamento natural)</span>
          </label>

          <button
            type="button"
            disabled={isSynthesizing}
            onClick={() => void handleSynthesize()}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-md bg-[#E58E26] hover:bg-[#F09A32] disabled:opacity-60 text-[#0B0D12] text-sm font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer"
          >
            {isSynthesizing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Sintetizando Narração...</span>
              </>
            ) : (
              <>
                <Volume2 className="w-4 h-4" />
                <span>Gerar Narração Fiel</span>
              </>
            )}
          </button>
        </div>
      </section>

      {/* Studio Master Playback Deck */}
      <section className="border border-white/[0.08] rounded-lg bg-[#12151C] p-5">
        {!activeTake ? (
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-[#F1F3F7]">
                  Assinatura Acústica de Referência — {narrator.name}
                </h2>
                <p className="text-xs text-[#9BA3B4] mt-0.5">
                  Clique em <strong className="text-[#F1F3F7] font-medium">Gerar Narração Fiel</strong> acima para sintetizar o áudio completo com este perfil prosódico.
                </p>
              </div>
              <span className="font-mono text-xs text-[#9BA3B4] tabular-nums shrink-0">
                {narrator.acousticMetrics.estimatedF0Hz} Hz · {narrator.acousticMetrics.dynamicRangeDb} dB
              </span>
            </div>
            <div className="opacity-55">
              <WaveformCanvas
                peaks={narrator.acousticMetrics.waveformPeaks}
                progress={0}
                height={48}
                ariaLabel={`Assinatura acústica de referência de ${narrator.name}`}
                testId="reference-signature-canvas"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[#F1F3F7]">
                  Take Master — {activeTake.narratorName}
                </h2>
                <p className="font-mono text-xs text-[#9BA3B4] tabular-nums mt-0.5">
                  {EMOTION_LABELS[activeTake.emotionPreset].label} · Fidelidade {activeTake.fidelityLevel}% · {activeTake.durationSec.toFixed(1)}s
                </p>
              </div>

              <div className="flex items-center gap-2">
                {hasReferenceAudio && (
                  <div className="inline-flex rounded-md border border-white/[0.1] bg-[#0B0D12] p-0.5">
                    <button
                      type="button"
                      onClick={() => void startPlaybackForMode('master')}
                      className={`px-2.5 py-1 text-xs rounded transition-colors cursor-pointer ${
                        playbackMode === 'master'
                          ? 'bg-[#191E29] text-[#F1F3F7] font-medium'
                          : 'text-[#9BA3B4]'
                      }`}
                    >
                      Narração Gerada
                    </button>
                    <button
                      type="button"
                      onClick={() => void startPlaybackForMode('reference')}
                      className={`px-2.5 py-1 text-xs rounded transition-colors cursor-pointer ${
                        playbackMode === 'reference'
                          ? 'bg-[#191E29] text-[#E58E26] font-medium'
                          : 'text-[#9BA3B4]'
                      }`}
                    >
                      A/B Voz Original
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => void handleDownloadMaster()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-white/[0.12] hover:border-[#E58E26] bg-[#191E29] text-xs font-medium text-[#F1F3F7] whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-[#E58E26]" />
                  <span>Baixar WAV Master</span>
                </button>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => void togglePlayPause()}
                aria-label={isPlaying ? 'Pausar narração' : 'Reproduzir narração'}
                className="w-11 h-11 rounded-md bg-[#E58E26] hover:bg-[#F09A32] text-[#0B0D12] flex items-center justify-center shrink-0 transition-colors cursor-pointer"
              >
                {isPlaying ? (
                  <Pause className="w-5 h-5 fill-current" />
                ) : (
                  <Play className="w-5 h-5 fill-current ml-0.5" />
                )}
              </button>

              <div className="flex-1 min-w-0">
                <WaveformCanvas
                  peaks={activeTake.waveformPeaks}
                  progress={progress}
                  onSeek={handleSeek}
                  height={64}
                  ariaLabel="Forma de onda da narração gerada"
                  testId="master-waveform-canvas"
                />
              </div>

              <span className="font-mono text-xs text-[#D6DCE6] tabular-nums shrink-0">
                {formatTime(currentTimeSec)} / {formatTime(durationSec || activeTake.durationSec)}
              </span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
