import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { QrCode, CheckCircle2, Loader2, RefreshCw, Power, Smartphone, Save, Users, Bot, MessageCircle, Search } from 'lucide-react';
import { api } from '../api/client';

interface UserSettings {
  groqApiKey: string;
  wifeName: string;
  husbandName: string;
  whatsappGroupId: string;
  whatsappGroupName: string;
  botApiKey: string;
  evolutionApiKey: string;
  evolutionApiUrl: string;
  discordToken: string;
  telegramToken: string;
  geminiApiKey: string;
}

interface WhatsAppStatus {
  exists: boolean;
  instanceName?: string;
  connected: boolean;
  connectionState: string;
  phone?: string;
}

const EMPTY: UserSettings = {
  groqApiKey: '', wifeName: '', husbandName: '', whatsappGroupId: '', whatsappGroupName: '',
  botApiKey: '', evolutionApiKey: '', evolutionApiUrl: '',
  discordToken: '', telegramToken: '', geminiApiKey: '',
};

export default function Setup() {
  // WhatsApp connection (single instance per logged-in user)
  const [waStatus, setWaStatus] = useState<WhatsAppStatus>({ exists: false, connected: false, connectionState: 'none' });
  const [qrLoading, setQrLoading] = useState(false);
  const [qrcode, setQrcode] = useState<string | null>(null);
  const [qrError, setQrError] = useState('');
  const [actionError, setActionError] = useState('');
  const [creating, setCreating] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // Settings form
  const [form, setForm] = useState<UserSettings>(EMPTY);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [finding, setFinding] = useState(false);
  const [groupFound, setGroupFound] = useState<'idle' | 'found' | 'notfound'>('idle');
  const [foundGroupName, setFoundGroupName] = useState('');

  // Load WhatsApp status
  const fetchStatus = useCallback(async () => {
    try {
      const data = await api('/api/whatsapp-users');
      setWaStatus(data);
      if (data.connected) {
        setQrcode(null);
        setQrError('');
      }
    } catch {
      // ignore
    }
  }, []);

  // Load settings
  useEffect(() => {
    fetchStatus();
    api('/api/settings')
      .then((data) => setForm({ ...EMPTY, ...data }))
      .catch(() => {})
      .finally(() => setSettingsLoading(false));
  }, [fetchStatus]);

  // Poll while QR is showing
  useEffect(() => {
    if (waStatus.connected || !qrcode) return;
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [waStatus.connected, qrcode, fetchStatus]);

  // Create/link WhatsApp instance
  async function handleCreate() {
    setCreating(true);
    setQrError('');
    try {
      await api('/api/whatsapp-users', { method: 'POST', body: JSON.stringify({}) });
      await fetchStatus();
      // Now fetch QR code
      await fetchQR();
    } catch (err: any) {
      setQrError(err.message || 'Erro ao criar instância');
    } finally {
      setCreating(false);
    }
  }

  // Fetch QR code
  async function fetchQR() {
    setQrLoading(true);
    setQrError('');
    try {
      const data = await api('/api/whatsapp-users/qrcode');
      if (data.connected) {
        setQrcode(null);
        await fetchStatus();
      } else if (data.base64) {
        setQrcode(data.base64);
      } else {
        setQrError('QR Code não disponível');
      }
    } catch (err: any) {
      setQrError(err.message || 'Erro ao gerar QR Code');
    } finally {
      setQrLoading(false);
    }
  }

  // Disconnect
  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await api('/api/whatsapp-users/disconnect', { method: 'POST' });
      setQrcode(null);
      await fetchStatus();
    } catch (err: any) {
      setActionError(err.message || 'Erro ao desconectar');
    } finally {
      setDisconnecting(false);
    }
  }

  // Delete instance
  async function handleUnlink() {
    if (!confirm('Desvincular WhatsApp? A instância será removida.')) return;
    try {
      await api('/api/whatsapp-users', { method: 'DELETE' });
      setQrcode(null);
      setWaStatus({ exists: false, connected: false, connectionState: 'none' });
    } catch (err: any) {
      setActionError(err.message || 'Erro ao desvincular');
    }
  }

  // -- Settings form --
  function setField(name: keyof UserSettings) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [name]: e.target.value }));
  }

  const safeTrim = (val: string | null | undefined) => (val || '').trim();

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaveMsg('');
    setSaving(true);
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify(form) });
      setSaveMsg('Salvo!');
    } catch {
      setSaveMsg('Erro ao salvar');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(''), 3000);
    }
  }

  async function findGroup() {
    const name = safeTrim(form.whatsappGroupName);
    if (!name) return;
    setFinding(true);
    setGroupFound('idle');
    try {
      const instanceParam = waStatus.instanceName ? `&instance=${encodeURIComponent(waStatus.instanceName)}` : '';
      const data = await api(`/api/whatsapp/find-group?name=${encodeURIComponent(name)}${instanceParam}`);
      setForm(prev => ({ ...prev, whatsappGroupId: data.id }));
      setGroupFound('found');
      setFoundGroupName(data.name);
    } catch {
      setGroupFound('notfound');
      setForm(prev => ({ ...prev, whatsappGroupId: '' }));
    } finally {
      setFinding(false);
    }
  }

  const connected = waStatus.connected;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div className="flex items-center gap-3 mb-6">
        <Smartphone className="w-8 h-8 text-emerald-400" />
        <h1 className="text-2xl font-bold text-white">Configuracao</h1>
      </div>

      {/* WhatsApp QR Code */}
      <section className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
            <h2 className="text-lg font-semibold text-white">
              {connected ? 'Conectado' : waStatus.exists ? 'Desconectado' : 'WhatsApp'}
            </h2>
            {waStatus.instanceName && (
              <span className="text-xs text-gray-600 bg-gray-800 px-2 py-0.5 rounded">{waStatus.instanceName}</span>
            )}
          </div>
          <div className="flex gap-2">
            {connected && (
              <button onClick={handleDisconnect} disabled={disconnecting}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 text-sm transition-colors">
                <Power className="w-4 h-4" />
                {disconnecting ? 'Desconectando...' : 'Desconectar'}
              </button>
            )}
            {waStatus.exists && !connected && (
              <button onClick={handleUnlink}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-700/50 hover:bg-gray-700 text-gray-400 text-sm transition-colors">
                Desvincular
              </button>
            )}
          </div>
        </div>

        {/* Not created yet */}
        {!waStatus.exists && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Smartphone className="w-12 h-12 text-gray-600" />
            <p className="text-gray-400 text-sm">Nenhum WhatsApp vinculado a esta conta.</p>
            <button onClick={handleCreate} disabled={creating}
              className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl text-sm font-semibold transition-colors">
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
              {creating ? 'Criando...' : 'Vincular WhatsApp'}
            </button>
          </div>
        )}

        {/* QR loading */}
        {qrLoading && (
          <div className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="w-10 h-10 text-emerald-400 animate-spin" />
            <p className="text-gray-400 text-sm">Gerando QR Code...</p>
          </div>
        )}

        {/* QR error */}
        {qrError && !qrLoading && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-red-400 text-sm text-center">
            {qrError}
            <button onClick={fetchQR} className="ml-3 underline hover:text-red-300">Tentar novamente</button>
          </div>
        )}

        {/* Action error (disconnect/unlink) */}
        {actionError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-red-400 text-sm text-center">
            {actionError}
          </div>
        )}

        {/* QR code display */}
        {!qrLoading && !qrError && !connected && qrcode && (
          <div className="flex flex-col items-center gap-6 py-6">
            <div className="bg-white p-4 rounded-2xl shadow-xl">
              <img src={qrcode} alt="QR Code WhatsApp" className="w-64 h-64" />
            </div>
            <div className="text-center space-y-2">
              <div className="flex items-center justify-center gap-2 text-gray-300">
                <QrCode className="w-5 h-5 text-emerald-400" />
                <p className="text-sm font-medium">Escaneie o QR Code</p>
              </div>
              <ol className="text-xs text-gray-500 space-y-1 max-w-sm mx-auto">
                <li>1. Abra o WhatsApp no celular</li>
                <li>2. Va em Configuracoes &gt; Dispositivos conectados</li>
                <li>3. Toque em "Conectar dispositivo"</li>
                <li>4. Escaneie o QR Code acima</li>
              </ol>
              <button onClick={fetchQR}
                className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 mt-2">
                <RefreshCw className="w-3.5 h-3.5" />Gerar novo QR Code
              </button>
            </div>
          </div>
        )}

        {/* No QR, not loading, exists but not connected */}
        {!qrLoading && !qrError && !connected && !qrcode && waStatus.exists && (
          <div className="flex flex-col items-center gap-4 py-8">
            <QrCode className="w-12 h-12 text-gray-600" />
            <p className="text-gray-400 text-sm">Instancia nao conectada</p>
            <button onClick={fetchQR}
              className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 rounded-xl text-sm font-semibold transition-colors">
              <QrCode className="w-4 h-4" />Gerar QR Code
            </button>
          </div>
        )}

        {/* Connected state */}
        {connected && (
          <div className="flex flex-col items-center gap-4 py-8">
            <CheckCircle2 className="w-16 h-16 text-emerald-400" />
            <p className="text-white text-lg font-medium">WhatsApp conectado!</p>
            <p className="text-gray-400 text-sm">
              Envie mensagens com <code className="bg-gray-800 px-1.5 py-0.5 rounded text-emerald-400">@contas</code> no grupo ou privado.
            </p>
          </div>
        )}
      </section>

      {/* WhatsApp Group */}
      <section className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
        <SectionHeader icon={Smartphone} title="Bot WhatsApp" />
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Nome do Grupo</label>
            <div className="flex gap-2">
              <input type="text" value={form.whatsappGroupName} onChange={setField('whatsappGroupName')} placeholder="Ex: Contas"
                className="flex-1 bg-white/[0.03] border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
              <button type="button" onClick={findGroup} disabled={finding || !safeTrim(form.whatsappGroupName)}
                className="flex items-center gap-1.5 px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 rounded-xl text-sm transition-colors">
                <Search className="w-4 h-4" />{finding ? '...' : 'Buscar'}
              </button>
            </div>
            {groupFound === 'found' && (
              <div className="mt-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <p className="text-sm text-emerald-400 font-medium">✅ Grupo "{foundGroupName}" encontrado!</p>
                <p className="text-xs text-emerald-400/60 mt-1">ID: {form.whatsappGroupId}</p>
                <p className="text-xs text-gray-500 mt-2">⚠️ Role a pagina e clique em <strong>Salvar Configuracoes</strong> para aplicar.</p>
              </div>
            )}
            {groupFound === 'notfound' && (
              <div className="mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <p className="text-sm text-red-400">❌ Grupo nao encontrado</p>
                <p className="text-xs text-red-400/60 mt-1">Verifique se ha um WhatsApp conectado e o nome esta correto.</p>
              </div>
            )}
            {finding && (
              <div className="mt-3 flex items-center gap-2 text-gray-400 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Buscando grupos...
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Settings Form */}
      {!settingsLoading && (
        <form onSubmit={handleSave} className="space-y-6">
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
            <SectionHeader icon={Users} title="Integrantes" />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Nome do Marido" value={form.husbandName} onChange={setField('husbandName')} placeholder="Ex: Jesi" />
              <Field label="Nome da Esposa" value={form.wifeName} onChange={setField('wifeName')} placeholder="Ex: Duda" />
            </div>
          </section>

          <section className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
            <SectionHeader icon={Bot} title="IA / NLP" />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Groq API Key" value={form.groqApiKey} onChange={setField('groqApiKey')} type="password" placeholder="gsk_xxx..." />
              <Field label="Gemini API Key" value={form.geminiApiKey} onChange={setField('geminiApiKey')} type="password" placeholder="AIza..." />
            </div>
          </section>

          <section className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
            <SectionHeader icon={MessageCircle} title="Outros Canais" />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Discord Token" value={form.discordToken} onChange={setField('discordToken')} type="password" placeholder="Token do bot" />
              <Field label="Telegram Token" value={form.telegramToken} onChange={setField('telegramToken')} type="password" placeholder="Token do bot" />
            </div>
          </section>

          <button type="submit" disabled={saving} className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-semibold shadow-lg shadow-emerald-500/20 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200">
            {saving ? 'Salvando...' : (<><Save className="w-4 h-4" />Salvar Configuracoes</>)}
          </button>
          {saveMsg && (
            <p className={`text-center text-sm ${saveMsg === 'Salvo!' ? 'text-emerald-400' : 'text-red-400'}`}>{saveMsg}</p>
          )}
        </form>
      )}

      {/* Exemplos */}
      <section className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold text-white">Exemplos de Mensagens</h2>
        <p className="text-sm text-gray-400">Envie no grupo (ou no privado se nao configurou grupo):</p>
        <div className="space-y-2 text-sm">
          <MsgExample msg="gastei 50 no supermercado" desc="Registra despesa de R$50" />
          <MsgExample msg="recebi 3000 de salario" desc="Registra receita de R$3.000" />
          <MsgExample msg="paguei 120 na farmacia" desc="Registra despesa na farmacia" />
          <MsgExample msg="lembrete: pagar luz dia 25" desc="Cria lembrete para conta" />
          <MsgExample msg="gastei 200 com roupa" desc="Registra despesa em vestuario" />
        </div>
      </section>
    </div>
  );
}

function SectionHeader({ icon: Icon, title }: { icon: React.ComponentType<any>; title: string }) {
  return (
    <div className="flex items-center gap-2 pb-2 border-b border-white/5">
      <Icon className="w-4 h-4 text-emerald-400" />
      <h2 className="text-sm font-semibold text-white uppercase tracking-wider">{title}</h2>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder }: {
  label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; type?: string; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-400 mb-1.5">{label}</label>
      <input type={type} value={value} onChange={onChange} placeholder={placeholder}
        className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/30 transition-all duration-200" />
    </div>
  );
}

function MsgExample({ msg, desc }: { msg: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 bg-gray-800/50 rounded-lg px-4 py-2">
      <span className="text-emerald-400 font-mono text-xs mt-0.5">&gt;</span>
      <div>
        <p className="text-white font-mono text-sm">"{msg}"</p>
        <p className="text-gray-400 text-xs">{desc}</p>
      </div>
    </div>
  );
}
