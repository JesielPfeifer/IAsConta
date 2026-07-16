import { parseWithRegex, extractPaymentMethod, extractInstallments as extractTxInstallments, type ParsedTransaction } from './regex.js';
import { parseWithGroq, chatWithGroq } from './groq.js';
import { callApi } from '../client.js';
import { PrismaClient } from '@prisma/client';

export type { ParsedTransaction } from './regex.js';

export interface ProcessResult {
  success: boolean;
  message: string;
}

function formatConfirmation(parsed: ParsedTransaction): string {
  const typeLabel = parsed.transaction_type === 'expense' ? 'gasto' : 'receita';
  const amountStr = parsed.amount != null
    ? `R$${parsed.amount.toFixed(2).replace('.', ',')}`
    : '';

  let categoryStr = '';
  if (parsed.category && parsed.category !== 'outros' && parsed.category !== 'Outros') {
    categoryStr = ` (${parsed.category})`;
  }

  let personStr = '';
  if (parsed.is_shared) {
    personStr = ' - casal';
  } else if (parsed.person === 'husband') {
    personStr = ' por marido';
  } else if (parsed.person === 'wife') {
    personStr = ' por esposa';
  }

  let paymentStr = '';
  if (parsed.paymentMethod) {
    paymentStr = ` no ${parsed.paymentMethod}`;
  }

  let installmentStr = '';
  if (parsed.installments && parsed.installments.total > 1) {
    installmentStr = ` (${parsed.installments.current}/${parsed.installments.total})`;
  }

  let descriptionPart = parsed.description
    ? ` em ${parsed.description.charAt(0).toUpperCase() + parsed.description.slice(1)}`
    : '';

  return `Registrei: ${typeLabel} de ${amountStr}${descriptionPart}${categoryStr}${paymentStr}${installmentStr}${personStr}`;
}

// Formato da esposa: "Celular 70,00 (26/06) guardado"
// Formato: descricao valor (data) status
function parseListLine(line: string): ParsedTransaction | null {
  const cleaned = line.trim();
  if (!cleaned || cleaned.length < 3) return null;

  // Extrair valor: numero com virgula ou ponto
  const amountMatch = /(\d+[\.,]\d{2})/.exec(cleaned);
  if (!amountMatch) return null;

  const amount = parseFloat(amountMatch[1].replace(',', '.'));
  if (amount <= 0) return null;

  // Extrair data se existir: (26/06) ou (26/06/2026)
  let dueDate: string | null = null;
  const dateMatch = /\((\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\)/.exec(cleaned);
  if (dateMatch) {
    const day = dateMatch[1].padStart(2, '0');
    const month = dateMatch[2].padStart(2, '0');
    const year = dateMatch[3]
      ? (dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3])
      : `${new Date().getFullYear()}`;
    dueDate = `${year}-${month}-${day}`;
  }

  // Remover valor e data para pegar a descricao
  let description = cleaned
    .replace(/\(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\)/g, '') // remove data
    .replace(/\d+[\.,]\d{2}/, '') // remove valor
    .replace(/\b(PAGO|pago|guardado|Guardado|PENDENTE|pendente|ATRASADO|atrasado)\b/gi, '') // remove status
    .replace(/\s+/g, ' ')
    .trim();

  if (!description) return null;

  // Detectar se e conta fixa (mensal)
  const isBill = /\b(fies|financiamento|parcela|fixo|mensal|aluguel|condominio|condomínio)\b/i.test(cleaned);

  // Detectar categoria
  const lower = cleaned.toLowerCase();
  let category = 'outros';
  if (/celular|telefone|chip/i.test(lower)) category = 'contas';
  else if (/fies|financiamento|faculdade|universidade/i.test(lower)) category = 'educacao';
  else if (/entrada.*ape|apartamento|aluguel/i.test(lower)) category = 'moradia';
  else if (/nubank|renner|cartao|crédito|credito/i.test(lower)) category = 'outros';
  else if (/supermercado|mercado/i.test(lower)) category = 'supermercado';
  else if (/farmacia|remedio/i.test(lower)) category = 'farmacia';
  else if (/uber|onibus|gasolina/i.test(lower)) category = 'transporte';
  else if (/restaurante|ifood|comida/i.test(lower)) category = 'restaurante';
  else if (/lazer|cinema|netflix/i.test(lower)) category = 'lazer';

  return {
    transaction_type: 'expense',
    amount,
    category,
    person: null,
    description,
    due_date: dueDate,
    is_shared: false,
    paymentMethod: extractPaymentMethod(cleaned),
    installments: extractTxInstallments(cleaned),
  };
}

