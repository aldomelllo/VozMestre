import { useState } from 'react';
import { Download, Play, Pause, Trash2, ArrowUpRight, Search } from 'lucide-react';
import { EMOTION_LABELS } from '../utils/audioProcessing';
import type { NarrationTake } from '../types/voice';

interface HistoryViewProps {
  takes: NarrationTake[];
  activeTakeId: string | null;
  isPlaying: boolean;
  onPlayTake: (take: NarrationTake) => void;
  onLoadInStudio: (take: NarrationTake) => void;
  onDownloadTake: (take: NarrationTake) => void;
  onDeleteTake: (id: string) => void;
  onGoToStudio: () => void;
}

export function HistoryView({
  takes,
  activeTakeId,
  isPlaying,
  onPlayTake,
  onLoadInStudio,
  onDownloadTake,
  onDeleteTake,
  onGoToStudio,
}: HistoryViewProps) {
  const [search, setSearch] = useState('');

  const filtered = takes.filter((t) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      t.narratorName.toLowerCase().includes(q) ||
      t.rawText.toLowerCase().includes(q) ||
      EMOTION_LABELS[t.emotionPreset].label.toLowerCase().includes(q)
    );
  });

  if (takes.length === 0) {
    return (
      <section className="max-w-3xl mx-auto py-16 px-6 text-center">
        <h1 className="font-display text-2xl font-semibold text-[#F1F3F7] mb-2">
          Nenhuma narração gerada ainda
        </h1>
        <p className="text-sm text-[#9BA3B4] max-w-md mx-auto mb-6">
          Escolha um narrador exclusivo ou treine sua própria voz a partir de áudios de referência e gere seu primeiro take de estúdio.
        </p>
        <button
          type="button"
          onClick={onGoToStudio}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-[#E58E26] hover:bg-[#F09A32] text-[#0B0D12] text-sm font-semibold transition-colors cursor-pointer"
        >
          Ir para o Estúdio de Narração
        </button>
      </section>
    );
  }

  return (
    <section className="max-w-5xl mx-auto py-8 px-4 lg:px-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-2xl font-semibold text-[#F1F3F7]">
            Histórico de Narrações
          </h1>
          <p className="text-xs text-[#9BA3B4] mt-1">
            Todos os takes renderizados ficam disponíveis para audição e download WAV master.
          </p>
        </div>

        <div className="relative w-full sm:w-72">
          <label htmlFor="history-search" className="sr-only">
            Buscar no histórico
          </label>
          <Search
            aria-hidden="true"
            className="w-4 h-4 text-[#6E7789] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          />
          <input
            id="history-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrar por narrador ou texto..."
            className="w-full bg-[#12151C] border border-white/[0.08] rounded-md pl-9 pr-3 py-2 text-sm text-[#F1F3F7] placeholder:text-[#6E7789] focus:outline-none focus:border-[#E58E26]"
          />
        </div>
      </div>

      <div className="border border-white/[0.08] rounded-lg bg-[#12151C] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/[0.08] text-xs font-medium text-[#9BA3B4]">
                <th className="py-3 px-4">Take &amp; Roteiro</th>
                <th className="py-3 px-4 whitespace-nowrap">Narrador</th>
                <th className="py-3 px-4 whitespace-nowrap">Intenção</th>
                <th className="py-3 px-4 text-right whitespace-nowrap">Duração</th>
                <th className="py-3 px-4 text-right whitespace-nowrap">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06] text-sm">
              {filtered.map((take) => {
                const active = take.id === activeTakeId && isPlaying;
                const formattedDate = new Date(take.createdAt).toLocaleString('pt-BR', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                });
                return (
                  <tr
                    key={take.id}
                    className="hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="py-3.5 px-4 max-w-md">
                      <p className="text-[#F1F3F7] line-clamp-1 font-medium">
                        {take.rawText}
                      </p>
                      <p className="font-mono text-xs text-[#6E7789] tabular-nums mt-0.5">
                        {formattedDate} · Fidelidade {take.fidelityLevel}%
                      </p>
                    </td>
                    <td className="py-3.5 px-4 text-[#D6DCE6] whitespace-nowrap">
                      {take.narratorName}
                    </td>
                    <td className="py-3.5 px-4 text-[#9BA3B4] whitespace-nowrap">
                      {EMOTION_LABELS[take.emotionPreset].label}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-xs text-[#D6DCE6] tabular-nums whitespace-nowrap">
                      {take.durationSec.toFixed(1)}s
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => onPlayTake(take)}
                          aria-label={
                            active
                              ? `Pausar take de ${take.narratorName}`
                              : `Reproduzir take de ${take.narratorName}`
                          }
                          className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-white/[0.1] bg-[#191E29] hover:border-[#E58E26] text-[#F1F3F7] transition-colors cursor-pointer"
                        >
                          {active ? <Pause className="w-4 h-4 text-[#E58E26]" /> : <Play className="w-4 h-4" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => onLoadInStudio(take)}
                          aria-label={`Abrir take de ${take.narratorName} no estúdio`}
                          title="Abrir no estúdio"
                          className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-white/[0.08] hover:bg-white/[0.05] text-[#9BA3B4] hover:text-[#F1F3F7] transition-colors cursor-pointer"
                        >
                          <ArrowUpRight className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDownloadTake(take)}
                          aria-label={`Baixar WAV de ${take.narratorName}`}
                          title="Baixar WAV"
                          className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-white/[0.08] hover:bg-white/[0.05] text-[#9BA3B4] hover:text-[#F1F3F7] transition-colors cursor-pointer"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteTake(take.id)}
                          aria-label={`Excluir take de ${take.narratorName}`}
                          title="Excluir"
                          className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-white/[0.08] hover:bg-white/[0.05] text-[#6E7789] hover:text-[#EF4444] transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
