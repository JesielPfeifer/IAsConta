export interface ParsedTransaction {
  transaction_type: 'expense' | 'income' | 'reminder' | 'unknown';
  amount: number | null;
  category: string | null;
  person: 'husband' | 'wife' | 'couple' | null;
  description: string;
  due_date: string | null;
  is_shared: boolean;
  paymentMethod?: string | null;
  installments?: { total: number; current: number } | null;
}

const CATEGORY_MAP: Record<string, string> = {
  salario: 'Salário',
  salário: 'Salário',
  contas: 'Moradia',
  conta: 'Moradia',
  luz: 'Moradia',
  agua: 'Moradia',
  água: 'Moradia',
  internet: 'Moradia',
  aluguel: 'Moradia',
  financiamento: 'Moradia',
  saude: 'Saúde',
  saúde: 'Saúde',
  pedicure: 'Beleza',
  maquiagem: 'Beleza',
  cosmético: 'Beleza',
  cosméticos: 'Beleza',
  perfumaria: 'Beleza',
  barba: 'Beleza',
  educacao: 'Educação',
  educação: 'Educação',
  escola: 'Educação',
  curso: 'Educação',
  veiculo: 'Veículo',
  veículo: 'Veículo',
  carro: 'Veículo',
  civic: 'Veículo',
  palio: 'Veículo',
  pneu: 'Veículo',
  manutencao: 'Veículo',
  manutenção: 'Veículo',
  suspensao: 'Veículo',
  suspensão: 'Veículo',
  alternador: 'Veículo',
  estacionamento: 'Veículo',
  moradia: 'Moradia',
  ap: 'Moradia',
  apartamento: 'Moradia',
  condominio: 'Moradia',
  condomínio: 'Moradia',
  financ: 'Financiamento',
  juros: 'Financiamento',
  emprestimo: 'Financiamento',
  empréstimo: 'Financiamento',
  fies: 'Educação',
  pucrs: 'Educação',
  faculdade: 'Educação',
  universidade: 'Educação',
  pos: 'Educação',
  pós: 'Educação',
  celular: 'Telefonia',
  telefone: 'Telefonia',
  chip: 'Telefonia',
  compras: 'Compras',
  shopee: 'Compras',
  mercadolivre: 'Compras',
  amazon: 'Compras',
  superlegal: 'Compras',
  servico: 'Serviços',
  serviço: 'Serviços',
  hostinger: 'Serviços',
  eletronico: 'Eletrônicos',
  eletrônico: 'Eletrônicos',
  eletronicos: 'Eletrônicos',
  playstation: 'Eletrônicos',
  xbox: 'Eletrônicos',
  fifa: 'Eletrônicos',
  jogo: 'Eletrônicos',
  gasolina: 'Gasolina',
  combustivel: 'Gasolina',
  combustível: 'Gasolina',
  posto: 'Gasolina',
  ifood: 'IFood/restaurante',
  restaurante: 'IFood/restaurante',
  comida: 'IFood/restaurante',
  almoco: 'IFood/restaurante',
  almoço: 'IFood/restaurante',
  jantar: 'IFood/restaurante',
  lanche: 'IFood/restaurante',
  uber: 'Uber/transporte',
  transporte: 'Uber/transporte',
  onibus: 'Uber/transporte',
  ônibus: 'Uber/transporte',
  mercado: 'Mercado',
  supermercado: 'Mercado',
  farmacia: 'Saúde',
  farmácia: 'Saúde',
  remedio: 'Saúde',
  remédio: 'Saúde',
  medico: 'Saúde',
  médico: 'Saúde',
  psicologa: 'Saúde',
  psicóloga: 'Saúde',
  psicologo: 'Saúde',
  psicólogo: 'Saúde',
  raia: 'Saúde',
  drogaria: 'Saúde',
  bottega: 'Saúde',
  totalpass: 'Saúde',
  monj: 'Saúde',
  beleza: 'Beleza',
  sobrancelha: 'Beleza',
  unha: 'Beleza',
  cabelo: 'Beleza',
  cabela: 'Beleza',
  manicure: 'Beleza',
  estetica: 'Beleza',
  estética: 'Beleza',
  belezaweb: 'Beleza',
  lazer: 'Lazer',
  cinema: 'Lazer',
  cafestival: 'Lazer',
  netflix: 'Assinaturas',
  spotify: 'Assinaturas',
  apple: 'Assinaturas',
  kindle: 'Assinaturas',
  iof: 'Assinaturas',
  assinatura: 'Assinaturas',
  assinaturas: 'Assinaturas',
  opencode: 'Assinaturas',
  roupa: 'Vestuário',
  vestuario: 'Vestuário',
  vestuário: 'Vestuário',
  tenis: 'Vestuário',
  tênis: 'Vestuário',
  calcado: 'Vestuário',
  calçado: 'Vestuário',
  presente: 'Presentes',
  presentes: 'Presentes',
  investimento: 'Investimentos',
  reserva: 'Investimentos',
};