// Detectar comando de conta fixa
function isBillCommand(text: string): boolean {
  return /\b(adicione|adicionar|criar|crie|colocar|coloque|cadastrar|cadastre)\b.*\b(conta|fixa|mensal|fixo|parcela)\b/i.test(text)
    || /\b(conta|fixa|mensal|fixo|parcela)\b.*\b(adicione|adicionar|criar|crie|colocar|coloque|cadastrar|cadastre)\b/i.test(text);
}

// Extrair nome da conta fixa do comando
function extractBillName(text: string): string | null {
  // "Adicionar conta fixa: fies 522,00" -> "fies"
  const matchColon = /(?:adicione|adicionar|criar|crie|colocar|coloque|cadastrar|cadastre)\s+(?:conta|fixa|mensal|fixo|parcela)\s*:\s*(.+?)(?:\s+\d|$)/i.exec(text);
  if (matchColon) return matchColon[1].trim();

  // "adicione FIES como conta fixa" -> "FIES"
  const matchComo = /(?:adicione|adicionar|criar|crie|colocar|coloque|cadastrar|cadastre)\s+(.+?)\s+(?:como|como\s+uma)\s+(?:conta|fixa|mensal|fixo|parcela)/i.exec(text);
  if (matchComo) return matchComo[1].trim();

  // "FIES conta fixa" -> "FIES"
  const matchPrefix = /^(.+?)\s+(?:conta|fixa|mensal|fixo|parcela)/i.exec(text);
  if (matchPrefix && !/^(adicione|adicionar|criar|crie|colocar|coloque|cadastrar|cadastre)$/i.test(matchPrefix[1].trim())) {
    return matchPrefix[1].trim();
  }

  // "conta fixa FIES" -> "FIES"
  const matchSuffix = /(?:conta|fixa|mensal|fixo|parcela)\s+(.+?)(?:\s+\d|$)/i.exec(text);
  if (matchSuffix && !/^\d/.test(matchSuffix[1].trim())) {
    return matchSuffix[1].trim();
  }

  return null;
}

// Extrair valor do comando de conta fixa
function extractBillAmount(text: string): number | null {
  const match = /(\d+[\.,]\d{2})/.exec(text);
  if (match) return parseFloat(match[1].replace(',', '.'));
  return null;
}

// Extrair quantidade de parcelas
function extractInstallments(text: string): { total: number; current: number } | null {
  // "5 parcelas", "10x", "em 5x", "parcela 3 de 5"
  const matchX = /(\d+)\s*x\b/i.exec(text);
  if (matchX) return { total: parseInt(matchX[1]), current: 1 };

  const matchParcelas = /(\d+)\s*parcelas?/i.exec(text);
  if (matchParcelas) return { total: parseInt(matchParcelas[1]), current: 1 };

  const matchParcelaDe = /parcela\s+(\d+)\s*(?:de|de\s+|\/)\s*(\d+)/i.exec(text);
  if (matchParcelaDe) return { total: parseInt(matchParcelaDe[2]), current: parseInt(matchParcelaDe[1]) };

  return null;
}

// Extrair dia do vencimento
function extractBillDay(text: string): number | null {
  const match = /(?:dia|vence|vencimento|todo\s+dia)\s+(\d{1,2})/i.exec(text);
  if (match) return parseInt(match[1]);
  return null;
}

