import { useState, useMemo, useEffect, useCallback } from 'react';
import { useTransactions, type Transaction } from '../hooks/useTransactions';
import TransactionForm from '../components/TransactionForm';
import FileImport from '../components/FileImport';
import ConfirmModal from '../components/ConfirmModal';
import { api, DATA_CHANGED_EVENT } from '../api/client';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { Plus, Upload, Pencil, Trash2, Search, Check, X, ChevronDown, Calendar, Filter, Users, CreditCard, ArrowUpDown, TrendingUp, HelpCircle, type LucideIcon } from 'lucide-react';
import dayjs from 'dayjs';
import { useOnboarding } from '../hooks/useOnboarding';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

const personLabel: Record<string, string> = { HUSBAND: 'Marido', WIFE: 'Esposa', COUPLE: 'Casal' };
const typeLabel: Record<string, string> = { EXPENSE: 'Despesa', INCOME: 'Receita' };

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
        className="flex items-center gap-2 bg-gray-800/50 hover:bg-gray-800 border border-white/5 hover:border-emerald-500/30 rounded-xl px-3 py-2 text-sm text-white transition-all duration-200 min-w-[150px] focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
      >
        {Icon && <Icon className="w-4 h-4 text-gray-400" />}
        <span className="flex-1 text-left">{current?.label || 'Selecione'}</span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-50 mt-1 bg-gray-800 border border-white/10 rounded-xl py-1 shadow-xl shadow-black/20 min-w-full max-h-60 overflow-auto">
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