const HUSBAND_NAMES = ['joão', 'joao', 'john', 'josé', 'jose', 'pedro', 'paulo', 'lucas', 'carlos', 'antonio', 'antônio', 'marido'];
const WIFE_NAMES = ['maria', 'ana', 'julia', 'júlia', 'fernanda', 'carla', 'patricia', 'patrícia', 'amanda', 'esposa', 'mulher'];

function extractAmount(text: string): number | null {
  const cleaned = text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  if (/milh[aã]o/i.test(cleaned)) return 1000000;
  if (/milhar\b/i.test(cleaned)) return null;

  const mil = /\b(\d+[\.,]?\d*)\s*mil\b/i.exec(cleaned);
  if (mil) {
    const base = parseFloat(mil[1].replace(',', '.'));
    return base * 1000;
  }

  const reaisRegex = /(?:r\$\s*)?(\d{1,3}(?:[\.]\d{3})*(?:,\d{1,2})?)(?:\s*(?:reais|r\$|pila|conto|real|pilas|contos))/i;
  const reaisMatch = reaisRegex.exec(cleaned);
  if (reaisMatch) {
    return parseFloat(reaisMatch[1].replace(/\./g, '').replace(',', '.'));
  }

  const fullNumRegex = /(\d{1,3}(?:\.\d{3})*,\d{2}|\d{1,3}(?:,\d{3})*\.\d{2}|\d+,\d{2}|\d+\.\d{2}|\d{1,3}(?:[\.]\d{3})+|\d{1,3}(?:,\d{3})+|\d+)/;
  const fullMatch = fullNumRegex.exec(cleaned);
  if (fullMatch) {
    let raw = fullMatch[1];

    if (raw.includes('.') && raw.includes(',')) {
      raw = raw.replace(/\./g, '').replace(',', '.');
    } else if (raw.includes(',')) {
      const parts = raw.split(',');
      if (parts[1] && parts[1].length === 3) {
        raw = parts[0] + parts[1];
      } else {
        raw = raw.replace(',', '.');
      }
    } else if (raw.includes('.')) {
      const parts = raw.split('.');
      if (parts.length > 2 || (parts[1] && parts[1].length === 3)) {
        raw = raw.replace(/\./g, '');
      }
    }

    const val = parseFloat(raw);
    if (val > 0) return val;
  }

  return null;
}

function extractCategory(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [keyword, category] of Object.entries(CATEGORY_MAP)) {
    if (lower.includes(keyword)) return category;
  }
  return null;
}

function extractPerson(text: string): 'husband' | 'wife' | 'couple' | null {
  const lower = text.toLowerCase();

  for (const name of HUSBAND_NAMES) {
    if (lower.includes(name)) return 'husband';
  }

  for (const name of WIFE_NAMES) {
    if (lower.includes(name)) return 'wife';
  }

  return null;
}

function isShared(text: string): boolean {
  const lower = text.toLowerCase();
  return /\b(casal|casa|carro|financiamento|aluguel|mercado|luz|agua|água|internet|condominio|condomínio|familia|família|nossa|nosso)\b/i.test(lower);
}

