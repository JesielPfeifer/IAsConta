import pdfParse from 'pdf-parse';
import type { ParsedTransaction, ParseResult } from './types.js';
import { autoCategorize } from './categories.js';

interface ParsedLine {
  date: string;
  description: string;
  amount: number;
  installments?: { current: number; total: number };
}

const MONTH_YEAR_REGEX = /(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)[A-Z]*\s*\/?\s*(\d{4})/i;
const ACCOUNT_HOLDER_REGEX = /(TITULAR|CLIENTE|NOME)[:\s]+(.+)/i;
const TOTAL_REGEX = /TOTAL\s+A\s+PAGAR[:\s]*R\$\s*([\d.-]+,\d{2})/i;

function parseBrazilianDate(value: string, referenceYear?: number): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (!match) return null;

  const day = match[1].padStart(2, '0');
  const month = match[2].padStart(2, '0');
  const year = match[3] || String(referenceYear ?? new Date().getFullYear());
  return `${year}-${month}-${day}`;
}

function parseBrazilianAmount(value: string): number | null {
  let cleaned = value.trim()
    .replace(/R\$/gi, '')
    .replace(/\s/g, '');

  const isCredit = /CR$/i.test(cleaned);
  cleaned = cleaned.replace(/CR$/i, '').trim();

  const isNegative = cleaned.startsWith('-');
  cleaned = cleaned.replace(/^-/, '').replace(/\./g, '').replace(',', '.');

  const parsed = parseFloat(cleaned);
  if (isNaN(parsed)) return null;

  if (isCredit) return Math.abs(parsed);
  return -(isNegative ? -parsed : Math.abs(parsed));
}

function extractPeriod(text: string): string | undefined {
  const match = text.match(MONTH_YEAR_REGEX);
  if (!match) return undefined;

  const months: Record<string, string> = {
    'JAN': '01', 'FEV': '02', 'MAR': '03', 'ABR': '04',
    'MAI': '05', 'JUN': '06', 'JUL': '07', 'AGO': '08',
    'SET': '09', 'OUT': '10', 'NOV': '11', 'DEZ': '12',
  };

  const monthAbbr = match[1].toUpperCase().substring(0, 3);
  const monthNum = months[monthAbbr] ?? '01';
  const year = match[2];
  return `${year}-${monthNum}`;
}

function extractAccountHolder(text: string): string | undefined {
  const match = text.match(ACCOUNT_HOLDER_REGEX);
  if (!match) return undefined;
  return match[2].trim().split('\n')[0].trim();
}

function extractTotalAmount(text: string): number | undefined {
  const match = text.match(TOTAL_REGEX);
  if (!match) return undefined;
  let cleaned = match[1].replace(/\./g, '').replace(',', '.');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? undefined : parsed;
}

function extractInstallments(description: string): { current: number; total: number } | undefined {
  const patterns = [
    /(\d{1,2})\s*(?:de|\\|de\s+|\/)\s*(\d{1,2})/,
    /parcela\s+(\d{1,2})\s*(?:\/|de\s+)\s*(\d{1,2})/i,
  ];

  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match) {
      const current = parseInt(match[1]);
      const total = parseInt(match[2]);
      if (current >= 1 && total >= 1 && current <= total) {
        return { current, total };
      }
    }
  }
  return undefined;
}

