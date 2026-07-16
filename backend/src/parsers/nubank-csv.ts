import type { ParsedTransaction, ParseResult } from './types.js';
import { autoCategorize } from './categories.js';

function parseNubankDate(value: string): string | null {
  const trimmed = value.trim();

  // YYYY-MM-DD (formato real do Nubank)
  let match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  // DD/MM/YYYY
  match = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) {
    return `${match[3]}-${match[2]}-${match[1]}`;
  }

  return null;
}

function parseNubankAmount(value: string): number | null {
  let trimmed = value.trim().replace(/^["']|["']$/g, '').trim();

  const isNegative = trimmed.startsWith('-');
  trimmed = trimmed.replace(/^-/, '').trim();

  // Remove separador de milhar (pontos) e troca virgula por ponto
  // Ex: "1.950,00" -> "1950.00"
  let numericStr = trimmed.replace(/\./g, '').replace(',', '.');

  const parsed = parseFloat(numericStr);
  if (isNaN(parsed)) return null;

  return isNegative ? -parsed : parsed;
}

function mapHeader(rawHeaders: string[]): { dateIdx: number; descriptionIdx: number; amountIdx: number } {
  const dateIdx = rawHeaders.findIndex(h => {
    const lower = h.trim().toLowerCase();
    return lower === 'date' || lower === 'data';
  });

  const descriptionIdx = rawHeaders.findIndex(h => {
    const lower = h.trim().toLowerCase();
    return lower === 'description' || lower === 'descricao' || lower === 'descrição' || lower === 'title';
  });

  const amountIdx = rawHeaders.findIndex(h => {
    const lower = h.trim().toLowerCase();
    return lower === 'amount' || lower === 'valor' || lower === 'value';
  });

  return { dateIdx, descriptionIdx, amountIdx };
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  fields.push(current.trim());
  return fields;
}

export function parseNubankCSV(csvContent: string): ParseResult {
  const errors: string[] = [];
  const transactions: ParsedTransaction[] = [];

  const normalized = csvContent
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  const lines = normalized.split('\n').filter(line => line.trim().length > 0);

  if (lines.length === 0) {
    return { success: false, transactions: [], errors: ['CSV content is empty'] };
  }

  const headerLine = lines[0];
  const rawHeaders = parseCSVLine(headerLine);

  if (rawHeaders.length < 3) {
    return { success: false, transactions: [], errors: ['CSV must have at least 3 columns: date, description, amount'] };
  }

  const { dateIdx, descriptionIdx, amountIdx } = mapHeader(rawHeaders);

  if (dateIdx === -1) {
    return { success: false, transactions: [], errors: ['Could not find date column (expected "date" or "data")'] };
  }
  if (descriptionIdx === -1) {
    return { success: false, transactions: [], errors: ['Could not find description column (expected "description", "descricao" or "title")'] };
  }
  if (amountIdx === -1) {
    return { success: false, transactions: [], errors: ['Could not find amount column (expected "amount" or "valor")'] };
  }

  for (let i = 1; i < lines.length; i++) {
    const rowFields = parseCSVLine(lines[i]);

    if (rowFields.length <= Math.max(dateIdx, descriptionIdx, amountIdx)) {
      errors.push(`Line ${i + 1}: insufficient columns`);
      continue;
    }

    const rawDate = rowFields[dateIdx];
    const rawDescription = rowFields[descriptionIdx];
    const rawAmount = rowFields[amountIdx];

    const date = parseNubankDate(rawDate);
    if (!date) {
      errors.push(`Line ${i + 1}: invalid date "${rawDate}" (expected YYYY-MM-DD or DD/MM/YYYY)`);
      continue;
    }

    const amount = parseNubankAmount(rawAmount);
    if (amount === null) {
      errors.push(`Line ${i + 1}: invalid amount "${rawAmount}"`);
      continue;
    }

    const description = rawDescription.trim();
    if (!description) {
      errors.push(`Line ${i + 1}: empty description`);
      continue;
    }

    const category = autoCategorize(description) ?? undefined;

    transactions.push({
      date,
      description,
      amount,
      category,
      source: 'NUBANK_CSV',
      rawData: [rawDate, rawDescription, rawAmount].join(','),
    });
  }

  return {
    success: errors.length === 0,
    transactions,
    errors,
    metadata: {
      bank: 'Nubank',
    },
  };
}
