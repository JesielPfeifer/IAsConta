import { parseWithRegex, extractPaymentMethod, extractInstallments as extractTxInstallments, type ParsedTransaction } from './regex.js';
import { parseWithGroq, chatWithGroq } from './groq.js';
import { callApi } from '../client.js';
import { PrismaClient } from '@prisma/client';
import { handleFinancialCommand } from './commands.js';
import { setPendingState, getPendingState, clearPendingState } from './conversation.js';

export type { ParsedTransaction } from './regex.js';

export interface ProcessResult {
  success: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Mês de competência — fluxo "mês atual ou mês que vem" ao registrar conta.
// ---------------------------------------------------------------------------

// Chave "YYYY-MM" do mês corrente (offset 0) ou relativo (1 = mês que vem).
function monthKey(offset = 0): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Nome do mês em pt-BR a partir da chave ("2026-10" -> "Outubro"), usado nas
// mensagens de confirmação/recapitulação.
function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const label = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Sufixo "🗓️ Mês: *X*" para as mensagens finais quando o mês foi escolhido.
function monthRecap(key?: string | null): string {
  return key ? `\n🗓️ Mês: *${monthLabel(key)}*` : '';
}

// Resposta da pergunta do mês: define a competência ou pula.
type MonthAnswer = { action: 'set'; ref: string } | { action: 'skip' };

// Nome (ou abreviação) do mês -> número, já normalizado (sem acentos).
const MONTH_NAMES: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
};

