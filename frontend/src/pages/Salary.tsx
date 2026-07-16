import { useState, useMemo } from 'react';
import { Wallet, Calculator, TrendingDown, TrendingUp, Receipt, Plus, Trash2, ChevronDown, Check } from 'lucide-react';
import { api } from '../api/client';
import dayjs from 'dayjs';
import 'dayjs/locale/pt-br';

dayjs.locale('pt-br');

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function calcINSS(gross: number): number {
  if (gross <= 0) return 0;
  if (gross >= 7786.02) return 861.01;
  if (gross <= 1412) return gross * 0.075;
  if (gross <= 2666.68) return 1412 * 0.075 + (gross - 1412) * 0.09;
  if (gross <= 4000.03) return 1412 * 0.075 + (2666.68 - 1412) * 0.09 + (gross - 2666.68) * 0.12;
  return 1412 * 0.075 + (2666.68 - 1412) * 0.09 + (4000.03 - 2666.68) * 0.12 + (gross - 4000.03) * 0.14;
}

function calcIRRF(base: number): number {
  if (base <= 2259.20) return 0;
  if (base <= 2826.65) return base * 0.075 - 169.44;
  if (base <= 3751.05) return base * 0.15 - 381.44;
  if (base <= 4664.68) return base * 0.225 - 662.77;
  return base * 0.275 - 896.00;
}

function inssRateLabel(gross: number): string {
  if (gross <= 0) return '-';
  if (gross >= 7786.02) return 'Teto';
  if (gross <= 1412) return '7,5%';
  if (gross <= 2666.68) return '9%';
  if (gross <= 4000.03) return '12%';
  return '14%';
}

function irrfRateLabel(base: number): string {
  if (base <= 2259.20) return 'Isento';
  if (base <= 2826.65) return '7,5%';
  if (base <= 3751.05) return '15%';
  if (base <= 4664.68) return '22,5%';
  return '27,5%';
}

function parseNumber(input: string): number {
  if (!input || !input.trim()) return 0;
  let s = input.trim();
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const parsed = parseFloat(s);
  return isNaN(parsed) ? 0 : parsed;
}

interface CustomDiscount {
  id: number;
  label: string;
  amount: string;
}

const inputClass =
  'w-full bg-gray-900/60 border border-white/5 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/30 transition-all duration-200 placeholder-gray-600';

const labelClass = 'block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wide';

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || 'R$ 0,00'}
        className={inputClass}
      />
    </div>
  );
}

function SectionHeader({ title, sectionKey, open, onToggle, icon }: { title: string; sectionKey: string; open: boolean; onToggle: (k: string) => void; icon: React.ReactNode }) {
  return (
    <button type="button" onClick={() => onToggle(sectionKey)} className="flex items-center justify-between w-full py-3 group">
      <span className="flex items-center gap-2.5 text-sm font-semibold text-gray-200">
        <span className="text-emerald-400">{icon}</span>
        {title}
      </span>
      <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
    </button>
  );
}

