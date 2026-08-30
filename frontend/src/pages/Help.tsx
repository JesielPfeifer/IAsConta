import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Landmark,
  ShieldCheck,
  RefreshCw,
  Webhook,
  CreditCard,
  CircleHelp,
  ExternalLink,
  KeyRound,
  UserRound,
  Unplug,
  Lightbulb,
  ChevronDown,
  Compass,
  LayoutDashboard,
  ArrowLeftRight,
  Calendar,
  Wallet,
} from 'lucide-react';

/**
 * Ajuda / Primeiros passos — documenta o fluxo real do app,
 * com foco no processo Open Finance (Pluggy) para novos usuários.
 */

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-white/5 bg-gray-900 p-6">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
      <div className="relative">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10">
            {icon}
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
          </div>
        </div>
        {children}
      </div>
    </section>
  );
}

function FlowStep({ n, title, children }: { n: number; title: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-xs font-bold text-emerald-400 border border-emerald-500/30">
        {n}
      </span>
      <div className="min-w-0 pb-4">
        <p className="text-sm font-medium text-white">{title}</p>
        {children && <div className="text-sm text-gray-400 leading-relaxed mt-1">{children}</div>}
      </div>
    </li>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md bg-white/[0.06] border border-white/10 px-1.5 py-0.5 text-[12px] font-medium text-emerald-300 whitespace-nowrap">
      {children}
    </span>
  );
}

function FaqItem({
  q,
  open,
  onToggle,
  children,
}: {
  q: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left group"
      >
        <span className="text-sm font-medium text-gray-200 group-hover:text-white transition-colors">{q}</span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 text-gray-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="px-4 pb-4 text-sm text-gray-400 leading-relaxed">{children}</div>}
    </div>
  );
}

