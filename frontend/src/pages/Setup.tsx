import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { Loader2, Smartphone, Save, Users, Bot, MessageCircle, Search } from 'lucide-react';
import { api } from '../api/client';
import WhatsAppInstanceCard from '../components/WhatsAppInstanceCard';
import PluggySettingsCard from '../components/PluggySettingsCard';

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

const EMPTY: UserSettings = {
  groqApiKey: '', wifeName: '', husbandName: '', whatsappGroupId: '', whatsappGroupName: '',
  botApiKey: '', evolutionApiKey: '', evolutionApiUrl: '',
  discordToken: '', telegramToken: '', geminiApiKey: '',
};

export default function Setup() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [form, setForm] = useState<UserSettings>(EMPTY);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [finding, setFinding] = useState(false);
  const [groupFound, setGroupFound] = useState<'idle' | 'found' | 'notfound'>('idle');
  const [foundGroupName, setFoundGroupName] = useState('');

  useEffect(() => {
    api('/api/settings')
      .then((data) => setForm({ ...EMPTY, ...data }))
      .catch(() => {})
      .finally(() => setSettingsLoading(false));
  }, []);

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
      const data = await api(`/api/whatsapp/find-group?name=${encodeURIComponent(name)}`);
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










  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div className="flex items-center gap-3 mb-6">
        <Smartphone className="w-8 h-8 text-emerald-400" />
        <h1 className="text-2xl font-bold text-white">Configuracao</h1>
      </div>

            <WhatsAppInstanceCard />

            <PluggySettingsCard />

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
                <p className="text-xs text-red-400/60 mt-1">Verifique se o WhatsApp esta conectado e o nome esta correto.</p>
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
