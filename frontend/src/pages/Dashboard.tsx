import { useState, useEffect } from 'react';
import { useDashboard } from '../hooks/useDashboard';
import { useTransactions } from '../hooks/useTransactions';
import { ArrowUpRight, ArrowDownRight, Wallet, PieChart, BarChart3, Clock, CheckSquare, CreditCard, Lightbulb, Calendar, TrendingUp, TrendingDown, DollarSign, Receipt, X } from 'lucide-react';
import { PieChart as RePie, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import dayjs from 'dayjs';
import { api } from '../api/client';
import { useOnboarding } from '../hooks/useOnboarding';

const COLORS = ['#10b981', '#14b8a6', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#f97316', '#ef4444', '#84cc16', '#a855f7', '#14b8a6', '#e11d48'];

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

interface Bill {
  id: string;
  name: string;
  amount: number;
  isPaid: boolean;
  dueDate: string;
  categoryName?: string;
  categoryId?: string;
}

export default function Dashboard() {
  const [pixReceived, setPixReceived] = useState<any[]>([]);
  const [pixLoading, setPixLoading] = useState(false);
  const [pixAddedIds, setPixAddedIds] = useState<string[]>([]);
  const [pixAddingId, setPixAddingId] = useState<string | null>(null);
  // Dispensa o card de PIX/DOC por mês (localStorage: volta no mês seguinte)
  const currentMonth = dayjs().format('YYYY-MM');
  const [pixReceiptDismissed, setPixReceiptDismissed] = useState(
    () => localStorage.getItem('pixReceiptDismissMonth') === currentMonth
  );
  const dismissPixReceipt = () => {
    localStorage.setItem('pixReceiptDismissMonth', currentMonth);
    setPixReceiptDismissed(true);
  };

  // PIX/DOC recebidos via Pluggy que ainda não viraram entrada manual — o
  // usuário decide se quer adicionar como receita (regra: só fatura de cartão
  // conta automaticamente; PIX fica a critério).
  async function loadPixReceived() {
    try {
      setPixLoading(true);
      const rows = await api('/api/transactions/pix-received');
      setPixReceived(Array.isArray(rows) ? rows : []);
    } catch {
      setPixReceived([]);
    } finally {
      setPixLoading(false);
    }
  }

  useEffect(() => { loadPixReceived(); /* eslint-disable-next-line */ }, []);

  async function addPixAsIncome(id: string) {
    // Guarda de duplo clique: o backend já é atômico/idempotente, mas o botão
    // desabilitado evita o alerta de "já adicionado" em cliques rápidos.
    if (pixAddingId) return;
    setPixAddingId(id);
    try {
      await api(`/api/transactions/pix-received/${id}/add`, { method: 'POST' });
      setPixAddedIds((p) => [...p, id]);
      setPixReceived((p) => p.filter((t) => t.id !== id));
    } catch (err: any) {
      // Já convertido (duplo clique/aba repetida): remove da lista sem alarme.
      if (String(err.message || '').toLowerCase().includes('já adicionado')) {
        setPixReceived((p) => p.filter((t) => t.id !== id));
      } else {
        alert(err.message || 'Erro ao adicionar');
      }
    } finally {
      setPixAddingId(null);
    }
  }

  // ── Onboarding interativo (primeira visita) ──
  const onboarding = useOnboarding('dashboard', [
    { target: '.iasconta-summary-cards', title: 'Resumo do mês', description: 'Cards com receitas, despesas e saldo do mês selecionado. Use o seletor de mês no topo para navegar entre períodos.' },
    { target: '.iasconta-month-compare', title: 'Comparação mensal', description: 'Veja a variação das suas despesas e receitas em relação ao mês anterior para acompanhar a evolução.' },
    { target: '.iasconta-ai-tip', title: 'Dica da IA', description: 'Análises e sugestões automáticas baseadas nos seus dados financeiros aparecem aqui.' },
  ]);
  const [month, setMonth] = useState(dayjs().format('YYYY-MM'));
  const { summary, byCategory, byPayment, creditCardTotal, comparison, yearAnalysis, tip, loading } = useDashboard(month);
  const { transactions } = useTransactions({ month });
  
  const [bills, setBills] = useState<Bill[]>([]);
  const [incomeTx, setIncomeTx] = useState<any[]>([]);
  const [loadingExtras, setLoadingExtras] = useState(true);

  useEffect(() => {
    const loadExtras = async () => {
      try {
        const [billsData, incomeData] = await Promise.all([
          api('/api/bills').catch(() => []),
          api(`/api/dashboard/income-detail?month=${encodeURIComponent(month)}`).catch(() => []),
        ]);
        const mappedBills = Array.isArray(billsData)
          ? billsData.map((b: any) => ({ ...b, categoryName: b.category?.name || '-' }))
          : [];
        setBills(mappedBills);
        setIncomeTx(Array.isArray(incomeData) ? incomeData : []);
      } catch {
        // silent
      } finally {
        setLoadingExtras(false);
      }
    };
    loadExtras();
  }, [month]);
  const now = dayjs(month + '-01');
  const monthStart = now.startOf('month');
  const monthEnd = now.endOf('month');

  const monthBills = bills.filter((b) => {
    const due = dayjs(b.dueDate);
    return due.isAfter(monthStart.subtract(1, 'day')) && due.isBefore(monthEnd.add(1, 'day'));
  });

  // Exclude bill-linked transactions: the summary counts the fatura (Bill)
  // once, and showing the card purchases here too would double-display them.
  const variableExpenses = transactions.filter(
    (t) => t.type === 'EXPENSE' && !t.isFixed && !t.billId
  );
  
  const fixedExpenses = transactions.filter(
    (t) => t.type === 'EXPENSE' && t.isFixed && !t.billId
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400" />
      </div>
    );
  }

  const totalIncome = summary?.totalIncome ?? 0;
  const totalExpense = summary?.totalExpense ?? 0;
  const balance = summary?.balance ?? 0;

  const pieData = byCategory.map((c) => ({ name: c.category, value: Math.abs(c.total) }));
  const byPaymentData = byPayment.map((p) => ({ method: p.method, total: p.total }));

  return (
    <div className="space-y-6">
      {onboarding}
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-b from-emerald-500/[0.06] via-gray-900 to-transparent p-6">
        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
        <div className="relative flex items-center justify-between gap-4 flex-wrap">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-emerald-400/80">Visao geral</p>
            <h1 className="text-3xl font-bold tracking-tight text-white">Dashboard</h1>
            <p className="text-sm text-gray-400">Acompanhe suas finanças em tempo real</p>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-emerald-400" />
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 [color-scheme:dark]"
            />
          </div>
        </div>
      </div>

      {/* Cards resumo */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 iasconta-summary-cards">
        <SummaryCard
          label="Saldo do mês"
          value={formatCurrency(balance)}
          icon={<Wallet className="h-5 w-5 text-emerald-400" />}
          color={balance >= 0 ? 'text-emerald-400' : 'text-red-400'}
          bgIcon="bg-emerald-500/10"
        />
        <SummaryCard
          label="Receitas"
          value={formatCurrency(totalIncome)}
          icon={<ArrowUpRight className="h-5 w-5 text-emerald-400" />}
          color="text-emerald-400"
          bgIcon="bg-emerald-500/10"
        />
        <SummaryCard
          label="Despesas"
          value={formatCurrency(totalExpense)}
          icon={<ArrowDownRight className="h-5 w-5 text-red-400" />}
          color="text-red-400"
          bgIcon="bg-red-500/10"
        />
        <SummaryCard
          label="Cartao de Credito"
          value={formatCurrency(creditCardTotal)}
          icon={<CreditCard className="h-5 w-5 text-amber-400" />}
          color="text-amber-400"
          bgIcon="bg-amber-500/10"
        />
      </div>

      {/* Comparacao mês anterior */}
      {comparison && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 iasconta-month-compare">
          <MiniCard
            label="vs mês anterior"
            value={`${comparison.diffPercent > 0 ? '+' : ''}${comparison.diffPercent}%`}
            icon={comparison.diffExpense <= 0 ? <TrendingDown className="h-5 w-5 text-emerald-400" /> : <TrendingUp className="h-5 w-5 text-red-400" />}
            color={comparison.diffExpense <= 0 ? 'text-emerald-400' : 'text-red-400'}
            sub="variacao nas despesas"
          />
          <MiniCard
            label="Despesas mês anterior"
            value={formatCurrency(comparison.previous.expense)}
            color="text-white"
          />
          <MiniCard
            label="Receitas mês anterior"
            value={formatCurrency(comparison.previous.income)}
            color="text-white"
          />
        </div>
      )}

      {/* Fixos + Gastos do Mes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Fixos (recorrentes) */}
        <SectionCard
          title="Fixos do Mes"
          subtitle="Contas e gastos recorrentes"
          icon={<CheckSquare className="h-5 w-5 text-indigo-400" />}
          iconBg="bg-indigo-500/10"
        >
          {monthBills.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-gray-500 border-b border-white/5">
                  <th className="pb-3 font-medium w-10">Pago</th>
                  <th className="pb-3 font-medium">Nome</th>
                  <th className="pb-3 font-medium">Categoria</th>
                  <th className="pb-3 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {monthBills.map((bill) => (
                  <tr key={bill.id} className="border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors">
                    <td className="py-3">
                      <input
                        type="checkbox"
                        checked={bill.isPaid}
                        readOnly
                        className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-emerald-500 focus:ring-emerald-500/50"
                      />
                    </td>
                    <td className="py-3 font-medium text-white">{bill.name}</td>
                    <td className="py-3 text-gray-400 text-xs">{bill.categoryName || '-'}</td>
                    <td className="py-3 text-right font-semibold tabular-nums text-gray-300">
                      {formatCurrency(bill.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-white/5">
                  <td colSpan={3} className="py-3 text-sm font-medium text-gray-300">Total Fixos</td>
                  <td className="py-3 text-right font-bold text-indigo-400">
                    {formatCurrency(monthBills.reduce((s, b) => s + b.amount, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          ) : (
            <EmptyState icon={<CheckSquare className="h-8 w-8 text-gray-700" />} text="Nenhuma conta fixa no mês" />
          )}
        </SectionCard>

        {/* Gastos do Mes (variáveis) */}
        <SectionCard
          title="Gastos do Mes"
          subtitle="Despesas variáveis"
          icon={<Receipt className="h-5 w-5 text-orange-400" />}
          iconBg="bg-orange-500/10"
        >
          {variableExpenses.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-gray-500 border-b border-white/5">
                  <th className="pb-3 font-medium">Data</th>
                  <th className="pb-3 font-medium">Descrição</th>
                  <th className="pb-3 font-medium">Categoria</th>
                  <th className="pb-3 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {variableExpenses.slice(0, 10).map((t) => (
                  <tr key={t.id} className="border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 text-gray-400">{dayjs(t.date).format('DD/MM')}</td>
                    <td className="py-3 font-medium text-white max-w-[140px] truncate">{t.description}</td>
                    <td className="py-3 text-gray-400 text-xs">{t.categoryName || '-'}</td>
                    <td className="py-3 text-right font-semibold tabular-nums text-red-400">
                      -{formatCurrency(Math.abs(t.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-white/5">
                  <td colSpan={3} className="py-3 text-sm font-medium text-gray-300">Total Variaveis</td>
                  <td className="py-3 text-right font-bold text-orange-400">
                    {formatCurrency(variableExpenses.reduce((s, t) => s + Math.abs(t.amount), 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          ) : (
            <EmptyState icon={<Receipt className="h-8 w-8 text-gray-700" />} text="Nenhum gasto variável" />
          )}
        </SectionCard>
      </div>

      {/* Categorias + Entradas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gastos por Categoria */}
        <SectionCard
          title="Gastos por Categoria"
          subtitle="Distribuicao dos gastos"
          icon={<PieChart className="h-5 w-5 text-blue-400" />}
          iconBg="bg-blue-500/10"
        >
          {pieData.length > 0 ? (
            <div>
              <ResponsiveContainer width="100%" height={220}>
                <RePie>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={85}
                    innerRadius={45}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#111827',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '0.75rem',
                      color: '#fff',
                    }}
                    formatter={(val: number) => formatCurrency(val)}
                  />
                </RePie>
              </ResponsiveContainer>
              <div className="mt-4 space-y-2">
                {byCategory.map((c, i) => {
                  const totalExp = byCategory.reduce((s, x) => s + x.total, 0);
                  const pct = totalExp > 0 ? ((c.total / totalExp) * 100).toFixed(1) : '0';
                  return (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                        <span className="text-gray-300">{c.category}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-500">{pct}%</span>
                        <span className="text-white font-medium tabular-nums">{formatCurrency(c.total)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <EmptyState icon={<PieChart className="h-8 w-8 text-gray-700" />} text="Nenhum dado disponível" />
          )}
        </SectionCard>

        {/* Entradas (Income) */}
        <SectionCard
          title="Entradas do Mes"
          subtitle="Receitas por fonte"
          icon={<DollarSign className="h-5 w-5 text-emerald-400" />}
          iconBg="bg-emerald-500/10"
        >
          {pixReceived.length > 0 && !pixReceiptDismissed && (
            <div className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-emerald-300 font-medium mb-2">
                  Você recebeu {pixReceived.length} {pixReceived.length === 1 ? 'PIX/DOC' : 'PIX/DOC'} via Open Finance neste mês. Deseja adicionar como entrada?
                </p>
                <button
                  onClick={dismissPixReceipt}
                  aria-label="Não adicionar agora"
                  title="Não adicionar agora"
                  className="shrink-0 rounded-lg p-1 text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ul className="space-y-1.5">
                {pixReceived.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-gray-300 truncate">{dayjs(t.date).format('DD/MM')} · {t.description}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-emerald-400 font-semibold">+{formatCurrency(Math.abs(t.amount))}</span>
                      <button
                        onClick={() => addPixAsIncome(t.id)}
                        disabled={pixAddingId === t.id}
                        className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {pixAddingId === t.id ? 'Adicionando...' : 'Adicionar'}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end mt-3">
                <button
                  onClick={dismissPixReceipt}
                  className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/5 border border-white/10 transition-colors"
                >
                  Agora não
                </button>
              </div>
            </div>
          )}
          {incomeTx.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-gray-500 border-b border-white/5">
                  <th className="pb-3 font-medium">Data</th>
                  <th className="pb-3 font-medium">Descrição</th>
                  <th className="pb-3 font-medium">Pessoa</th>
                  <th className="pb-3 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {incomeTx.map((t) => (
                  <tr key={t.id} className="border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 text-gray-400">{dayjs(t.date).format('DD/MM')}</td>
                    <td className="py-3 font-medium text-white max-w-[140px] truncate">{t.description}</td>
                    <td className="py-3 text-gray-400 text-xs">
                      {t.person === 'HUSBAND' ? 'Marido' : t.person === 'WIFE' ? 'Esposa' : 'Casal'}
                    </td>
                    <td className="py-3 text-right font-semibold tabular-nums text-emerald-400">
                      +{formatCurrency(Math.abs(t.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-white/5">
                  <td colSpan={3} className="py-3 text-sm font-medium text-gray-300">Total Entradas</td>
                  <td className="py-3 text-right font-bold text-emerald-400">
                    {formatCurrency(totalIncome)}
                  </td>
                </tr>
              </tfoot>
            </table>
          ) : (
            <EmptyState icon={<DollarSign className="h-8 w-8 text-gray-700" />} text="Nenhuma receita no mês" />
          )}
        </SectionCard>
      </div>

      {/* Gastos por Meio de Pagamento */}
      <SectionCard
        title="Gastos por Meio de Pagamento"
        subtitle="Distribuicao por metodo"
        icon={<BarChart3 className="h-5 w-5 text-amber-400" />}
        iconBg="bg-amber-500/10"
      >
        {byPaymentData.length > 0 ? (
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={byPaymentData} layout="vertical" margin={{ top: 5, right: 30, left: 60, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
              <XAxis type="number" stroke="#6b7280" tickFormatter={(v) => formatCurrency(v)} />
              <YAxis type="category" dataKey="method" stroke="#6b7280" width={80} />
              <Tooltip
                cursor={{ fill: 'rgba(245,158,11,0.05)' }}
                contentStyle={{
                  backgroundColor: '#111827',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '0.75rem',
                  color: '#fff',
                }}
                formatter={(val: number) => formatCurrency(val)}
              />
              <Bar dataKey="total" fill="#f59e0b" radius={[0, 4, 4, 0]} barSize={24} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState icon={<BarChart3 className="h-8 w-8 text-gray-700" />} text="Nenhum dado" />
        )}
      </SectionCard>

      {/* Analise Anual + Dica */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {yearAnalysis && (
          <SectionCard
            title="Analise do Ano"
            subtitle={`Resumo de ${dayjs().year()}`}
            icon={<BarChart3 className="h-5 w-5 text-purple-400" />}
            iconBg="bg-purple-500/10"
          >
            <div className="space-y-3">
              <InsightRow label="Mes que mais gastou" value={`${yearAnalysis.worstMonth[0]} (${formatCurrency(yearAnalysis.worstMonth[1])})`} color="text-red-400" bg="bg-red-500/5 border-red-500/10" />
              <InsightRow label="Mes que menos gastou" value={`${yearAnalysis.bestMonth[0]} (${formatCurrency(yearAnalysis.bestMonth[1])})`} color="text-emerald-400" bg="bg-emerald-500/5 border-emerald-500/10" />
              <InsightRow label="Categoria top" value={`${yearAnalysis.topCategory[0]} (${formatCurrency(yearAnalysis.topCategory[1])})`} color="text-amber-400" bg="bg-amber-500/5 border-amber-500/10" />
              <InsightRow label="Media mensal de gastos" value={formatCurrency(yearAnalysis.avgPerMonth)} color="text-blue-400" bg="bg-blue-500/5 border-blue-500/10" />
            </div>
          </SectionCard>
        )}

        {tip && (
          <div className="iasconta-ai-tip">
          <SectionCard
            title="Dica de Economia"
            subtitle="IA analisou seus gastos"
            icon={<Lightbulb className="h-5 w-5 text-yellow-400" />}
            iconBg="bg-yellow-500/10"
          >
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-yellow-500/5 border border-yellow-500/10">
                <p className="text-sm text-gray-200 leading-relaxed">{tip.tip}</p>
              </div>
              {tip.topCategories.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">Top categorias de gasto:</p>
                  <div className="space-y-2">
                    {tip.topCategories.map((cat, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-gray-400">{cat.name}</span>
                        <span className="text-white font-medium">{formatCurrency(cat.total)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </SectionCard>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Subcomponents ---

function SummaryCard({ label, value, icon, color, bgIcon }: { label: string; value: string; icon: React.ReactNode; color: string; bgIcon: string }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/5 bg-gray-900 p-5 transition-transform duration-200 hover:scale-[1.02]">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
      <div className="relative flex items-start justify-between">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-gray-400">{label}</p>
          <p className={`text-2xl font-bold tracking-tight ${color}`}>{value}</p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${bgIcon}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function MiniCard({ label, value, icon, color, sub }: { label: string; value: string; icon?: React.ReactNode; color: string; sub?: string }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-gray-900 p-4">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
      <div className="relative">
        <p className="text-xs font-medium text-gray-500 mb-1">{label}</p>
        <div className="flex items-center gap-2">
          {icon}
          <span className={`text-xl font-bold ${color}`}>{value}</span>
        </div>
        {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
      </div>
    </div>
  );
}

function SectionCard({ title, subtitle, icon, iconBg, children }: { title: string; subtitle: string; icon: React.ReactNode; iconBg: string; children: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-gray-900 p-6">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
      <div className="relative">
        <div className="mb-5 flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconBg}`}>
            {icon}
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            <p className="text-xs text-gray-500">{subtitle}</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12">
      {icon}
      <p className="text-sm text-gray-500">{text}</p>
    </div>
  );
}

function InsightRow({ label, value, color, bg }: { label: string; value: string; color: string; bg: string }) {
  return (
    <div className={`flex items-center justify-between p-3 rounded-xl ${bg}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-sm font-semibold ${color}`}>{value}</p>
    </div>
  );
}
