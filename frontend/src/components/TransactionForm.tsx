import { useState, useEffect, type FormEvent } from 'react';
import { api } from '../api/client';
import { X } from 'lucide-react';
import dayjs from 'dayjs';

interface Category {
  id: string;
  name: string;
}

interface TransactionFormData {
  amount: number;
  description: string;
  type: 'EXPENSE' | 'INCOME';
  categoryId: string;
  person: 'HUSBAND' | 'WIFE' | 'COUPLE';
  date: string;
  isShared: boolean;
  paymentMethod: string;
  totalInstallments: number;
  currentInstallment: number;
  isFixed: boolean;
}

interface Props {
  transaction?: {
    id: string;
    amount: number;
    description: string;
    type: string;
    categoryId?: string;
    category?: { id: string; name: string };
    person?: string;
    date: string;
    isShared?: boolean;
    categoryName?: string;
    paymentMethod?: string;
    totalInstallments?: number;
    currentInstallment?: number;
    isFixed?: boolean;
  } | null;
  onSave: (data: TransactionFormData) => void;
  onClose: () => void;
}

function normType(t: string): 'EXPENSE' | 'INCOME' {
  return t?.toUpperCase() === 'INCOME' ? 'INCOME' : 'EXPENSE';
}

function normPerson(p: string): 'HUSBAND' | 'WIFE' | 'COUPLE' {
  const up = p?.toUpperCase() || '';
  if (up === 'HUSBAND' || up === 'WIFE' || up === 'COUPLE') return up as 'HUSBAND' | 'WIFE' | 'COUPLE';
  return 'COUPLE';
}

export default function TransactionForm({ transaction, onSave, onClose }: Props) {
  const isEditing = !!transaction;
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState<TransactionFormData>({
    amount: transaction?.amount ?? 0,
    description: transaction?.description ?? '',
    type: normType(transaction?.type || ''),
    categoryId: transaction?.categoryId ?? transaction?.category?.id ?? '',
    person: normPerson(transaction?.person || ''),
    date: transaction?.date ? dayjs(transaction.date).format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
    isShared: transaction?.isShared ?? false,
    paymentMethod: transaction?.paymentMethod ?? '',
    totalInstallments: transaction?.totalInstallments ?? 1,
    currentInstallment: transaction?.currentInstallment ?? 1,
    isFixed: transaction?.isFixed ?? false,
  });

  const isExpense = form.type === 'EXPENSE';

  useEffect(() => {
    api('/api/categories').then((data) => setCategories(Array.isArray(data) ? data : [])).catch(() => {});
  }, []);

  function updateField<K extends keyof TransactionFormData>(key: K, value: TransactionFormData[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'type' && value === 'INCOME') {
        next.paymentMethod = '';
        next.totalInstallments = 1;
        next.currentInstallment = 1;
        next.isFixed = false;
      }
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.amount || form.amount <= 0) { setError('Valor deve ser maior que zero'); return; }
    if (!form.description.trim()) { setError('Descricao e obrigatoria'); return; }

    setLoading(true);
    try {
      const payload = { ...form, date: new Date(form.date + 'T12:00:00.000Z').toISOString() };
      await onSave(payload);
    } catch (err: any) {
      setError(err.message || 'Erro ao salvar');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">
            {isEditing ? 'Editar' : isExpense ? 'Nova Despesa' : 'Nova Receita'}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2 text-red-400 text-sm">{error}</div>}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Tipo</label>
              <select value={form.type} onChange={(e) => updateField('type', e.target.value as 'EXPENSE' | 'INCOME')} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50">
                <option value="EXPENSE">Despesa</option>
                <option value="INCOME">Receita</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">
                {isExpense ? 'Valor da Despesa' : 'Valor do Credito'}
              </label>
              <input type="number" step="0.01" min="0.01" value={form.amount || ''} onChange={(e) => updateField('amount', parseFloat(e.target.value) || 0)} required className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Descricao</label>
            <input type="text" value={form.description} onChange={(e) => updateField('description', e.target.value)} required className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50" placeholder={isExpense ? "Ex: Supermercado" : "Ex: Salario"} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Pessoa</label>
              <select value={form.person} onChange={(e) => updateField('person', e.target.value as 'HUSBAND' | 'WIFE' | 'COUPLE')} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50">
                <option value="HUSBAND">Marido</option>
                <option value="WIFE">Esposa</option>
                <option value="COUPLE">Casal</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Data</label>
              <input type="date" value={form.date} onChange={(e) => updateField('date', e.target.value)} required className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
            </div>
          </div>

          {isExpense && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Categoria</label>
                <select value={form.categoryId} onChange={(e) => updateField('categoryId', e.target.value)} required className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50">
                  <option value="">Selecione...</option>
                  {categories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Pagamento</label>
                  <select value={form.paymentMethod} onChange={(e) => updateField('paymentMethod', e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50">
                    <option value="">Selecione...</option>
                    <option value="DEBITO">Debito</option>
                    <option value="CAIXA">Caixa</option>
                    <option value="NUBANK">Nubank</option>
                    <option value="CREDITO_3">Credito 3</option>
                    <option value="CREDITO_4">Credito 4</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Parcelas</label>
                  <input type="number" min="1" max="24" value={form.totalInstallments} onChange={(e) => updateField('totalInstallments', parseInt(e.target.value) || 1)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
                </div>
              </div>

              <div className="flex items-center gap-6 pb-1">
                <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                  <input type="checkbox" checked={form.isShared} onChange={(e) => updateField('isShared', e.target.checked)} className="rounded bg-gray-800 border-gray-600 text-emerald-500 focus:ring-emerald-500/50" />
                  Dividir com parceiro
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                  <input type="checkbox" checked={form.isFixed} onChange={(e) => updateField('isFixed', e.target.checked)} className="rounded bg-gray-800 border-gray-600 text-emerald-500 focus:ring-emerald-500/50" />
                  Conta fixa
                </label>
              </div>
            </>
          )}

          {!isExpense && (
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Categoria</label>
              <select value={form.categoryId} onChange={(e) => updateField('categoryId', e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50">
                <option value="">Selecione...</option>
                {categories
                  .filter(c => /salario|salário|freelance|investimento|renda|extra/i.test(c.name))
                  .map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                {categories
                  .filter(c => !/salario|salário|freelance|investimento|renda|extra/i.test(c.name))
                  .map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </select>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2.5 rounded-lg text-sm transition-colors">Cancelar</button>
            <button type="submit" disabled={loading} className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">{loading ? 'Salvando...' : 'Salvar'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