// Ocorrência mais próxima do mês (1..12) como "YYYY-MM": meses passados
// recentes contam como competência retroativa (ex.: "julho" respondido em
// agosto); meses que ficariam muito no passado vão para o ano seguinte.
function nearestMonthKey(month: number): string {
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;
  let d = month - curM;
  if (d < -6) d += 12;
  if (d > 6) d -= 12;
  if (d === -6) d = 6; // empate: prefere o futuro
  const base = new Date(curY, curM - 1 + d, 1);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`;
}

// Dica de resposta do mês com exemplo dinâmico (ex.: "_outubro_ ou _10_").
function monthAnswerHint(): string {
  const name = monthLabel(monthKey(0)).toLowerCase();
  const num = String(Number(monthKey(0).split('-')[1]));
  return `_${name}_ ou _${num}_`;
}

// Interpreta a resposta da pergunta do mês: atual, "mês que vem", o mês pelo
// nome/número (ex.: "outubro", "10") ou pular.
function parseMonthAnswer(answer: string): MonthAnswer | null {
  const norm = answer
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.!?]+$/, '')
    .trim();
  if (/^(atual|este|esse|este mes|esse mes|mes atual)$/.test(norm)) return { action: 'set', ref: monthKey(0) };
  if (/^(mes que vem|que vem|proximo|proximo mes|mes seguinte)$/.test(norm)) return { action: 'set', ref: monthKey(1) };
  if (/^(pular|depois|deixa)$/.test(norm)) return { action: 'skip' };
  const numMatch = /^(\d{1,2})$/.exec(norm);
  const month = numMatch ? parseInt(numMatch[1]) : MONTH_NAMES[norm];
  if (month && month >= 1 && month <= 12) return { action: 'set', ref: nearestMonthKey(month) };
  return null;
}

function formatConfirmation(parsed: ParsedTransaction): string {
  const isIncome = parsed.transaction_type === 'income';
  const typeLabel = isIncome ? 'Receita' : 'Despesa';
  const amountStr = parsed.amount != null
    ? `R$ ${parsed.amount.toFixed(2).replace('.', ',')}`
    : '';

  let msg = `✅ *Registrado!*\n\n`;
  msg += `📌 *Tipo:* ${typeLabel}\n`;
  msg += `💰 *Valor:* ${amountStr}\n`;
  
  if (parsed.description) {
    msg += `📝 *Descrição:* ${parsed.description.charAt(0).toUpperCase() + parsed.description.slice(1)}\n`;
  }
  
  if (parsed.category && !/outros/i.test(parsed.category)) {
    msg += `📂 *Categoria:* ${parsed.category}\n`;
  }
  
  if (parsed.is_shared) {
    msg += `👥 *Pessoa:* Casal\n`;
  } else if (parsed.person === 'husband') {
    msg += `👨 *Pessoa:* Marido\n`;
  } else if (parsed.person === 'wife') {
    msg += `👩 *Pessoa:* Esposa\n`;
  }
  
  if (parsed.paymentMethod) {
    const methodLabels: Record<string, string> = {
      'NUBANK': 'Nubank 💳',
      'CAIXA': 'Caixa 🏦',
      'DEBITO': 'Debito 🏧',
    };
    msg += `💳 *Pagamento:* ${methodLabels[parsed.paymentMethod] || parsed.paymentMethod}\n`;
  }
  
  if (parsed.installments && parsed.installments.total > 1) {
    msg += `🔢 *Parcela:* ${parsed.installments.current}/${parsed.installments.total}\n`;
  }
  
  if (parsed.due_date) {
    msg += `📅 *Data:* ${parsed.due_date.split('-').reverse().join('/')}\n`;
  }
  
  // Próximas perguntas do fluxo: conta fixa → mês (só despesa) → parcelas.
  const askMonth = !isIncome;
  const detectedInstallments =
    parsed.installments && parsed.installments.total > 1 ? parsed.installments : null;

  msg += `\n━━━━━━━━━━━━━━\n`;
  msg += `🤔 *Perguntas rápidas:*\n`;
  msg += `• É uma *conta fixa*? Responda _sim_ ou _nao_\n`;

  if (askMonth) {
    msg += `• É do *mês atual* (${monthLabel(monthKey(0))}) ou do *mês que vem* (${monthLabel(monthKey(1))})? Responda _atual_, _mes que vem_ ou o mês direto (ex.: ${monthAnswerHint()})\n`;
  }

  // Only ask about installments if not already detected
  if (!detectedInstallments) {
    msg += `• Foi *parcelado*? Responda _sim_ ou _nao_\n`;
  } else {
    msg += `• Parcelado em *${detectedInstallments.total}x* detectado! ✓\n`;
  }

  // Como responder — alinhado com a máquina de estados em processMessage.
  msg += `\n💡 *Como responder:*\n`;
  if (askMonth && !detectedInstallments) {
    msg += `• Uma por vez: _sim_, depois o mês (_atual_, _mes que vem_ ou o mês direto), depois _nao_\n`;
    msg += `• Tudo junto, na ordem: _sim, atual, nao_ (conta fixa · mês · parcelado)\n`;
    msg += `• Se foi parcelado, mande só o número de vezes: _3_, _6_, _10_...`;
  } else if (askMonth && detectedInstallments) {
    msg += `• Uma por vez: _sim_, depois o mês (_atual_, _mes que vem_ ou o mês direto)\n`;
    msg += `• Tudo junto: _sim, mes que vem_ (conta fixa · mês)`;
  } else if (!detectedInstallments) {
    msg += `• Uma por vez: _sim_ ou _nao_\n`;
    msg += `• As duas juntas: _sim e sim_ ou _sim, nao_\n`;
    msg += `• Se foi parcelado, mande só o número de vezes: _3_, _6_, _10_...`;
  } else {
    msg += `• Responda _sim_ ou _nao_`;
  }

  return msg;
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
  userId?: string,
): Promise<ProcessResult> {
  if (!text || text.trim().length === 0) {
    return { success: true, message: '' };
  }

  const prisma = new PrismaClient();
  let botUserId = userId || '';
  if (!botUserId) {
    // No user linked — transactions will be skipped
    return { success: true, message: '' };
  }
  const { getSetting } = await import('../../api/services/settings.js');

  // --- FINANCIAL COMMANDS (Tier 0: explicit commands) ---
  const cmdResult = await handleFinancialCommand(text, botUserId);
  if (cmdResult.handled) {
    return { success: true, message: cmdResult.message };
  }

  // --- PENDING CONVERSATION: handle replies to the quick questions ---
  const pending = getPendingState(senderInfo?.senderId);
  if (pending && botUserId) {
    const lower = text.toLowerCase().trim();

    // Parse combined answers: "sim e nao", "sim, nao", "sim, atual, nao"
    const answers = lower.split(/\s*,\s*|\s+e\s+/).map(s => s.trim()).filter(Boolean);

    for (const answer of answers) {
      if (!pending) break;

      if (pending.question === 'fixa') {
        if (/^(sim|s|yes|y|claro|verdade|isso|correto)$/i.test(answer)) {
          await callApi(`/api/transactions/bot/${pending.transactionId}`, { isFixed: true, userId: pending.userId }, 'PUT').catch(() => {});
          pending.isFixed = true;
          pending.question = pending.askMonth ? 'mes' : 'parcelas';
          continue;
        } else if (/^(n[ãa]o|nao|n|nop|negativo)$/i.test(answer)) {
          pending.question = pending.askMonth ? 'mes' : 'parcelas';
          continue;
        } else if (pending.askMonth && parseMonthAnswer(answer)) {
          // Responderam o mês direto: pula a conta fixa e processa o mês abaixo.
          pending.question = 'mes';
        }
      }

      if (pending.question === 'mes') {
        const monthAnswer = parseMonthAnswer(answer);
        if (monthAnswer?.action === 'set') {
          await callApi(`/api/transactions/bot/${pending.transactionId}`, { referenceMonth: monthAnswer.ref, userId: pending.userId }, 'PUT').catch(() => {});
          pending.referenceMonth = monthAnswer.ref;
          pending.question = 'parcelas';
          continue;
        }
        if (monthAnswer?.action === 'skip') {
          // segue sem competência (usa a data do lançamento)
          pending.question = 'parcelas';
          continue;
        }
        // Resposta que não é de mês: "sim/nao" (ex.: "sim, nao" do fluxo de
        // duas respostas) avança para as parcelas e é reaproveitado abaixo;
        // qualquer outro texto mantém a pergunta do mês aberta.
        if (/^(sim|s|yes|y|n[ãa]o|nao|n|nop|negativo)$/i.test(answer)) {
          pending.question = 'parcelas';
        } else {
          continue;
        }
      }

      if (pending.question === 'parcelas') {
        const numMatch = /^(\d+)$/.exec(answer);
        if (numMatch) {
          const total = parseInt(numMatch[1]);
          if (total > 1 && total <= 36) {
            await callApi(`/api/transactions/bot/${pending.transactionId}`, {
              totalInstallments: total, currentInstallment: 1, userId: pending.userId,
            }, 'PUT').catch(() => {});
            clearPendingState(senderInfo.senderId);
            return { success: true, message: `✅ Marcado como *${total}x parcelado*!${monthRecap(pending.referenceMonth)}` };
          }
        }
        if (/^(sim|s|yes|y)$/i.test(answer)) {
          return { success: true, message: '❓ Quantas parcelas? Digite um número (ex: 3) ou _nao_ para a vista.' };
        }
        if (/^(n[ãa]o|nao|n|nop|negativo)$/i.test(answer)) {
          clearPendingState(senderInfo.senderId);
          return { success: true, message: `👍 Ok! Pagamento à vista.${monthRecap(pending.referenceMonth)}` };
        }
      }
    }

    // Ainda falta responder alguma pergunta: envia a próxima da fila.
    if (pending.question === 'mes') {
      const prefix = pending.isFixed ? '✅ Conta fixa!\n\n' : '';
      return {
        success: true,
        message: `${prefix}🗓️ É do *mês atual* (${monthLabel(monthKey(0))}) ou do *mês que vem* (${monthLabel(monthKey(1))})? Responda _atual_, _mes que vem_ ou o mês direto (ex.: ${monthAnswerHint()}).`,
      };
    }
    if (pending.question === 'parcelas') {
      const marks: string[] = [];
      if (pending.isFixed) marks.push('Conta fixa');
      if (pending.referenceMonth) marks.push(`Mês: *${monthLabel(pending.referenceMonth)}*`);
      const prefix = marks.length > 0 ? `✅ ${marks.join(' · ')}\n\n` : '';
      return {
        success: true,
        message: `${prefix}❓ Quantas parcelas? Digite um número (ex: 3) ou _nao_ para a vista.`,
      };
    }
    return { success: true, message: '' };
  }

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

      const groqResponse = await chatWithGroq(text, context, botUserId);
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
      const response = await chatWithGroq(text, context, botUserId);

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
          userId: botUserId,
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
          userId: botUserId,
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
    parsed = await parseWithGroq(text, botUserId);
  }

  if (parsed && parsed.transaction_type === 'income' && parsed.amount !== null && parsed.amount < 100) {
    console.log(`[nlp] Regex extracted suspicious amount ${parsed.amount} for income, trying Groq...`);
    const groqParsed = await parseWithGroq(text, botUserId);
    if (groqParsed && groqParsed.amount !== null && groqParsed.amount > parsed.amount) {
      console.log(`[nlp] Groq corrected amount to ${groqParsed.amount}`);
      parsed = groqParsed;
    }
  }

  if (parsed && parsed.transaction_type !== 'unknown' && parsed.amount !== null && parsed.amount < 10) {
    console.log(`[nlp] Regex extracted suspicious amount ${parsed.amount}, trying Groq...`);
    const groqParsed = await parseWithGroq(text, botUserId);
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
        userId: botUserId,
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

    const created = await callApi<any>('/api/transactions/bot', {
      userId: botUserId,
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

    // Store for follow-up questions (conta fixa? parcelado?)
    if (senderInfo?.senderId && created?.id) {
      setPendingState(senderInfo.senderId, {
        transactionId: created.id,
        question: 'fixa',
        userId: botUserId,
        timestamp: Date.now(),
        askMonth: parsed.transaction_type === 'expense',
      });
    }

    // Create future installments automatically
    const totalParc = parsed.installments?.total || 1;
    if (totalParc > 1 && created?.id) {
      const groupId = created.id; // Use first transaction ID as group
      
      // Tag the first transaction with the group
      await callApi(`/api/transactions/${created.id}`, {
        installmentGroupId: groupId,
      }, 'PUT').catch(() => {});
      
      const baseDate = parsed.due_date ? new Date(parsed.due_date) : new Date();
      for (let i = 2; i <= totalParc; i++) {
        const futureDate = new Date(baseDate);
        futureDate.setMonth(futureDate.getMonth() + (i - 1));
        const dateStr = futureDate.toISOString();
        
        await callApi('/api/transactions/bot', {
          userId: botUserId,
          type: parsed.transaction_type,
          amount: parsed.amount,
          category: parsed.category,
          description: parsed.description,
          person: parsed.person,
          isShared: parsed.is_shared,
          dueDate: dateStr,
          platform,
          rawMessage: text,
          senderInfo,
          paymentMethod: parsed.paymentMethod || null,
          totalInstallments: totalParc,
          currentInstallment: i,
          installmentGroupId: groupId,
        }).catch(() => {});
      }
    }

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
