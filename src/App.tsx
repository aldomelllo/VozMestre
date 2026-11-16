import { useEffect, useRef, useState } from 'react';
import { HistoryView } from './components/HistoryView';
import { NarrationStudio } from './components/NarrationStudio';
import { NarratorSidebar } from './components/NarratorSidebar';
import { TopBar } from './components/TopBar';
import { VoiceLearningLab } from './components/VoiceLearningLab';
import { SEED_NARRATORS } from './data/seedNarrators';
import type {
  NarrationTake,
  NarratorProfile,
  StudioCalibration,
  WorkspaceTab,
} from './types/voice';
import { renderCalibratedWavBlob } from './utils/webAudioPlayback';

const CUSTOM_NARRATORS_KEY = 'vozmestre.custom_narrators.v1';
const CALIBRATIONS_KEY = 'vozmestre.calibrations.v1';
const HISTORY_TAKES_KEY = 'vozmestre.history_takes.v1';

function loadInitialNarrators(): NarratorProfile[] {
  let savedCustom: NarratorProfile[] = [];
  let savedCalibrations: Record<string, StudioCalibration> = {};

  try {
    const raw = localStorage.getItem(CUSTOM_NARRATORS_KEY);
    if (raw) savedCustom = JSON.parse(raw) as NarratorProfile[];
  } catch {
    savedCustom = [];
  }

  try {
    const rawCal = localStorage.getItem(CALIBRATIONS_KEY);
    if (rawCal) savedCalibrations = JSON.parse(rawCal) as Record<string, StudioCalibration>;
  } catch {
    savedCalibrations = {};
  }

  return [...savedCustom, ...SEED_NARRATORS].map((n) => ({
    ...n,
    calibration: savedCalibrations[n.id] ?? n.calibration,
  }));
}

function loadInitialTakes(): NarrationTake[] {
  try {
    const raw = localStorage.getItem(HISTORY_TAKES_KEY);
    if (raw) return JSON.parse(raw) as NarrationTake[];
  } catch {
    return [];
  }
  return [];
}

