import { useState, useEffect, useCallback } from 'react';
import { Repeat, Plus, Trash2, Pencil, Check, X, Loader2, CalendarCheck } from 'lucide-react';
import { api } from '../api/client';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

interface FixedIncome {
  id: string;
  name: string;
  amount: number;
  person: 'HUSBAND' | 'WIFE' | 'COUPLE' | null;
  active: boolean;
}

const PERSON_LABEL: Record<string, string> = {
  HUSBAND: 'Marido',
  WIFE: 'Esposa',
  COUPLE: 'Casal',
};

const inputClass =
  'w-full bg-gray-900/60 border border-white/5 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/30 transition-all duration-200 placeholder-gray-600';

function parseNumber(input: string): number {
  if (!input || !input.trim()) return 0;
  let s = input.trim();
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  // pt-BR thousands without decimals: "1.000" or "1.000.000" -> 1000/1000000
  else if (/^\d{1,3}(?:\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const parsed = parseFloat(s);
  return isNaN(parsed) ? 0 : parsed;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

export default function FixedIncomesCard() {
  const [incomes, setIncomes] = useState<FixedIncome[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newPerson, setNewPerson] = useState<'HUSBAND' | 'WIFE' | 'COUPLE'>('HUSBAND');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string; amount: string; person: string } | null>(null);
  const [applying, setApplying] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api('/api/fixed-incomes');
      setIncomes(Array.isArray(data) ? data : []);
    } catch {
      setIncomes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useAutoRefresh(load, []);

  function flash(ok: boolean, text: string) {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 4000);
  }

  async function handleCreate() {
    const name = newName.trim();
    const amount = parseNumber(newAmount);
    if (!name || amount <= 0 || creating) return;
    setCreating(true);
    try {
      await api('/api/fixed-incomes', {
        method: 'POST',
        body: JSON.stringify({ name, amount, person: newPerson }),
      });
      setNewName('');
      setNewAmount('');
      flash(true, `"${name}" (${formatCurrency(amount)}) salvo! Ele entra todo mês ao lançar.`);
      await load();
    } catch (err: any) {
      flash(false, err.message || 'Erro ao salvar');
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveEdit(id: string) {
    if (!editing) return;
    const name = editing.name.trim();
    const amount = parseNumber(editing.amount);
    if (!name || amount <= 0) return;
    setBusyId(id);
    try {
      await api(`/api/fixed-incomes/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name, amount, person: editing.person }),
      });
      setEditing(null);
      flash(true, 'Renda atualizada!');
      await load();
    } catch (err: any) {
      flash(false, err.message || 'Erro ao atualizar');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Excluir "${name}"?`)) return;
    setBusyId(id);
    try {
      await api(`/api/fixed-incomes/${id}`, { method: 'DELETE' });
      flash(true, `"${name}" excluído.`);
      await load();
    } catch (err: any) {
      flash(false, err.message || 'Erro ao excluir');
    } finally {
      setBusyId(null);
    }
  }

  async function handleApply() {
    setApplying(true);
    try {
      // Derive the month in LOCAL time: toISOString() is UTC and in Brazilian
      // timezones the final hours of a month would send the NEXT month,
      // creating records in the wrong month and changing the idempotency key.
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const result = await api<{ month: string; created: string[]; skipped: string[] }>(
        `/api/fixed-incomes/apply?month=${month}`,
        { method: 'POST', body: JSON.stringify({}) }
      );
      if (result.created.length > 0) {
        flash(true, `Lançadas no mês: ${result.created.join(', ')}`);
      } else if (result.skipped.length > 0) {
        flash(true, `Já lançadas neste mês: ${result.skipped.join(', ')}`);
      } else {
        flash(true, 'Nenhuma renda fixa ativa para lançar.');
      }
    } catch (err: any) {
      flash(false, err.message || 'Erro ao lançar rendas');
    } finally {
      setApplying(false);
    }
  }

  const total = incomes.filter((i) => i.active).reduce((s, i) => s + i.amount, 0);

  return (
    <section className="bg-gray-900/80 backdrop-blur-sm border border-white/5 rounded-2xl bg-gradient-to-b from-white/[0.02] to-transparent shadow-xl shadow-black/20 overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-white/5">
        <Repeat className="w-4 h-4 text-emerald-400" />
        <h2 className="text-sm font-semibold text-white uppercase tracking-wide">Rendas Fixas Mensais</h2>
        <span className="ml-auto text-xs text-gray-500">Total: <span className="text-emerald-400 font-semibold">{formatCurrency(total)}</span>/mês</span>
      </div>

      <div className="p-5 space-y-4">
        <p className="text-xs text-gray-500 leading-relaxed">
          Salário do marido, da esposa e outras entradas fixas (aluguel recebido, renda extra...).
          Cadastre aqui e clique em <strong className="text-emerald-400">Lançar no mês</strong> para que
          entrem automaticamente como receita todo mês (não duplica se lançar de novo).
        </p>

        {msg && (
          <div className={`rounded-lg px-4 py-2.5 text-sm ${msg.ok ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
            {msg.text}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Nome (ex: Salário Jesiel)"
            className={inputClass}
          />
          <input
            value={newAmount}
            onChange={(e) => setNewAmount(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Valor (ex: 5240,66)"
            inputMode="decimal"
            className={inputClass}
          />
          <select
            value={newPerson}
            onChange={(e) => setNewPerson(e.target.value as 'HUSBAND' | 'WIFE' | 'COUPLE')}
            className={inputClass + ' [color-scheme:dark]'}
          >
            <option value="HUSBAND">Marido</option>
            <option value="WIFE">Esposa</option>
            <option value="COUPLE">Casal</option>
          </select>
          <button
            onClick={handleCreate}
            disabled={creating || !newName.trim() || parseNumber(newAmount) <= 0}
            className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-all"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Adicionar
          </button>
        </div>

        <div className="space-y-2">
          {loading && <p className="text-sm text-gray-500">Carregando...</p>}
          {!loading && incomes.length === 0 && (
            <p className="text-sm text-gray-600 italic">Nenhuma renda fixa cadastrada ainda.</p>
          )}
          {incomes.map((inc) => (
            <div key={inc.id} className="flex items-center justify-between gap-3 bg-white/[0.03] border border-white/5 rounded-xl px-4 py-2.5">
              {editing?.id === inc.id ? (
                <div className="flex flex-wrap items-center gap-2 flex-1">
                  <input
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    className={inputClass + ' max-w-[220px] py-1.5'}
                  />
                  <input
                    value={editing.amount}
                    onChange={(e) => setEditing({ ...editing, amount: e.target.value })}
                    inputMode="decimal"
                    className={inputClass + ' max-w-[120px] py-1.5'}
                  />
                  <select
                    value={editing.person}
                    onChange={(e) => setEditing({ ...editing, person: e.target.value })}
                    className={inputClass + ' max-w-[140px] py-1.5 [color-scheme:dark]'}
                  >
                    <option value="HUSBAND">Marido</option>
                    <option value="WIFE">Esposa</option>
                    <option value="COUPLE">Casal</option>
                  </select>
                  <button onClick={() => handleSaveEdit(inc.id)} className="p-1.5 rounded-lg text-emerald-400 hover:bg-emerald-500/10 transition-colors">
                    <Check className="w-4 h-4" />
                  </button>
                  <button onClick={() => setEditing(null)} className="p-1.5 rounded-lg text-gray-400 hover:bg-white/5 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 min-w-0">
                    <Repeat className="w-4 h-4 text-emerald-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-white truncate">{inc.name}</p>
                      <p className="text-xs text-gray-500">
                        {PERSON_LABEL[inc.person || ''] || 'Casal'} · {inc.active ? 'ativo' : 'inativo'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-semibold text-emerald-400">{formatCurrency(inc.amount)}</span>
                    <button onClick={() => setEditing({ id: inc.id, name: inc.name, amount: String(inc.amount).replace('.', ','), person: inc.person || 'COUPLE' })} title="Editar" className="p-1.5 rounded-lg text-gray-400 hover:bg-white/5 hover:text-white transition-colors">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(inc.id, inc.name)} title="Excluir" className="p-1.5 rounded-lg text-gray-400 hover:bg-red-500/10 hover:text-red-400 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                    {busyId === inc.id && <Loader2 className="w-4 h-4 animate-spin text-gray-500" />}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        <button
          onClick={handleApply}
          disabled={applying || incomes.length === 0}
          className="flex items-center justify-center gap-2 w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white px-4 py-3 rounded-xl text-sm font-semibold transition-all"
        >
          {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarCheck className="w-4 h-4" />}
          Lançar rendas no mês atual
        </button>
      </div>
    </section>
  );
}
