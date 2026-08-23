import { useState } from 'react';
import { useGoals, type Goal } from '../hooks/useGoals';
import { Target, Plus, Trash2, Calendar, X, TrendingUp } from 'lucide-react';
import dayjs from 'dayjs';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

const MONTHS = [
  { value: '01', label: 'Jan' }, { value: '02', label: 'Fev' },
  { value: '03', label: 'Mar' }, { value: '04', label: 'Abr' },
  { value: '05', label: 'Mai' }, { value: '06', label: 'Jun' },
  { value: '07', label: 'Jul' }, { value: '08', label: 'Ago' },
  { value: '09', label: 'Set' }, { value: '10', label: 'Out' },
  { value: '11', label: 'Nov' }, { value: '12', label: 'Dez' },
];

const currentYear = dayjs().year();

interface GoalFormData {
  name: string;
  totalAmount: string;
  targetDate: string;
}

export default function Goals() {
  const { goals, loading, create, remove, upsertMonth } = useGoals();
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<GoalFormData>({ name: '', totalAmount: '', targetDate: '' });
  const [saving, setSaving] = useState(false);
  const [editingMonth, setEditingMonth] = useState<{ goalId: string; month: string; amount: string } | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.totalAmount) return;
    setSaving(true);
    try {
      await create({
        name: form.name,
        totalAmount: parseFloat(form.totalAmount),
        targetDate: form.targetDate ? new Date(form.targetDate).toISOString() : null,
      });
      setForm({ name: '', totalAmount: '', targetDate: '' });
      setShowModal(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Remover esta meta?')) return;
    await remove(id);
  }

  function getMonthAmount(goal: Goal, monthNum: string): number {
    const month = `${currentYear}-${monthNum}`;
    const m = goal.months.find((gm) => gm.month === month);
    return m?.amount ?? 0;
  }

  async function handleMonthBlur(goalId: string, month: string, value: string) {
    const amount = parseFloat(value);
    if (isNaN(amount)) return;
    await upsertMonth(goalId, month, amount);
    setEditingMonth(null);
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
            <p className="text-sm font-medium text-emerald-400/80">Planejamento</p>
            <h1 className="text-3xl font-bold tracking-tight text-white">Metas Financeiras</h1>
            <p className="text-sm text-gray-400">Acompanhe o progresso das suas metas mês a mês</p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 active:scale-95"
          >
            <Plus className="w-4 h-4" />
            Nova Meta
          </button>
        </div>
      </div>

      {/* Goals Grid */}
      {goals.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border border-white/5 bg-gray-900/50">
          <Target className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-400 mb-2">Nenhuma meta cadastrada</h3>
          <p className="text-sm text-gray-500 mb-4">Crie metas para acompanhar seu progresso financeiro</p>
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200"
          >
            <Plus className="w-4 h-4" />
            Criar primeira meta
          </button>
        </div>
      ) : (
        <div className="grid gap-6">
          {goals.map((goal) => {
            const progress = goal.totalAmount > 0 ? Math.min((goal.savedAmount / goal.totalAmount) * 100, 100) : 0;
            const remaining = Math.max(goal.totalAmount - goal.savedAmount, 0);

            return (
              <div
                key={goal.id}
                className="rounded-2xl border border-white/5 bg-gray-900/70 hover:bg-gray-900/90 hover:scale-[1.02] transition-all duration-300 overflow-hidden"
              >
                <div className="p-6">
                  {/* Goal Header */}
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Target className="w-5 h-5 text-emerald-400 shrink-0" />
                        <h3 className="text-lg font-semibold text-white truncate">{goal.name}</h3>
                      </div>
                      {goal.targetDate && (
                        <div className="flex items-center gap-1 text-sm text-gray-400">
                          <Calendar className="w-3.5 h-3.5" />
                          <span>Alvo: {dayjs(goal.targetDate).format('DD/MM/YYYY')}</span>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleDelete(goal.id)}
                      className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors duration-200 shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Progress Section */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                    <div className="bg-gray-800/50 rounded-xl p-3 border border-white/5">
                      <p className="text-xs text-gray-400 mb-1">Meta total</p>
                      <p className="text-lg font-bold text-white">{formatCurrency(goal.totalAmount)}</p>
                    </div>
                    <div className="bg-gray-800/50 rounded-xl p-3 border border-white/5">
                      <p className="text-xs text-gray-400 mb-1">Acumulado</p>
                      <p className="text-lg font-bold text-emerald-400">{formatCurrency(goal.savedAmount)}</p>
                    </div>
                    <div className="bg-gray-800/50 rounded-xl p-3 border border-white/5">
                      <p className="text-xs text-gray-400 mb-1">Restante</p>
                      <p className="text-lg font-bold text-amber-400">{formatCurrency(remaining)}</p>
                    </div>
                    <div className="bg-gray-800/50 rounded-xl p-3 border border-white/5">
                      <p className="text-xs text-gray-400 mb-1">Progresso</p>
                      <p className="text-lg font-bold text-white">{progress.toFixed(1)}%</p>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mb-6">
                    <div className="h-3 bg-gray-800 rounded-full overflow-hidden border border-white/5">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-500 shadow-sm shadow-emerald-500/30"
                        style={{ width: `${Math.min(progress, 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Monthly Table */}
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-3 flex items-center gap-1">
                      <TrendingUp className="w-3.5 h-3.5" />
                      Aportes mensais em {currentYear}
                    </p>
                    <div className="grid grid-cols-6 sm:grid-cols-12 gap-2">
                      {MONTHS.map(({ value, label }) => {
                        const monthStr = `${currentYear}-${value}`;
                        const currentAmount = getMonthAmount(goal, value);
                        const isEditing = editingMonth?.goalId === goal.id && editingMonth?.month === monthStr;

                        return (
                          <div key={value} className="flex flex-col items-center gap-1">
                            <span className="text-[10px] text-gray-500 font-medium">{label}</span>
                            {isEditing ? (
                              <input
                                type="number"
                                autoFocus
                                step="0.01"
                                min="0"
                                className="w-full bg-gray-700 border border-emerald-500/50 rounded-lg px-1.5 py-1 text-xs text-white text-center focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                defaultValue={currentAmount || ''}
                                onBlur={(e) => handleMonthBlur(goal.id, monthStr, e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                  if (e.key === 'Escape') setEditingMonth(null);
                                }}
                              />
                            ) : (
                              <button
                                onClick={() =>
                                  setEditingMonth({ goalId: goal.id, month: monthStr, amount: String(currentAmount || '') })
                                }
                                className={`w-full rounded-lg px-1.5 py-1 text-xs font-medium text-center transition-colors duration-200 border ${
                                  currentAmount > 0
                                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'
                                    : 'bg-gray-800/50 border-white/5 text-gray-600 hover:text-gray-400 hover:border-white/10'
                                }`}
                              >
                                {currentAmount > 0 ? formatCurrency(currentAmount).replace('R$', '') : '-'}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* New Goal Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="new-goal-title" onKeyDown={(e) => { if (e.key === 'Escape') setShowModal(false); }}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative bg-gray-900 border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl shadow-black/50">
            <div className="flex items-center justify-between mb-6">
              <h2 id="new-goal-title" className="text-lg font-semibold text-white flex items-center gap-2">
                <Target className="w-5 h-5 text-emerald-400" />
                Nova Meta
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
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Nome da meta</label>
                <input
                  type="text"
                  placeholder="Ex: Viagem, Carro, Emergência..."
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full bg-gray-800 border border-white/5 rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/30 transition-all"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Valor total (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0,00"
                  value={form.totalAmount}
                  onChange={(e) => setForm({ ...form, totalAmount: e.target.value })}
                  className="w-full bg-gray-800 border border-white/5 rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/30 transition-all"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Data alvo (opcional)</label>
                <input
                  type="date"
                  value={form.targetDate}
                  onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
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
                  {saving ? 'Criando...' : 'Criar Meta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
