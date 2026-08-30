import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api } from '../api/client';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Check,
  DollarSign,
  CreditCard,
  Users,
  PartyPopper,
  Landmark,
  LayoutDashboard,
  MessageCircle,
  Loader2,
  Wallet2,
} from 'lucide-react';

/**
 * Wizard de setup inicial (onboarding pós-login).
 *
 * Aparece logo após o login quando o usuário ainda não completou a
 * configuração básica (salário, cartão de crédito e nomes do casal),
 * decidido por GET /api/setup/status. Pode ser pulado em qualquer etapa;
 * a escolha de pular fica em localStorage (prefixo `iasconta.onboarding.`,
 * mesmo padrão do tour interativo das páginas).
 */

const DONE_KEY = 'iasconta.onboarding.setup-inicial';

interface SetupStatus {
  complete: boolean;
  missing: string[];
}

const STEP_LABELS = ['Boas-vindas', 'Salário', 'Cartão', 'Casal', 'Concluído'];

export default function SetupWizard() {
  const { user, updateUser } = useAuth();

  const [visible, setVisible] = useState(false);
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState(0);

  const [salary, setSalary] = useState('');
  const [cardName, setCardName] = useState('');
  const [wifeName, setWifeName] = useState('');
  const [husbandName, setHusbandName] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const totalSteps = STEP_LABELS.length;
  const isLast = step === totalSteps - 1;

  // Decide se o wizard deve abrir: ainda não pulou E setup incompleto.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (localStorage.getItem(DONE_KEY) === 'done') return;
        const status = await api<SetupStatus>('/api/setup/status');
        if (!cancelled && !status.complete) {
          setVisible(true);
          setSalary(user?.salary ? String(user.salary) : '');
        }
      } catch {
        // Sem status (rede/erro) não bloqueia o acesso ao app.
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const firstName = useMemo(() => (user?.name || '').trim().split(/\s+/)[0] || '', [user]);

  async function finish() {
    try {
      localStorage.setItem(DONE_KEY, 'done');
    } catch {
      // localStorage indisponível — ignora
    }
    setVisible(false);
  }

  async function skipAll() {
    await finish();
  }

  /** Avança uma etapa salvando os dados preenchidos (etapas são opcionais). */
  async function next() {
    setError('');
    setSaving(true);
    try {
      // Etapa 2 — Salário mensal
      if (step === 1 && salary.trim()) {
        const parsed = parseFloat(salary.replace(',', '.'));
        if (Number.isFinite(parsed) && parsed > 0) {
          const updated = await api<{ salary: number | null }>('/api/users/me', {
            method: 'PUT',
            body: JSON.stringify({ salary: parsed }),
          });
          updateUser({ salary: updated.salary });
        } else {
          setError('Informe um valor válido (ex.: 4500) ou pule a etapa.');
          setSaving(false);
          return;
        }
      }
      // Etapa 3 — Cartão de crédito
      if (step === 2 && cardName.trim()) {
        await api('/api/payment-methods', {
          method: 'POST',
          body: JSON.stringify({ name: cardName.trim(), type: 'CARD' }),
        });
      }
      // Etapa 4 — Nomes do casal
      if (step === 3 && (wifeName.trim() || husbandName.trim())) {
        await api('/api/settings', {
          method: 'PUT',
          body: JSON.stringify({ wifeName: wifeName.trim(), husbandName: husbandName.trim() }),
        });
      }
    } catch (err: any) {
      setError(err?.message || 'Não foi possível salvar. Tente novamente.');
      setSaving(false);
      return;
    }
    setSaving(false);
    if (isLast) {
      await finish();
    } else {
      setStep((s) => s + 1);
    }
  }

  function back() {
    setError('');
    setStep((s) => Math.max(0, s - 1));
  }

  if (!visible || checking) return null;

  const inputClass =
    'w-full bg-white/[0.03] border border-white/10 rounded-xl pl-10 pr-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/30 transition-all duration-200';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-950/80 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-gray-900 border border-white/10 shadow-2xl shadow-black/50 overflow-hidden">
        {/* Cabeçalho */}
        <div className="px-7 pt-7 pb-4 relative">
          <button
            onClick={finish}
            aria-label="Fechar"
            className="absolute right-4 top-4 p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/25">
              <Wallet2 className="w-5 h-5 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">Setup inicial</h2>
              <p className="text-xs text-gray-500">Configure o essencial em poucos minutos</p>
            </div>
          </div>

          {/* Indicador de etapas */}
          <div className="flex items-center gap-1.5 mt-5">
            {STEP_LABELS.map((label, i) => (
              <div key={label} className="flex-1" title={label}>
                <div
                  className={`h-1 rounded-full transition-all duration-300 ${
                    i <= step ? 'bg-emerald-500' : 'bg-white/10'
                  }`}
                />
              </div>
            ))}
          </div>
          <p className="text-[11px] uppercase tracking-wider text-emerald-400/80 font-medium mt-2">
            Passo {step + 1} de {totalSteps} · {STEP_LABELS[step]}
          </p>
        </div>

        {/* Conteúdo */}
        <div className="px-7 pb-2 min-h-[280px]">
          {error && (
            <div className="mb-4 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2.5 text-red-400 text-sm">
              {error}
            </div>
          )}

          {step === 0 && (
            <div>
              <h3 className="text-xl font-bold text-white">
                Bem-vindo{firstName ? `, ${firstName}` : ''}! 👋
              </h3>
              <p className="text-sm text-gray-400 mt-2 leading-relaxed">
                Vamos deixar seu IAsConta pronto para controlar as finanças do casal. São só
                alguns passos rápidos — e você pode pular qualquer um deles.
              </p>
              <ul className="mt-5 space-y-3">
                <StepRow icon={<DollarSign className="w-4 h-4 text-emerald-400" />} title="Seu salário mensal" desc="Base para as projeções do mês e do dashboard." />
                <StepRow icon={<CreditCard className="w-4 h-4 text-emerald-400" />} title="Seu cartão de crédito" desc="Registre a forma de pagamento para lançar compras." />
                <StepRow icon={<Users className="w-4 h-4 text-emerald-400" />} title="Nomes do casal" desc="Relatórios e comparações por pessoa." />
                <StepRow icon={<Landmark className="w-4 h-4 text-emerald-400" />} title="Conecte seu banco depois" desc="Em Configuração, o Open Finance (Pluggy) importa transações e faturas automaticamente." />
              </ul>
            </div>
          )}

          {step === 1 && (
            <div>
              <h3 className="text-xl font-bold text-white">Qual é o seu salário mensal?</h3>
              <p className="text-sm text-gray-400 mt-2 leading-relaxed">
                Usamos esse valor nas projeções de renda e no resumo do mês. Você pode ajustar a
                qualquer momento na página Salário.
              </p>
              <label className="block text-sm font-medium text-gray-400 mt-5 mb-1.5">
                Salário mensal (líquido)
              </label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={salary}
                  onChange={(e) => setSalary(e.target.value)}
                  placeholder="Ex.: 4500"
                  className={inputClass}
                />
              </div>
              <p className="text-xs text-gray-600 mt-2">Deixe em branco e clique em “Pular etapa” se preferir.</p>
            </div>
          )}

          {step === 2 && (
            <div>
              <h3 className="text-xl font-bold text-white">Quais cartões de crédito você usa?</h3>
              <p className="text-sm text-gray-400 mt-2 leading-relaxed">
                Registre o nome do cartão (ex.: Nubank, Caixa) para classificar as compras por
                forma de pagamento.
              </p>
              <label className="block text-sm font-medium text-gray-400 mt-5 mb-1.5">
                Nome do cartão
              </label>
              <div className="relative">
                <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  value={cardName}
                  onChange={(e) => setCardName(e.target.value)}
                  placeholder="Ex.: Nubank"
                  className={inputClass}
                />
              </div>
              <p className="text-xs text-gray-600 mt-2">
                Dica: para importar faturas automaticamente, conecte seu banco em{' '}
                <span className="text-emerald-400/80">Configuração → Open Finance</span>.
              </p>
            </div>
          )}

          {step === 3 && (
            <div>
              <h3 className="text-xl font-bold text-white">Quem faz parte do casal?</h3>
              <p className="text-sm text-gray-400 mt-2 leading-relaxed">
                Os nomes aparecem nos relatórios por pessoa (marido/esposa) e no bot do WhatsApp.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1.5">Nome do marido</label>
                  <input
                    type="text"
                    value={husbandName}
                    onChange={(e) => setHusbandName(e.target.value)}
                    placeholder="Ex.: Jesi"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1.5">Nome da esposa</label>
                  <input
                    type="text"
                    value={wifeName}
                    onChange={(e) => setWifeName(e.target.value)}
                    placeholder="Ex.: Duda"
                    className={inputClass}
                  />
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="text-center py-2">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                <PartyPopper className="w-8 h-8 text-emerald-400" />
              </div>
              <h3 className="text-xl font-bold text-white mt-4">Tudo pronto! 🎉</h3>
              <p className="text-sm text-gray-400 mt-2 leading-relaxed">
                Seu setup básico está salvo. Próximos passos para extrair o máximo do IAsConta:
              </p>
              <ul className="mt-4 space-y-2 text-left max-w-sm mx-auto">
                <StepRow icon={<Landmark className="w-4 h-4 text-emerald-400" />} title="Conecte seu banco (Open Finance)" desc="Importa transações e faturas automaticamente." />
                <StepRow icon={<MessageCircle className="w-4 h-4 text-emerald-400" />} title="Ative o bot no WhatsApp" desc="Registre gastos conversando, direto do grupo." />
                <StepRow icon={<LayoutDashboard className="w-4 h-4 text-emerald-400" />} title="Acompanhe o dashboard" desc="Saldo, comparação com o mês anterior e dicas da IA." />
              </ul>
            </div>
          )}
        </div>

        {/* Ações */}
        <div className="px-7 py-5 flex items-center justify-between gap-2 border-t border-white/5 mt-4">
          <button
            onClick={step === 0 ? skipAll : back}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
          >
            {step === 0 ? <X className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
            {step === 0 ? 'Pular tudo' : 'Voltar'}
          </button>

          <div className="flex items-center gap-2">
            {!isLast && step > 0 && (
              <button
                onClick={() => {
                  setError('');
                  setStep((s) => s + 1);
                }}
                disabled={saving}
                className="text-xs text-gray-400 hover:text-gray-200 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors disabled:opacity-50"
              >
                Pular etapa
              </button>
            )}
            <button
              onClick={next}
              disabled={saving}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 disabled:opacity-50 text-white shadow-lg shadow-emerald-500/20 transition-all"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Salvando...
                </>
              ) : isLast ? (
                <>
                  <Check className="w-4 h-4" /> Começar a usar
                </>
              ) : (
                <>
                  Próximo <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepRow({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20">
        {icon}
      </span>
      <div>
        <p className="text-sm font-medium text-white">{title}</p>
        <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
      </div>
    </li>
  );
}