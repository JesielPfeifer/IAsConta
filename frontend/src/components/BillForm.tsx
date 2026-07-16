import { useState, useEffect, type FormEvent } from 'react';
import { X } from 'lucide-react';
import dayjs from 'dayjs';
import { api } from '../api/client';

interface Category {
  id: string;
  name: string;
}

interface Props {
  onSave: (data: {
    name: string;
    amount: number;
    dueDate: string;
    person?: string | null;
    categoryId?: string | null;
    totalInstallments?: number;
    currentInstallment?: number;
  }) => void;
  onClose: () => void;
}

export default function BillForm({ onSave, onClose }: Props) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [person, setPerson] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [totalInstallments, setTotalInstallments] = useState(1);
  const [error, setError] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    api('/api/categories').then(setCategories).catch(() => {});
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Nome e obrigatorio'); return; }
    if (!amount || parseFloat(amount) <= 0) { setError('Valor invalido'); return; }
    await onSave({
      name: name.trim(),
      amount: parseFloat(amount),
      dueDate: new Date(dueDate + 'T12:00:00.000Z').toISOString(),
      person: person || null,
      categoryId: categoryId || null,
      totalInstallments: totalInstallments >= 1 ? totalInstallments : 1,
      currentInstallment: 1,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">Nova Conta</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2 text-red-400 text-sm">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Nome</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50" placeholder="Ex: Conta de luz" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Valor</label>
            <input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Vencimento</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Responsavel</label>
            <select value={person} onChange={(e) => setPerson(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50">
              <option value="">Casal (compartilhado)</option>
              <option value="HUSBAND">Marido</option>
              <option value="WIFE">Esposa</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Categoria</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50">
              <option value="">Sem categoria</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Parcelas</label>
            <input type="number" min="1" max="120" value={totalInstallments} onChange={(e) => setTotalInstallments(parseInt(e.target.value) || 1)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
            {totalInstallments > 1 && <p className="text-xs text-gray-500 mt-1">Sera criada 1 conta como parcela 1 de {totalInstallments}</p>}
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2.5 rounded-lg text-sm transition-colors">Cancelar</button>
            <button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">Salvar</button>
          </div>
        </form>
      </div>
    </div>
  );
}