export async function processMessage(
  text: string,
  platform: string,
  senderInfo?: any,
): Promise<ProcessResult> {
  if (!text || text.trim().length === 0) {
    return { success: true, message: '' };
  }

  const prisma = new PrismaClient();
  const botEmail = process.env.BOT_DEFAULT_EMAIL || '';
  let botUserId = '';
  if (botEmail) {
    const u = await prisma.user.findUnique({ where: { email: botEmail } });
    if (u) botUserId = u.id;
  }
  const { getSetting } = await import('../../api/services/settings.js');

  // Comando de saldo/status/resumo
  if (/\b(saldo|status|resumo|extrato|quanto\s+resta|quanto\s+tenho|quanto\s+gastei|como\s+est(a|á)|como\s+t(a|á)|sal[aá]rio)\b/i.test(text)) {
    try {
      const [summary, byCategory, percentage] = await Promise.all([
        callApi<any>('/api/bot/dashboard/summary', {}, 'GET'),
        callApi<any[]>('/api/bot/dashboard/by-category', {}, 'GET'),
        callApi<any>('/api/bot/dashboard/percentage', {}, 'GET'),
      ]);

      const wifeSalary = percentage?.wife?.salary ?? 0;
      const husbandSalary = percentage?.husband?.salary ?? 0;
      const wifeExpense = percentage?.wife?.expense ?? 0;
      const husbandExpense = percentage?.husband?.expense ?? 0;
      const wifeBalance = wifeSalary - wifeExpense;
      const husbandBalance = husbandSalary - husbandExpense;
      const balance = summary?.balance ?? 0;
      const totalSalary = husbandSalary + wifeSalary;
      const lower = text.toLowerCase();

      // Respostas diretas para perguntas factuais (sem Groq)
      if (/salario.*(casal|total|soma|juntos|familia)/i.test(lower) || /(casal|total|soma|juntos|familia).*salario/i.test(lower)) {
        if (totalSalary > 0) {
          return { success: true, message: `O salario total do casal e de R$${totalSalary.toFixed(2).replace('.', ',')}.` };
        }
      }

      if (/salario.*(marido|esposo|homem)/i.test(lower) || /(marido|esposo|homem).*salario/i.test(lower)) {
        if (husbandSalary > 0) {
          return { success: true, message: `O salario do marido e de R$${husbandSalary.toFixed(2).replace('.', ',')}.` };
        }
      }

      if (/salario.*(esposa|mulher|duda)/i.test(lower) || /(esposa|mulher|duda).*salario/i.test(lower)) {
        if (wifeSalary > 0) {
          return { success: true, message: `O salario da esposa e de R$${wifeSalary.toFixed(2).replace('.', ',')}.` };
        }
      }

      if (/sal[aá]rio\b/i.test(lower) && !/saldo/i.test(lower)) {
        if (husbandSalary > 0 && wifeSalary > 0) {
          return { success: true, message: `Marido: R$${husbandSalary.toFixed(2).replace('.', ',')}\nEsposa: R$${wifeSalary.toFixed(2).replace('.', ',')}\nTotal: R$${totalSalary.toFixed(2).replace('.', ',')}` };
        }
        if (husbandSalary > 0) {
          return { success: true, message: `Salario: R$${husbandSalary.toFixed(2).replace('.', ',')}.` };
        }
      }

      // Consultas complexas: usa Groq com dados reais
      const context = `DADOS OFICIAIS (use apenas estes numeros, nao invente):\nSalario Marido: R$${husbandSalary.toFixed(2)}\nSalario Esposa: R$${wifeSalary.toFixed(2)}\nTotal Casal: R$${totalSalary.toFixed(2)}\nReceitas: R$${summary?.totalIncome?.toFixed(2) || '0'}\nDespesas: R$${summary?.totalExpense?.toFixed(2) || '0'}\nSaldo: R$${balance.toFixed(2)}\nGasto Marido: R$${husbandExpense.toFixed(2)}\nGasto Esposa: R$${wifeExpense.toFixed(2)}`;

      const groqResponse = await chatWithGroq(text, context);
      if (groqResponse) {
        return { success: true, message: groqResponse };
      }

      // Fallback with real data
      let msg = `💰 *Resumo do Mes*\n\n`;
      if (husbandSalary > 0) {
        msg += `👨 *Marido*\nSalario: R$${husbandSalary.toFixed(2).replace('.', ',')}\nGastos: R$${husbandExpense.toFixed(2).replace('.', ',')}\nSaldo: R$${husbandBalance.toFixed(2).replace('.', ',')}\n\n`;
      }
      if (wifeSalary > 0) {
        msg += `👩 *Esposa*\nSalario: R$${wifeSalary.toFixed(2).replace('.', ',')}\nGastos: R$${wifeExpense.toFixed(2).replace('.', ',')}\nSaldo: R$${wifeBalance.toFixed(2).replace('.', ',')}\n\n`;
      }
      if (byCategory.length > 0) {
        msg += `📂 *Por Categoria*\n`;
        for (const cat of byCategory) {
          msg += `${cat.category}: R$${cat.total.toFixed(2).replace('.', ',')}\n`;
        }
      }
      return { success: true, message: msg };
    } catch (err) {
      console.error('[nlp] Balance query failed:', err);
      return { success: true, message: 'Erro ao consultar saldo.' };
    }
  }

  // Conversational questions (powered by Groq)
  if (/\b(onde|como|qual|quais|quanto|me\s+ajuda|dica|sugest|conselho|economizar|melhorar|relatorio|relatório|analise|análise|resum|como\s+esta|como\s+tá|o\s+que\s+voce\s+acha|pode\s+me\s+dizer|me\s+fala|me\s+conta)\b/i.test(text) ||
      /\?$/.test(text.trim()) ||
      text.trim().length > 60) {
    try {
      const [summary, byCategory, percentage, last7Days] = await Promise.all([
        callApi<any>('/api/bot/dashboard/summary', {}, 'GET').catch(() => null),
        callApi<any[]>('/api/bot/dashboard/by-category', {}, 'GET').catch(() => []),
        callApi<any>('/api/bot/dashboard/percentage', {}, 'GET').catch(() => null),
        callApi<any[]>('/api/bot/dashboard/last-7-days', {}, 'GET').catch(() => []),
      ]);

      const context = buildFinancialContext(summary, byCategory, percentage, last7Days);
      const response = await chatWithGroq(text, context);

      if (response) {
        return { success: true, message: response };
      }
    } catch (err) {
      console.error('[nlp] Chat query failed:', err);
    }
  }

  // Detectar person pelo nome do remetente
  let detectedPerson: 'husband' | 'wife' | 'couple' | null = null;
  if (senderInfo?.senderName) {
    const wifeName = await getSetting(botUserId, 'wifeName', process.env.WIFE_NAME);
    const husbandName = await getSetting(botUserId, 'husbandName', process.env.HUSBAND_NAME);
    const senderLower = senderInfo.senderName.toLowerCase();

    if (wifeName && senderLower.includes(wifeName.toLowerCase())) {
      detectedPerson = 'wife';
    } else if (husbandName && senderLower.includes(husbandName.toLowerCase())) {
      detectedPerson = 'husband';
    }
  }

  // Comando de conta fixa
  if (isBillCommand(text)) {
    const billName = extractBillName(text);
    const amount = extractBillAmount(text);
    const dueDay = extractBillDay(text);

    if (billName) {
      try {
        const installments = extractInstallments(text);

        await callApi('/api/bills/bot', {
          description: billName,
          amount: amount,
          dueDate: dueDay ? `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(dueDay).padStart(2, '0')}` : null,
          category: null,
          isShared: false,
          person: detectedPerson,
          platform,
          rawMessage: text,
          senderInfo,
          totalInstallments: installments?.total ?? 1,
          currentInstallment: installments?.current ?? 1,
        });

        const amountStr = amount ? ` de R$${amount.toFixed(2).replace('.', ',')}` : '';
        const dayStr = dueDay ? ` dia ${dueDay}` : '';
        const instStr = installments && installments.total > 1
          ? ` (${installments.total}x)`
          : '';
        return {
          success: true,
          message: `Conta fixa criada: ${billName}${amountStr}${dayStr}${instStr}`,
        };
      } catch (err) {
        console.error('[nlp] Bill creation failed:', err);
        return {
          success: false,
          message: 'Erro ao criar conta fixa.',
        };
      }
    }
  }

  // Verificar se e uma lista (multiplas linhas)
  const lines = text.split('\n').filter(l => l.trim().length > 0);

  if (lines.length > 1) {
    // Modo lista: processar cada linha
    const results: string[] = [];
    let successCount = 0;

    for (const line of lines) {
      const parsed = parseListLine(line);
      if (!parsed) continue;

      // Aplicar person detectado
      if (!parsed.person && detectedPerson) {
        parsed.person = detectedPerson;
      }

      try {
        await callApi('/api/transactions/bot', {
          type: parsed.transaction_type,
          amount: parsed.amount,
          category: parsed.category,
          description: parsed.description,
          person: parsed.person,
          isShared: parsed.is_shared,
          dueDate: parsed.due_date,
          platform,
          rawMessage: line,
          senderInfo,
          paymentMethod: parsed.paymentMethod || null,
          totalInstallments: parsed.installments?.total || 1,
          currentInstallment: parsed.installments?.current || 1,
        });

        const amountDisplay = parsed.amount != null
          ? `R$${parsed.amount.toFixed(2).replace('.', ',')}`
          : '';
        successCount++;
        results.push(`✓ ${parsed.description} - ${amountDisplay}`);
      } catch (err) {
        console.error('[nlp] Failed to process line:', line, err);
        results.push(`✗ ${line.trim()} (erro)`);
      }
    }

    if (successCount > 0) {
      return {
        success: true,
        message: `Registrei ${successCount} compra(s):\n${results.join('\n')}`,
      };
    }

    return {
      success: true,
      message: 'Nenhuma compra válida encontrada na lista.',
    };
  }

  // Modo normal: mensagem unica
  let parsed = parseWithRegex(text);

  if (!parsed) {
    parsed = await parseWithGroq(text);
  }

  if (parsed && parsed.transaction_type === 'income' && parsed.amount !== null && parsed.amount < 100) {
    console.log(`[nlp] Regex extracted suspicious amount ${parsed.amount} for income, trying Groq...`);
    const groqParsed = await parseWithGroq(text);
    if (groqParsed && groqParsed.amount !== null && groqParsed.amount > parsed.amount) {
      console.log(`[nlp] Groq corrected amount to ${groqParsed.amount}`);
      parsed = groqParsed;
    }
  }

  if (parsed && parsed.transaction_type !== 'unknown' && parsed.amount !== null && parsed.amount < 10) {
    console.log(`[nlp] Regex extracted suspicious amount ${parsed.amount}, trying Groq...`);
    const groqParsed = await parseWithGroq(text);
    if (groqParsed && groqParsed.amount !== null && groqParsed.amount > parsed.amount) {
      console.log(`[nlp] Groq corrected amount to ${groqParsed.amount}`);
      parsed = groqParsed;
    }
  }

  if (!parsed || parsed.transaction_type === 'unknown') {
    return { success: true, message: '' };
  }

  // Aplicar person detectado
  if (!parsed.person && detectedPerson) {
    parsed.person = detectedPerson;
  }

  try {
    if (parsed.transaction_type === 'reminder') {
      await callApi('/api/bills/bot', {
        description: parsed.description,
        amount: parsed.amount,
        dueDate: parsed.due_date,
        category: parsed.category,
        isShared: parsed.is_shared,
        person: parsed.person,
        platform,
        rawMessage: text,
        senderInfo,
      });

      const dueStr = parsed.due_date
        ? ` para ${parsed.due_date.split('-').reverse().join('/')}`
        : '';

      return {
        success: true,
        message: `Lembrete criado: ${parsed.description}${dueStr}`,
      };
    }

    await callApi('/api/transactions/bot', {
      type: parsed.transaction_type,
      amount: parsed.amount,
      category: parsed.category,
      description: parsed.description,
      person: parsed.person,
      isShared: parsed.is_shared,
      dueDate: parsed.due_date,
      platform,
      rawMessage: text,
      senderInfo,
      paymentMethod: parsed.paymentMethod || null,
      totalInstallments: parsed.installments?.total || 1,
      currentInstallment: parsed.installments?.current || 1,
    });

    return {
      success: true,
      message: formatConfirmation(parsed),
    };
  } catch (err) {
    console.error('[nlp] API call failed:', err);
    return {
      success: false,
      message: 'Erro ao registrar. Tente novamente mais tarde.',
    };
  }
}

