import { useState, useEffect } from 'react';
import { useDashboard } from '../hooks/useDashboard';
import { useTransactions } from '../hooks/useTransactions';
import { ArrowUpRight, ArrowDownRight, Wallet, PieChart, BarChart3, Clock, CheckSquare, CreditCard, TrendingUp, TrendingDown, Lightbulb, Calendar } from 'lucide-react';
import { PieChart as RePie, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import dayjs from 'dayjs';
import { api } from '../api/client';

const COLORS = ['#10b981', '#14b8a6', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#f97316'];

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

interface Bill {
  id: string;
  name: string;
  amount: number;
  isPaid: boolean;
  dueDate: string;
}

export default function Dashboard() {
  const [month, setMonth] = useState(dayjs().format('YYYY-MM'));
  const { summary, byCategory, byPayment, creditCardTotal, comparison, yearAnalysis, tip, loading } = useDashboard(month);
  const { transactions, refresh: refreshTx } = useTransactions({});
  const recentTransactions = transactions.slice(0, 5);

  const [bills, setBills] = useState<Bill[]>([]);

  useEffect(() => {
    api('/api/bills')
      .then((data) => setBills(Array.isArray(data) ? data : []))
      .catch(() => setBills([]));
  }, []);

  const now = dayjs(month + '-01');
  const monthStart = now.startOf('month');
  const monthEnd = now.endOf('month');

  const monthBills = bills.filter((b) => {
    const due = dayjs(b.dueDate);
    return due.isAfter(monthStart.subtract(1, 'day')) && due.isBefore(monthEnd.add(1, 'day'));
  });

  const incomeCount = transactions.filter((t) => t.type === 'INCOME').length;

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
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-b from-emerald-500/[0.06] via-gray-900 to-transparent p-6">
        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
        <div className="relative flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-emerald-400/80">Visao geral</p>
            <h1 className="text-3xl font-bold tracking-tight text-white">Dashboard</h1>
            <p className="text-sm text-gray-400">Acompanhe suas financas em tempo real</p>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-emerald-400" />
            <input
              type="month"
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                refreshTx();
              }}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 [color-scheme:dark]"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <div className="group relative overflow-hidden rounded-2xl border border-white/5 bg-gray-900 p-6 transition-transform duration-200 hover:scale-[1.02]">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
          <div className="relative flex items-start justify-between">
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-400">Saldo do mes</p>
              <p className={`text-3xl font-bold tracking-tight ${balance >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatCurrency(balance)}
              </p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10">
              <Wallet className="h-5 w-5 text-emerald-400" />
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden rounded-2xl border border-white/5 bg-gray-900 p-6 transition-transform duration-200 hover:scale-[1.02]">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
          <div className="relative flex items-start justify-between">
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-400">Receitas</p>
              <p className="text-3xl font-bold tracking-tight text-emerald-400">{formatCurrency(totalIncome)}</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10">
              <ArrowUpRight className="h-5 w-5 text-emerald-400" />
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden rounded-2xl border border-white/5 bg-gray-900 p-6 transition-transform duration-200 hover:scale-[1.02]">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
          <div className="relative flex items-start justify-between">
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-400">Despesas</p>
              <p className="text-3xl font-bold tracking-tight text-red-400">{formatCurrency(totalExpense)}</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-500/10">
              <ArrowDownRight className="h-5 w-5 text-red-400" />
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden rounded-2xl border border-white/5 bg-gray-900 p-6 transition-transform duration-200 hover:scale-[1.02]">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
          <div className="relative flex items-start justify-between">
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-400">Cartao de Credito</p>
              <p className="text-3xl font-bold tracking-tight text-amber-400">{formatCurrency(creditCardTotal)}</p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/10">
              <CreditCard className="h-5 w-5 text-amber-400" />
            </div>
          </div>
        </div>
      </div>

      {comparison && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-gray-900 p-4">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
            <div className="relative">
              <p className="text-xs font-medium text-gray-500 mb-1">vs mes anterior</p>
              <div className="flex items-center gap-2">
                {comparison.diffExpense <= 0 ? (
                  <TrendingDown className="h-5 w-5 text-emerald-400" />
                ) : (
                  <TrendingUp className="h-5 w-5 text-red-400" />
                )}
                <span className={`text-xl font-bold ${comparison.diffExpense <= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {comparison.diffPercent > 0 ? '+' : ''}{comparison.diffPercent}%
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">variacao nas despesas</p>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-gray-900 p-4">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
            <div className="relative">
              <p className="text-xs font-medium text-gray-500 mb-1">Despesas mes anterior</p>
              <p className="text-xl font-bold text-white">{formatCurrency(comparison.previous.expense)}</p>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-gray-900 p-4">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
            <div className="relative">
              <p className="text-xs font-medium text-gray-500 mb-1">Receitas mes anterior</p>
              <p className="text-xl font-bold text-white">{formatCurrency(comparison.previous.income)}</p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="group relative overflow-hidden rounded-2xl border border-white/5 bg-gray-900 p-6 transition-transform duration-200 hover:scale-[1.02]">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
          <div className="relative flex items-start justify-between">
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-400">Total Cartao de Credito</p>
              <p className="text-2xl font-bold tracking-tight text-amber-400">{formatCurrency(creditCardTotal)}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
              <CreditCard className="h-4 w-4 text-amber-400" />
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden rounded-2xl border border-white/5 bg-gray-900 p-6 transition-transform duration-200 hover:scale-[1.02]">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
          <div className="relative flex items-start justify-between">
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-400">Entradas do Mes</p>
              <p className="text-2xl font-bold tracking-tight text-emerald-400">{incomeCount} lancamentos</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
              <ArrowUpRight className="h-4 w-4 text-emerald-400" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-gray-900 p-6">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
          <div className="relative mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
              <PieChart className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Gastos por Categoria</h2>
              <p className="text-xs text-gray-500">Distribuicao dos gastos</p>
            </div>
          </div>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <RePie>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={110}
                  innerRadius={55}
                  paddingAngle={2}
                  stroke="none"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
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
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <PieChart className="h-8 w-8 text-gray-700" />
              <p className="text-sm text-gray-500">Nenhum dado disponivel</p>
            </div>
          )}
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-gray-900 p-6">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
          <div className="relative mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
              <BarChart3 className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Gastos por Meio de Pagamento</h2>
              <p className="text-xs text-gray-500">Distribuicao por metodo</p>
            </div>
          </div>
          {byPaymentData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={byPaymentData} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
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
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <BarChart3 className="h-8 w-8 text-gray-700" />
              <p className="text-sm text-gray-500">Nenhum dado disponivel</p>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-gray-900 p-6">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
          <div className="relative mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10">
              <CheckSquare className="h-5 w-5 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Fixos do Mes</h2>
              <p className="text-xs text-gray-500">Contas recorrentes</p>
            </div>
          </div>
          {monthBills.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-gray-500">
                    <th className="pb-4 font-medium w-10">Pago</th>
                    <th className="pb-4 font-medium">Nome</th>
                    <th className="pb-4 text-right font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {monthBills.map((bill) => (
                    <tr key={bill.id} className="transition-colors duration-200 hover:bg-white/[0.02]">
                      <td className="py-3">
                        <input
                          type="checkbox"
                          checked={bill.isPaid}
                          readOnly
                          className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-emerald-500 focus:ring-emerald-500/50"
                        />
                      </td>
                      <td className="py-3 font-medium text-white">{bill.name}</td>
                      <td className="py-3 text-right font-semibold tabular-nums text-gray-300">
                        {formatCurrency(bill.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <CheckSquare className="h-8 w-8 text-gray-700" />
              <p className="text-sm text-gray-500">Nenhuma conta fixa no mes</p>
            </div>
          )}
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-gray-900 p-6">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
          <div className="relative mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-500/10">
              <Clock className="h-5 w-5 text-gray-300" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Transacoes Recentes</h2>
              <p className="text-xs text-gray-500">Ultimos lancamentos</p>
            </div>
          </div>
          {recentTransactions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-gray-500">
                    <th className="pb-4 font-medium">Data</th>
                    <th className="pb-4 font-medium">Descricao</th>
                    <th className="pb-4 font-medium">Categoria</th>
                    <th className="pb-4 font-medium">Pessoa</th>
                    <th className="pb-4 text-right font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {recentTransactions.map((t, idx) => (
                    <tr
                      key={t.id}
                      className={`transition-colors duration-200 hover:bg-white/[0.02] ${
                        idx === 0 ? 'rounded-t-xl' : ''
                      } ${idx === recentTransactions.length - 1 ? 'rounded-b-xl' : ''}`}
                    >
                      <td className="py-4 text-gray-400">{dayjs(t.date).format('DD/MM')}</td>
                      <td className="py-4 font-medium text-white">{t.description}</td>
                      <td className="py-4 text-gray-400">{t.categoryName || '-'}</td>
                      <td className="py-4 text-gray-400">
                        {t.person === 'HUSBAND' ? 'Marido' : t.person === 'WIFE' ? 'Esposa' : 'Casal'}
                      </td>
                      <td className={`py-4 text-right font-semibold tabular-nums ${t.type === 'INCOME' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {t.type === 'INCOME' ? '+' : '-'}{formatCurrency(Math.abs(t.amount))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <Clock className="h-8 w-8 text-gray-700" />
              <p className="text-sm text-gray-500">Nenhuma transacao registrada</p>
            </div>
          )}
        </div>
      </div>

      {(yearAnalysis || tip) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {yearAnalysis && (
            <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-gray-900 p-6">
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
              <div className="relative mb-6 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10">
                  <BarChart3 className="h-5 w-5 text-purple-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">Analise do Ano</h2>
                  <p className="text-xs text-gray-500">Resumo de {dayjs().year()}</p>
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 rounded-xl bg-red-500/5 border border-red-500/10">
                  <div>
                    <p className="text-xs text-gray-500">Mes que mais gastou</p>
                    <p className="text-sm font-semibold text-red-400">
                      {yearAnalysis.worstMonth[0]}{' '}
                      <span className="text-gray-500 font-normal">({formatCurrency(yearAnalysis.worstMonth[1])})</span>
                    </p>
                  </div>
                  <TrendingUp className="h-5 w-5 text-red-400" />
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
                  <div>
                    <p className="text-xs text-gray-500">Mes que menos gastou</p>
                    <p className="text-sm font-semibold text-emerald-400">
                      {yearAnalysis.bestMonth[0]}{' '}
                      <span className="text-gray-500 font-normal">({formatCurrency(yearAnalysis.bestMonth[1])})</span>
                    </p>
                  </div>
                  <TrendingDown className="h-5 w-5 text-emerald-400" />
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl bg-amber-500/5 border border-amber-500/10">
                  <div>
                    <p className="text-xs text-gray-500">Categoria top</p>
                    <p className="text-sm font-semibold text-amber-400">
                      {yearAnalysis.topCategory[0]}{' '}
                      <span className="text-gray-500 font-normal">({formatCurrency(yearAnalysis.topCategory[1])})</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl bg-blue-500/5 border border-blue-500/10">
                  <div>
                    <p className="text-xs text-gray-500">Media mensal de gastos</p>
                    <p className="text-sm font-semibold text-blue-400">{formatCurrency(yearAnalysis.avgPerMonth)}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tip && (
            <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-gray-900 p-6">
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
              <div className="relative mb-6 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-yellow-500/10">
                  <Lightbulb className="h-5 w-5 text-yellow-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">Dica de Economia</h2>
                  <p className="text-xs text-gray-500">IA analisou seus gastos</p>
                </div>
              </div>
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}
