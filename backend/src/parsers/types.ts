export interface ParsedTransaction {
  date: string;
  description: string;
  amount: number;
  category?: string;
  source: 'NUBANK_CSV' | 'CAIXA_PDF';
  rawData?: string;
  installments?: { current: number; total: number };
}

export interface ParseResult {
  success: boolean;
  transactions: ParsedTransaction[];
  errors: string[];
  metadata?: {
    bank: string;
    period?: string;
    totalAmount?: number;
    accountHolder?: string;
  };
}