function buildFinancialContext(
  summary: any,
  byCategory: any[],
  percentage: any,
  last7Days: any[],
): string {
  let ctx = '';

  if (summary) {
    ctx += `Resumo do mes:\n`;
    ctx += `- Receitas: R$${summary.totalIncome?.toFixed(2) || '0.00'}\n`;
    ctx += `- Despesas: R$${summary.totalExpense?.toFixed(2) || '0.00'}\n`;
    ctx += `- Saldo: R$${summary.balance?.toFixed(2) || '0.00'}\n`;
    const h = summary.byPerson?.husband;
    const w = summary.byPerson?.wife;
    if (h) ctx += `- Marido: recebeu R$${h.income?.toFixed(2) || '0.00'}, gastou R$${h.expense?.toFixed(2) || '0.00'}\n`;
    if (w) ctx += `- Esposa: recebeu R$${w.income?.toFixed(2) || '0.00'}, gastou R$${w.expense?.toFixed(2) || '0.00'}\n`;
  }

  if (percentage) {
    const hp = percentage.husband;
    const wp = percentage.wife;
    if (hp) ctx += `- Salario Marido: R$${hp.salary?.toFixed(2) || '0.00'}\n`;
    if (wp) ctx += `- Salario Esposa: R$${wp.salary?.toFixed(2) || '0.00'}\n`;
  }

  if (byCategory.length > 0) {
    ctx += `\nGastos por categoria:\n`;
    for (const c of byCategory.slice(0, 8)) {
      ctx += `- ${c.category}: R$${c.total.toFixed(2)}\n`;
    }
  }

  if (last7Days.length > 0) {
    ctx += `\nUltimos 7 dias (${last7Days.length} transacoes):\n`;
    for (const tx of last7Days.slice(0, 10)) {
      ctx += `- ${tx.date}: ${tx.description} - R$${tx.amount.toFixed(2)} (${tx.type === 'INCOME' ? 'receita' : 'despesa'}, ${tx.category})\n`;
    }
  }

  return ctx;
}
