import { Menu, Plus, X } from 'lucide-react';
import type { WorkspaceTab } from '../types/voice';

interface TopBarProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  onCreateNewVoice: () => void;
  historyCount: number;
  mobileMenuOpen: boolean;
  onToggleMobileMenu: () => void;
}

export function TopBar({
  activeTab,
  onSelectTab,
  onCreateNewVoice,
  historyCount,
  mobileMenuOpen,
  onToggleMobileMenu,
}: TopBarProps) {
  const navItems: Array<{ id: WorkspaceTab; label: string }> = [
    { id: 'studio', label: 'Estúdio de Narração' },
    { id: 'learn', label: 'Aprender Voz' },
    { id: 'history', label: historyCount > 0 ? `Histórico (${historyCount})` : 'Histórico' },
  ];

  return (
    <header className="h-14 border-b border-white/[0.08] bg-[#0B0D12] px-4 lg:px-6 flex items-center justify-between gap-8 shrink-0">
      {/* Zone 1: Single-line Brand Wordmark */}
      <div className="flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={onToggleMobileMenu}
          aria-label={mobileMenuOpen ? 'Fechar lista de narradores' : 'Abrir lista de narradores'}
          className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-md text-[#9BA3B4] hover:text-[#F1F3F7] hover:bg-white/[0.05] transition-colors focus-visible:outline-2 focus-visible:outline-[#E58E26]"
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
        <a
          href="#studio"
          onClick={(e) => {
            e.preventDefault();
            onSelectTab('studio');
          }}
          className="font-display text-lg font-bold tracking-tight text-[#F1F3F7] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#E58E26] rounded"
        >
          VozMestre
        </a>
      </div>

      {/* Zone 2: Concise single-line navigation links */}
      <nav aria-label="Navegação principal" className="hidden md:flex items-center gap-7 h-full">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`relative h-full inline-flex items-center text-sm font-medium whitespace-nowrap shrink-0 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-[#E58E26] ${
                isActive ? 'text-[#F1F3F7]' : 'text-[#9BA3B4] hover:text-[#F1F3F7]'
              }`}
            >
              {item.label}
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#E58E26]"
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: Single Primary Action */}
      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={onCreateNewVoice}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#E58E26] hover:bg-[#F09A32] text-[#0B0D12] text-sm font-semibold whitespace-nowrap shrink-0 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E58E26] cursor-pointer"
        >
          <Plus className="w-4 h-4 stroke-[2.2]" />
          <span>Nova Voz</span>
        </button>
      </div>
    </header>
  );
}