export default function Help() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const toggleFaq = (i: number) => setOpenFaq((cur) => (cur === i ? null : i));

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-b from-emerald-500/[0.06] via-gray-900 to-transparent p-6">
        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
        <div className="relative flex items-center gap-3">
          <Compass className="h-8 w-8 text-emerald-400" />
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Ajuda</h1>
            <p className="text-sm text-gray-400">
              Primeiros passos e guia do Open Finance (Pluggy) para novos usuários
            </p>
          </div>
        </div>
      </div>

      {/* Comece por aqui */}
      <Section icon={<Lightbulb className="h-5 w-5 text-yellow-400" />} title="Comece por aqui">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            {
              to: '/setup',
              icon: <Landmark className="w-4 h-4 text-emerald-400" />,
              t: '1. Conecte seu banco',
              d: 'Ative o Open Finance em Configuração para importar transações e faturas.',
            },
            {
              to: '/salary',
              icon: <Wallet className="w-4 h-4 text-emerald-400" />,
              t: '2. Cadastre seus rendimentos',
              d: 'Calcule o salário líquido e registre rendas fixas de cada pessoa.',
            },
            {
              to: '/bills',
              icon: <Calendar className="w-4 h-4 text-emerald-400" />,
              t: '3. Acompanhe as contas',
              d: 'Contas a Pagar e a Receber do mês, incluindo faturas de cartão.',
            },
            {
              to: '/',
              icon: <LayoutDashboard className="w-4 h-4 text-emerald-400" />,
              t: '4. Acompanhe o resumo',
              d: 'O Dashboard mostra saldo, comparação com o mês anterior e dicas da IA.',
            },
          ].map((c) => (
            <Link
              key={c.to}
              to={c.to}
              className="group rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-emerald-500/30 p-4 transition-all duration-200"
            >
              <div className="flex items-center gap-2">
                {c.icon}
                <p className="text-sm font-semibold text-white group-hover:text-emerald-300 transition-colors">{c.t}</p>
              </div>
              <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">{c.d}</p>
            </Link>
          ))}
        </div>
      </Section>

      {/* Fluxo de conexão */}
      <Section
        icon={<Landmark className="h-5 w-5 text-emerald-400" />}
        title="Conectando seu banco (Open Finance)"
        subtitle="Passo a passo do fluxo completo dentro do IAsConta"
      >
        <ol className="mt-1">
          <FlowStep n={1} title="Abra a página Configuração">
            No menu lateral, entre em <Kbd>Configuração</Kbd> e localize o cartão{' '}
            <strong className="text-gray-200">Bancos (Pluggy Open Finance)</strong>.
          </FlowStep>
          <FlowStep n={2} title="Confira suas credenciais Pluggy">
            Informe o <Kbd>Client ID</Kbd> e o <Kbd>Client Secret</Kbd> do painel Pluggy e clique em{' '}
            <Kbd>Salvar Credenciais</Kbd> e depois em <Kbd>Testar Conexão</Kbd>. Se o servidor já tiver credenciais
            globais, essa etapa já vem pronta — cada pessoa do casal também pode usar as próprias.
          </FlowStep>
          <FlowStep n={3} title="Clique em “Conectar Novo Banco”">
            O widget oficial do Open Finance (Pluggy Connect) abre sobre a página.
          </FlowStep>
          <FlowStep n={4} title="Escolha sua instituição">
            Busque pelo nome do seu banco (Caixa, Nubank etc.). Na lista pode aparecer também o conector agregador{' '}
            <strong className="text-gray-200">“Meu Pluggy”</strong>, que reúne conexões já autorizadas na sua conta
            Pluggy.
          </FlowStep>
          <FlowStep n={5} title="Entre com as credenciais do seu banco">
            A tela seguinte é do próprio banco (via Pluggy). Suas senha e credenciais bancárias vão direto para a
            instituição — <strong className="text-gray-200">não ficam armazenadas no IAsConta</strong>.
          </FlowStep>
          <FlowStep n={6} title="Autorize o compartilhamento">
            Confirme o consentimento Open Finance para que o app possa ler contas, transações e faturas.
          </FlowStep>
          <FlowStep n={7} title="Aguarde a sincronização">
            Ao concluir, o app sincroniza na hora e passa a receber novidades automaticamente via{' '}
            <strong className="text-gray-200">webhook</strong>. Dica: clique em{' '}
            <Kbd>Ativar Sync Automático (Webhooks)</Kbd> uma única vez após conectar. O ícone <RefreshCw className="inline w-3.5 h-3.5 -mt-0.5" />{' '}
            ao lado de cada conexão força uma sincronização manual.
          </FlowStep>
          <FlowStep n={8} title="Confira o resultado">
            As compras aparecem em <Link to="/transactions" className="text-emerald-400 hover:underline">Transações</Link>{' '}
            agrupadas por cartão/forma de pagamento, e as faturas viram contas em{' '}
            <Link to="/bills" className="text-emerald-400 hover:underline">Contas a Pagar</Link>.
          </FlowStep>
        </ol>
      </Section>

      {/* Como funciona */}
      <Section
        icon={<ShieldCheck className="h-5 w-5 text-emerald-400" />}
        title="Entendendo a sincronização"
        subtitle="Credenciais, status e regras do Open Finance no app"
      >
        <div className="space-y-4">
          <div className="flex gap-3">
            <UserRound className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <p className="text-sm text-gray-300 leading-relaxed">
              <strong className="text-white">As credenciais são por usuário.</strong> Cada pessoa do casal conecta as
              próprias contas em <Kbd>Configuração</Kbd>, com o próprio login do painel Pluggy — assim as transações já
              chegam vinculadas ao dono (marido/esposa) sempre que o banco informa.
            </p>
          </div>
          <div className="flex gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <p className="text-sm text-gray-300 leading-relaxed">
              <strong className="text-white">Status da conexão.</strong> Cada conexão mostra um status:{' '}
              <span className="text-emerald-400">Sincronizado</span> (verde, tudo certo) ou alertas em amarelo como{' '}
              <span className="text-amber-400">Erro de login</span>, <span className="text-amber-400">Aguardando MFA</span>{' '}
              ou <span className="text-amber-400">Desatualizado</span>. Quando cai (troca de senha no banco, MFA
              pendente), basta clicar em <Kbd>Conectar Novo Banco</Kbd> novamente e refazer a autorização — depois use o
              botão de sync manual.
            </p>
          </div>
          <div className="flex gap-3">
            <Webhook className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <p className="text-sm text-gray-300 leading-relaxed">
              <strong className="text-white">Sync automático e manual.</strong> Com webhooks ativos, o banco avisa o app
              a cada lançamento novo e a sincronização acontece sozinha. Sem webhooks (ou na dúvida), toque no ícone{' '}
              <RefreshCw className="inline w-3.5 h-3.5 -mt-0.5" /> da conexão para buscar tudo agora.
            </p>
          </div>
          <div className="flex gap-3">
            <CreditCard className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <p className="text-sm text-gray-300 leading-relaxed">
              <strong className="text-white">Fatura prevista × fatura oficial.</strong> Enquanto o banco não publica a
              fatura fechada do mês, <Link to="/bills" className="text-emerald-400 hover:underline">Contas a Pagar</Link>{' '}
              mostra um cartão âmbar de <strong className="text-amber-300">fatura prevista</strong> (projeção das compras
              do ciclo) e o <strong className="text-gray-200">Total Pendente já a inclui</strong>. Você pode registrar a
              previsão como conta a pagar editável; quando a fatura oficial chega pelo Open Finance, ela passa a valer —
              com créditos e estornos considerados.
            </p>
          </div>
          <div className="flex gap-3">
            <KeyRound className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <p className="text-sm text-gray-300 leading-relaxed">
              <strong className="text-white">Editar protege do sync.</strong> Se você corrigir o valor ou a descrição de
              uma transação importada, o app marca aquela linha como editada manualmente e{' '}
              <strong className="text-white">não sobrescreve</strong> nas próximas sincronizações.
            </p>
          </div>
        </div>
      </Section>

      {/* Meu Pluggy */}
      <Section
        icon={<ExternalLink className="h-5 w-5 text-emerald-400" />}
        title="Painel Meu Pluggy (my.pluggy.ai)"
        subtitle="Sua central de consentimentos do Open Finance"
      >
        <div className="space-y-3 text-sm text-gray-300 leading-relaxed">
          <p>
            O <a href="https://my.pluggy.ai" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">my.pluggy.ai</a>{' '}
            é o painel onde você acompanha, fora do IAsConta, todas as conexões ativas da sua conta: quais instituições
            estão vinculadas e quando compartilharam dados.
          </p>
          <p>
            É lá também que você pode <strong className="text-white">revogar o consentimento</strong> de qualquer banco a
            qualquer momento (seu direito previstos no Open Finance/LGPD). O IAsConta consome a mesma conexão — se o
            consentimento for revogado, a sincronização para até você conectar o banco de novo.
          </p>
          <p className="text-gray-400">
            Já conectou o banco pelo painel e o app reclamou de <code className="text-amber-400">ITEM_USER_ALREADY_EXISTS</code>?
            Em <Kbd>Configuração</Kbd>, use <Kbd>Anexar Item Existente</Kbd> informando o ID do item que aparece no painel
            para reaproveitar a conexão sem duplicar.
          </p>
        </div>
      </Section>

      {/* Desvincular */}
      <Section
        icon={<Unplug className="h-5 w-5 text-red-400" />}
        title="Desvinculando um banco"
        subtitle="Remova a conexão quando quiser"
      >
        <ol className="space-y-2 text-sm text-gray-300 leading-relaxed list-decimal list-inside">
          <li>
            Vá em <Kbd>Configuração</Kbd> → cartão <strong className="text-gray-200">Bancos (Pluggy Open Finance)</strong>.
          </li>
          <li>
            Na conexão desejada, clique no ícone da lixeira e confirme. As transações e faturas importadas por aquela
            conexão também são removidas do app.
          </li>
          <li>
            Para encerrar o compartilhamento de vez, revogue o consentimento no painel{' '}
            <a href="https://my.pluggy.ai" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">my.pluggy.ai</a>.
          </li>
        </ol>
      </Section>

      {/* FAQ */}
      <Section icon={<CircleHelp className="h-5 w-5 text-emerald-400" />} title="Perguntas frequentes">
        <div className="space-y-2">
          <FaqItem
            q="Conectei meu banco, mas meu cartão não aparece. E agora?"
            open={openFaq === 0}
            onToggle={() => toggleFaq(0)}
          >
            Primeiro confira se a conexão está com status <span className="text-emerald-400">Sincronizado</span> em{' '}
            <Kbd>Configuração</Kbd>. Se sim, force um sync manual pelo ícone <RefreshCw className="inline w-3.5 h-3.5 -mt-0.5" /> e
            aguarde alguns instantes: compras de cartão aparecem em <em>Transações</em> dentro do grupo{' '}
            <strong className="text-gray-200">Fatura</strong> do respectivo cartão, e a fatura em <em>Contas a Pagar</em>.
            Compras pendentes no banco podem levar um pouco até serem confirmadas pela instituição.
          </FaqItem>
          <FaqItem
            q="O valor da fatura está diferente do app do banco. Por quê?"
            open={openFaq === 1}
            onToggle={() => toggleFaq(1)}
          >
            São duas faturas diferentes: a <strong className="text-amber-300">prevista</strong> (projeção do ciclo aberto,
            feita pelo app enquanto o banco não fecha a fatura) e a{' '}
            <strong className="text-gray-200">oficial</strong> (publicada pelo banco via Open Finance, que já considera
            créditos, estornos e ajustes). Quando a oficial é publicada, ela substitui a previsão. Pagamento de fatura não
            é lançado duas vezes — o app conta a fatura uma única vez.
          </FaqItem>
          <FaqItem
            q="Uma transação veio errada do banco. Posso corrigir?"
            open={openFaq === 2}
            onToggle={() => toggleFaq(2)}
          >
            Sim. Edite o valor clicando nele (ou use o lápis) em <em>Transações</em>. Depois da edição, o app{' '}
            <strong className="text-white">preserva</strong> aquele registro nas próximas sincronizações — o sync não
            sobrescreve o que você corrigiu.
          </FaqItem>
          <FaqItem
            q="Excluí uma transação e ela voltou. O que fazer?"
            open={openFaq === 3}
            onToggle={() => toggleFaq(3)}
          >
            Ao excluir uma transação importada, o app mantém o lançamento oculto nas próximas sincronizações. Para
            exibi-lo novamente, restaure o lançamento. Para lançamentos recorrentes que precisam de ajuste, prefira{' '}
            <strong className="text-white">editar</strong>; a edição é preservada nas próximas sincronizações.
          </FaqItem>
          <FaqItem
            q="Como desvinculo meu banco?"
            open={openFaq === 4}
            onToggle={() => toggleFaq(4)}
          >
            Em <Kbd>Configuração</Kbd>, clique na lixeira da conexão (isso remove também as transações importadas por
            ela). Para encerrar o compartilhamento definitivamente, revogue o consentimento no{' '}
            <a href="https://my.pluggy.ai" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">my.pluggy.ai</a>.
          </FaqItem>
          <FaqItem
            q="Minha conexão caiu / pede login de novo. E agora?"
            open={openFaq === 5}
            onToggle={() => toggleFaq(5)}
          >
            Status em amarelo (<span className="text-amber-400">Erro de login</span>,{' '}
            <span className="text-amber-400">Aguardando MFA</span>) significam que o banco exige nova autenticação —
            acontece ao trocar de senha ou periodicamente, por segurança. Clique em <Kbd>Conectar Novo Banco</Kbd>,
            refaça a autorização no widget e depois force um sync manual.
          </FaqItem>
          <FaqItem
            q="Preciso de conta no Pluggy? Quem paga isso?"
            open={openFaq === 6}
            onToggle={() => toggleFaq(6)}
          >
            O IAsConta usa o Pluggy como agregador Open Finance. Cada usuário cria a própria conta gratuita no painel
            Pluggy e informa <Kbd>Client ID</Kbd>/<Kbd>Client Secret</Kbd> em <Kbd>Configuração</Kbd>; se o servidor onde
            o app roda já tiver credenciais globais, esse passo é opcional. Os limites do plano escolhido se aplicam à
            sua conta.
          </FaqItem>
        </div>
      </Section>

      {/* Rodapé */}
      <p className="text-center text-xs text-gray-600 pb-4">
        Dica: cada página principal tem um tour interativo na primeira visita — use o menu acima para explorar. Precisa
        registrar lançamentos rápido? Experimente o bot WhatsApp em <Kbd>Configuração</Kbd>.
      </p>
    </div>
  );
}
