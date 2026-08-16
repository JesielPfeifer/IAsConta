import { useState, useEffect, useCallback } from 'react';
import { Link2, RefreshCw, Trash2, Landmark, CheckCircle2, XCircle, Loader2, Webhook, Paperclip } from 'lucide-react';
import { api } from '../api/client';

interface PluggyConnection {
  id: string;
  bankName: string;
  itemId: string | null;
  connectorName: string | null;
  status: string | null;
  lastSyncAt: string | null;
  errorMessage: string | null;
}

interface SyncResult {
  itemId: string;
  status: string;
  accounts: number;
  transactionsCreated: number;
  transactionsUpdated: number;
  billsCreated: number;
  billsUpdated: number;
  errors: string[];
}

const STATUS_LABEL: Record<string, { label: string; ok: boolean }> = {
  UPDATED: { label: 'Sincronizado', ok: true },
  UPDATING: { label: 'Sincronizando...', ok: true },
  LOGIN_OK: { label: 'Conectado', ok: true },
  LOGIN_ERROR: { label: 'Erro de login', ok: false },
  OUTDATED: { label: 'Desatualizado', ok: false },
  WAITING_USER_INPUT: { label: 'Aguardando MFA', ok: false },
  WAITING_USER_ACTION: { label: 'Aguardando ação', ok: false },
  ERROR: { label: 'Erro', ok: false },
  PARTIAL_SUCCESS: { label: 'Sucesso parcial', ok: true },
};

declare global {
  interface Window {
    PluggyConnect?: any;
  }
}

