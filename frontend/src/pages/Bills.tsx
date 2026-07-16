import { useState, useEffect } from 'react';
import { api } from '../api/client';
import BillForm from '../components/BillForm';
import ConfirmModal from '../components/ConfirmModal';
import { Plus, Check, Trash2, Pencil, X, ChevronDown, Calendar, Clock, CheckCircle2, AlertTriangle, type LucideIcon } from 'lucide-react';
import dayjs from 'dayjs';

interface Bill {
  id: string;
  name: string;
  amount: number;
  dueDate: string;
  isRecurring: boolean;
  isShared: boolean;
  isPaid: boolean;
  person: string | null;
  totalInstallments: number;
  currentInstallment: number;
  category?: { id: string; name: string } | null;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function getPersonLabel(person: string | null): string {
  if (person === 'HUSBAND') return 'Marido';
  if (person === 'WIFE') return 'Esposa';
  if (person === 'COUPLE') return 'Casal';
  return 'Casal';
}

function CustomSelect({ value, onChange, options, icon: Icon }: {
  value: string | number;
  onChange: (v: string | number) => void;
  options: { value: string | number; label: string }[];
  icon?: LucideIcon;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find(o => String(o.value) === String(value));
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 bg-gray-800/50 hover:bg-gray-800 border border-white/5 hover:border-emerald-500/30 rounded-xl px-3 py-2 text-sm text-white transition-all duration-200 min-w-[140px] focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
      >
        {Icon && <Icon className="w-4 h-4 text-gray-400" />}
        <span className="flex-1 text-left">{current?.label || 'Selecione'}</span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 bg-gray-800 border border-white/10 rounded-xl py-1 shadow-xl shadow-black/20 min-w-full max-h-60 overflow-auto">
            {options.map(o => (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-sm transition-colors duration-150 ${String(o.value) === String(value) ? 'bg-emerald-500/10 text-emerald-400' : 'text-gray-300 hover:bg-gray-700/60'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function Bills() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [monthFilter, setMonthFilter] = useState(dayjs().month() + 1);
  const [yearFilter, setYearFilter] = useState(dayjs().year());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<string | string[] | null>(null);
  const [editingAmount, setEditingAmount] = useState<{ id: string; value: string } | null>(null);

  const months = [
    { value: 1, label: 'Janeiro' }, { value: 2, label: 'Fevereiro' }, { value: 3, label: 'Marco' },
    { value: 4, label: 'Abril' }, { value: 5, label: 'Maio' }, { value: 6, label: 'Junho' },
    { value: 7, label: 'Julho' }, { value: 8, label: 'Agosto' }, { value: 9, label: 'Setembro' },
    { value: 10, label: 'Outubro' }, { value: 11, label: 'Novembro' }, { value: 12, label: 'Dezembro' },
  ];

  const currentYear = dayjs().year();
  const years = Array.from({ length: 5 }, (_, i) => currentYear + i);

  async function loadBills() {
    setLoading(true);
    try {
      const data = await api('/api/bills');
      setBills(Array.isArray(data) ? data : []);
    } catch { setBills([]); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadBills(); }, []);

  async function togglePaid(bill: Bill) {
    await api(`/api/bills/${bill.id}`, {
      method: 'PUT',
      body: JSON.stringify({ isPaid: !bill.isPaid }),
    });
    loadBills();
  }

  function handleDeleteRequest(ids: string | string[]) {
    setDeleteTarget(ids);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const ids = Array.isArray(deleteTarget) ? deleteTarget : [deleteTarget];
    for (const id of ids) {
      await api(`/api/bills/${id}`, { method: 'DELETE' });
    }
    setDeleteTarget(null);
    setSelected(new Set());
    loadBills();
  }

  async function handleSave(data: {
    name: string;
    amount: number;
    dueDate: string;
    person?: string | null;
    categoryId?: string | null;
    totalInstallments?: number;
    currentInstallment?: number;
  }) {
    await api('/api/bills', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    setShowForm(false);
    loadBills();
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === filteredBills.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredBills.map(b => b.id)));
    }
  }

  async function handleAmountSave(billId: string) {
    if (!editingAmount) return;
    const newAmount = parseFloat(editingAmount.value);
    if (isNaN(newAmount) || newAmount <= 0) {
      setEditingAmount(null);
      return;
    }
    await api(`/api/bills/${billId}`, {
      method: 'PUT',
      body: JSON.stringify({ amount: newAmount }),
    });
    setEditingAmount(null);
    loadBills();
  }

  const filteredBills = bills.filter((b) => {
    const billMonth = dayjs(b.dueDate).month() + 1;
    const billYear = dayjs(b.dueDate).year();
    return billMonth === monthFilter && billYear === yearFilter;
  });

  const pending = filteredBills.filter((b) => !b.isPaid);
  const paid = filteredBills.filter((b) => b.isPaid);
  const overdue = pending.filter((b) => dayjs(b.dueDate).isBefore(dayjs(), 'day'));

  const totalPending = pending.reduce((sum, b) => sum + b.amount, 0);
  const totalPaid = paid.reduce((sum, b) => sum + b.amount, 0);

  const deleteMessage = Array.isArray(deleteTarget) && deleteTarget.length > 1
    ? `Deseja excluir ${deleteTarget.length} contas selecionadas?`
    : 'Deseja excluir esta conta?';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Contas a Pagar</h1>
          <p className="text-sm text-gray-500 mt-0.5">Gerencie suas contas mensais</p>
        </div>
        <div className="flex gap-2">
          {selected.size > 0 && (
            <button
              onClick={() => handleDeleteRequest(Array.from(selected))}
              className="flex items-center gap-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 hover:text-red-300 px-4 py-2 rounded-xl text-sm transition-all duration-200 hover:scale-[1.02]"
            >
              <Trash2 className="w-4 h-4" /> Excluir ({selected.size})
            </button>
          )}
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-medium px-4 py-2 rounded-xl text-sm transition-all duration-200 hover:scale-[1.02] shadow-lg shadow-emerald-500/20"
          >
            <Plus className="w-4 h-4" /> Nova Conta
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <CustomSelect
          value={monthFilter}
          onChange={(v) => setMonthFilter(Number(v))}
          options={months}
          icon={Calendar}
        />
        <CustomSelect
          value={yearFilter}
          onChange={(v) => setYearFilter(Number(v))}
          options={years.map(y => ({ value: y, label: String(y) }))}
          icon={Calendar}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="relative bg-gray-900/50 border border-white/5 rounded-2xl p-5 overflow-hidden hover:border-white/10 transition-colors duration-200">
          <div className="absolute inset-0 bg-gradient-to-b from-white/[0.03] to-transparent pointer-events-none" />
          <div className="relative">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-400">Total Pendente</p>
              <Clock className="w-4 h-4 text-yellow-400/70" />
            </div>
            <p className="text-2xl font-bold text-yellow-400">{formatCurrency(totalPending)}</p>
            <p className="text-xs text-gray-500 mt-1">{pending.length} conta(s)</p>
          </div>
        </div>
        <div className="relative bg-gray-900/50 border border-white/5 rounded-2xl p-5 overflow-hidden hover:border-white/10 transition-colors duration-200">
          <div className="absolute inset-0 bg-gradient-to-b from-white/[0.03] to-transparent pointer-events-none" />
          <div className="relative">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-400">Total Pago</p>
              <CheckCircle2 className="w-4 h-4 text-emerald-400/70" />
            </div>
            <p className="text-2xl font-bold text-emerald-400">{formatCurrency(totalPaid)}</p>
            <p className="text-xs text-gray-500 mt-1">{paid.length} conta(s)</p>
          </div>
        </div>
        <div className="relative bg-gray-900/50 border border-white/5 rounded-2xl p-5 overflow-hidden hover:border-white/10 transition-colors duration-200">
          <div className="absolute inset-0 bg-gradient-to-b from-white/[0.03] to-transparent pointer-events-none" />
          <div className="relative">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-400">Vencidas</p>
              <AlertTriangle className="w-4 h-4 text-red-400/70" />
            </div>
            <p className="text-2xl font-bold text-red-400">{overdue.length}</p>
            <p className="text-xs text-gray-500 mt-1">contas atrasadas</p>
          </div>
        </div>
      </div>

      {overdue.length > 0 && (
        <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400" />
          <p className="text-red-400 font-medium text-sm">{overdue.length} conta(s) vencida(s)</p>
        </div>
      )}

      <div className="relative bg-gray-900/50 border border-white/5 rounded-2xl overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none" />
        <div className="relative">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400" />
            </div>
          ) : filteredBills.length === 0 ? (
            <p className="text-gray-500 text-center py-12">Nenhuma conta cadastrada neste mes</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-white/5">
                    <th className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={selected.size === filteredBills.length && filteredBills.length > 0}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 accent-emerald-500 cursor-pointer"
                      />
                    </th>
                    <th className="px-4 py-3 font-medium">Nome</th>
                    <th className="px-4 py-3 font-medium">Valor</th>
                    <th className="px-4 py-3 font-medium">Vencimento</th>
                    <th className="px-4 py-3 font-medium">Responsavel</th>
                    <th className="px-4 py-3 font-medium">Parcelas</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {[...pending, ...paid].map((b) => {
                    const isOverdue = !b.isPaid && dayjs(b.dueDate).isBefore(dayjs(), 'day');
                    const isSelected = selected.has(b.id);
                    const isEditing = editingAmount?.id === b.id;
                    return (
                      <tr key={b.id} className={`border-b border-white/[0.03] transition-colors duration-150 hover:bg-white/[0.02] ${isSelected ? 'bg-emerald-500/[0.07]' : ''}`}>
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(b.id)}
                            className="w-4 h-4 accent-emerald-500 cursor-pointer"
                          />
                        </td>
                        <td className="px-4 py-3 text-white">
                          <div className="flex items-center gap-2">
                            <span className={b.isPaid ? 'line-through text-gray-500' : ''}>{b.name}</span>
                            {b.category && <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-gray-400">{b.category.name}</span>}
                            {b.isRecurring && <span className="text-xs text-gray-500">recorrente</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-white font-medium">
                          {isEditing ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                step="0.01"
                                min="0.01"
                                value={editingAmount.value}
                                onChange={(e) => setEditingAmount({ id: b.id, value: e.target.value })}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleAmountSave(b.id); if (e.key === 'Escape') setEditingAmount(null); }}
                                autoFocus
                                className="w-28 bg-gray-800 border border-white/10 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                              />
                              <button onClick={() => handleAmountSave(b.id)} className="p-1 text-emerald-400 hover:text-emerald-300 rounded hover:bg-emerald-500/10 transition-colors"><Check className="w-4 h-4" /></button>
                              <button onClick={() => setEditingAmount(null)} className="p-1 text-gray-400 hover:text-red-400 rounded hover:bg-red-500/10 transition-colors"><X className="w-4 h-4" /></button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setEditingAmount({ id: b.id, value: String(b.amount) })}
                              className="hover:text-emerald-400 transition-colors group"
                              title="Editar valor"
                            >
                              {formatCurrency(b.amount)}
                              <Pencil className="w-3 h-3 inline ml-2 opacity-0 group-hover:opacity-50 transition-opacity" />
                            </button>
                          )}
                        </td>
                        <td className={`px-4 py-3 ${isOverdue ? 'text-red-400' : 'text-gray-400'}`}>
                          {dayjs(b.dueDate).format('DD/MM/YYYY')}
                        </td>
                        <td className="px-4 py-3 text-gray-400">{getPersonLabel(b.person)}</td>
                        <td className="px-4 py-3 text-gray-400">
                          {b.totalInstallments > 1 ? `${b.currentInstallment}/${b.totalInstallments}` : '-'}
                        </td>
                        <td className="px-4 py-3">
                          {b.isPaid ? (
                            <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-[0_0_8px_-2px_rgba(16,185,129,0.3)]">Pago</span>
                          ) : isOverdue ? (
                            <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 shadow-[0_0_8px_-2px_rgba(239,68,68,0.3)]">Vencido</span>
                          ) : (
                            <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 shadow-[0_0_8px_-2px_rgba(234,179,8,0.3)]">Pendente</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {!b.isPaid && (
                              <button onClick={() => togglePaid(b)} className="p-1.5 hover:bg-emerald-500/10 rounded-lg text-gray-400 hover:text-emerald-400 transition-colors" title="Marcar como pago">
                                <Check className="w-4 h-4" />
                              </button>
                            )}
                            <button onClick={() => handleDeleteRequest(b.id)} className="p-1.5 hover:bg-red-500/10 rounded-lg text-gray-400 hover:text-red-400 transition-colors">
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
          )}
        </div>
      </div>

      {showForm && <BillForm onSave={handleSave} onClose={() => setShowForm(false)} />}

      {deleteTarget && (
        <ConfirmModal
          title="Excluir conta(s)"
          message={deleteMessage}
          confirmLabel="Excluir"
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