function extractDate(text: string): string | null {
  const dateRegex = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/;
  const match = dateRegex.exec(text);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    let year = match[3] ? (match[3].length === 2 ? `20${match[3]}` : match[3]) : `${new Date().getFullYear()}`;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');

  const diaRegex = /(?:ate|até|vence|vencimento|dia)\s+(\d{1,2})\b/i;
  const diaMatch = diaRegex.exec(text);
  if (diaMatch) {
    const day = diaMatch[1].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return null;
}

export function extractPaymentMethod(text: string): string | null {
  const lower = text.toLowerCase();

  if (/(?:conta\s*caixa|\bcaixa\b)/i.test(lower)) return 'CAIXA';
  if (/(?:nubank|nu\s*bank)/i.test(lower)) return 'NUBANK';
  if (/(?:d[ée]bito)/i.test(lower)) return 'DEBITO';
  if (/(?:cr[ée]dito\s*3|cart[ãa]o\s*3)/i.test(lower)) return 'CREDITO_3';
  if (/(?:cr[ée]dito\s*4|cart[ãa]o\s*4)/i.test(lower)) return 'CREDITO_4';
  if (/(?:cr[ée]dito|cart[ãa]o)/i.test(lower)) return 'NUBANK';

  return null;
}

export function extractInstallments(text: string): { total: number; current: number } | null {
  const lower = text.toLowerCase();

  const parcelaDe = /parcela\s+(\d+)\s*(?:de|de\s+|\/)\s*(\d+)/i.exec(lower);
  if (parcelaDe) return { total: parseInt(parcelaDe[2]), current: parseInt(parcelaDe[1]) };

  const frac = /(\d+)\/(\d+)/g;
  let fracMatch;
  while ((fracMatch = frac.exec(lower)) !== null) {
    const a = parseInt(fracMatch[1]);
    const b = parseInt(fracMatch[2]);
    if (a > 0 && b > 0 && a <= b && b <= 36) {
      return { total: b, current: a };
    }
  }

  const emX = /(?:em\s+)?(\d+)\s*x\b/i.exec(lower);
  if (emX) return { total: parseInt(emX[1]), current: 1 };

  const matchParcelas = /(\d+)\s*parcelas?/i.exec(lower);
  if (matchParcelas) return { total: parseInt(matchParcelas[1]), current: 1 };

  const parcelado = /parcelad[oa]\s+(?:em\s+)?(\d+)/i.exec(lower);
  if (parcelado) return { total: parseInt(parcelado[1]), current: 1 };

  return null;
}

export function parseWithRegex(text: string): ParsedTransaction | null {
  const cleaned = text.trim();
  const lower = cleaned.toLowerCase();

  let isExpense = /\b(gastei|paguei|deixei|foi|gasto|pagar|pago|comprei|comprou|despesa|despesas|saída|saida)\b/i.test(lower);
  let isIncome = /\b(recebi|ganhei|caiu|cai|cahiu|salario|salário|pagamento|entrada|receita|renda)\b/i.test(lower);
  let isReminder = /\b(lembrete|lembrar|lembra|vencendo|vence|vencimento)\b/i.test(lower);

  if (!isExpense && !isIncome && !isReminder) {
    // Tenta detectar por valor + contexto
    const hasAmount = /\b\d+[\.,]?\d*\b/.test(lower);
    const hasR$ = /r\$/.test(lower);
    if (hasAmount || hasR$) {
      // Se tem valor, assume despesa por padrao
      isExpense = true;
    } else {
      return null;
    }
  }

  const amount = extractAmount(cleaned);
  const category = extractCategory(cleaned);
  const person = extractPerson(cleaned);
  const dueDate = extractDate(cleaned);

  let transactionType: 'expense' | 'income' | 'reminder';
  let description = '';

  if (isReminder) {
    transactionType = 'reminder';
    description = cleaned
      .replace(/^lembrete:?\s*/i, '')
      .replace(/^lembrar\s*/i, '')
      .replace(/^lembra\s*/i, '')
      .replace(/\b(pagar|pago|pagamento)\b/i, '')
      .trim();
  } else if (isExpense) {
    transactionType = 'expense';
    description = cleaned
      .replace(/^(gastei|paguei|deixei|foi|gasto|pagar|pago|comprei|comprou|despesa|despesas|saída|saida)\s*/i, '')
      .replace(/\b(no|na|em|com|de)\s*/gi, ' ')
      .trim();
  } else {
    transactionType = 'income';
    description = cleaned
      .replace(/^(recebi|ganhei|caiu|cai|cahiu|salario|salário|pagamento|entrada|receita|renda)\s*/i, '')
      .replace(/\b(no|na|em|com|de)\s*/gi, ' ')
      .trim();
  }

  if (!amount && transactionType !== 'reminder') {
    return null;
  }

  const shared = isShared(cleaned);
  const paymentMethod = extractPaymentMethod(cleaned);
  const installments = extractInstallments(cleaned);

  return {
    transaction_type: transactionType,
    amount,
    category: category || 'outros',
    person: person || (shared ? 'couple' : null),
    description: description || cleaned,
    due_date: dueDate,
    is_shared: shared,
    paymentMethod,
    installments,
  };
}
