import { callApi } from '../client.js';
import { chatWithGroq } from './groq.js';
import { PrismaClient } from '@prisma/client';

export interface CommandResult {
  handled: boolean;
  message: string;
}

const COMMANDS_HELP = `📋 *Comandos disponiveis:*
• saldo — Resumo financeiro do mes
• gastos [categoria] — Gastos por categoria  
• contas a vencer — Proximas contas
• onde economizar — Dicas de economia
• mes que mais gastei — Pior mes do ano
• investimentos — Resumo investimentos
• meta [nome] — Progresso de meta
• ajuda — Esta lista`;

export async function handleFinancialCommand(
  text: string,
  userId?: string,
): Promise<CommandResult> {
  const lower = text.toLowerCase().trim();
  const prisma = new PrismaClient();

  // --- SALDO / RESUMO ---
  if (/^(saldo|resumo|balanco|balanço|extrato)$/i.test(lower) ||
      /^(como está|como tá|como vai).*(financeiro|contas|gastos)/i.test(lower)) {
    try {
      const [summary, byCategory, percentage] = await Promise.all([
        callApi<any>('/api/bot/dashboard/summary', {}, 'GET'),
        callApi<any[]>('/api/bot/dashboard/by-category', {}, 'GET'),
        callApi<any>('/api/bot/dashboard/percentage', {}, 'GET'),
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
      console.error('[cmd] Saldo error:', err);
      return { handled: true, message: 'Erro ao consultar saldo.' };
    }
  }

  // --- GASTOS POR CATEGORIA ---
  if (/^gastos?\s*(\w+)?$/i.test(lower) || /^(quanto|oq|o que)\s+gastei\s+(em|com|de)\s+(\w+)/i.test(lower)) {
    try {
      const byCategory = await callApi<any[]>('/api/bot/dashboard/by-category', {}, 'GET').catch(() => []);
      
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
      const bills = await callApi<any[]>('/api/bot/dashboard/upcoming-bills', {}, 'GET').catch(() => []);
      
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
        callApi<any>('/api/bot/dashboard/summary', {}, 'GET').catch(() => null),
        callApi<any[]>('/api/bot/dashboard/by-category', {}, 'GET').catch(() => []),
        callApi<any>('/api/bot/dashboard/year-analysis', {}, 'GET').catch(() => null),
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
      const yearAnalysis = await callApi<any>('/api/bot/dashboard/year-analysis', {}, 'GET').catch(() => null);
      
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

  // --- AJUDA ---
  if (/^(ajuda|help|comandos|menu|oq vc faz|o que vc faz|o que voce faz)/i.test(lower)) {
    return { handled: true, message: COMMANDS_HELP };
  }

  return { handled: false, message: '' };
}