export default function App() {
  const [narrators, setNarrators] = useState<NarratorProfile[]>(loadInitialNarrators);
  const [selectedNarratorId, setSelectedNarratorId] = useState<string>(
    () => loadInitialNarrators()[0]?.id ?? SEED_NARRATORS[0].id
  );
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('studio');
  const [takes, setTakes] = useState<NarrationTake[]>(loadInitialTakes);
  const [latestTakeForStudio, setLatestTakeForStudio] = useState<NarrationTake | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // History audio playback state
  const [playingTakeId, setPlayingTakeId] = useState<string | null>(null);
  const historyAudioRef = useRef<HTMLAudioElement | null>(null);
  const historyUrlRef = useRef<string | null>(null);

  useEffect(() => {
    try {
      const customOnly = narrators.filter((n) => !n.isBuiltIn);
      localStorage.setItem(CUSTOM_NARRATORS_KEY, JSON.stringify(customOnly));

      const calMap: Record<string, StudioCalibration> = {};
      for (const n of narrators) {
        calMap[n.id] = n.calibration;
      }
      localStorage.setItem(CALIBRATIONS_KEY, JSON.stringify(calMap));
    } catch {
      // Ignore storage quota errors safely
    }
  }, [narrators]);

  useEffect(() => {
    try {
      // Keep up to 10 recent takes within localStorage quota
      localStorage.setItem(HISTORY_TAKES_KEY, JSON.stringify(takes.slice(0, 10)));
    } catch {
      // Ignore quota exceeded
    }
  }, [takes]);

  useEffect(() => {
    return () => {
      historyAudioRef.current?.pause();
      if (historyUrlRef.current) URL.revokeObjectURL(historyUrlRef.current);
    };
  }, []);

  const selectedNarrator =
    narrators.find((n) => n.id === selectedNarratorId) ?? narrators[0] ?? SEED_NARRATORS[0];

  const handleSaveNarrator = (profile: NarratorProfile) => {
    setNarrators((prev) => [profile, ...prev]);
    setSelectedNarratorId(profile.id);
    setActiveTab('studio');
  };

  const handleDeleteNarrator = (id: string) => {
    setNarrators((prev) => {
      const next = prev.filter((n) => n.id !== id);
      if (selectedNarratorId === id && next[0]) {
        setSelectedNarratorId(next[0].id);
      }
      return next;
    });
  };

  const handleUpdateCalibration = (narratorId: string, calibration: StudioCalibration) => {
    setNarrators((prev) =>
      prev.map((n) => (n.id === narratorId ? { ...n, calibration } : n))
    );
  };

  const handleTakeGenerated = (take: NarrationTake) => {
    setTakes((prev) => [take, ...prev]);
    setLatestTakeForStudio(take);
  };

  const handlePlayHistoryTake = async (take: NarrationTake) => {
    if (playingTakeId === take.id && historyAudioRef.current) {
      historyAudioRef.current.pause();
      setPlayingTakeId(null);
      return;
    }

    historyAudioRef.current?.pause();
    if (historyUrlRef.current) {
      URL.revokeObjectURL(historyUrlRef.current);
      historyUrlRef.current = null;
    }

    const owner = narrators.find((n) => n.id === take.narratorId) ?? selectedNarrator;
    const blob = await renderCalibratedWavBlob(take.audioBase64Wav, owner.calibration);
    const url = URL.createObjectURL(blob);
    historyUrlRef.current = url;

    const audio = new Audio(url);
    historyAudioRef.current = audio;
    setPlayingTakeId(take.id);
    audio.onended = () => setPlayingTakeId(null);
    await audio.play();
  };

  const handleDownloadTake = async (take: NarrationTake) => {
    const owner = narrators.find((n) => n.id === take.narratorId) ?? selectedNarrator;
    const blob = await renderCalibratedWavBlob(take.audioBase64Wav, owner.calibration);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = take.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen lg:h-screen flex flex-col bg-[#0B0D12] text-[#F1F3F7]">
      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onCreateNewVoice={() => setActiveTab('learn')}
        historyCount={takes.length}
        mobileMenuOpen={mobileMenuOpen}
        onToggleMobileMenu={() => setMobileMenuOpen((v) => !v)}
      />

      {/* Compact mobile view switcher (< 768px) */}
      <nav
        aria-label="Abas mobile"
        className="md:hidden flex items-center border-b border-white/[0.08] bg-[#10131A] px-3 py-1.5 gap-2 overflow-x-auto"
      >
        {(
          [
            { id: 'studio', label: 'Estúdio' },
            { id: 'learn', label: 'Aprender Voz' },
            { id: 'history', label: `Histórico (${takes.length})` },
          ] as Array<{ id: WorkspaceTab; label: string }>
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap shrink-0 ${
              activeTab === tab.id
                ? 'bg-[#E58E26] text-[#0B0D12] font-semibold'
                : 'text-[#9BA3B4]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="flex-1 flex min-h-0">
        <NarratorSidebar
          narrators={narrators}
          selectedId={selectedNarrator.id}
          onSelect={(id) => {
            setSelectedNarratorId(id);
            if (activeTab === 'history') setActiveTab('studio');
          }}
          onDelete={handleDeleteNarrator}
          onNewVoice={() => setActiveTab('learn')}
          mobileOpen={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
        />

        <main className="flex-1 min-w-0 overflow-y-auto bg-[#0B0D12]">
          {activeTab === 'studio' && (
            <NarrationStudio
              narrator={selectedNarrator}
              latestTake={
                latestTakeForStudio?.narratorId === selectedNarrator.id
                  ? latestTakeForStudio
                  : null
              }
              onUpdateCalibration={handleUpdateCalibration}
              onTakeGenerated={handleTakeGenerated}
              onTrainNewVoice={() => setActiveTab('learn')}
            />
          )}

          {activeTab === 'learn' && (
            <VoiceLearningLab
              onSaveNarrator={handleSaveNarrator}
              onCancel={() => setActiveTab('studio')}
            />
          )}

          {activeTab === 'history' && (
            <HistoryView
              takes={takes}
              activeTakeId={playingTakeId}
              isPlaying={playingTakeId !== null}
              onPlayTake={(t) => void handlePlayHistoryTake(t)}
              onLoadInStudio={(t) => {
                setSelectedNarratorId(t.narratorId);
                setLatestTakeForStudio(t);
                setActiveTab('studio');
              }}
              onDownloadTake={(t) => void handleDownloadTake(t)}
              onDeleteTake={(id) => setTakes((prev) => prev.filter((t) => t.id !== id))}
              onGoToStudio={() => setActiveTab('studio')}
            />
          )}
        </main>
      </div>
    </div>
  );
}
