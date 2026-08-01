import { useState } from 'react';
import { useInvestments } from '../hooks/useInvestments';
import { TrendingUp, PiggyBank, Landmark, BarChart3, Plus, Trash2, Calendar, X } from 'lucide-react';
import dayjs from 'dayjs';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function getTypeLabel(type: string): string {
  if (type === 'RESERVA') return 'Reserva de Emergência';
  if (type === 'RENDA_FIXA') return 'Renda Fixa';
  if (type === 'RENDA_VARIAVEL') return 'Renda Variável';
  return type;
}

function getTypeIcon(type: string) {
  if (type === 'RESERVA') return PiggyBank;
  if (type === 'RENDA_FIXA') return Landmark;
  if (type === 'RENDA_VARIAVEL') return BarChart3;
  return TrendingUp;
}

function getTypeColor(type: string): string {
  if (type === 'RESERVA') return 'from-amber-500 to-amber-400';
  if (type === 'RENDA_FIXA') return 'from-blue-500 to-blue-400';
  if (type === 'RENDA_VARIAVEL') return 'from-purple-500 to-purple-400';
  return 'from-emerald-500 to-emerald-400';
}

function getTypeBg(type: string): string {
  if (type === 'RESERVA') return 'bg-amber-500/10 border-amber-500/20';
  if (type === 'RENDA_FIXA') return 'bg-blue-500/10 border-blue-500/20';
  if (type === 'RENDA_VARIAVEL') return 'bg-purple-500/10 border-purple-500/20';
  return 'bg-emerald-500/10 border-emerald-500/20';
}

function getTypeText(type: string): string {
  if (type === 'RESERVA') return 'text-amber-400';
  if (type === 'RENDA_FIXA') return 'text-blue-400';
  if (type === 'RENDA_VARIAVEL') return 'text-purple-400';
  return 'text-emerald-400';
}

function getMonthLabel(month: string): string {
  const m = parseInt(month.split('-')[1], 10);
  const names = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return names[m - 1] || month;
}

const TYPES = ['RESERVA', 'RENDA_FIXA', 'RENDA_VARIAVEL'] as const;

interface InvestmentForm {
  type: string;
  amount: string;
  month: string;
  date: string;
}

