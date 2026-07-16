import { useState, useMemo } from 'react';
import { useTransactions, type Transaction } from '../hooks/useTransactions';
import TransactionForm from '../components/TransactionForm';
import FileImport from '../components/FileImport';
import ConfirmModal from '../components/ConfirmModal';
import { Plus, Upload, Pencil, Trash2, Search, Check, X, ChevronDown, Calendar, Filter, Users, type LucideIcon } from 'lucide-react';
import dayjs from 'dayjs';

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

  const filtered = useMemo(() => {
    if (!search) return transactions;
    const q = search.toLowerCase();
    return transactions.filter((t) =>
      t.description.toLowerCase().includes(q) ||
      (t.categoryName || '').toLowerCase().includes(q)
    );
  }, [transactions, search]);

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
      await remove(id);
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
      setSelected(new Set(filtered.map(t => t.id)));
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
    ? `Deseja excluir ${deleteTarget.length} transacoes selecionadas?`
    : 'Deseja excluir esta transacao?';

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

  const paymentOptions = [
    { value: '', label: 'Todos os pagamentos' },
    { value: 'DEBITO', label: 'Débito' },
    { value: 'CAIXA', label: 'Caixa' },
    { value: 'NUBANK', label: 'Nubank' },
    { value: 'CREDITO_3', label: 'Crédito 3' },
    { value: 'CREDITO_4', label: 'Crédito 4' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Transacoes</h1>
          <p className="text-sm text-gray-500 mt-0.5">Gerencie suas receitas e despesas</p>
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

      <div className="relative bg-gray-900/50 border border-white/5 rounded-2xl overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none" />
        <div className="relative">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400" />
            </div>
          ) : filtered.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-white/5">
                    <th className="px-4 py-3 w-10">
                      <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleSelectAll} className="w-4 h-4 accent-emerald-500 cursor-pointer" />
                    </th>
                    <th className="px-4 py-3 font-medium">Data</th>
                    <th className="px-4 py-3 font-medium">Descricao</th>
                    <th className="px-4 py-3 font-medium">Categoria</th>
                    <th className="px-4 py-3 font-medium">Pagamento</th>
                    <th className="px-4 py-3 font-medium">Pessoa</th>
                    <th className="px-4 py-3 font-medium">Parcelas</th>
                    <th className="px-4 py-3 font-medium">Tipo</th>
                    <th className="px-4 py-3 font-medium text-right">Valor</th>
                    <th className="px-4 py-3 font-medium text-right">Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((tx) => {
                    const isSelected = selected.has(tx.id);
                    const isEditing = editingAmount?.id === tx.id;
                    return (
                      <tr key={tx.id} className={`border-b border-white/[0.03] transition-colors duration-150 hover:bg-white/[0.02] ${isSelected ? 'bg-emerald-500/[0.07]' : ''}`}>
                        <td className="px-4 py-3">
                          <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(tx.id)} className="w-4 h-4 accent-emerald-500 cursor-pointer" />
                        </td>
                        <td className="px-4 py-3 text-gray-400">{dayjs(tx.date).format('DD/MM/YYYY')}</td>
                        <td className="px-4 py-3 text-white">{tx.description}</td>
                        <td className="px-4 py-3">
                          {tx.categoryName ? (
                            <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-white/5 text-gray-300">{tx.categoryName}</span>
                          ) : (
                            <span className="text-gray-500">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-400">{tx.paymentMethod || '-'}</td>
                        <td className="px-4 py-3 text-gray-400">{personLabel[tx.person || ''] || tx.person}</td>
                        <td className="px-4 py-3 text-gray-400">
                          {tx.totalInstallments && tx.totalInstallments > 1
                            ? `${tx.currentInstallment || 1}/${tx.totalInstallments}`
                            : '-'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border ${tx.type === 'INCOME' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_8px_-2px_rgba(16,185,129,0.3)]' : 'bg-red-500/10 text-red-400 border-red-500/20 shadow-[0_0_8px_-2px_rgba(239,68,68,0.3)]'}`}>
                            {typeLabel[tx.type] || tx.type}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-right font-medium ${tx.type === 'INCOME' ? 'text-emerald-400' : 'text-red-400'}`}>
                          {isEditing ? (
                            <div className="flex items-center justify-end gap-1">
                              <input type="number" step="0.01" min="0.01" value={editingAmount.value} onChange={(e) => setEditingAmount({ id: tx.id, value: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') handleAmountSave(tx.id); if (e.key === 'Escape') setEditingAmount(null); }} autoFocus className="w-28 bg-gray-800 border border-white/10 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50" />
                              <button onClick={() => handleAmountSave(tx.id)} className="p-1 text-emerald-400 hover:text-emerald-300 rounded hover:bg-emerald-500/10 transition-colors"><Check className="w-4 h-4" /></button>
                              <button onClick={() => setEditingAmount(null)} className="p-1 text-gray-400 hover:text-red-400 rounded hover:bg-red-500/10 transition-colors"><X className="w-4 h-4" /></button>
                            </div>
                          ) : (
                            <button onClick={() => setEditingAmount({ id: tx.id, value: String(tx.amount) })} className="hover:text-emerald-400 transition-colors">
                              {tx.type === 'INCOME' ? '+' : '-'}{formatCurrency(Math.abs(tx.amount))}
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => handleEdit(tx)} className="p-1.5 hover:bg-white/5 rounded-lg text-gray-400 hover:text-white transition-colors"><Pencil className="w-4 h-4" /></button>
                            <button onClick={() => handleDeleteRequest(tx.id)} className="p-1.5 hover:bg-red-500/10 rounded-lg text-gray-400 hover:text-red-400 transition-colors"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-500 text-center py-12">Nenhuma transacao encontrada</p>
          )}
        </div>
      </div>

      {showForm && (
        <TransactionForm transaction={editing} onSave={handleSave} onClose={() => { setShowForm(false); setEditing(null); }} />
      )}

      {showImport && <FileImport onClose={() => setShowImport(false)} onSuccess={() => { setShowImport(false); refresh(); }} />}

      {deleteTarget && (
        <ConfirmModal
          title="Excluir transacao(es)"
          message={deleteMessage}
          confirmLabel="Excluir"
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
