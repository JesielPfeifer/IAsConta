import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { LayoutDashboard, ArrowLeftRight, Calendar, Settings, LogOut, Wallet, Wallet2, Target, TrendingUp, BarChart3, Menu, X } from 'lucide-react';
import ChatBot from './ChatBot';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/transactions', icon: ArrowLeftRight, label: 'Transações' },
  { to: '/bills', icon: Calendar, label: 'Contas a Pagar' },
  { to: '/goals', icon: Target, label: 'Metas' },
  { to: '/investments', icon: TrendingUp, label: 'Investimentos' },
  { to: '/salary', icon: Wallet, label: 'Salário' },
  { to: '/annual', icon: BarChart3, label: 'Panorama Anual' },
  { to: '/setup', icon: Settings, label: 'Configuração' },
];

function getInitials(name?: string) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20 shrink-0">
        <Wallet2 className="w-5 h-5 text-white" strokeWidth={2.5} />
      </div>
      {!compact && (
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-white tracking-tight leading-tight">Contas</h1>
          <p className="text-[11px] text-gray-500 leading-tight">Finanças pessoais</p>
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const navLinks = (onNavigate?: () => void) =>
    navItems.map(({ to, icon: Icon, label }) => (
      <NavLink
        key={to}
        to={to}
        end={to === '/'}
        onClick={onNavigate}
        className={({ isActive }) =>
          `group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 border-l-2 ${
            isActive
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-400'
              : 'text-gray-400 hover:text-white hover:bg-white/[0.03] border-transparent'
          }`
        }
      >
        {({ isActive }) => (
          <>
            <span
              className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors duration-200 shrink-0 ${
                isActive ? 'bg-emerald-500/15' : 'bg-white/5 group-hover:bg-white/10'
              }`}
            >
              <Icon className="w-[18px] h-[18px]" strokeWidth={2} />
            </span>
            <span className="truncate">{label}</span>
          </>
        )}
      </NavLink>
    ));

  return (
    <div className="flex h-screen bg-gray-950 overflow-hidden">
      {/* ===== Sidebar Desktop (md+) ===== */}
      <aside className="hidden md:flex w-64 bg-gray-950 border-r border-white/5 flex-col shrink-0">
        <div className="px-5 py-5 border-b border-white/5">
          <Brand />
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">{navLinks()}</nav>
        <div className="px-3 py-3 border-t border-white/5">
          <div className="rounded-xl bg-gradient-to-b from-white/[0.04] to-transparent border border-white/5 p-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white text-xs font-semibold shrink-0 shadow-md shadow-emerald-500/20">
                {getInitials(user?.name)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white font-medium truncate">{user?.name}</p>
                <p className="text-xs text-gray-500 truncate">{user?.email}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="mt-3 w-full flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-red-400 hover:bg-red-500/5 rounded-lg py-2 transition-colors duration-200"
            >
              <LogOut className="w-4 h-4" /> Sair
            </button>
          </div>
        </div>
      </aside>

      {/* ===== Drawer Mobile ===== */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setDrawerOpen(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-gray-950 border-r border-white/10 flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
              <Brand />
              <button
                onClick={() => setDrawerOpen(false)}
                aria-label="Fechar menu"
                className="w-10 h-10 rounded-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/5"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">{navLinks(() => setDrawerOpen(false))}</nav>
            <div className="px-3 py-3 border-t border-white/5">
              <div className="flex items-center gap-3 px-2 py-2">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white text-xs font-semibold shrink-0">
                  {getInitials(user?.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white font-medium truncate">{user?.name}</p>
                  <p className="text-xs text-gray-500 truncate">{user?.email}</p>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="mt-1 w-full flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-red-400 hover:bg-red-500/5 rounded-lg py-2.5"
              >
                <LogOut className="w-4 h-4" /> Sair
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Conteúdo ===== */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header mobile (hamburger) */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-white/5 bg-gray-950/95 backdrop-blur sticky top-0 z-30">
          <Brand compact />
          <div className="flex items-center gap-2">
            <button
              onClick={handleLogout}
              aria-label="Sair"
              className="w-10 h-10 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-400"
            >
              <LogOut className="w-5 h-5" />
            </button>
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="Abrir menu"
              className="w-10 h-10 rounded-lg flex items-center justify-center text-gray-300 hover:bg-white/5"
            >
              <Menu className="w-6 h-6" />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-gray-950 p-3 md:p-3 md:p-6 pb-20 md:pb-6">
          <Outlet />
          <ChatBot />
        </main>
      </div>
    </div>
  );
}