export default function Salary() {
  const [baseSalary, setBaseSalary] = useState('');
  const [trienio, setTrienio] = useState('');
  const [periculosidade, setPericulosidade] = useState('');
  const [adicionalNoturno, setAdicionalNoturno] = useState('');
  const [horaExtra, setHoraExtra] = useState('');
  const [comissao, setComissao] = useState('');
  const [outrosAdicionais, setOutrosAdicionais] = useState('');
  const [valeTransporte, setValeTransporte] = useState('');
  const [valeRefeicao, setValeRefeicao] = useState('');
  const [planoSaude, setPlanoSaude] = useState('');
  const [outrosDescontosFixos, setOutrosDescontosFixos] = useState('');
  const [customDiscounts, setCustomDiscounts] = useState<CustomDiscount[]>([]);
  const [nextId, setNextId] = useState(1);

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    base: true,
    adicionais: true,
    descontos: true,
  });

  const [registering, setRegistering] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [registerError, setRegisterError] = useState('');

  const calc = useMemo(() => {
    const base = parseNumber(baseSalary);
    const trienioVal = parseNumber(trienio);
    const periVal = parseNumber(periculosidade);
    const noturnoVal = parseNumber(adicionalNoturno);
    const heVal = parseNumber(horaExtra);
    const comissaoVal = parseNumber(comissao);
    const outrosVal = parseNumber(outrosAdicionais);

    const totalAdicionais = round2(trienioVal + periVal + noturnoVal + heVal + comissaoVal + outrosVal);
    const grossSalaryTotal = round2(base + totalAdicionais);

    const inss = round2(calcINSS(grossSalaryTotal));
    const irrfBase = round2(grossSalaryTotal - inss);
    const irrf = round2(Math.max(0, calcIRRF(irrfBase)));
    const vt = round2(parseNumber(valeTransporte));
    const vr = round2(parseNumber(valeRefeicao));
    const ps = round2(parseNumber(planoSaude));
    const outrosFixos = round2(parseNumber(outrosDescontosFixos));
    const customDiscountTotal = round2(
      customDiscounts.reduce((sum, d) => sum + parseNumber(d.amount), 0),
    );

    const totalDeductions = round2(inss + irrf + vt + vr + ps + outrosFixos + customDiscountTotal);
    const netSalary = round2(grossSalaryTotal - totalDeductions);

    return {
      base,
      trienioVal,
      periVal,
      noturnoVal,
      heVal,
      comissaoVal,
      outrosVal,
      totalAdicionais,
      grossSalaryTotal,
      inss,
      irrf,
      irrfBase,
      vt,
      vr,
      ps,
      outrosFixos,
      customDiscountTotal,
      totalDeductions,
      netSalary,
    };
  }, [
    baseSalary,
    trienio,
    periculosidade,
    adicionalNoturno,
    horaExtra,
    comissao,
    outrosAdicionais,
    valeTransporte,
    valeRefeicao,
    planoSaude,
    outrosDescontosFixos,
    customDiscounts,
  ]);

  const additions = [
    { name: 'Trienio', value: calc.trienioVal },
    { name: 'Periculosidade/Insalubridade', value: calc.periVal },
    { name: 'Adicional Noturno', value: calc.noturnoVal },
    { name: 'Hora Extra', value: calc.heVal },
    { name: 'Comissao/Bonus', value: calc.comissaoVal },
    { name: 'Outros Adicionais', value: calc.outrosVal },
  ].filter((a) => a.value > 0);

  const deductions = [
    { name: 'INSS', detail: inssRateLabel(calc.grossSalaryTotal), value: calc.inss },
    { name: 'IRRF', detail: irrfRateLabel(calc.irrfBase), value: calc.irrf },
    { name: 'Vale Transporte', detail: '-', value: calc.vt },
    { name: 'Vale Refeicao', detail: '-', value: calc.vr },
    { name: 'Plano de Saude', detail: '-', value: calc.ps },
    { name: 'Outros Descontos', detail: '-', value: calc.outrosFixos },
    ...customDiscounts.map((d) => ({
      name: d.label || 'Desconto personalizado',
      detail: '-',
      value: parseNumber(d.amount),
    })),
  ].filter((d) => d.value > 0);

  function toggleSection(key: string) {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function addCustomDiscount() {
    const id = nextId;
    setNextId(nextId + 1);
    setCustomDiscounts((prev) => [...prev, { id, label: '', amount: '' }]);
  }

  function removeCustomDiscount(id: number) {
    setCustomDiscounts((prev) => prev.filter((d) => d.id !== id));
  }

  function updateCustomDiscount(id: number, field: 'label' | 'amount', value: string) {
    setCustomDiscounts((prev) => prev.map((d) => (d.id === id ? { ...d, [field]: value } : d)));
  }

  async function handleRegister() {
    if (calc.netSalary <= 0 || registering) return;
    setRegistering(true);
    setRegistered(false);
    setRegisterError('');
    try {
      await api('/api/transactions', {
        method: 'POST',
        body: JSON.stringify({
          amount: calc.netSalary,
          type: 'INCOME',
          description: `Salario Liquido - ${dayjs().format('MMMM YYYY')}`,
          date: new Date().toISOString(),
          person: 'COUPLE',
          isShared: true,
          source: 'MANUAL',
          categoryId: null,
        }),
      });
      setRegistered(true);
      setTimeout(() => setRegistered(false), 3000);
    } catch (err) {
      setRegisterError(err instanceof Error ? err.message : 'Erro ao cadastrar renda');
    } finally {
      setRegistering(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <Wallet className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Salario</h1>
          <p className="text-sm text-gray-500">Calculo de salario liquido com adicionais e descontos</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <div className="lg:sticky lg:top-6 space-y-4">
            <div className="bg-gray-900/80 backdrop-blur-sm border border-white/5 rounded-2xl bg-gradient-to-b from-white/[0.02] to-transparent shadow-xl shadow-black/20 overflow-hidden">
              <div className="flex items-center gap-2.5 px-5 pt-4 pb-2 border-b border-white/5">
                <Calculator className="w-4 h-4 text-emerald-400" />
                <h2 className="text-sm font-semibold text-white uppercase tracking-wide">Dados da Folha</h2>
              </div>

              <div className="px-5 divide-y divide-white/5">
                <div>
                  <SectionHeader title="Salario Base" sectionKey="base" open={openSections.base} onToggle={toggleSection} icon={<Wallet className="w-4 h-4" />} />
                  {openSections.base && (
                    <div className="pb-4 pt-1 space-y-4">
                      <Field label="Salario Base (mensal)" value={baseSalary} onChange={setBaseSalary} />
                      <Field label="Trienio" value={trienio} onChange={setTrienio} />
                      <p className="text-xs text-gray-500">Insira o valor do trienio conforme sua folha</p>
                    </div>
                  )}
                </div>

                <div>
                  <SectionHeader title="Adicionais (Beneficios)" sectionKey="adicionais" open={openSections.adicionais} onToggle={toggleSection} icon={<TrendingUp className="w-4 h-4" />} />
                  {openSections.adicionais && (
                    <div className="pb-4 pt-1 space-y-4">
                      <Field label="Periculosidade/Insalubridade" value={periculosidade} onChange={setPericulosidade} />
                      <Field label="Adicional Noturno" value={adicionalNoturno} onChange={setAdicionalNoturno} />
                      <Field label="Hora Extra" value={horaExtra} onChange={setHoraExtra} />
                      <Field label="Comissao/Bonus" value={comissao} onChange={setComissao} />
                      <Field label="Outros Adicionais" value={outrosAdicionais} onChange={setOutrosAdicionais} />
                    </div>
                  )}
                </div>

                <div>
                  <SectionHeader title="Descontos" sectionKey="descontos" open={openSections.descontos} onToggle={toggleSection} icon={<TrendingDown className="w-4 h-4" />} />
                  {openSections.descontos && (
                    <div className="pb-4 pt-1 space-y-4">
                      <Field label="Vale Transporte" value={valeTransporte} onChange={setValeTransporte} />
                      <Field label="Vale Refeicao" value={valeRefeicao} onChange={setValeRefeicao} />
                      <Field label="Plano de Saude" value={planoSaude} onChange={setPlanoSaude} />
                      <Field label="Outros Descontos" value={outrosDescontosFixos} onChange={setOutrosDescontosFixos} />

                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className={labelClass + ' mb-0'}>Descontos Personalizados</span>
                          <button
                            type="button"
                            onClick={addCustomDiscount}
                            className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 transition-colors duration-200"
                          >
                            <Plus className="w-3.5 h-3.5" /> Adicionar
                          </button>
                        </div>
                        <div className="space-y-3">
                          {customDiscounts.length === 0 && (
                            <p className="text-xs text-gray-600 italic px-1">Nenhum desconto personalizado</p>
                          )}
                          {customDiscounts.map((d) => (
                            <div key={d.id} className="space-y-2 p-2 rounded-xl bg-white/[0.02] border border-white/5">
                              <input
                                type="text"
                                value={d.label}
                                onChange={(e) => updateCustomDiscount(d.id, 'label', e.target.value)}
                                placeholder="Nome do desconto (ex: Sindicato)"
                                className={inputClass}
                              />
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={d.amount}
                                  onChange={(e) => updateCustomDiscount(d.id, 'amount', e.target.value)}
                                  placeholder="R$ 0,00"
                                  className={inputClass + ' flex-1'}
                                />
                                <button
                                  type="button"
                                  onClick={() => removeCustomDiscount(d.id)}
                                  className="p-2.5 rounded-xl text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors duration-200 flex-shrink-0"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gray-900/80 backdrop-blur-sm border border-white/5 rounded-2xl bg-gradient-to-b from-white/[0.02] to-transparent shadow-xl shadow-black/20 p-5 transition-all duration-200 hover:border-white/10">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Salario Bruto Total</p>
                  <p className="text-2xl font-bold mt-1.5 text-white tracking-tight">{formatCurrency(calc.grossSalaryTotal)}</p>
                </div>
                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-white/5">
                  <Wallet className="w-4 h-4 text-gray-400" />
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-2">Base + {formatCurrency(calc.totalAdicionais)} em adicionais</p>
            </div>

            <div className="bg-gray-900/80 backdrop-blur-sm border border-white/5 rounded-2xl bg-gradient-to-b from-white/[0.02] to-transparent shadow-xl shadow-black/20 p-5 transition-all duration-200 hover:border-white/10">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Total Descontos</p>
                  <p className="text-2xl font-bold mt-1.5 text-red-400 tracking-tight">-{formatCurrency(calc.totalDeductions)}</p>
                </div>
                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-red-500/10">
                  <TrendingDown className="w-4 h-4 text-red-400" />
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-2">INSS, IRRF e descontos</p>
            </div>

            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl bg-gradient-to-b from-emerald-500/[0.08] to-transparent shadow-xl shadow-emerald-900/20 p-5 transition-all duration-200 hover:border-emerald-500/40">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-emerald-300 uppercase tracking-wide">Salario Liquido</p>
                  <p className="text-3xl font-bold mt-1.5 text-emerald-400 tracking-tight">{formatCurrency(calc.netSalary)}</p>
                </div>
                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-emerald-500/20">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                </div>
              </div>
              <p className="text-xs text-emerald-300/70 mt-2">
                {calc.grossSalaryTotal > 0 ? ((calc.netSalary / calc.grossSalaryTotal) * 100).toFixed(1) : 0}% do bruto
              </p>
            </div>
          </div>

          <div className="bg-gray-900/80 backdrop-blur-sm border border-white/5 rounded-2xl bg-gradient-to-b from-white/[0.02] to-transparent shadow-xl shadow-black/20 overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-4 border-b border-white/5">
              <Receipt className="w-4 h-4 text-emerald-400" />
              <h2 className="text-sm font-semibold text-white uppercase tracking-wide">Detalhamento</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-white/5">
                    <th className="px-5 py-3 font-medium text-xs uppercase tracking-wide">Item</th>
                    <th className="px-5 py-3 font-medium text-xs uppercase tracking-wide">Aliquota</th>
                    <th className="px-5 py-3 font-medium text-xs uppercase tracking-wide text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="px-5 py-3 text-gray-200 font-medium">Salario Base</td>
                    <td className="px-5 py-3 text-gray-500">-</td>
                    <td className="px-5 py-3 text-right font-medium text-white">{formatCurrency(calc.base)}</td>
                  </tr>

                  {additions.length > 0 && (
                    <tr>
                      <td colSpan={3} className="px-5 pt-4 pb-1.5 text-xs font-semibold text-emerald-400 uppercase tracking-wide">Adicionais</td>
                    </tr>
                  )}
                  {additions.map((row) => (
                    <tr key={`add-${row.name}`} className="border-b border-white/[0.03]">
                      <td className="px-5 py-3 text-gray-200">{row.name}</td>
                      <td className="px-5 py-3 text-gray-500">-</td>
                      <td className="px-5 py-3 text-right font-medium text-emerald-400">+{formatCurrency(row.value)}</td>
                    </tr>
                  ))}
                  {additions.length > 0 && (
                    <tr className="bg-emerald-500/[0.04]">
                      <td className="px-5 py-3 text-xs font-semibold text-emerald-300 uppercase tracking-wide" colSpan={2}>Total Adicionais</td>
                      <td className="px-5 py-3 text-right font-bold text-emerald-400">+{formatCurrency(calc.totalAdicionais)}</td>
                    </tr>
                  )}

                  <tr className="bg-white/[0.02]">
                    <td className="px-5 py-3 text-gray-200 font-semibold">Salario Bruto Total</td>
                    <td className="px-5 py-3 text-gray-500">-</td>
                    <td className="px-5 py-3 text-right font-bold text-white">{formatCurrency(calc.grossSalaryTotal)}</td>
                  </tr>

                  <tr>
                    <td colSpan={3} className="px-5 pt-4 pb-1.5 text-xs font-semibold text-red-400 uppercase tracking-wide">Descontos</td>
                  </tr>
                  {deductions.map((row, i) => (
                    <tr key={`ded-${row.name}-${i}`} className="border-b border-white/[0.03]">
                      <td className="px-5 py-3 text-gray-200">{row.name}</td>
                      <td className="px-5 py-3 text-gray-500">{row.detail}</td>
                      <td className="px-5 py-3 text-right font-medium text-red-400">-{formatCurrency(row.value)}</td>
                    </tr>
                  ))}
                  <tr className="bg-red-500/[0.04]">
                    <td className="px-5 py-3 text-xs font-semibold text-red-300 uppercase tracking-wide" colSpan={2}>Total Descontos</td>
                    <td className="px-5 py-3 text-right font-bold text-red-400">-{formatCurrency(calc.totalDeductions)}</td>
                  </tr>

                  <tr className="border-b border-white/[0.03]">
                    <td className="px-5 py-3 text-gray-500" colSpan={2}>Base IRRF (Bruto - INSS)</td>
                    <td className="px-5 py-3 text-right text-gray-300">{formatCurrency(calc.irrfBase)}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr className="bg-emerald-500/10 border-t border-emerald-500/20">
                    <td className="px-5 py-4 font-semibold text-emerald-300 uppercase tracking-wide text-xs" colSpan={2}>Salario Liquido</td>
                    <td className="px-5 py-4 text-right font-bold text-emerald-400 text-lg">{formatCurrency(calc.netSalary)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <button
              onClick={handleRegister}
              disabled={calc.netSalary <= 0 || registering || registered}
              className={`flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-semibold text-sm transition-all duration-200 ${
                registered
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'bg-emerald-600 hover:bg-emerald-500 hover:scale-[1.01] active:scale-[0.99] text-white shadow-lg shadow-emerald-900/30 disabled:opacity-40 disabled:hover:scale-100 disabled:cursor-not-allowed'
              }`}
            >
              {registered ? (
                <><Check className="w-4 h-4" /> Renda Cadastrada</>
              ) : registering ? (
                <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Cadastrando...</>
              ) : (
                <><Plus className="w-4 h-4" /> Cadastrar como Renda</>
              )}
            </button>
            {registerError && <p className="text-sm text-red-400">{registerError}</p>}
            {!registerError && !registered && (
              <p className="text-xs text-gray-500">
                Registra o salario liquido de {formatCurrency(calc.netSalary)} como receita do casal em {dayjs().format('MMMM YYYY')}.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}