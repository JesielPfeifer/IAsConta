import { useState, useEffect, useCallback } from 'react';
import { CreditCard, Wallet, Plus, Trash2, Pencil, Check, X, Loader2 } from 'lucide-react';
import { api } from '../api/client';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

interface PaymentMethod {
  id: string;
  name: string;
  type: 'CARD' | 'ACCOUNT';
  active: boolean;
}

const inputClass =
  'w-full bg-white/[0.03] border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/30';

interface MethodRowProps {
  m: PaymentMethod;
  editing: { id: string; name: string } | null;
  busyId: string | null;
  onStartEdit: (m: PaymentMethod) => void;
  onRename: (id: string) => void;
  onCancelEdit: () => void;
  onToggleType: (id: string, current: 'CARD' | 'ACCOUNT') => void;
  onDelete: (id: string, name: string) => void;
}

// Defined at MODULE SCOPE: a component declared inside PaymentMethodsCard is
// recreated on every parent render (setEditing runs per keystroke), which
// makes React remount the row and the input loses focus after each character.
function MethodRow({ m, editing, busyId, onStartEdit, onRename, onCancelEdit, onToggleType, onDelete }: MethodRowProps) {
  const isEditing = editing?.id === m.id;
  return (
    <div className="flex items-center justify-between gap-3 bg-white/[0.03] border border-white/10 rounded-xl px-4 py-2.5">
      <div className="flex items-center gap-2.5 min-w-0">
        {m.type === 'CARD' ? (
          <CreditCard className="w-4 h-4 text-violet-400 shrink-0" />
        ) : (
          <Wallet className="w-4 h-4 text-emerald-400 shrink-0" />
        )}
        {isEditing ? (
          <input
            autoFocus
            value={editing.name}
            onChange={(e) => onStartEdit({ ...m, name: e.target.value } as PaymentMethod)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRename(m.id);
              if (e.key === 'Escape') onCancelEdit();
            }}
            className={inputClass + ' py-1.5 max-w-[220px]'}
          />
        ) : (
          <span className="text-sm text-white truncate">{m.name}</span>
        )}
        <button
          onClick={() => onToggleType(m.id, m.type)}
          title={m.type === 'CARD' ? 'Mudar para valor em conta' : 'Mudar para cartão de crédito'}
          className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border transition-colors ${
            m.type === 'CARD'
              ? 'bg-violet-500/10 text-violet-300 border-violet-500/20 hover:bg-violet-500/20'
              : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20 hover:bg-emerald-500/20'
          }`}
        >
          {m.type === 'CARD' ? 'Cartão' : 'Em conta'}
        </button>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {isEditing ? (
          <>
            <button onClick={() => onRename(m.id)} className="p-1.5 rounded-lg text-emerald-400 hover:bg-emerald-500/10 transition-colors">
              <Check className="w-4 h-4" />
            </button>
            <button onClick={onCancelEdit} className="p-1.5 rounded-lg text-gray-400 hover:bg-white/5 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            <button onClick={() => onStartEdit(m)} title="Renomear" className="p-1.5 rounded-lg text-gray-400 hover:bg-white/5 hover:text-white transition-colors">
              <Pencil className="w-4 h-4" />
            </button>
            <button onClick={() => onDelete(m.id, m.name)} title="Excluir" className="p-1.5 rounded-lg text-gray-400 hover:bg-red-500/10 hover:text-red-400 transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        )}
        {busyId === m.id && <Loader2 className="w-4 h-4 animate-spin text-gray-500" />}
      </div>
    </div>
  );
}

export default function PaymentMethodsCard() {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'CARD' | 'ACCOUNT'>('CARD');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api('/api/payment-methods');
      setMethods(Array.isArray(data) ? data : []);
    } catch {
      setMethods([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useAutoRefresh(load, []);

  function flash(ok: boolean, text: string) {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 3000);
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      await api('/api/payment-methods', {
        method: 'POST',
        body: JSON.stringify({ name, type: newType }),
      });
      setNewName('');
      flash(true, `"${name}" adicionado!`);
      await load();
    } catch (err: any) {
      flash(false, err.message || 'Erro ao adicionar');
    } finally {
      setCreating(false);
    }
  }

  async function handleRename(id: string) {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) return;
    setBusyId(id);
    try {
      await api(`/api/payment-methods/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      });
      setEditing(null);
      flash(true, 'Nome atualizado!');
      await load();
    } catch (err: any) {
      flash(false, err.message || 'Erro ao renomear');
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleType(id: string, current: 'CARD' | 'ACCOUNT') {
    setBusyId(id);
    try {
      await api(`/api/payment-methods/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ type: current === 'CARD' ? 'ACCOUNT' : 'CARD' }),
      });
      await load();
    } catch (err: any) {
      flash(false, err.message || 'Erro ao alterar tipo');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Excluir "${name}"?`)) return;
    setBusyId(id);
    try {
      await api(`/api/payment-methods/${id}`, { method: 'DELETE' });
      flash(true, `"${name}" excluído.`);
      await load();
    } catch (err: any) {
      flash(false, err.message || 'Erro ao excluir');
    } finally {
      setBusyId(null);
    }
  }

  const cards = methods.filter((m) => m.type === 'CARD');
  const accounts = methods.filter((m) => m.type === 'ACCOUNT');

  return (
    <section className="bg-gray-900/50 border border-white/10 rounded-2xl p-6 space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-white/5">
        <CreditCard className="w-4 h-4 text-violet-400" />
        <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Cartões e Métodos de Pagamento</h2>
      </div>

      <p className="text-sm text-gray-400 leading-relaxed">
        Cartões de crédito entram no total do cartão na dashboard. Métodos "em conta" (débito,
        dinheiro, Pix) são pagamentos com o valor já descontado da conta.
      </p>

      {msg && (
        <div className={`rounded-lg px-4 py-2.5 text-sm ${msg.ok ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
          {msg.text}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          placeholder="Nome (ex: Cartão Inter)"
          className={inputClass + ' flex-1 min-w-[180px]'}
        />
        <select
          value={newType}
          onChange={(e) => setNewType(e.target.value as 'CARD' | 'ACCOUNT')}
          className="bg-gray-800 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 [color-scheme:dark]"
        >
          <option value="CARD">Cartão de crédito</option>
          <option value="ACCOUNT">Em conta</option>
        </select>
        <button
          onClick={handleCreate}
          disabled={creating || !newName.trim()}
          className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-violet-500 hover:from-violet-500 hover:to-violet-400 disabled:opacity-40 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-all"
        >
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Adicionar
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Carregando...</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-violet-300 uppercase tracking-wider flex items-center gap-1.5">
              <CreditCard className="w-3.5 h-3.5" /> Cartões de crédito ({cards.length})
            </p>
            {cards.length === 0 && <p className="text-sm text-gray-600">Nenhum cartão cadastrado.</p>}
            {cards.map((m) => (
              <MethodRow
                key={m.id}
                m={m}
                editing={editing}
                busyId={busyId}
                onStartEdit={(row) => setEditing({ id: row.id, name: row.name })}
                onRename={handleRename}
                onCancelEdit={() => setEditing(null)}
                onToggleType={handleToggleType}
                onDelete={handleDelete}
              />
            ))}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-emerald-300 uppercase tracking-wider flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5" /> Valor em conta ({accounts.length})
            </p>
            {accounts.length === 0 && <p className="text-sm text-gray-600">Nenhum método em conta.</p>}
            {accounts.map((m) => (
              <MethodRow
                key={m.id}
                m={m}
                editing={editing}
                busyId={busyId}
                onStartEdit={(row) => setEditing({ id: row.id, name: row.name })}
                onRename={handleRename}
                onCancelEdit={() => setEditing(null)}
                onToggleType={handleToggleType}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
