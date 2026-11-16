import { useEffect, useRef, useState } from 'react';
import {
  Check,
  FileAudio,
  Loader2,
  Mic,
  Pause,
  Play,
  Square,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import type {
  AcousticMetrics,
  BaseVoiceId,
  NarratorProfile,
  ReferenceSampleMeta,
  VocalDnaProfile,
} from '../types/voice';
import {
  generateSyntheticStudioSampleWav,
  uint8ArrayToBase64,
} from '../utils/audioProcessing';
import { analyzeAudioBlobClient, fileToBase64 } from '../utils/webAudioPlayback';
import { WaveformCanvas } from './WaveformCanvas';

interface VoiceLearningLabProps {
  onSaveNarrator: (profile: NarratorProfile) => void;
  onCancel: () => void;
}

interface PendingSample {
  id: string;
  fileName: string;
  mimeType: string;
  blob: Blob;
  base64: string;
  objectUrl: string;
  metrics: AcousticMetrics;
}

const BASE_VOICES: Array<{ id: BaseVoiceId; label: string; desc: string }> = [
  { id: 'Charon', label: 'Charon', desc: 'Masculina barítono grave e documental' },
  { id: 'Fenrir', label: 'Fenrir', desc: 'Masculina profunda e dramática' },
  { id: 'Puck', label: 'Puck', desc: 'Masculina/juvenil articulada e dinâmica' },
  { id: 'Kore', label: 'Kore', desc: 'Feminina mezzo-soprano quente e narrativa' },
  { id: 'Zephyr', label: 'Zephyr', desc: 'Feminina suave, clara e intimista' },
];

export function VoiceLearningLab({ onSaveNarrator, onCancel }: VoiceLearningLabProps) {
  const [speakerName, setSpeakerName] = useState('');
  const [speakerRole, setSpeakerRole] = useState('Narração Profissional');
  const [samples, setSamples] = useState<PendingSample[]>([]);
  const [combinedMetrics, setCombinedMetrics] = useState<AcousticMetrics | null>(null);
  const [bannerError, setBannerError] = useState(false);

  // Mic recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<number | null>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recStreamRef = useRef<MediaStream | null>(null);

  // Playback preview for reference samples
  const [playingSampleId, setPlayingSampleId] = useState<string | null>(null);
  const [sampleProgress, setSampleProgress] = useState(0);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  // Analysis & DNA blueprint state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [learnedDna, setLearnedDna] = useState<VocalDnaProfile | null>(null);
  const [selectedBaseVoice, setSelectedBaseVoice] = useState<BaseVoiceId>('Charon');
  const [editableStylePrompt, setEditableStylePrompt] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (recTimerRef.current) window.clearInterval(recTimerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      recStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioElRef.current?.pause();
    };
  }, []);

  // Recompute aggregate metrics whenever samples list changes
  useEffect(() => {
    if (samples.length === 0) {
      setCombinedMetrics(null);
      return;
    }
    const totalDur = samples.reduce((acc, s) => acc + s.metrics.durationSec, 0);
    const avg = (fn: (m: AcousticMetrics) => number) =>
      Math.round(samples.reduce((acc, s) => acc + fn(s.metrics), 0) / samples.length);

    setCombinedMetrics({
      durationSec: Number(totalDur.toFixed(1)),
      estimatedF0Hz: avg((m) => m.estimatedF0Hz),
      pitchMinHz: Math.min(...samples.map((s) => s.metrics.pitchMinHz)),
      pitchMaxHz: Math.max(...samples.map((s) => s.metrics.pitchMaxHz)),
      pauseRatioPercent: avg((m) => m.pauseRatioPercent),
      estimatedWpm: avg((m) => m.estimatedWpm),
      dynamicRangeDb: avg((m) => m.dynamicRangeDb),
      warmthIndex: avg((m) => m.warmthIndex),
      waveformPeaks: samples[0].metrics.waveformPeaks,
    });
  }, [samples]);

  const addAudioFileOrBlob = async (blob: Blob, fileName: string, mimeType: string) => {
    setErrorMsg(null);
    try {
      const [metrics, base64] = await Promise.all([
        analyzeAudioBlobClient(blob),
        fileToBase64(blob),
      ]);
      const objectUrl = URL.createObjectURL(blob);
      setSamples((prev) => [
        ...prev,
        {
          id: `sample-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          fileName,
          mimeType: mimeType || 'audio/wav',
          blob,
          base64,
          objectUrl,
          metrics,
        },
      ]);
      setLearnedDna(null);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? `Não foi possível decodificar "${fileName}": ${err.message}`
          : `Formato de áudio não suportado em "${fileName}".`
      );
    }
  };

  const handleFileInput = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      await addAudioFileOrBlob(file, file.name, file.type || 'audio/wav');
    }
  };

  const handleLoadStudioTestSample = async () => {
    const wavBytes = generateSyntheticStudioSampleWav('baritono');
    const blob = new Blob([wavBytes.buffer as ArrayBuffer], { type: 'audio/wav' });
    const base64 = uint8ArrayToBase64(wavBytes);
    const metrics = await analyzeAudioBlobClient(blob);
    const objectUrl = URL.createObjectURL(blob);

    if (!speakerName.trim()) {
      setSpeakerName('Locutor de Referência');
    }
    setSamples((prev) => [
      ...prev,
      {
        id: `sample-demo-${Date.now()}`,
        fileName: 'amostra_estudio_prosodia.wav',
        mimeType: 'audio/wav',
        blob,
        base64,
        objectUrl,
        metrics,
      },
    ]);
    setLearnedDna(null);
    setErrorMsg(null);
  };

  const startLiveRecording = async () => {
    setErrorMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recStreamRef.current = stream;

      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      recChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) recChunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        if (recTimerRef.current) window.clearInterval(recTimerRef.current);
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        stream.getTracks().forEach((t) => t.stop());
        void audioCtx.close();

        const blob = new Blob(recChunksRef.current, { type: mimeType });
        if (blob.size > 0) {
          await addAudioFileOrBlob(
            blob,
            `gravacao_microfone_${new Date().toLocaleTimeString('pt-BR').replace(/:/g, '-')}.webm`,
            'audio/webm'
          );
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingSeconds(0);

      recTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);

      const drawLive = () => {
        const canvas = liveCanvasRef.current;
        const an = analyserRef.current;
        if (!canvas || !an) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const bufLen = an.frequencyBinCount;
        const data = new Uint8Array(bufLen);
        an.getByteTimeDomainData(data);

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(0, canvas.height / 2, canvas.width, 1);

        ctx.strokeStyle = '#E58E26';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const sliceW = canvas.width / bufLen;
        for (let i = 0; i < bufLen; i++) {
          const v = data[i] / 128.0;
          const y = (v * canvas.height) / 2;
          if (i === 0) ctx.moveTo(0, y);
          else ctx.lineTo(i * sliceW, y);
        }
        ctx.stroke();
        animFrameRef.current = requestAnimationFrame(drawLive);
      };
      animFrameRef.current = requestAnimationFrame(drawLive);
    } catch {
      setErrorMsg('Não foi possível acessar o microfone. Verifique as permissões do navegador ou envie um arquivo de áudio.');
    }
  };

  const stopLiveRecording = () => {
    setIsRecording(false);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const togglePlaySample = (sample: PendingSample) => {
    if (playingSampleId === sample.id && audioElRef.current) {
      audioElRef.current.pause();
      setPlayingSampleId(null);
      return;
    }

    audioElRef.current?.pause();
    const audio = new Audio(sample.objectUrl);
    audioElRef.current = audio;
    setPlayingSampleId(sample.id);
    setSampleProgress(0);

    audio.ontimeupdate = () => {
      if (audio.duration > 0) {
        setSampleProgress(audio.currentTime / audio.duration);
      }
    };
    audio.onended = () => {
      setPlayingSampleId(null);
      setSampleProgress(0);
    };
    void audio.play();
  };

  const removeSample = (id: string) => {
    if (playingSampleId === id) {
      audioElRef.current?.pause();
      setPlayingSampleId(null);
    }
    setSamples((prev) => prev.filter((s) => s.id !== id));
    setLearnedDna(null);
  };

  const handleAnalyzeVoice = async () => {
    setErrorMsg(null);
    if (!speakerName.trim()) {
      setErrorMsg('Informe o nome do locutor ou narrador antes de iniciar a aprendizagem vocal.');
      return;
    }
    if (samples.length === 0) {
      setErrorMsg('Envie ou grave pelo menos um áudio de referência para aprender a voz.');
      return;
    }

    setIsAnalyzing(true);
    try {
      const response = await fetch('/api/voices/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          speakerName: speakerName.trim(),
          clientMetrics: combinedMetrics,
          audios: samples.map((s) => ({
            base64: s.base64,
            mimeType: s.mimeType,
            fileName: s.fileName,
          })),
        }),
      });

      const rawBody = await response.text();
      let data: { dna?: VocalDnaProfile; error?: string } = {};
      try {
        data = JSON.parse(rawBody) as { dna?: VocalDnaProfile; error?: string };
      } catch {
        throw new Error(
          response.ok
            ? 'Resposta inesperada do servidor.'
            : `Servidor indisponível (${response.status}). Aguarde alguns segundos e tente novamente.`
        );
      }
      if (!response.ok || !data.dna) {
        throw new Error(data.error || 'Falha ao analisar o áudio de referência.');
      }

      const dna = data.dna;
      setLearnedDna(dna);
      setSelectedBaseVoice(dna.recommendedBaseVoice);
      setEditableStylePrompt(dna.stylePrompt);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro de comunicação com o laboratório vocal.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSaveProfile = () => {
    if (!learnedDna || !combinedMetrics || !speakerName.trim()) return;

    const firstSample = samples[0];
    const refMetas: ReferenceSampleMeta[] = samples.map((s, idx) => ({
      id: s.id,
      fileName: s.fileName,
      mimeType: s.mimeType,
      durationSec: s.metrics.durationSec,
      // Store compact base64 preview for the first sample (< 4MB) for A/B comparison
      base64Audio: idx === 0 && s.base64.length < 4_500_000 ? s.base64 : undefined,
    }));

    const newNarrator: NarratorProfile = {
      id: `narrator-${Date.now()}`,
      name: speakerName.trim(),
      role: speakerRole.trim() || 'Narrador Exclusivo',
      createdAt: new Date().toISOString(),
      sampleCount: samples.length,
      totalReferenceDurationSec: combinedMetrics.durationSec,
      baseVoice: selectedBaseVoice,
      acousticMetrics: combinedMetrics,
      dna: {
        ...learnedDna,
        recommendedBaseVoice: selectedBaseVoice,
        stylePrompt: editableStylePrompt.trim() || learnedDna.stylePrompt,
      },
      calibration: {
        pitchSemitones: 0,
        rateMultiplier: 1.0,
        warmthDb: 1.0,
        studioCompression: true,
      },
      referenceSamples: refMetas,
      isBuiltIn: false,
    };

    onSaveNarrator(newNarrator);
    void firstSample;
  };

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 lg:px-8 space-y-8">
      {/* Studio Booth Editorial Banner */}
      <section className="relative rounded-lg overflow-hidden border border-white/[0.08] bg-[#12151C]">
        <div className="grid grid-cols-1 lg:grid-cols-12 items-stretch">
          <div className="lg:col-span-7 p-6 lg:p-8 flex flex-col justify-center">
            <p className="text-xs font-medium text-[#E58E26] mb-2">
              Laboratório de Aprendizagem Prosódica
            </p>
            <h1 className="font-display text-2xl lg:text-3xl font-semibold text-[#F1F3F7] leading-tight text-balance">
              Ensine ao estúdio o timbre, o ritmo e as pausas de uma voz real
            </h1>
            <p className="text-sm text-[#9BA3B4] mt-3 leading-relaxed max-w-xl">
              Envie gravações ou grave diretamente pelo microfone. O sistema analisa a frequência fundamental, respiração, silêncios e entonação emocional para criar um narrador exclusivo fiel à pessoa original.
            </p>
          </div>
          <div className="lg:col-span-5 relative min-h-[180px] lg:min-h-[220px] bg-[#161A24]">
            {!bannerError ? (
              <img
                src="/src/assets/images/studio_booth_backdrop_1794843342234.jpg"
                alt="Cabine acústica de gravação vocal com microfone condensador"
                referrerPolicy="no-referrer"
                onError={() => setBannerError(true)}
                className="w-full h-full object-cover lg:h-full"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-[#161A24] text-[#6E7789] text-xs">
                Cabine Acústica de Referência
              </div>
            )}
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-gradient-to-r from-[#12151C] via-[#12151C]/35 to-transparent hidden lg:block"
            />
          </div>
        </div>
      </section>

      {/* Step 1: Speaker Identity + Reference Audio Ingestion */}
      <section className="border border-white/[0.08] rounded-lg bg-[#12151C] p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label htmlFor="speaker-name-input" className="block text-xs font-medium text-[#D6DCE6] mb-2">
              Nome do Narrador Exclusivo
            </label>
            <input
              id="speaker-name-input"
              type="text"
              value={speakerName}
              onChange={(e) => setSpeakerName(e.target.value)}
              placeholder="Ex: Voz do Aldo, Helena Documentários..."
              className="w-full bg-[#0B0D12] border border-white/[0.1] rounded-md px-3.5 py-2.5 text-sm text-[#F1F3F7] placeholder:text-[#6E7789] focus:outline-none focus:border-[#E58E26]"
            />
          </div>
          <div>
            <label htmlFor="speaker-role-input" className="block text-xs font-medium text-[#D6DCE6] mb-2">
              Especialidade / Estilo de Locução
            </label>
            <input
              id="speaker-role-input"
              type="text"
              value={speakerRole}
              onChange={(e) => setSpeakerRole(e.target.value)}
              placeholder="Ex: Storytelling, Institucional, Audiolivro..."
              className="w-full bg-[#0B0D12] border border-white/[0.1] rounded-md px-3.5 py-2.5 text-sm text-[#F1F3F7] placeholder:text-[#6E7789] focus:outline-none focus:border-[#E58E26]"
            />
          </div>
        </div>

        {/* Upload Dropzone & Live Mic Controls */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              void handleFileInput(e.dataTransfer.files);
            }}
            className={`lg:col-span-7 border border-dashed rounded-lg p-6 text-center transition-colors ${
              isDragging
                ? 'border-[#E58E26] bg-[#E58E26]/[0.06]'
                : 'border-white/[0.14] bg-[#0E1117]'
            }`}
          >
            <Upload className="w-6 h-6 text-[#E58E26] mx-auto mb-3" />
            <p className="text-sm font-medium text-[#F1F3F7]">
              Arraste áudios de referência da pessoa aqui
            </p>
            <p className="text-xs text-[#9BA3B4] mt-1 mb-4">
              WAV, MP3, M4A, OGG ou WebM · Recomendado 15s a 120s de fala limpa e expressiva
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                multiple
                onChange={(e) => void handleFileInput(e.target.files)}
                className="hidden"
                aria-label="Selecionar arquivos de áudio"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#191E29] hover:bg-[#222836] border border-white/[0.1] text-xs font-medium text-[#F1F3F7] cursor-pointer whitespace-nowrap shrink-0 transition-colors"
              >
                <FileAudio className="w-3.5 h-3.5 text-[#E58E26]" />
                <span>Selecionar Arquivos</span>
              </button>

              <button
                type="button"
                onClick={() => void handleLoadStudioTestSample()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-white/[0.1] hover:border-[#E58E26]/60 text-xs font-medium text-[#D6DCE6] hover:text-[#F1F3F7] whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                <span>Carregar Amostra de Teste</span>
              </button>
            </div>
          </div>

          {/* Live Microphone Recorder */}
          <div className="lg:col-span-5 rounded-lg p-5 bg-[#0E1117] flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div>
                <h2 className="text-sm font-medium text-[#F1F3F7]">Gravar no Microfone</h2>
                <p className="text-xs text-[#9BA3B4] mt-0.5">
                  Leia um parágrafo naturalmente com pausas reais
                </p>
              </div>
              <span className="font-mono text-xs text-[#D6DCE6] tabular-nums">
                {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:
                {String(recordingSeconds % 60).padStart(2, '0')}
              </span>
            </div>

            <canvas
              ref={liveCanvasRef}
              data-testid="live-mic-canvas"
              width={360}
              height={54}
              aria-label="Monitor de entrada do microfone"
              className="w-full h-[54px] rounded bg-[#0B0D12] border border-white/[0.06] mb-3"
            />

            {!isRecording ? (
              <button
                type="button"
                onClick={() => void startLiveRecording()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-[#191E29] hover:bg-[#222836] border border-white/[0.12] text-xs font-semibold text-[#F1F3F7] transition-colors cursor-pointer"
              >
                <Mic className="w-4 h-4 text-[#E58E26]" />
                <span>Iniciar Gravação Vocal</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={stopLiveRecording}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-[#DC2626] hover:bg-[#B91C1C] text-xs font-semibold text-white transition-colors cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Parar e Adicionar Amostra</span>
              </button>
            )}
          </div>
        </div>

        {/* Uploaded / Recorded Samples + Real DSP Telemetry */}
        {samples.length > 0 && combinedMetrics && (
          <div className="pt-4 border-t border-white/[0.08] space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[#F1F3F7]">
                Amostras Carregadas ({samples.length})
              </h2>
              <p className="font-mono text-xs text-[#9BA3B4] tabular-nums">
                Duração total: {combinedMetrics.durationSec.toFixed(1)}s · F0 Médio: {combinedMetrics.estimatedF0Hz} Hz · Pausas: {combinedMetrics.pauseRatioPercent}%
              </p>
            </div>

            <div className="divide-y divide-white/[0.06] rounded-md bg-[#0E1117]">
              {samples.map((s) => {
                const isPlayingThis = playingSampleId === s.id;
                return (
                  <div key={s.id} className="p-3.5 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => togglePlaySample(s)}
                        aria-label={
                          isPlayingThis ? `Pausar ${s.fileName}` : `Ouvir ${s.fileName}`
                        }
                        className="w-9 h-9 rounded-md bg-[#191E29] hover:border-[#E58E26] border border-white/[0.1] flex items-center justify-center shrink-0 text-[#F1F3F7] cursor-pointer"
                      >
                        {isPlayingThis ? (
                          <Pause className="w-4 h-4 text-[#E58E26]" />
                        ) : (
                          <Play className="w-4 h-4" />
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-[#F1F3F7] font-medium truncate">{s.fileName}</p>
                        <p className="font-mono text-xs text-[#9BA3B4] tabular-nums">
                          {s.metrics.durationSec.toFixed(1)}s · {s.metrics.estimatedF0Hz} Hz · {s.metrics.estimatedWpm} ppm · {s.metrics.pauseRatioPercent}% silêncio
                        </p>
                      </div>
                    </div>

                    <div className="w-full sm:w-56">
                      <WaveformCanvas
                        peaks={s.metrics.waveformPeaks}
                        progress={isPlayingThis ? sampleProgress : 0}
                        height={36}
                        ariaLabel={`Forma de onda de ${s.fileName}`}
                        testId={`sample-wave-${s.id}`}
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => removeSample(s.id)}
                      aria-label={`Remover amostra ${s.fileName}`}
                      className="p-2 rounded text-[#6E7789] hover:text-[#EF4444] hover:bg-white/[0.04] self-end sm:self-center cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* DSP Acoustic Profile Readout */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 pt-2">
              <div className="border-t border-white/[0.08] pt-3">
                <span className="block text-xs text-[#9BA3B4]">Tom Fundamental</span>
                <span className="font-mono text-lg font-semibold text-[#F1F3F7] tabular-nums">
                  {combinedMetrics.estimatedF0Hz} Hz
                </span>
              </div>
              <div className="border-t border-white/[0.08] pt-3">
                <span className="block text-xs text-[#9BA3B4]">Extensão Vocal</span>
                <span className="font-mono text-lg font-semibold text-[#F1F3F7] tabular-nums">
                  {combinedMetrics.pitchMinHz}–{combinedMetrics.pitchMaxHz} Hz
                </span>
              </div>
              <div className="border-t border-white/[0.08] pt-3">
                <span className="block text-xs text-[#9BA3B4]">Cadência Média</span>
                <span className="font-mono text-lg font-semibold text-[#F1F3F7] tabular-nums">
                  {combinedMetrics.estimatedWpm} ppm
                </span>
              </div>
              <div className="border-t border-white/[0.08] pt-3">
                <span className="block text-xs text-[#9BA3B4]">Pausas &amp; Silêncio</span>
                <span className="font-mono text-lg font-semibold text-[#F1F3F7] tabular-nums">
                  {combinedMetrics.pauseRatioPercent}%
                </span>
              </div>
              <div className="border-t border-white/[0.08] pt-3">
                <span className="block text-xs text-[#9BA3B4]">Faixa Dinâmica</span>
                <span className="font-mono text-lg font-semibold text-[#F1F3F7] tabular-nums">
                  {combinedMetrics.dynamicRangeDb} dB
                </span>
              </div>
              <div className="border-t border-white/[0.08] pt-3">
                <span className="block text-xs text-[#9BA3B4]">Calor Espectral</span>
                <span className="font-mono text-lg font-semibold text-[#F1F3F7] tabular-nums">
                  {combinedMetrics.warmthIndex}/100
                </span>
              </div>
            </div>
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            className="border border-[#EF4444]/40 bg-[#EF4444]/10 rounded-md px-4 py-3 text-sm text-[#FCA5A5]"
          >
            {errorMsg}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 rounded-md border border-white/[0.1] text-sm text-[#9BA3B4] hover:text-[#F1F3F7] transition-colors cursor-pointer"
          >
            Voltar ao Estúdio
          </button>

          <button
            type="button"
            disabled={isAnalyzing}
            onClick={() => void handleAnalyzeVoice()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-[#E58E26] hover:bg-[#F09A32] disabled:opacity-60 text-[#0B0D12] text-sm font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Analisando Timbre e Prosódia...</span>
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4" />
                <span>Analisar &amp; Aprender Voz</span>
              </>
            )}
          </button>
        </div>
      </section>

      {/* Step 2: Learned Vocal DNA Review & Save */}
      {learnedDna && (
        <section className="border border-[#E58E26]/40 rounded-lg bg-[#12151C] p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
            <div>
              <h2 className="font-display text-xl font-semibold text-[#F1F3F7]">
                DNA Vocal &amp; Prosódico Extraído
              </h2>
              <p className="text-xs text-[#9BA3B4] mt-1">
                Revise o comportamento vocal aprendido dos áudios antes de criar o narrador exclusivo.
              </p>
            </div>
            <span className="font-mono text-xs text-[#E58E26] tabular-nums">
              {learnedDna.toneSummary}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
            <div>
              <h3 className="text-xs font-semibold text-[#9BA3B4] mb-1.5">Timbre &amp; Ressonância</h3>
              <p className="text-[#D6DCE6] leading-relaxed">{learnedDna.timbreCharacteristics}</p>
            </div>
            <div>
              <h3 className="text-xs font-semibold text-[#9BA3B4] mb-1.5">Cadência &amp; Ritmo</h3>
              <p className="text-[#D6DCE6] leading-relaxed">{learnedDna.cadenceAndRhythm}</p>
            </div>
            <div>
              <h3 className="text-xs font-semibold text-[#9BA3B4] mb-1.5">Pausas &amp; Respiração</h3>
              <p className="text-[#D6DCE6] leading-relaxed">{learnedDna.pauseAndBreathHabits}</p>
            </div>
            <div>
              <h3 className="text-xs font-semibold text-[#9BA3B4] mb-1.5">Entonação Emocional</h3>
              <p className="text-[#D6DCE6] leading-relaxed">{learnedDna.emotionalSignature}</p>
            </div>
          </div>

          {learnedDna.prosodyRules.length > 0 && (
            <div className="border-t border-white/[0.08] pt-4">
              <h3 className="text-xs font-semibold text-[#9BA3B4] mb-2">
                Regras de Prosódia Aprendidas
              </h3>
              <ul className="space-y-1.5 text-sm text-[#D6DCE6]">
                {learnedDna.prosodyRules.map((rule, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="font-mono text-xs text-[#E58E26] mt-0.5">{i + 1}.</span>
                    <span>{rule}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {learnedDna.transcript && (
            <div className="border-t border-white/[0.08] pt-4">
              <h3 className="text-xs font-semibold text-[#9BA3B4] mb-1.5">
                Transcrição da Amostra Original
              </h3>
              <p className="text-sm text-[#9BA3B4] italic">"{learnedDna.transcript}"</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 border-t border-white/[0.08] pt-5">
            <div>
              <label htmlFor="base-voice-select" className="block text-xs font-medium text-[#D6DCE6] mb-2">
                Núcleo de Timbre Neural
              </label>
              <select
                id="base-voice-select"
                value={selectedBaseVoice}
                onChange={(e) => setSelectedBaseVoice(e.target.value as BaseVoiceId)}
                className="w-full bg-[#0B0D12] border border-white/[0.1] rounded-md px-3 py-2.5 text-sm text-[#F1F3F7] focus:outline-none focus:border-[#E58E26]"
              >
                {BASE_VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label} — {v.desc}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="style-directive-input" className="block text-xs font-medium text-[#D6DCE6] mb-2">
                Diretiva de Síntese Prosódica (ajustável)
              </label>
              <textarea
                id="style-directive-input"
                rows={3}
                value={editableStylePrompt}
                onChange={(e) => setEditableStylePrompt(e.target.value)}
                className="w-full bg-[#0B0D12] border border-white/[0.1] rounded-md px-3 py-2 text-xs text-[#D6DCE6] focus:outline-none focus:border-[#E58E26]"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleSaveProfile}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-[#E58E26] hover:bg-[#F09A32] text-[#0B0D12] text-sm font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>Salvar Narrador Exclusivo</span>
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