export default function Investments() {
  const { investments, byType, byMonth, loading, create, remove } = useInvestments();
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<InvestmentForm>({
    type: 'RENDA_FIXA',
    amount: '',
    month: dayjs().format('YYYY-MM'),
    date: dayjs().format('YYYY-MM-DD'),
  });
  const [saving, setSaving] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.amount || !form.month) return;
    setSaving(true);
    try {
      await create({
        type: form.type,
        amount: parseFloat(form.amount),
        month: form.month,
        date: form.date || undefined,
      });
      setForm({
        type: 'RENDA_FIXA',
        amount: '',
        month: dayjs().format('YYYY-MM'),
        date: dayjs().format('YYYY-MM-DD'),
      });
      setShowModal(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Remover este investimento?')) return;
    await remove(id);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-b from-emerald-500/[0.06] via-gray-900 to-transparent p-6">
        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
        <div className="relative flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-emerald-400/80">Carteira</p>
            <h1 className="text-3xl font-bold tracking-tight text-white">Investimentos</h1>
            <p className="text-sm text-gray-400">Reserva, renda fixa e renda variável</p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 active:scale-95"
          >
            <Plus className="w-4 h-4" />
            Novo Aporte
          </button>
        </div>
      </div>

      {/* Type Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {TYPES.map((type) => {
          const Icon = getTypeIcon(type);
          const amount = byType[type] || 0;

          return (
            <div
              key={type}
              className={`rounded-2xl border ${getTypeBg(type)} hover:scale-[1.02] transition-all duration-300 p-5`}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${getTypeColor(type)} flex items-center justify-center shadow-lg`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">{getTypeLabel(type)}</p>
                </div>
              </div>
              <p className={`text-2xl font-bold ${getTypeText(type)}`}>{formatCurrency(amount)}</p>
            </div>
          );
        })}
      </div>

      {/* Total Card */}
      <div className="rounded-2xl border border-white/5 bg-gradient-to-r from-emerald-500/10 to-gray-900 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <TrendingUp className="w-5 h-5 text-emerald-400" />
            <span className="text-sm font-medium text-gray-300">Total investido</span>
          </div>
          <span className="text-2xl font-bold text-emerald-400">{formatCurrency(byType.total)}</span>
        </div>
      </div>

      {/* Monthly Table */}
      <div className="rounded-2xl border border-white/5 bg-gray-900/70 overflow-hidden">
        <div className="p-5 border-b border-white/5">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Calendar className="w-5 h-5 text-emerald-400" />
            Aportes Mensais
          </h2>
        </div>
        {byMonth.length === 0 ? (
          <div className="p-10 text-center text-gray-500 text-sm">
            Nenhum aporte registrado. Clique em "Novo Aporte" para começar.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Mes</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-amber-400 uppercase tracking-wider">Reserva</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-blue-400 uppercase tracking-wider">Renda Fixa</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-purple-400 uppercase tracking-wider">Renda Variavel</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-emerald-400 uppercase tracking-wider">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {byMonth.map((row) => (
                  <tr key={row.month} className="hover:bg-white/[0.01] transition-colors">
                    <td className="px-5 py-3 text-sm font-medium text-white">
                      {getMonthLabel(row.month)}/{row.month.split('-')[0]}
                    </td>
                    <td className="px-5 py-3 text-sm text-right text-amber-400">
                      {row.RESERVA > 0 ? formatCurrency(row.RESERVA) : '-'}
                    </td>
                    <td className="px-5 py-3 text-sm text-right text-blue-400">
                      {row.RENDA_FIXA > 0 ? formatCurrency(row.RENDA_FIXA) : '-'}
                    </td>
                    <td className="px-5 py-3 text-sm text-right text-purple-400">
                      {row.RENDA_VARIAVEL > 0 ? formatCurrency(row.RENDA_VARIAVEL) : '-'}
                    </td>
                    <td className="px-5 py-3 text-sm text-right font-semibold text-emerald-400">
                      {formatCurrency(row.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Investments */}
      <div className="rounded-2xl border border-white/5 bg-gray-900/70 overflow-hidden">
        <div className="p-5 border-b border-white/5">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-400" />
            Aportes Recentes
          </h2>
        </div>
        {investments.length === 0 ? (
          <div className="p-10 text-center text-gray-500 text-sm">Nenhum aporte registrado.</div>
        ) : (
          <div className="divide-y divide-white/5">
            {investments.slice(0, 20).map((inv) => {
              const Icon = getTypeIcon(inv.type);
              return (
                <div key={inv.id} className="flex items-center justify-between px-5 py-3 hover:bg-white/[0.01] transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${getTypeColor(inv.type)} flex items-center justify-center shrink-0`}>
                      <Icon className="w-4 h-4 text-white" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{getTypeLabel(inv.type)}</p>
                      <p className="text-xs text-gray-500">
                        {getMonthLabel(inv.month)}/{inv.month.split('-')[0]}
                        {inv.date && ` • ${dayjs(inv.date).format('DD/MM/YYYY')}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-semibold ${getTypeText(inv.type)}`}>
                      {formatCurrency(inv.amount)}
                    </span>
                    <button
                      onClick={() => handleDelete(inv.id)}
                      className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* New Investment Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="new-investment-title" onKeyDown={(e) => { if (e.key === 'Escape') setShowModal(false); }}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative bg-gray-900 border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl shadow-black/50">
            <div className="flex items-center justify-between mb-6">
              <h2 id="new-investment-title" className="text-lg font-semibold text-white flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-emerald-400" />
                Novo Aporte
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-1.5 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Tipo</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className="w-full bg-gray-800 border border-white/5 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/30 transition-all"
                >
                  {TYPES.map((t) => (
                    <option key={t} value={t}>{getTypeLabel(t)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Valor (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0,00"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  className="w-full bg-gray-800 border border-white/5 rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/30 transition-all"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Mês de referência</label>
                <input
                  type="month"
                  value={form.month}
                  onChange={(e) => setForm({ ...form, month: e.target.value })}
                  className="w-full bg-gray-800 border border-white/5 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/30 transition-all"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Data do aporte (opcional)</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  className="w-full bg-gray-800 border border-white/5 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/30 transition-all"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-300 bg-gray-800 hover:bg-gray-700 border border-white/5 rounded-xl transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl transition-colors disabled:opacity-50 shadow-lg shadow-emerald-500/20"
                >
                  {saving ? 'Salvando...' : 'Adicionar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
