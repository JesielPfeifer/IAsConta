import { useState, useEffect, type FormEvent } from 'react';
import { Cog, Save, Key, Users, Bot, MessageCircle } from 'lucide-react';
import { api } from '../api/client';

interface UserSettings {
  groqApiKey: string;
  wifeName: string;
  husbandName: string;
  whatsappGroupId: string;
  botApiKey: string;
  evolutionApiKey: string;
  evolutionApiUrl: string;
  discordToken: string;
  telegramToken: string;
  geminiApiKey: string;
}

const EMPTY: UserSettings = {
  groqApiKey: '',
  wifeName: '',
  husbandName: '',
  whatsappGroupId: '',
  botApiKey: '',
  evolutionApiKey: '',
  evolutionApiUrl: '',
  discordToken: '',
  telegramToken: '',
  geminiApiKey: '',
};

export default function Settings() {
  const [form, setForm] = useState<UserSettings>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await api('/api/settings');
        setForm({ ...EMPTY, ...data });
      } catch (err: any) {
        setError(err.message || 'Erro ao carregar configuracoes');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function set(name: keyof UserSettings) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [name]: e.target.value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(form),
      });
      setSuccess('Configuracoes salvas com sucesso!');
    } catch (err: any) {
      setError(err.message || 'Erro ao salvar configuracoes');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="flex items-center gap-3">
        <Cog className="w-7 h-7 text-emerald-400" />
        <h1 className="text-2xl font-bold text-white">Configuracoes</h1>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2.5 text-red-400 text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-2.5 text-emerald-400 text-sm">
          {success}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="bg-gray-900/50 border border-white/10 rounded-2xl p-6 space-y-4">
          <SectionHeader icon={MessageCircle} title="WhatsApp" />
          <Field
            label="Evolution API Key"
            value={form.evolutionApiKey}
            onChange={set('evolutionApiKey')}
            placeholder="evolution-api-key"
          />
          <Field
            label="Evolution API URL"
            value={form.evolutionApiUrl}
            onChange={set('evolutionApiUrl')}
            placeholder="https://api.example.com"
          />
          <Field
            label="WhatsApp Group ID"
            value={form.whatsappGroupId}
            onChange={set('whatsappGroupId')}
            placeholder="120363XXX@g.us"
          />
          <Field
            label="Bot API Key"
            value={form.botApiKey}
            onChange={set('botApiKey')}
            placeholder="bot-api-key"
          />
        </section>

        <section className="bg-gray-900/50 border border-white/10 rounded-2xl p-6 space-y-4">
          <SectionHeader icon={Users} title="Integrantes" />
          <Field
            label="Nome do Marido"
            value={form.husbandName}
            onChange={set('husbandName')}
            placeholder="Nome do marido"
          />
          <Field
            label="Nome da Esposa"
            value={form.wifeName}
            onChange={set('wifeName')}
            placeholder="Nome da esposa"
          />
        </section>

        <section className="bg-gray-900/50 border border-white/10 rounded-2xl p-6 space-y-4">
          <SectionHeader icon={Bot} title="IA / NLP" />
          <Field
            label="Groq API Key"
            value={form.groqApiKey}
            onChange={set('groqApiKey')}
            type="password"
            placeholder="gsk_xxx..."
          />
          <Field
            label="Gemini API Key"
            value={form.geminiApiKey}
            onChange={set('geminiApiKey')}
            type="password"
            placeholder="AIza..."
          />
        </section>

        <section className="bg-gray-900/50 border border-white/10 rounded-2xl p-6 space-y-4">
          <SectionHeader icon={MessageCircle} title="Outros Canais" />
          <Field
            label="Discord Token"
            value={form.discordToken}
            onChange={set('discordToken')}
            type="password"
            placeholder="Discord bot token"
          />
          <Field
            label="Telegram Token"
            value={form.telegramToken}
            onChange={set('telegramToken')}
            type="password"
            placeholder="Telegram bot token"
          />
        </section>

        <button
          type="submit"
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 disabled:opacity-50 text-white py-3 rounded-xl text-sm font-semibold shadow-lg shadow-emerald-500/20 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
        >
          {saving ? (
            'Salvando...'
          ) : (
            <>
              <Save className="w-4 h-4" />
              Salvar Configuracoes
            </>
          )}
        </button>
      </form>
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

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-400 mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/30 transition-all duration-200"
      />
    </div>
  );
}
