import { logger } from '../../lib/logger.js';
import { callApi } from '../client.js';
import { chatWithGroq } from './groq.js';
import { PrismaClient } from '@prisma/client';

export interface CommandResult {
  handled: boolean;
  message: string;
}

const COMMANDS_HELP = `📋 *O que eu posso fazer:*\n
📊 *Consultar* — _saldo_, _gastos_, _contas a vencer_, _saude_
💡 *Dicas* — _onde economizar_, _mes que mais gastei_
📈 *Investimentos* — _investimentos_
🎯 *Metas* — _meta_ (ou _meta casa_)
✍️ *Registrar* — envie o gasto direto, ex: \"gastei 40 no crepe\" ou \"recebi 3000\"
❓ *Ajuda* — _ajuda_ para ver esta lista`;

export async function handleFinancialCommand(
  text: string,
  userId?: string,
): Promise<CommandResult> {
  const lower = text.toLowerCase().trim();

  // Bot-authenticated GETs resolve the user from this identity (the API
  // validates it against the active WhatsApp link) instead of falling back
  // to a global "first active user" selection.
  const userQS = userId ? `?userId=${encodeURIComponent(userId)}` : '';

  // --- SAUDACAO ---
  if (/^(oi+|ola|olá|bom dia|boa tarde|boa noite|e ai|e aí|opa|hello|hi|hey|oie|oiie|tudo bem|tudo bom)[!?.\s]*$/i.test(lower) ||
      /^(bom dia|boa tarde|boa noite|ola|olá|oi|opa|hey)\b.*\b(bot|contas|tudo bem|tudo bom)/i.test(lower)) {
    const greetings = ['Oi!', 'Olá!', 'Opa!', 'E aí!', 'Oi oi!'];
    const greeting = greetings[Math.floor(Math.random() * greetings.length)];
    return {
      handled: true,
      message: `${greeting} 😊 Sou o assistente financeiro do casal!\n\n${COMMANDS_HELP}`,
    };
  }

  const prisma = new PrismaClient();

  // --- SALDO / RESUMO ---
  if (/^(saldo|resumo|balanco|balanço|extrato)$/i.test(lower) ||
      /^(como está|como tá|como vai).*(financeiro|contas|gastos)/i.test(lower)) {
    try {
      const [summary, byCategory, percentage] = await Promise.all([
        callApi<any>(`/api/bot/dashboard/summary${userQS}`, {}, 'GET'),
        callApi<any[]>(`/api/bot/dashboard/by-category${userQS}`, {}, 'GET'),
        callApi<any>(`/api/bot/dashboard/percentage${userQS}`, {}, 'GET'),
      ]);

      const balance = summary?.balance ?? 0;
      const totalIncome = summary?.totalIncome ?? 0;
      const totalExpense = summary?.totalExpense ?? 0;
      const hName = percentage?.husband?.name || 'Marido';
      const wName = percentage?.wife?.name || 'Esposa';
      const hSal = percentage?.husband?.salary ?? 0;
      const wSal = percentage?.wife?.salary ?? 0;
      const hExp = percentage?.husband?.expense ?? 0;
      const wExp = percentage?.wife?.expense ?? 0;

      let msg = `💰 *Resumo do Mes*\n\n`;
      msg += `📥 Receitas: R$${totalIncome.toFixed(2).replace('.', ',')}\n`;
      msg += `📤 Despesas: R$${totalExpense.toFixed(2).replace('.', ',')}\n`;
      msg += `💵 Saldo: R$${balance.toFixed(2).replace('.', ',')}\n\n`;

      if (hSal > 0) {
        msg += `👨 *${hName}*\nSalario: R$${hSal.toFixed(2).replace('.', ',')}\nGastos: R$${hExp.toFixed(2).replace('.', ',')}\n\n`;
      }
      if (wSal > 0) {
        msg += `👩 *${wName}*\nSalario: R$${wSal.toFixed(2).replace('.', ',')}\nGastos: R$${wExp.toFixed(2).replace('.', ',')}\n\n`;
      }

      if (byCategory.length > 0) {
        msg += `📂 *Top Categorias*\n`;
        for (const cat of byCategory.slice(0, 5)) {
          msg += `${cat.category}: R$${cat.total.toFixed(2).replace('.', ',')}\n`;
        }
      }

      return { handled: true, message: msg };
    } catch (err) {
      logger.error('[cmd] Saldo error:', err);
      return { handled: true, message: 'Erro ao consultar saldo.' };
    }
  }

  // --- GASTOS POR CATEGORIA ---
  if (/^gastos?\s*(\w+)?$/i.test(lower) || /^(quanto|oq|o que)\s+gastei\s+(em|com|de)\s+(\w+)/i.test(lower)) {
    try {
      const byCategory = await callApi<any[]>(`/api/bot/dashboard/by-category${userQS}`, {}, 'GET').catch(() => []);
      
      // Extract category filter
      const catFilter = lower.replace(/^(gastos?|quanto|oq|o que)\s+(gastei\s+)?(em|com|de)?\s*/i, '').trim();

      if (catFilter && catFilter.length > 0) {
        const found = byCategory.find(c => 
          c.category.toLowerCase().includes(catFilter.toLowerCase())
        );
        if (found) {
          return {
            handled: true,
            message: `Gasto em *${found.category}*: R$${found.total.toFixed(2).replace('.', ',')}`,
          };
        }
      }

      if (byCategory.length > 0) {
        let msg = `📂 *Gastos por Categoria*\n\n`;
        const total = byCategory.reduce((s: number, c: any) => s + c.total, 0);
        for (const cat of byCategory) {
          const pct = total > 0 ? ((cat.total / total) * 100).toFixed(0) : '0';
          msg += `• ${cat.category}: R$${cat.total.toFixed(2).replace('.', ',')} (${pct}%)\n`;
        }
        return { handled: true, message: msg };
      }

      return { handled: true, message: 'Nenhum gasto registrado.' };
    } catch {
      return { handled: true, message: 'Erro ao consultar gastos.' };
    }
  }

  // --- CONTAS A VENCER ---
  if (/^(contas?\s*(a\s*)?vencer|proximas?\s*contas?|faturas?|boletos?)$/i.test(lower)) {
    try {
      const bills = await callApi<any[]>(`/api/bot/dashboard/upcoming-bills${userQS}`, {}, 'GET').catch(() => []);
      
      if (bills.length > 0) {
        let msg = `📅 *Contas a Vencer*\n\n`;
        for (const b of bills.slice(0, 5)) {
          const dueDate = new Date(b.dueDate).toLocaleDateString('pt-BR');
          const status = b.isPaid ? '✅' : '⬜';
          msg += `${status} ${b.name}: R$${b.amount.toFixed(2).replace('.', ',')} (vence ${dueDate})\n`;
        }
        const unpaid = bills.filter((b: any) => !b.isPaid).reduce((s: number, b: any) => s + b.amount, 0);
        msg += `\nTotal a pagar: R$${unpaid.toFixed(2).replace('.', ',')}`;
        return { handled: true, message: msg };
      }
      return { handled: true, message: 'Nenhuma conta cadastrada.' };
    } catch {
      return { handled: true, message: 'Erro ao consultar contas.' };
    }
  }

  // --- ONDE ECONOMIZAR ---
  if (/^(onde|como|dica|dicas?)\s+(economizar|gastar\s*menos|reduzir|cortar|melhorar)/i.test(lower) ||
      /^(me\s+ajuda|me\s+de\s+uma\s+dica|sugest[aã]o|conselho)/i.test(lower)) {
    try {
      const [summary, byCategory, yearAnalysis] = await Promise.all([
        callApi<any>(`/api/bot/dashboard/summary${userQS}`, {}, 'GET').catch(() => null),
        callApi<any[]>(`/api/bot/dashboard/by-category${userQS}`, {}, 'GET').catch(() => []),
        callApi<any>(`/api/bot/dashboard/year-analysis${userQS}`, {}, 'GET').catch(() => null),
      ]);

      const categories = byCategory.slice(0, 5).map((c: any) =>
        `${c.category}: R$${c.total.toFixed(2)}`
      ).join(', ');

      const context = `DADOS PARA ANALISE:\nSaldo: R$${summary?.balance?.toFixed(2) || '0'}\nTop gastos: ${categories}\nMes que mais gastou: ${yearAnalysis?.worstMonth?.[0] || 'N/A'} (R$${yearAnalysis?.worstMonth?.[1]?.toFixed(2) || '0'})\nMedia mensal: R$${yearAnalysis?.avgPerMonth?.toFixed(2) || '0'}`;

      const tip = await chatWithGroq(
        'Analise estes dados e de UMA dica pratica e direta de onde economizar (max 200 caracteres)',
        context,
        userId
      );

      return { handled: true, message: tip || 'Analise seus gastos por categoria para identificar onde pode cortar.' };
    } catch {
      return { handled: true, message: 'Registre seus gastos para receber dicas personalizadas.' };
    }
  }

  // --- MES QUE MAIS GASTEI ---
  if (/^(mes\s+que\s+mais\s+gastei|pior\s+mes|maior\s+gasto|quando\s+gastei\s+mais)/i.test(lower)) {
    try {
      const yearAnalysis = await callApi<any>(`/api/bot/dashboard/year-analysis${userQS}`, {}, 'GET').catch(() => null);
      
      if (yearAnalysis) {
        let msg = `📊 *Analise do Ano*\n\n`;
        msg += `🔴 Mes que mais gastou: ${yearAnalysis.worstMonth?.[0] || 'N/A'} (R$${yearAnalysis.worstMonth?.[1]?.toFixed(2).replace('.', ',') || '0'})\n`;
        msg += `🟢 Mes que menos gastou: ${yearAnalysis.bestMonth?.[0] || 'N/A'} (R$${yearAnalysis.bestMonth?.[1]?.toFixed(2).replace('.', ',') || '0'})\n`;
        msg += `📂 Categoria top: ${yearAnalysis.topCategory?.[0] || 'N/A'} (R$${yearAnalysis.topCategory?.[1]?.toFixed(2).replace('.', ',') || '0'})\n`;
        msg += `📊 Media mensal: R$${yearAnalysis.avgPerMonth?.toFixed(2).replace('.', ',') || '0'}`;
        return { handled: true, message: msg };
      }
      return { handled: true, message: 'Nenhum dado disponivel.' };
    } catch {
      return { handled: true, message: 'Erro ao consultar analise.' };
    }
  }

  // --- INVESTIMENTOS ---
  if (/^(investimentos?|carteira|renda\s*(fixa|variavel|variável)|reserva)$/i.test(lower)) {
    try {
      const investments = await callApi<any>('/api/investments', {}, 'GET').catch(() => null);
      
      if (investments && (investments.byType || investments.items)) {
        const byType = investments.byType || {};
        let msg = `📈 *Investimentos*\n\n`;
        msg += `🏦 Reserva: R$${(byType.RESERVA || 0).toFixed(2).replace('.', ',')}\n`;
        msg += `📊 Renda Fixa: R$${(byType.RENDA_FIXA || 0).toFixed(2).replace('.', ',')}\n`;
        msg += `📉 Renda Variavel: R$${(byType.RENDA_VARIAVEL || 0).toFixed(2).replace('.', ',')}\n`;
        
        const total = (byType.RESERVA || 0) + (byType.RENDA_FIXA || 0) + (byType.RENDA_VARIAVEL || 0);
        msg += `\n💰 Total: R$${total.toFixed(2).replace('.', ',')}`;
        return { handled: true, message: msg };
      }
      return { handled: true, message: 'Nenhum investimento registrado.' };
    } catch {
      return { handled: true, message: 'Erro ao consultar investimentos.' };
    }
  }

  // --- METAS ---
  if (/^meta\s*(\w+)?/i.test(lower) || /^(progresso|objetivo)/i.test(lower)) {
    try {
      const goals = await callApi<any[]>('/api/goals', {}, 'GET').catch(() => []);
      
      const goalFilter = lower.replace(/^(meta|progresso|objetivo)\s*/i, '').trim();
      
      if (goals.length > 0) {
        let msg = `🎯 *Metas Financeiras*\n\n`;
        const filtered = goalFilter 
          ? goals.filter((g: any) => g.name.toLowerCase().includes(goalFilter.toLowerCase()))
          : goals;
        
        for (const g of filtered.slice(0, 5)) {
          const saved = g.savedAmount || 0;
          const total = g.totalAmount;
          const pct = total > 0 ? ((saved / total) * 100).toFixed(0) : '0';
          const bar = '█'.repeat(Math.floor(Number(pct) / 10)) + '░'.repeat(10 - Math.floor(Number(pct) / 10));
          msg += `• ${g.name}: R$${saved.toFixed(2).replace('.', ',')} / R$${total.toFixed(2).replace('.', ',')}\n`;
          msg += `  [${bar}] ${pct}%\n\n`;
        }
        return { handled: true, message: msg };
      }
      return { handled: true, message: 'Nenhuma meta cadastrada. Use o painel web para criar.' };
    } catch {
      return { handled: true, message: 'Erro ao consultar metas.' };
    }
  }

  // --- SAUDE FINANCEIRA DO CASAL ---
  if (/^(sa[úu]de|indicador|saude\s*financeira|sa[úu]de\s*financeira)$/i.test(lower) ||
      /^(como está|como ta|como vai)\s*(a\s*)?(sa[úu]de|nossas\s*finan)/i.test(lower)) {
    try {
      const h = await callApi<any>(`/api/bot/dashboard/financial-health${userQS}`, {}, 'GET').catch(() => null);
      if (!h) return { handled: true, message: 'Erro ao calcular a saúde financeira.' };

      const brl = (v: number) => `R$${v.toFixed(2).replace('.', ',')}`;
      const monthName = (offset: number) => {
        const d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() + offset);
        return d.toLocaleDateString('pt-BR', { month: 'long' }).replace(/^./, (c) => c.toUpperCase());
      };

      let msg = `🩺 *Saúde Financeira do Casal*\n\n`;
      msg += `📥 *Renda mensal:* ${brl(h.monthlyIncome)}\n`;
      msg += `📅 *${monthName(0)}:* compromissos ${brl(h.commitments)} → sobra ${brl(h.leftover)} (${h.leftoverPercent}%)\n`;
      msg += `🔮 *${monthName(1)} (previsão):* compromissos ${brl(h.nextCommitments)} → sobra ${brl(h.nextLeftover)} (${h.nextLeftoverPercent}%)\n\n`;

      const pct = h.nextLeftoverPercent;
      const emoji = pct >= 30 ? '🟢' : pct >= 10 ? '🟡' : '🔴';
      msg += `${emoji} ${pct >= 30 ? 'Saudável' : pct >= 10 ? 'Atenção' : 'Risco'}: previsão de sobra ${pct}% da renda no próximo mês.\n\n`;

      if (h.endingSoon.length > 0) {
        msg += `🎯 *Parcelas que terminam nos próximos 3 meses (${h.endingSoonCount}):*\n`;
        for (const p of h.endingSoon.slice(0, 6)) {
          const name = p.description.length > 28 ? p.description.slice(0, 26) + '…' : p.description;
          const endMonth = new Date(p.endsAt).toLocaleDateString('pt-BR', { month: 'short' });
          msg += `• ${name} — ${p.currentInstallment}/${p.totalInstallments} (acaba ${endMonth}, ${brl(p.monthlyAmount)}/mês)\n`;
        }
        msg += `\n💰 Liberam ${brl(h.endingSoonMonthly)}/mês até ${monthName(2)}!\n`;
      }

      if (h.openPurchasesCount > 0) {
        msg += `\n📦 Parcelas abertas no horizonte: ${h.openPurchasesCount} compras (${brl(h.openPurchasesTotal)} a pagar).`;
      }
      return { handled: true, message: msg };
    } catch (err) {
      logger.error('[cmd] Saúde error:', err);
      return { handled: true, message: 'Erro ao consultar saúde financeira.' };
    }
  }

  // --- AJUDA ---
  if (/^(ajuda|help|comandos|menu|oq vc faz|o que vc faz|o que voce faz)/i.test(lower)) {
    return { handled: true, message: COMMANDS_HELP };
  }

  return { handled: false, message: '' };
}