export default function Transactions() {
  // ── Onboarding interativo (primeira visita) ──
  useOnboarding('transactions', [
    { target: '.iasconta-group-cards', title: 'Gastos agrupados', description: 'As despesas aparecem agrupadas por cartão (fatura do ciclo) e por forma de pagamento no débito. Clique num grupo para filtrar a lista só com ele.' },
    { target: '.iasconta-receitas-group', title: 'Grupo Receitas', description: 'Suas entradas ficam reunidas no grupo Receitas, com total e lançamentos do período.' },
    { target: '.iasconta-bulk-actions', title: 'Seleção múltipla', description: 'Marque as caixas de seleção das transações e use o botão Excluir que aparece aqui para remover várias de uma vez.' },
    { target: '.iasconta-tx-amount', title: 'Edição inline', description: 'Clicar no valor abre a edição na hora: digite o novo valor e pressione Enter. Transações importadas editadas ficam protegidas da sincronização do Open Finance.' },
  ]);

  const [month, setMonth] = useState(dayjs().format('YYYY-MM'));
  const [categoryId, setCategoryId] = useState('');
  const [person, setPerson] = useState('');
  const [type, setType] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [search, setSearch] = useState('');

  const filters = useMemo(() => ({
    month: month || undefined,
    categoryId: categoryId || undefined,
    person: person || undefined,
    type: type || undefined,
    paymentMethod: paymentMethod || undefined,
  }), [month, categoryId, person, type, paymentMethod]);

  const { transactions, loading, create, update, remove, refresh } = useTransactions(filters);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<string | string[] | null>(null);
  const [editingAmount, setEditingAmount] = useState<{ id: string; value: string } | null>(null);

  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set([]));
  const [cardCycles, setCardCycles] = useState<any[]>([]);

  // Prompt de revisão de salário: TED de salário com valor diferente da
  // Rendas Fixas configurada. O usuário decide se atualiza o mês vigente.
  const salaryReview = useMemo(
    () => transactions.filter((t) => (t as any).salaryReviewPending),
    [transactions]
  );
  const [salaryUpdating, setSalaryUpdating] = useState(false);

  async function updateSalaryFromReview(id: string, novoValor: number) {
    try {
      setSalaryUpdating(true);
      await api(`/api/transactions/${id}/salary-review`, {
        method: 'POST',
        body: JSON.stringify({ action: 'update', amount: novoValor }),
      });
      await refresh();
    } catch (e: any) {
      alert(e.message || 'Erro ao atualizar salário');
    } finally {
      setSalaryUpdating(false);
    }
  }

  async function dismissSalaryReview(id: string) {
    try {
      await api(`/api/transactions/${id}/salary-review`, {
        method: 'POST',
        body: JSON.stringify({ action: 'dismiss' }),
      });
      await refresh();
    } catch (e: any) {
      alert(e.message || 'Erro');
    }
  }


  const filtered = useMemo(() => {
    if (!search) return transactions;
    const q = search.toLowerCase();
    return transactions.filter((t) =>
      t.description.toLowerCase().includes(q) ||
      (t.categoryName || '').toLowerCase().includes(q)
    );
  }, [transactions, search]);

  // ── Agrupadores: cartões/contas (Pluggy) + formas de pagamento (débito) + casal ──
  const grouped = useMemo(() => {
    const cartões: Record<string, { total: number; count: number }> = {};
    const formas: Record<string, { total: number; count: number }> = {};
    for (const t of filtered) {
      if (t.type !== 'EXPENSE') continue;
      if (t.isCreditCard) {
        const k = t.paymentMethod || 'Cartao';
        cartões[k] = cartões[k] || { total: 0, count: 0 };
        cartões[k].total += Math.abs(t.amount);
        cartões[k].count += 1;
      } else {
        const k = t.paymentMethod ? t.paymentMethod.toUpperCase() : 'DINHEIRO';
        formas[k] = formas[k] || { total: 0, count: 0 };
        formas[k].total += Math.abs(t.amount);
        formas[k].count += 1;
      }
    }
    const desc = (t: Transaction) => (t.description || '').toLowerCase();
    const ehTransferencia = (t: Transaction) => /transfer|pix|ted/.test(desc(t));
    const ehCasal = (t: Transaction) => /eduarda|jesiel/.test(desc(t)) || t.person === 'WIFE';
    const casal = filtered.filter((t) => t.type === 'EXPENSE' && ehTransferencia(t) && ehCasal(t));
    // Lançamentos manuais/legados SEM forma de pagamento não podem ficar
    // invisíveis na listagem: caem no grupo "Outros" (exceto os já mostrados
    // em "Transferências entre o casal").
    const idsCasal = new Set(casal.map((t) => t.id));
    const outros = filtered
      .filter((t) => t.type === 'EXPENSE' && !t.paymentMethod && !idsCasal.has(t.id))
      .slice()
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const receitas = filtered
      .filter((t) => t.type === 'INCOME')
      .slice()
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return {
      cartões: Object.entries(cartões).sort((a, b) => b[1].total - a[1].total),
      formas: Object.entries(formas).sort((a, b) => b[1].total - a[1].total),
      casal,
      receitas,
      outros,
    };
  }, [filtered]);

  const groupTxs = (key: string): Transaction[] => {
    if (!filtered.length) return [];
    if (key.startsWith('cc-')) {
      const id = key.slice(3);
      const found = cardCycles.find((cc) => (cc.id || cc.paymentMethod || '') === id);
      const listCC: any[] = found ? (found.txs || []) : [];
      return listCC.slice().sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
    if (key.startsWith('fp-')) {
      const name = key.slice(3);
      const list = filtered.filter((t) => t.type === 'EXPENSE' && !t.isCreditCard && (t.paymentMethod ? t.paymentMethod.toUpperCase() : 'DINHEIRO') === name);
      return list.slice().sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
    if (key.startsWith('rec-')) {
      return filtered
        .filter((t) => t.type === 'INCOME')
        .slice()
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
    if (key.startsWith('outros-')) {
      const idsCasal = new Set(grouped.casal.map((t) => t.id));
      return filtered
        .filter((t) => t.type === 'EXPENSE' && !t.paymentMethod && !idsCasal.has(t.id))
        .slice()
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
    return [];
  };

  const visibleRows = useMemo(() => {
    if (!groupFilter) return filtered;
    return filtered.filter((t) => groupTxs(groupFilter).some((g) => g.id === t.id));
  }, [filtered, groupFilter]);

  function handleEdit(tx: Transaction) {
    setEditing(tx);
    setShowForm(true);
  }

  function handleSave(data: Omit<Transaction, 'id' | 'categoryName'>) {
    if (editing) update(editing.id, data);
    else create(data);
    setShowForm(false);
    setEditing(null);
  }

  function handleDeleteRequest(ids: string | string[]) {
    setDeleteTarget(ids);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const ids = Array.isArray(deleteTarget) ? deleteTarget : [deleteTarget];
    for (const id of ids) {
      try {
        await remove(id);
      } catch {
        // ignora erro de item individual (ex.: já removido em cascata)
      }
    }
    setDeleteTarget(null);
    setSelected(new Set());
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
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visibleRows.map(t => t.id)));
    }
  }

  async function handleAmountSave(txId: string) {
    if (!editingAmount) return;
    const newAmount = parseFloat(editingAmount.value);
    if (isNaN(newAmount) || newAmount <= 0) {
      setEditingAmount(null);
      return;
    }
    const tx = transactions.find(t => t.id === txId);
    if (tx) {
      await update(txId, { ...tx, amount: newAmount });
    }
    setEditingAmount(null);
  }

  const deleteMessage = Array.isArray(deleteTarget) && deleteTarget.length > 1
    ? `Deseja excluir ${deleteTarget.length} transações selecionadas?`
    : 'Deseja excluir esta transação?';

  const typeOptions = [
    { value: '', label: 'Todos os tipos' },
    { value: 'INCOME', label: 'Receitas' },
    { value: 'EXPENSE', label: 'Despesas' },
  ];

  const personOptions = [
    { value: '', label: 'Todas as pessoas' },
    { value: 'HUSBAND', label: 'Marido' },
    { value: 'WIFE', label: 'Esposa' },
    { value: 'COUPLE', label: 'Casal' },
  ];

  const [paymentMethods, setPaymentMethods] = useState<{ name: string; type: string }[]>([]);

  useEffect(() => {
    api('/api/payment-methods')
      .then((data) => setPaymentMethods(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const fetchCardCycles = useCallback(async () => {
    try {
      const data = await api(`/api/transactions/card-cycle?month=${month}`);
      setCardCycles(Array.isArray(data) ? data : []);
    } catch {
      setCardCycles([]);
    }
  }, [month]);

  useAutoRefresh(fetchCardCycles, [month]);

  const paymentOptions = useMemo(() => [
    { value: '', label: 'Todos os pagamentos' },
    ...paymentMethods.map((m) => ({
      value: m.name,
      label: `${m.name}${m.type === 'CARD' ? ' (Cartão)' : ''}`,
    })),
  ], [paymentMethods]);

  return (
    <div className="space-y-6">
      {salaryReview.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
          <p className="text-sm text-amber-200 font-medium">
            A TED de salário veio com valor diferente da sua Rendas Fixas. Deseja atualizar o mês vigente?
          </p>
          {salaryReview.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-gray-300">{dayjs(t.date).format('DD/MM')} · {formatCurrency(Math.abs(t.amount))}</span>
              <button
                disabled={salaryUpdating}
                onClick={() => updateSalaryFromReview(t.id, Math.abs(t.amount))}
                className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 text-xs font-medium transition-colors disabled:opacity-50"
              >
                Atualizar renda fixa p/ {formatCurrency(Math.abs(t.amount))}
              </button>
              <button
                onClick={() => dismissSalaryReview(t.id)}
                className="px-3 py-1.5 rounded-lg bg-white/5 text-gray-400 hover:bg-white/10 text-xs font-medium transition-colors"
              >
                Manter atual
              </button>
            </div>
          ))}
        </div>
      )}
      <style>{`@keyframes dropExpand { from { opacity: 0; transform: translateY(-12px) translateX(-7px); } to { opacity: 1; transform: translateY(0px) translateX(0px); } }`}</style>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Transações</h1>
          <p className="text-sm text-gray-500 mt-0.5">Gerencie suas receitas e despesas</p>
        </div>
        <div className="flex gap-2">
          {selected.size > 0 && (
            <button
              onClick={() => handleDeleteRequest(Array.from(selected))}
              className="flex items-center gap-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 hover:text-red-300 px-4 py-2 rounded-xl text-sm transition-all duration-200 hover:scale-[1.02] iasconta-bulk-actions"
            >
              <Trash2 className="w-4 h-4" /> Excluir ({selected.size})
            </button>
          )}
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 bg-gray-800/50 hover:bg-gray-800 border border-white/5 hover:border-white/10 text-gray-300 px-4 py-2 rounded-xl text-sm transition-all duration-200 hover:scale-[1.02]"
          >
            <Upload className="w-4 h-4" /> Importar
          </button>
          <button
            onClick={() => { setEditing(null); setShowForm(true); }}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-medium px-4 py-2 rounded-xl text-sm transition-all duration-200 hover:scale-[1.02] shadow-lg shadow-emerald-500/20"
          >
            <Plus className="w-4 h-4" /> Nova Transacao
          </button>
        </div>
      </div>

      <div className="relative bg-gray-900/50 border border-white/5 rounded-2xl p-4">
        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none" />
        <div className="relative flex flex-wrap gap-3 items-center">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none z-10" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar..."
              className="bg-gray-800/50 hover:bg-gray-800 border border-white/5 hover:border-emerald-500/30 rounded-xl pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 w-48 transition-all duration-200"
            />
          </div>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none z-10" />
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="bg-gray-800/50 hover:bg-gray-800 border border-white/5 hover:border-emerald-500/30 rounded-xl pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40 [color-scheme:dark] transition-all duration-200"
            />
          </div>
          <CustomSelect
            value={type}
            onChange={(v) => setType(String(v))}
            options={typeOptions}
            icon={Filter}
          />
          <CustomSelect
            value={person}
            onChange={(v) => setPerson(String(v))}
            options={personOptions}
            icon={Users}
          />
          <CustomSelect
            value={paymentMethod}
            onChange={(v) => setPaymentMethod(String(v))}
            options={paymentOptions}
          />
          {(month || categoryId || person || type || paymentMethod) && (
            <button
              onClick={() => { setMonth(''); setCategoryId(''); setPerson(''); setType(''); setPaymentMethod(''); }}
              className="text-sm text-gray-400 hover:text-emerald-400 transition-colors px-2"
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {(grouped.cartões.length > 0 || grouped.formas.length > 0 || grouped.casal.length > 0 || grouped.receitas.length > 0 || grouped.outros.length > 0) && (
        <div className="space-y-4">
          <div className="space-y-3">
            {cardCycles.map((c, i) => {
              const key = 'cc-' + (c.id || c.pluggyAccountId || c.paymentMethod);
              const open = expandedGroups.has(key);
              const ativo = groupFilter === key;
              const nome = (c.paymentMethod || 'Cartão');
              const período = c.invoiceMonth
                ? (() => { const [yy, mm] = c.invoiceMonth.split('-'); return `${mm}/${yy}`; })()
                : (c.start && c.end ? dayjs(c.start).format('DD/MM') + ' – ' + dayjs(c.end).format('DD/MM') : '');
              const qtde = (c.txs || []).length;
              return (
                <div key={key} className={`relative bg-gray-900/50 border rounded-2xl p-4 overflow-hidden transition-all duration-200 iasconta-group-cards ${ativo ? 'border-emerald-500/40 ring-1 ring-emerald-500/20' : 'border-white/5'}`}>
                  <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none" />
                  <button
                    onClick={() => {
                      setExpandedGroups((prev) => {
                        if (prev.has(key)) return new Set([]);
                        return new Set([key]);
                      });
                      setGroupFilter((f) => (ativo ? null : key));
                    }}
                    className="relative w-full flex items-center justify-between text-left gap-3 group"
                  >
                    <span className="flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-violet-300" />
                      <span className="text-sm font-semibold text-white uppercase tracking-wide">{nome}</span>
                      <span className="text-[10px] bg-violet-500/10 text-violet-300 border border-violet-500/20 px-1.5 py-0.5 rounded-full">Fatura</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-right">
                        <span className="block text-base font-bold text-white">{formatCurrency(c.total || 0)}</span>
                        <span className="block text-[11px] text-gray-500">ciclo {período} · {qtde} compras</span>
                      </span>
                      <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
                    </span>
                  </button>
                {open && (
                  <div className="relative overflow-x-auto mt-3 pt-3 border-t border-white/[0.06]" style={{ animation: 'dropExpand 0.3s cubic-bezier(.22,.9,.32,1) both' }}>
                    {groupTxs(key).length === 0 ? (
                      <p className="text-gray-500 text-sm py-3">Nenhum lançamento neste filtro</p>
                    ) : (
                      <table className="w-full text-sm min-w-[720px]">
                        <thead>
                          <tr className="text-left text-gray-400 border-b border-white/5">
                            <th className="px-3 py-2 w-8"></th>
                            <th className="px-3 py-2 font-medium">Data</th>
                            <th className="px-3 py-2 font-medium">Descrição</th>
                            <th className="px-3 py-2 font-medium">Categoria</th>
                            <th className="px-3 py-2 font-medium">Pagamento</th>
                            <th className="px-3 py-2 font-medium">Pessoa</th>
                            <th className="px-3 py-2 font-medium">Parcelas</th>
                            <th className="px-3 py-2 font-medium">Tipo</th>
                            <th className="px-3 py-2 font-medium text-right">Valor</th>
                            <th className="px-3 py-2 font-medium text-right">Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {groupTxs(key).map((t) => (
                            <tr key={t.id} className="border-b border-white/[0.03] transition-colors duration-150 hover:bg-white/[0.02]">
                              <td className="px-3 py-2">
                                <label className="inline-flex items-center cursor-pointer relative">
                        <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)} className="peer sr-only" />
                        <span className={`flex h-4 w-4 items-center justify-center rounded-md border transition-all duration-150 ${selected.has(t.id) ? 'bg-emerald-500 border-emerald-500 shadow-[0_0_8px_-2px_rgba(16,185,129,0.6)]' : 'bg-gray-900/60 border-gray-600 hover:border-emerald-400/60'}`}>
                          {selected.has(t.id) && <Check className="w-3 h-3 text-gray-950" strokeWidth={3} />}
                        </span>
                      </label>
                              </td>
                              <td className="px-3 py-2 text-gray-400">{dayjs(t.date).format('DD/MM/YYYY')}</td>
                              <td className="px-3 py-2 text-white">{t.description}</td>
                              <td className="px-3 py-2">
                                {t.categoryName ? (
                                  <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-white/5 text-gray-300">{t.categoryName}</span>
                                ) : (
                                  <span className="text-gray-500">-</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-gray-400">
                                {t.paymentMethod || '-'}
                                {t.isCreditCard && (
                                  <span className="ml-2 inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-500/10 text-violet-300 border border-violet-500/20">Cartão</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-gray-400">{personLabel[t.person || ''] || t.person}</td>
                              <td className="px-3 py-2 text-gray-400">
                                {t.totalInstallments && t.totalInstallments > 1
                                  ? `${t.currentInstallment || 1}/${t.totalInstallments}`
                                  : '-'}
                              </td>
                              <td className="px-3 py-2">
                                <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border ${t.type === 'INCOME' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                                  {typeLabel[t.type] || t.type}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right font-medium text-red-400">
                                {editingAmount?.id === t.id ? (
                                  <div className="flex items-center justify-end gap-1">
                                    <input type="number" step="0.01" min="0.01" value={editingAmount.value} onChange={(e) => setEditingAmount({ id: t.id, value: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') handleAmountSave(t.id); if (e.key === 'Escape') setEditingAmount(null); }} autoFocus className="w-24 bg-gray-800 border border-white/10 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50" />
                                    <button onClick={() => handleAmountSave(t.id)} className="p-1 text-emerald-400 hover:text-emerald-300 rounded hover:bg-emerald-500/10 transition-colors"><Check className="w-4 h-4" /></button>
                                    <button onClick={() => setEditingAmount(null)} className="p-1 text-gray-400 hover:text-red-400 rounded hover:bg-red-500/10 transition-colors"><X className="w-4 h-4" /></button>
                                  </div>
                                ) : (
                                  <button onClick={() => setEditingAmount({ id: t.id, value: String(t.amount) })} className="hover:text-emerald-400 transition-colors iasconta-tx-amount">
                                    {formatCurrency(Math.abs(t.amount))}
                                  </button>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <button onClick={() => handleEdit(t)} className="p-1.5 hover:bg-white/5 rounded-lg text-gray-400 hover:text-white transition-colors"><Pencil className="w-4 h-4" /></button>
                                  <button onClick={() => handleDeleteRequest(t.id)} className="p-1.5 hover:bg-red-500/10 rounded-lg text-gray-400 hover:text-red-400 transition-colors"><Trash2 className="w-4 h-4" /></button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
                </div>
              );
            })}

          </div>
          <div className="space-y-3">
            {grouped.formas.map(([nome, g]) => {
              const key = 'fp-' + nome;
              const open = expandedGroups.has(key);
              const ativo = groupFilter === key;
              return (
              <div key={key} className={`relative bg-gray-900/50 border rounded-2xl p-4 overflow-hidden transition-all duration-200 ${ativo ? 'border-emerald-500/40 ring-1 ring-emerald-500/20' : 'border-white/5'}`}>
                <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none" />
                <button
                  onClick={() => {
                    setExpandedGroups((prev) => {
                      if (prev.has(key)) return new Set([]);
                      return new Set([key]);
                    });
                    setGroupFilter((f) => (ativo ? null : key));
                  }}
                  className="relative w-full flex items-center justify-between text-left gap-3 group"
                >
                  <span className="flex items-center gap-2">
                    <ArrowUpDown className="w-4 h-4 text-emerald-300" />
                    <span className="text-sm font-semibold text-white uppercase tracking-wide">{nome}</span>
                    <span className="text-[10px] bg-white/5 text-gray-300 border border-white/10 px-1.5 py-0.5 rounded-full">Débito</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-right">
                      <span className="block text-base font-bold text-white">{formatCurrency(g.total)}</span>
                      <span className="block text-[11px] text-gray-500">{g.count} lançamento(s)</span>
                    </span>
                    <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
                  </span>
                </button>
                {open && (
                  <div className="relative overflow-x-auto mt-3 pt-3 border-t border-white/[0.06]" style={{ animation: 'dropExpand 0.3s cubic-bezier(.22,.9,.32,1) both' }}>
                    {groupTxs(key).length === 0 ? (
                      <p className="text-gray-500 text-sm py-3">Nenhum lançamento neste filtro</p>
                    ) : (
                      <table className="w-full text-sm min-w-[720px]">
                        <thead>
                          <tr className="text-left text-gray-400 border-b border-white/5">
                            <th className="px-3 py-2 w-8"></th>
                            <th className="px-3 py-2 font-medium">Data</th>
                            <th className="px-3 py-2 font-medium">Descrição</th>
                            <th className="px-3 py-2 font-medium">Categoria</th>
                            <th className="px-3 py-2 font-medium">Pagamento</th>
                            <th className="px-3 py-2 font-medium">Pessoa</th>
                            <th className="px-3 py-2 font-medium">Parcelas</th>
                            <th className="px-3 py-2 font-medium">Tipo</th>
                            <th className="px-3 py-2 font-medium text-right">Valor</th>
                            <th className="px-3 py-2 font-medium text-right">Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {groupTxs(key).map((t) => (
                            <tr key={t.id} className="border-b border-white/[0.03] transition-colors duration-150 hover:bg-white/[0.02]">
                              <td className="px-3 py-2">
                                <label className="inline-flex items-center cursor-pointer relative">
                        <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)} className="peer sr-only" />
                        <span className={`flex h-4 w-4 items-center justify-center rounded-md border transition-all duration-150 ${selected.has(t.id) ? 'bg-emerald-500 border-emerald-500 shadow-[0_0_8px_-2px_rgba(16,185,129,0.6)]' : 'bg-gray-900/60 border-gray-600 hover:border-emerald-400/60'}`}>
                          {selected.has(t.id) && <Check className="w-3 h-3 text-gray-950" strokeWidth={3} />}
                        </span>
                      </label>
                              </td>
                              <td className="px-3 py-2 text-gray-400">{dayjs(t.date).format('DD/MM/YYYY')}</td>
                              <td className="px-3 py-2 text-white">{t.description}</td>
                              <td className="px-3 py-2">
                                {t.categoryName ? (
                                  <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-white/5 text-gray-300">{t.categoryName}</span>
                                ) : (
                                  <span className="text-gray-500">-</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-gray-400">
                                {t.paymentMethod || '-'}
                                {t.isCreditCard && (
                                  <span className="ml-2 inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-500/10 text-violet-300 border border-violet-500/20">Cartão</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-gray-400">{personLabel[t.person || ''] || t.person}</td>
                              <td className="px-3 py-2 text-gray-400">
                                {t.totalInstallments && t.totalInstallments > 1
                                  ? `${t.currentInstallment || 1}/${t.totalInstallments}`
                                  : '-'}
                              </td>
                              <td className="px-3 py-2">
                                <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border ${t.type === 'INCOME' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                                  {typeLabel[t.type] || t.type}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right font-medium text-red-400">
                                {editingAmount?.id === t.id ? (
                                  <div className="flex items-center justify-end gap-1">
                                    <input type="number" step="0.01" min="0.01" value={editingAmount.value} onChange={(e) => setEditingAmount({ id: t.id, value: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') handleAmountSave(t.id); if (e.key === 'Escape') setEditingAmount(null); }} autoFocus className="w-24 bg-gray-800 border border-white/10 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50" />
                                    <button onClick={() => handleAmountSave(t.id)} className="p-1 text-emerald-400 hover:text-emerald-300 rounded hover:bg-emerald-500/10 transition-colors"><Check className="w-4 h-4" /></button>
                                    <button onClick={() => setEditingAmount(null)} className="p-1 text-gray-400 hover:text-red-400 rounded hover:bg-red-500/10 transition-colors"><X className="w-4 h-4" /></button>
                                  </div>
                                ) : (
                                  <button onClick={() => setEditingAmount({ id: t.id, value: String(t.amount) })} className="hover:text-emerald-400 transition-colors iasconta-tx-amount">
                                    {formatCurrency(Math.abs(t.amount))}
                                  </button>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <button onClick={() => handleEdit(t)} className="p-1.5 hover:bg-white/5 rounded-lg text-gray-400 hover:text-white transition-colors"><Pencil className="w-4 h-4" /></button>
                                  <button onClick={() => handleDeleteRequest(t.id)} className="p-1.5 hover:bg-red-500/10 rounded-lg text-gray-400 hover:text-red-400 transition-colors"><Trash2 className="w-4 h-4" /></button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
              );
            })}
          </div>
          {grouped.receitas.length > 0 && (
            <div className="space-y-3">
              {(() => {
                const key = 'rec-todas';
                const open = expandedGroups.has(key);
                const ativo = groupFilter === key;
                const total = grouped.receitas.reduce((sum, t) => sum + Math.abs(t.amount), 0);
                return (
              <div key={key} className={`relative bg-gray-900/50 border rounded-2xl p-4 overflow-hidden transition-all duration-200 iasconta-receitas-group ${ativo ? 'border-emerald-500/40 ring-1 ring-emerald-500/20' : 'border-white/5'}`}>
                <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none" />
                <button
                  onClick={() => {
                    setExpandedGroups((prev) => {
                      if (prev.has(key)) return new Set([]);
                      return new Set([key]);
                    });
                    setGroupFilter((f) => (ativo ? null : key));
                  }}
                  className="relative w-full flex items-center justify-between text-left gap-3 group"
                >
                  <span className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-emerald-300" />
                    <span className="text-sm font-semibold text-white uppercase tracking-wide">Receitas</span>
                    <span className="text-[10px] bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 px-1.5 py-0.5 rounded-full">Entradas</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-right">
                      <span className="block text-base font-bold text-emerald-400">{formatCurrency(total)}</span>
                      <span className="block text-[11px] text-gray-500">{grouped.receitas.length} lançamento(s)</span>
                    </span>
                    <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
                  </span>
                </button>
                {open && (
                  <div className="relative overflow-x-auto mt-3 pt-3 border-t border-white/[0.06]" style={{ animation: 'dropExpand 0.3s cubic-bezier(.22,.9,.32,1) both' }}>
                    {groupTxs(key).length === 0 ? (
                      <p className="text-gray-500 text-sm py-3">Nenhum lançamento neste filtro</p>
                    ) : (
                      <table className="w-full text-sm min-w-[720px]">
                        <thead>
                          <tr className="text-left text-gray-400 border-b border-white/5">
                            <th className="px-3 py-2 w-8"></th>
                            <th className="px-3 py-2 font-medium">Data</th>
                            <th className="px-3 py-2 font-medium">Descrição</th>
                            <th className="px-3 py-2 font-medium">Categoria</th>
                            <th className="px-3 py-2 font-medium">Origem</th>
                            <th className="px-3 py-2 font-medium">Pessoa</th>
                            <th className="px-3 py-2 font-medium text-right">Valor</th>
                            <th className="px-3 py-2 font-medium text-right">Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {groupTxs(key).map((t) => (
                            <tr key={t.id} className="border-b border-white/[0.03] transition-colors duration-150 hover:bg-white/[0.02]">
                              <td className="px-3 py-2">
                                <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)} className="w-4 h-4 accent-emerald-500 cursor-pointer" />
                              </td>
                              <td className="px-3 py-2 text-gray-400">{dayjs(t.date).format('DD/MM/YYYY')}</td>
                              <td className="px-3 py-2 text-white">{t.description}</td>
                              <td className="px-3 py-2">
                                {t.categoryName ? (
                                  <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-white/5 text-gray-300">{t.categoryName}</span>
                                ) : (
                                  <span className="text-gray-500">-</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-gray-400">{t.source || '-'}</td>
                              <td className="px-3 py-2 text-gray-400">{personLabel[t.person || ''] || t.person}</td>
                              <td className="px-3 py-2 text-right font-medium text-emerald-400">+{formatCurrency(Math.abs(t.amount))}</td>
                              <td className="px-3 py-2 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <button onClick={() => handleEdit(t)} className="p-1.5 hover:bg-white/5 rounded-lg text-gray-400 hover:text-white transition-colors" title="Editar"><Pencil className="w-4 h-4" /></button>
                                  <button onClick={() => handleDeleteRequest(t.id)} className="p-1.5 hover:bg-red-500/10 rounded-lg text-gray-400 hover:text-red-400 transition-colors" title="Remover"><Trash2 className="w-4 h-4" /></button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
                );
              })()}
            </div>
          )}

          {grouped.outros.length > 0 && (
            <div className="space-y-3">
              {(() => {
                const key = 'outros-sem-pagamento';
                const open = expandedGroups.has(key);
                const ativo = groupFilter === key;
                const total = grouped.outros.reduce((sum, t) => sum + Math.abs(t.amount), 0);
                return (
              <div key={key} className={`relative bg-gray-900/50 border rounded-2xl p-4 overflow-hidden transition-all duration-200 ${ativo ? 'border-emerald-500/40 ring-1 ring-emerald-500/20' : 'border-white/5'}`}>
                <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none" />
                <button
                  onClick={() => {
                    setExpandedGroups((prev) => {
                      if (prev.has(key)) return new Set([]);
                      return new Set([key]);
                    });
                    setGroupFilter((f) => (ativo ? null : key));
                  }}
                  className="relative w-full flex items-center justify-between text-left gap-3 group"
                >
                  <span className="flex items-center gap-2">
                    <HelpCircle className="w-4 h-4 text-amber-300" />
                    <span className="text-sm font-semibold text-white uppercase tracking-wide">Outros</span>
                    <span className="text-[10px] bg-amber-500/10 text-amber-300 border border-amber-500/20 px-1.5 py-0.5 rounded-full">Sem pagamento</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-right">
                      <span className="block text-base font-bold text-white">{formatCurrency(total)}</span>
                      <span className="block text-[11px] text-gray-500">{grouped.outros.length} lançamento(s)</span>
                    </span>
                    <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
                  </span>
                </button>
                {open && (
                  <div className="relative overflow-x-auto mt-3 pt-3 border-t border-white/[0.06]" style={{ animation: 'dropExpand 0.3s cubic-bezier(.22,.9,.32,1) both' }}>
                    {groupTxs(key).length === 0 ? (
                      <p className="text-gray-500 text-sm py-3">Nenhum lançamento neste filtro</p>
                    ) : (
                      <table className="w-full text-sm min-w-[720px]">
                        <thead>
                          <tr className="text-left text-gray-400 border-b border-white/5">
                            <th className="px-3 py-2 w-8"></th>
                            <th className="px-3 py-2 font-medium">Data</th>
                            <th className="px-3 py-2 font-medium">Descrição</th>
                            <th className="px-3 py-2 font-medium">Categoria</th>
                            <th className="px-3 py-2 font-medium">Pessoa</th>
                            <th className="px-3 py-2 font-medium">Tipo</th>
                            <th className="px-3 py-2 font-medium text-right">Valor</th>
                            <th className="px-3 py-2 font-medium text-right">Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {groupTxs(key).map((t) => (
                            <tr key={t.id} className="border-b border-white/[0.03] transition-colors duration-150 hover:bg-white/[0.02]">
                              <td className="px-3 py-2">
                                <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)} className="w-4 h-4 accent-emerald-500 cursor-pointer" />
                              </td>
                              <td className="px-3 py-2 text-gray-400">{dayjs(t.date).format('DD/MM/YYYY')}</td>
                              <td className="px-3 py-2 text-white">{t.description}</td>
                              <td className="px-3 py-2">
                                {t.categoryName ? (
                                  <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-white/5 text-gray-300">{t.categoryName}</span>
                                ) : (
                                  <span className="text-gray-500">-</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-gray-400">{personLabel[t.person || ''] || t.person}</td>
                              <td className="px-3 py-2">
                                <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border ${t.type === 'INCOME' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                                  {typeLabel[t.type] || t.type}
                                </span>
                              </td>
                              <td className={`px-3 py-2 text-right font-medium ${t.type === 'INCOME' ? 'text-emerald-400' : 'text-red-400'}`}>
                                {editingAmount?.id === t.id ? (
                                  <div className="flex items-center justify-end gap-1">
                                    <input type="number" step="0.01" min="0.01" value={editingAmount.value} onChange={(e) => setEditingAmount({ id: t.id, value: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') handleAmountSave(t.id); if (e.key === 'Escape') setEditingAmount(null); }} autoFocus className="w-24 bg-gray-800 border border-white/10 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50" />
                                    <button onClick={() => handleAmountSave(t.id)} className="p-1 text-emerald-400 hover:text-emerald-300 rounded hover:bg-emerald-500/10 transition-colors"><Check className="w-4 h-4" /></button>
                                    <button onClick={() => setEditingAmount(null)} className="p-1 text-gray-400 hover:text-red-400 rounded hover:bg-red-500/10 transition-colors"><X className="w-4 h-4" /></button>
                                  </div>
                                ) : (
                                  <button onClick={() => setEditingAmount({ id: t.id, value: String(t.amount) })} className="hover:text-emerald-400 transition-colors iasconta-tx-amount">
                                    {(t.type === 'INCOME' ? '+' : '-') + formatCurrency(Math.abs(t.amount))}
                                  </button>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <button onClick={() => handleEdit(t)} className="p-1.5 hover:bg-white/5 rounded-lg text-gray-400 hover:text-white transition-colors" title="Editar"><Pencil className="w-4 h-4" /></button>
                                  <button onClick={() => handleDeleteRequest(t.id)} className="p-1.5 hover:bg-red-500/10 rounded-lg text-gray-400 hover:text-red-400 transition-colors" title="Remover"><Trash2 className="w-4 h-4" /></button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
                );
              })()}
            </div>
          )}

          {grouped.casal.length > 0 && (
            <div className="relative bg-gray-900/50 border border-white/5 rounded-2xl p-4 overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none" />
              <div className="relative">
                <h3 className="text-xs font-semibold tracking-wider text-sky-300 uppercase mb-3 flex items-center gap-2">
                  <Users className="w-3.5 h-3.5" /> Transferências entre o casal ({grouped.casal.length})
                </h3>
                <div className="divide-y divide-white/[0.04]">
                  {grouped.casal.map((t) => (
                    <div key={t.id} className="flex items-center justify-between py-2 text-sm">
                      <div>
                        <div className="text-white">{t.description}</div>
                        <div className="text-[11px] text-gray-500">{dayjs(t.date).format('DD/MM/YYYY')} · {t.paymentMethod || '-'}</div>
                      </div>
                      <div className="font-medium text-red-400">{formatCurrency(Math.abs(t.amount))}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="relative bg-gray-900/50 border border-white/5 rounded-2xl p-6 overflow-hidden text-center">
        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none" />
        <div className="relative">
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400" />
            </div>
          ) : (
            <p className="text-gray-500 text-sm">
              {filtered.length === 0
                ? 'Nenhuma transação encontrada nos filtros'
                : 'Os lançamentos aparecem dentro de cada cartão/conta acima — clique para abrir.'}
            </p>
          )}
        </div>
      </div>

      {showForm && (
        <TransactionForm transaction={editing} onSave={handleSave} onClose={() => { setShowForm(false); setEditing(null); }} />
      )}

      {showImport && <FileImport onClose={() => setShowImport(false)} onSuccess={() => { setShowImport(false); refresh(); }} />}

      {deleteTarget && (
        <ConfirmModal
          title="Excluir transação(es)"
          message={deleteMessage}
          confirmLabel="Excluir"
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