function parseFullText(fullText: string, referenceYear?: number): ParsedLine[] {
  const results: ParsedLine[] = [];
  const seen = new Set<string>();

  const lines = fullText.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 10) continue;

    const regex = /(\d{1,2}\/\d{1,2}(?:\/\d{4})?)\s+(.+?)\s+(-?\s*R?\$\s*-?[\d.]+,\d{2})/g;
    let match;

    while ((match = regex.exec(trimmed)) !== null) {
      const rawDate = match[1].trim();
      let rawDescription = match[2].trim();
      const rawAmount = match[3].trim().replace(/R\$/i, '').trim();

      const dedupeKey = `${rawDate}|${rawDescription}|${rawAmount}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const date = parseBrazilianDate(rawDate, referenceYear);
      if (!date) continue;

      let description = rawDescription.replace(/\s+/g, ' ').trim();
      if (!description || description.length < 2) continue;

      if (/^(SALDO|LIMITE|VENCIMENTO|PAGAMENTO|TOTAL|ENCARGOS|AUTORIZA)/i.test(description)) continue;

      const amount = parseBrazilianAmount(rawAmount);
      if (amount === null) continue;

      const installments = extractInstallments(description);

      if (installments) {
        description = description
          .replace(/\s*\d{1,2}\s*\/\s*\d{1,2}\s*/g, ' ')
          .replace(/\s*\d{1,2}\s+de\s+\d{1,2}\s*/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }

      results.push({ date, description, amount, installments });
    }
  }

  return results;
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\f/g, '\n');
}

async function parseEncryptedPDF(buffer: Buffer, password: string): Promise<string> {
  const pdfjsPath = require.resolve('pdf-parse/lib/pdf.js/v2.0.550/build/pdf.js');
  const PDFJS = require(pdfjsPath);
  PDFJS.disableWorker = true;

  const loadingTask = PDFJS.getDocument({
    data: new Uint8Array(buffer),
    password,
  });

  const pdf = await loadingTask.promise;
  let fullText = '';

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    let lastY: number | null = null;
    let pageText = '';

    for (const item of content.items) {
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 5) {
        pageText += '\n';
      } else if (pageText.length > 0 && !pageText.endsWith('\n') && !pageText.endsWith(' ')) {
        pageText += ' ';
      }
      pageText += item.str;
      lastY = y;
    }

    fullText += pageText + '\n';
  }

  return fullText;
}

export async function parseCaixaPDF(pdfBuffer: Buffer, password?: string): Promise<ParseResult> {
  const errors: string[] = [];

  try {
    let rawText = '';

    if (password) {
      try {
        rawText = await parseEncryptedPDF(pdfBuffer, password);
      } catch (err: any) {
        if (err?.name === 'PasswordException' || /password/i.test(err?.message || '')) {
          return {
            success: false,
            transactions: [],
            errors: ['Senha incorreta ou nao foi possivel abrir o PDF. Verifique a senha e tente novamente.'],
          };
        }
        return {
          success: false,
          transactions: [],
          errors: ['Erro ao abrir PDF com senha: ' + (err instanceof Error ? err.message : 'erro desconhecido')],
        };
      }
    } else {
      try {
        const data = await pdfParse(pdfBuffer);
        rawText = data.text;
      } catch {
        return {
          success: false,
          transactions: [],
          errors: [
            'Failed to parse PDF. If this PDF is password protected, provide the password.',
          ],
        };
      }
    }

    rawText = normalizeText(rawText);

    if (!rawText || rawText.trim().length === 0) {
      return {
        success: false,
        transactions: [],
        errors: ['No text content extracted from PDF. The file may be image-based or empty.'],
      };
    }

    const period = extractPeriod(rawText);
    const referenceYear = period ? parseInt(period.split('-')[0], 10) : undefined;

    const parsedLines = parseFullText(rawText, referenceYear);

    if (parsedLines.length === 0) {
      return {
        success: false,
        transactions: [],
        errors: [...errors, 'No transactions found in the PDF. The statement format may be unsupported.'],
        metadata: {
          bank: 'Caixa Econômica Federal',
          period,
          accountHolder: extractAccountHolder(rawText),
        },
      };
    }

    const transactions: ParsedTransaction[] = parsedLines.map(line => ({
      date: line.date,
      description: line.description,
      amount: line.amount,
      category: autoCategorize(line.description) ?? undefined,
      source: 'CAIXA_PDF' as const,
      rawData: `${line.date} ${line.description} R$ ${Math.abs(line.amount).toFixed(2)}`,
      installments: line.installments,
    }));

    const totalAmount = extractTotalAmount(rawText);

    return {
      success: errors.length === 0,
      transactions,
      errors,
      metadata: {
        bank: 'Caixa Econômica Federal',
        period,
        totalAmount,
        accountHolder: extractAccountHolder(rawText),
      },
    };
  } catch (err) {
    return {
      success: false,
      transactions: [],
      errors: [err instanceof Error ? err.message : 'Unknown error while parsing PDF'],
      metadata: { bank: 'Caixa Econômica Federal' },
    };
  }
}