export default function PluggySettingsCard() {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [userConfigured, setUserConfigured] = useState(false);
  const [globalConfigured, setGlobalConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<null | { ok: boolean; message: string }>(null);
  const [connections, setConnections] = useState<PluggyConnection[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [registeringWebhooks, setRegisteringWebhooks] = useState(false);
  const [attachItemId, setAttachItemId] = useState('');
  const [attaching, setAttaching] = useState(false);

  const loadConnections = useCallback(async () => {
    setLoadingConnections(true);
    try {
      const data = await api('/api/pluggy/items').catch(() => []);
      setConnections(Array.isArray(data) ? data : []);
    } finally {
      setLoadingConnections(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const status = await api('/api/pluggy/status');
        setUserConfigured(Boolean(status.userConfigured));
        setGlobalConfigured(Boolean(status.globalConfigured));
        if (status.userConfigured) {
          // Client ID comes back; secret never does
          const settings = await api('/api/settings');
          setClientId(settings.pluggyClientId || '');
        }
        await loadConnections();
      } catch {
        // silent
      }
    })();
  }, [loadConnections]);

  async function handleSave() {
    setSaving(true);
    setTestResult(null);
    try {
      const body: Record<string, string> = {};
      if (clientId.trim()) body.pluggyClientId = clientId.trim();
      if (clientSecret.trim()) body.pluggyClientSecret = clientSecret.trim();
      await api('/api/settings', { method: 'PUT', body: JSON.stringify(body) });
      setUserConfigured(true);
      setTestResult({ ok: true, message: 'Credenciais salvas!' });
    } catch (err: any) {
      setTestResult({ ok: false, message: err.message || 'Erro ao salvar' });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      // Saves first, then lists connectors (validates auth against Pluggy)
      const body: Record<string, string> = {};
      if (clientId.trim()) body.pluggyClientId = clientId.trim();
      if (clientSecret.trim()) body.pluggyClientSecret = clientSecret.trim();
      if (Object.keys(body).length) {
        await api('/api/settings', { method: 'PUT', body: JSON.stringify(body) });
      }
      const connectors = await api('/api/pluggy/connectors?search=nubank');
      setUserConfigured(true);
      setTestResult({
        ok: true,
        message: `Conectado à Pluggy! (${(connectors as any[]).length} resultados p/ "nubank")`,
      });
    } catch (err: any) {
      setTestResult({ ok: false, message: err.message || 'Falha na autenticação' });
    } finally {
      setTesting(false);
    }
  }

  async function handleConnect() {
    setConnecting(true);
    setSyncMessage('');
    try {
      const { accessToken } = await api('/api/pluggy/connect-token', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      // Load the Pluggy Connect widget script on demand
      if (!window.PluggyConnect) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.pluggy.ai/pluggy-connect/v2.8.2/pluggy-connect.js';
          s.onload = () => resolve();
          s.onerror = () => reject(new Error('Falha ao carregar o widget Pluggy'));
          document.head.appendChild(s);
        });
      }

      const handler = new (window as any).PluggyConnect({
        connectToken: accessToken,
        onSuccess: async ({ itemId }: { itemId: string }) => {
          setSyncMessage('Conta conectada! Sincronizando dados...');
          try {
            const result = await api<SyncResult>(`/api/pluggy/items/${itemId}/sync`, {
              method: 'POST',
              body: JSON.stringify({}),
            });
            setSyncMessage(
              `✓ Sincronizado: ${result.transactionsCreated} transações, ${result.billsCreated} faturas importadas.` +
                (result.errors.length ? ` ⚠️ ${result.errors.join('; ')}` : '')
            );
          } catch (err: any) {
            setSyncMessage(`Conectado, mas sync falhou: ${err.message}`);
          }
          await loadConnections();
        },
        onClose: () => setConnecting(false),
        onError: (err: any) => {
          setConnecting(false);
          setSyncMessage(`Erro na conexão: ${err?.message || 'desconhecido'}`);
        },
      });
      handler.init();
      // Widget is open; keep connecting state until closed
    } catch (err: any) {
      setConnecting(false);
      setSyncMessage(`Erro: ${err.message}`);
    }
  }

  async function handleSync(conn: PluggyConnection) {
    if (!conn.itemId) return;
    setSyncingId(conn.itemId);
    setSyncMessage('');
    try {
      const result = await api<SyncResult>(`/api/pluggy/items/${conn.itemId}/sync`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setSyncMessage(
        `${conn.bankName}: ${result.transactionsCreated} novas, ${result.transactionsUpdated} atualizadas, ${result.billsCreated} faturas.` +
          (result.errors.length ? ` ⚠️ ${result.errors.join('; ')}` : '')
      );
    } catch (err: any) {
      setSyncMessage(`Erro no sync: ${err.message}`);
    } finally {
      setSyncingId(null);
      await loadConnections();
    }
  }

  async function handleRemove(conn: PluggyConnection) {
    if (!conn.itemId) return;
    if (!window.confirm(`Remover a conexão "${conn.bankName}"? As transações importadas também serão removidas.`)) return;
    try {
      await api(`/api/pluggy/items/${conn.itemId}`, { method: 'DELETE' });
      setSyncMessage('Conexão removida.');
      await loadConnections();
    } catch (err: any) {
      setSyncMessage(`Erro ao remover: ${err.message}`);
    }
  }

  async function handleAttach() {
    const itemId = attachItemId.trim();
    if (!itemId || attaching) return;
    setAttaching(true);
    setSyncMessage('');
    try {
      const result = await api<{ sync: SyncResult; connection: PluggyConnection }>('/api/pluggy/items/attach', {
        method: 'POST',
        body: JSON.stringify({ itemId }),
      });
      setAttachItemId('');
      setSyncMessage(
        `✓ Item anexado e sincronizado: ${result.sync.transactionsCreated} transações, ${result.sync.billsCreated} faturas, ${result.sync.accounts} contas.` +
          (result.sync.errors.length ? ` ⚠️ ${result.sync.errors.join('; ')}` : '')
      );
      await loadConnections();
    } catch (err: any) {
      setSyncMessage(`Erro ao anexar: ${err.message}`);
    } finally {
      setAttaching(false);
    }
  }

  async function handleRegisterWebhooks() {
    setRegisteringWebhooks(true);
    setSyncMessage('');
    try {
      const result = await api<{ ok: boolean; results: Array<{ event: string; id?: string; error?: string }> }>(
        '/api/pluggy/webhooks/register',
        { method: 'POST', body: JSON.stringify({}) }
      );
      const okCount = result.results.filter((r) => r.id).length;
      setSyncMessage(`Webhooks registrados (${okCount}/${result.results.length}) — sync automático ativo.`);
    } catch (err: any) {
      setSyncMessage(`Erro ao registrar webhooks: ${err.message}`);
    } finally {
      setRegisteringWebhooks(false);
    }
  }

  const canUse = userConfigured || globalConfigured;

  return (
    <section className="bg-gray-900/50 border border-white/10 rounded-2xl p-6 space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-white/5">
        <Landmark className="w-4 h-4 text-emerald-400" />
        <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Bancos (Pluggy Open Finance)</h2>
      </div>

      <p className="text-sm text-gray-400 leading-relaxed">
        Conecte suas contas bancárias (Caixa, Nubank e outros) para importar automaticamente
        transações e faturas de cartão de crédito. Credenciais da sua conta em{' '}
        <a href="https://dashboard.pluggy.ai" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">
          dashboard.pluggy.ai
        </a>
        . Cada usuário usa as próprias credenciais.
      </p>

      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1.5">Pluggy Client ID</label>
        <input
          type="text"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="ex: seu-client-id (dashboard.pluggy.ai)"
          className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/30"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1.5">Pluggy Client Secret</label>
        <input
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          placeholder={userConfigured ? '•••••••• (salvo — deixe vazio p/ manter)' : 'client-secret'}
          className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/30"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleSave}
          disabled={saving || !clientId.trim()}
          className="flex items-center gap-2 bg-white/[0.06] hover:bg-white/[0.1] disabled:opacity-40 text-white px-4 py-2 rounded-xl text-sm font-medium transition-all"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
          Salvar Credenciais
        </button>
        <button
          onClick={handleTest}
          disabled={testing}
          className="flex items-center gap-2 bg-white/[0.06] hover:bg-white/[0.1] disabled:opacity-40 text-white px-4 py-2 rounded-xl text-sm font-medium transition-all"
        >
          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4 text-emerald-400" />}
          Testar Conexão
        </button>
      </div>

      {testResult && (
        <div className={`rounded-lg px-4 py-2.5 text-sm ${testResult.ok ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
          {testResult.message}
        </div>
      )}

      {canUse && (
        <>
          <div className="border-t border-white/5 pt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-semibold shadow-lg shadow-emerald-500/20 transition-all"
              >
                {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                Conectar Novo Banco
              </button>
              <button
                onClick={handleRegisterWebhooks}
                disabled={registeringWebhooks}
                className="flex items-center gap-2 bg-white/[0.06] hover:bg-white/[0.1] disabled:opacity-40 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
              >
                {registeringWebhooks ? <Loader2 className="w-4 h-4 animate-spin" /> : <Webhook className="w-4 h-4 text-emerald-400" />}
                Ativar Sync Automático (Webhooks)
              </button>
            </div>

            <div className="bg-white/[0.02] border border-white/5 rounded-xl p-3 space-y-2">
              <p className="text-xs text-gray-500 leading-relaxed">
                Já conectou o banco no <span className="text-emerald-400">dashboard.pluggy.ai</span> / Meu Pluggy e o
                botão acima retornou <code className="text-amber-400">ITEM_USER_ALREADY_EXISTS</code>? Anexe o item
                existente pelo ID (o mesmo que aparece na URL do item no dashboard).
              </p>
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={attachItemId}
                  onChange={(e) => setAttachItemId(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAttach()}
                  placeholder="itemId (ex: 1498c237-c9b7-4527-a93d-270a769eb8e0)"
                  className="flex-1 min-w-[220px] bg-white/[0.03] border border-white/10 rounded-xl px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/30"
                />
                <button
                  onClick={handleAttach}
                  disabled={attaching || !attachItemId.trim()}
                  className="flex items-center gap-2 bg-white/[0.06] hover:bg-white/[0.1] disabled:opacity-40 text-white px-4 py-2 rounded-xl text-sm font-medium transition-all"
                >
                  {attaching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4 text-emerald-400" />}
                  Anexar Item Existente
                </button>
              </div>
            </div>

            {syncMessage && (
              <div className="bg-white/[0.04] border border-white/10 rounded-lg px-4 py-2.5 text-sm text-gray-200">
                {syncMessage}
              </div>
            )}

            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-400">Suas conexões</p>
              {loadingConnections && <p className="text-sm text-gray-500">Carregando...</p>}
              {!loadingConnections && connections.length === 0 && (
                <p className="text-sm text-gray-500">Nenhum banco conectado ainda.</p>
              )}
              {connections.map((conn) => {
                const st = STATUS_LABEL[conn.status || ''] || { label: conn.status || 'Desconhecido', ok: false };
                return (
                  <div key={conn.id} className="flex items-center justify-between gap-3 bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Landmark className="w-5 h-5 text-emerald-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">{conn.bankName}</p>
                        <p className="text-xs text-gray-500">
                          {conn.lastSyncAt
                            ? `Último sync: ${new Date(conn.lastSyncAt).toLocaleString('pt-BR')}`
                            : 'Nunca sincronizado'}
                          {conn.errorMessage ? ` — ${conn.errorMessage}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`flex items-center gap-1 text-xs ${st.ok ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {st.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                        {st.label}
                      </span>
                      {conn.itemId && (
                        <>
                          <button
                            onClick={() => handleSync(conn)}
                            disabled={syncingId === conn.itemId}
                            title="Sincronizar agora"
                            className="p-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-gray-300 hover:text-white transition-all"
                          >
                            {syncingId === conn.itemId ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => handleRemove(conn)}
                            title="Remover conexão"
                            className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
