import { useState } from 'react';
import { Search, Trash2, UserPlus } from 'lucide-react';
import type { NarratorProfile } from '../types/voice';

interface NarratorSidebarProps {
  narrators: NarratorProfile[];
  selectedId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNewVoice: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

function NarratorAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  const [imgError, setImgError] = useState(false);
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

  if (avatarUrl && !imgError) {
    return (
      <img
        src={avatarUrl}
        alt={`Retrato de estúdio de ${name}`}
        referrerPolicy="no-referrer"
        onError={() => setImgError(true)}
        className="w-10 h-10 rounded-md object-cover shrink-0 border border-white/10"
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className="w-10 h-10 rounded-md bg-[#1D222E] border border-white/10 flex items-center justify-center shrink-0 font-display text-xs font-semibold text-[#E58E26]"
    >
      {initials || 'VM'}
    </div>
  );
}

export function NarratorSidebar({
  narrators,
  selectedId,
  onSelect,
  onDelete,
  onNewVoice,
  mobileOpen,
  onCloseMobile,
}: NarratorSidebarProps) {
  const [query, setQuery] = useState('');

  const filtered = narrators.filter((n) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      n.name.toLowerCase().includes(q) ||
      n.role.toLowerCase().includes(q) ||
      n.dna.toneSummary.toLowerCase().includes(q)
    );
  });

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[#10131A] border-r border-white/[0.08]">
      <div className="p-4 border-b border-white/[0.08]">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-sm font-semibold text-[#F1F3F7]">
            Narradores Exclusivos
          </h2>
          <span className="font-mono text-xs text-[#9BA3B4] tabular-nums">
            {narrators.length}
          </span>
        </div>

        <div className="relative">
          <label htmlFor="narrator-search" className="sr-only">
            Filtrar narradores
          </label>
          <Search
            aria-hidden="true"
            className="w-3.5 h-3.5 text-[#6E7789] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          />
          <input
            id="narrator-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar voz ou timbre..."
            className="w-full bg-[#0B0D12] border border-white/[0.08] rounded-md pl-8 pr-3 py-2 text-xs text-[#F1F3F7] placeholder:text-[#6E7789] focus:outline-none focus:border-[#E58E26]"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-white/[0.05]">
        {filtered.length === 0 ? (
          <div className="p-5 text-center">
            <p className="text-xs text-[#9BA3B4] mb-3">Nenhum narrador encontrado.</p>
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-xs text-[#E58E26] hover:underline"
            >
              Limpar filtro
            </button>
          </div>
        ) : (
          filtered.map((narrator) => {
            const isSelected = narrator.id === selectedId;
            return (
              <div
                key={narrator.id}
                className={`group flex items-start gap-3 px-4 py-3.5 transition-colors duration-150 ${
                  isSelected ? 'bg-[#191E29]' : 'hover:bg-white/[0.03]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    onSelect(narrator.id);
                    onCloseMobile();
                  }}
                  aria-pressed={isSelected}
                  className="flex-1 min-w-0 flex items-start gap-3 text-left focus-visible:outline-2 focus-visible:outline-[#E58E26] rounded cursor-pointer"
                >
                  <NarratorAvatar name={narrator.name} avatarUrl={narrator.avatarUrl} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-sm font-medium truncate ${
                          isSelected ? 'text-[#F1F3F7]' : 'text-[#D6DCE6]'
                        }`}
                      >
                        {narrator.name}
                      </span>
                    </div>
                    <p className="text-xs text-[#9BA3B4] truncate mt-0.5">{narrator.role}</p>
                    <p className="font-mono text-[11px] text-[#6E7789] tabular-nums mt-1.5 truncate">
                      {narrator.acousticMetrics.estimatedF0Hz} Hz · {narrator.acousticMetrics.estimatedWpm} ppm
                    </p>
                  </div>
                </button>

                {!narrator.isBuiltIn && (
                  <button
                    type="button"
                    onClick={() => onDelete(narrator.id)}
                    aria-label={`Excluir narrador ${narrator.name}`}
                    className="opacity-60 group-hover:opacity-100 p-1.5 rounded text-[#6E7789] hover:text-[#EF4444] hover:bg-white/[0.05] transition-colors shrink-0 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[#E58E26] cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="p-4 border-t border-white/[0.08]">
        <button
          type="button"
          onClick={() => {
            onNewVoice();
            onCloseMobile();
          }}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-md border border-white/[0.12] hover:border-[#E58E26]/60 bg-[#151923] hover:bg-[#191E29] text-xs font-medium text-[#F1F3F7] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <UserPlus className="w-3.5 h-3.5 text-[#E58E26]" />
          <span>Treinar Nova Voz</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop persistent rack */}
      <aside aria-label="Biblioteca de narradores" className="hidden lg:block w-[280px] shrink-0 h-full">
        {sidebarContent}
      </aside>

      {/* Mobile slide-over drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div
            aria-hidden="true"
            onClick={onCloseMobile}
            className="fixed inset-0 bg-black/70"
          />
          <aside
            aria-label="Biblioteca de narradores"
            className="relative z-50 w-[280px] max-w-[85vw] h-full"
          >
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}
