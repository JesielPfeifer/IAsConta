import { useState } from 'react';
import { useAnnual } from '../hooks/useAnnual';
import { ArrowUpRight, ArrowDownRight, Wallet, TrendingUp, BarChart3, Calendar } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import dayjs from 'dayjs';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function getMonthLabel(month: string) {
  const m = parseInt(month.split('-')[1], 10);
  return MONTH_NAMES[m - 1]?.substring(0, 3) || month;
}

const currentYear = dayjs().year();
const currentMonth = dayjs().format('YYYY-MM');

export default function Annual() {
  const [year, setYear] = useState(currentYear);
  const { data, loading } = useAnnual(year);

  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

  const chartData = data?.months.map((m) => ({
    ...m,
    label: getMonthLabel(m.month),
  })) || [];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400" />
      </div>
    );
  }

  const totals = data?.totals || { income: 0, expense: 0, balance: 0 };
  const avg = data?.avgPerMonth || { income: 0, expense: 0 };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-b from-emerald-500/[0.06] via-gray-900 to-transparent p-6">
        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
        <div className="relative flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-emerald-400/80">Visão anual</p>
            <h1 className="text-3xl font-bold tracking-tight text-white">Panorama Anual</h1>
            <p className="text-sm text-gray-400">Receitas, despesas e saldo mês a mês</p>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-emerald-400" />
            <select
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value, 10))}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 appearance-none cursor-pointer [color-scheme:dark]"
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <div className="group relative overflow-hidden rounded-2xl border border-white/5 bg-gray-900 p-6 transition-transform duration-200 hover:scale-[1.02]">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
          <div className="relative flex items-start justify-between">
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-400">Total Receitas</p>
              <p className="text-3xl font-bold tracking-tight text-emerald-400">
                {formatCurrency(totals.income)}
              </p>
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
              <p className="text-sm font-medium text-gray-400">Total Despesas</p>
              <p className="text-3xl font-bold tracking-tight text-red-400">
                {formatCurrency(totals.expense)}
              </p>
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
              <p className="text-sm font-medium text-gray-400">Saldo Acumulado</p>
              <p className={`text-3xl font-bold tracking-tight ${totals.balance >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatCurrency(totals.balance)}
              </p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-500/10">
              <Wallet className="h-5 w-5 text-blue-400" />
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden rounded-2xl border border-white/5 bg-gray-900 p-6 transition-transform duration-200 hover:scale-[1.02]">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
          <div className="relative flex items-start justify-between">
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-400">Média Mensal</p>
              <p className="text-3xl font-bold tracking-tight text-amber-400">
                {formatCurrency(avg.income)}
              </p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/10">
              <TrendingUp className="h-5 w-5 text-amber-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Bar Chart */}
      <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-gray-900 p-6">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
        <div className="relative mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
            <BarChart3 className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Receitas vs Despesas por Mês</h2>
            <p className="text-xs text-gray-500">Comparativo mensal de {year}</p>
          </div>
        </div>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="label" stroke="#6b7280" fontSize={12} />
              <YAxis
                stroke="#6b7280"
                fontSize={12}
                tickFormatter={(v) =>
                  new Intl.NumberFormat('pt-BR', { notation: 'compact', compactDisplay: 'short' }).format(v)
                }
              />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.02)' }}
                contentStyle={{
                  backgroundColor: '#111827',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '0.75rem',
                  color: '#fff',
                }}
                formatter={(val: number, name: string) => [
                  formatCurrency(val),
                  name === 'income' ? 'Receitas' : 'Despesas',
                ]}
                labelFormatter={(label: string) => {
                  const month = chartData.find((d) => d.label === label);
                  return month ? `${label} / ${month.month.split('-')[0]}` : label;
                }}
              />
              <Bar dataKey="income" name="Receitas" fill="#10b981" radius={[4, 4, 0, 0]} barSize={20} />
              <Bar dataKey="expense" name="Despesas" fill="#ef4444" radius={[4, 4, 0, 0]} barSize={20} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <BarChart3 className="h-8 w-8 text-gray-700" />
            <p className="text-sm text-gray-500">Nenhum dado disponível para {year}</p>
          </div>
        )}
      </div>

      {/* Monthly Table */}
      <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-gray-900 p-6">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
        <div className="relative mb-6">
          <h2 className="text-lg font-semibold text-white">Detalhamento Mensal</h2>
          <p className="text-xs text-gray-500">Tabela com os 12 meses de {year}</p>
        </div>
        {chartData.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-gray-500">
                  <th className="pb-4 font-medium">Mês</th>
                  <th className="pb-4 text-right font-medium">Receitas</th>
                  <th className="pb-4 text-right font-medium">Despesas</th>
                  <th className="pb-4 text-right font-medium">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {(data?.months || []).map((m) => {
                  const isCurrent = m.month === currentMonth;
                  return (
                    <tr
                      key={m.month}
                      className={`transition-colors duration-200 hover:bg-white/[0.02] ${
                        isCurrent ? 'bg-emerald-500/5' : ''
                      }`}
                    >
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          {isCurrent && (
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                          )}
                          <span className={`font-medium ${isCurrent ? 'text-emerald-400' : 'text-white'}`}>
                            {getMonthLabel(m.month)}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 text-right font-semibold tabular-nums text-emerald-400">
                        {formatCurrency(m.income)}
                      </td>
                      <td className="py-3 text-right font-semibold tabular-nums text-red-400">
                        {formatCurrency(m.expense)}
                      </td>
                      <td className={`py-3 text-right font-semibold tabular-nums ${
                        m.balance >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}>
                        {formatCurrency(m.balance)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-white/10">
                  <td className="py-4 font-bold text-white">Total</td>
                  <td className="py-4 text-right font-bold text-emerald-400 tabular-nums">
                    {formatCurrency(totals.income)}
                  </td>
                  <td className="py-4 text-right font-bold text-red-400 tabular-nums">
                    {formatCurrency(totals.expense)}
                  </td>
                  <td className={`py-4 text-right font-bold tabular-nums ${
                    totals.balance >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {formatCurrency(totals.balance)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <BarChart3 className="h-8 w-8 text-gray-700" />
            <p className="text-sm text-gray-500">Nenhum dado disponível para {year}</p>
          </div>
        )}
      </div>
    </div>
  );
}
