import Groq from 'groq-sdk';
import { PrismaClient } from '@prisma/client';

const PARSING_PROMPT = `Voce e um assistente financeiro que extrai informacoes de mensagens em portugues do Brasil.

Analise a mensagem e extraia:
- transaction_type: "expense" (gasto/despesa), "income" (receita/salario/pagamento), ou "reminder" (lembrete/conta a pagar)
- amount: valor numerico em reais (ex: 50.00, 2100.00, 3500.50)
- category: uma destas categorias: Alimentacao, Transporte, Moradia, Saude, Educacao, Lazer, Assinaturas, Vestuario, Salario, Investimentos, Beleza, Outros
- person: quem fez - "husband" (marido), "wife" (esposa), "couple" (casal/compartilhado), ou null se nao especificado
- description: descricao resumida do que foi gasto ou recebido (sem o valor, sem a pessoa)
- due_date: data de vencimento em YYYY-MM-DD, se mencionada
- is_shared: boolean, se e gasto compartilhado do casal

REGRAS DE VALOR (MUITO IMPORTANTE):
- "2,100" ou "2.100" = 2100.00 (virgula ou ponto entre 3 digitos = SEPARADOR DE MILHAR)
- "2,10" = 2.10 (virgula com 2 digitos apos = CENTAVOS)
- "2100" = 2100.00
- "50 reais", "R$50", "50 pila", "50 conto" = 50.00
- "mil" = 1000, "2 mil" = 2000, "milhao" = 1000000
- "3.500,00" = 3500.00 (ponto = milhar, virgula = decimal)
- SEMPRE retorne o valor como numero decimal (ex: 2100.00, nao "2,100")

REGRAS DE PESSOA:
- "salario esposa", "salario da esposa", "minha esposa" -> person="wife"
- "salario marido", "salario do marido", "meu marido" -> person="husband"
- "nosso", "casal", "casa" -> person="couple" e is_shared=true
- Se nao mencionar pessoa, person=null

REGRAS DE CATEGORIA:
- "salario" -> Salario
- "ifood", "restaurante", "comida", "mercado", "supermercado" -> Alimentacao
- "uber", "gasolina", "onibus", "transporte" -> Transporte
- "aluguel", "luz", "agua", "internet", "condominio" -> Moradia
- "farmacia", "medico", "saude", "remedio" -> Saude
- "netflix", "spotify", "assinatura" -> Assinaturas
- "roupa", "tenis", "calcado" -> Vestuario
- "cinema", "lazer", "viagem" -> Lazer

Retorne APENAS um JSON valido com as chaves: transaction_type, amount, category, person, description, due_date, is_shared.
Se nao for uma mensagem financeira, retorne {"transaction_type": "unknown"}.`;

export interface ParsedTransaction {
  transaction_type: 'expense' | 'income' | 'reminder' | 'unknown';
  amount: number | null;
  category: string | null;
  person: 'husband' | 'wife' | 'couple' | null;
  description: string;
  due_date: string | null;
  is_shared: boolean;
}

const VALID_CATEGORIES = [
  'Alimentação', 'Transporte', 'Moradia', 'Saúde', 'Educação',
  'Lazer', 'Assinaturas', 'Vestuário', 'Salário', 'Investimentos',
  'Beleza', 'Outros',
];

function normalizeCategory(raw: string): string {
  const normalized = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  for (const valid of VALID_CATEGORIES) {
    const validNorm = valid.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (validNorm === normalized) return valid;
  }
  return 'Outros';
}

function normalizeParsed(raw: any): ParsedTransaction {
  const category = raw.category ? normalizeCategory(raw.category) : 'Outros';
  const validPersons = ['husband', 'wife', 'couple'];
  const person = validPersons.includes(raw.person) ? raw.person : null;

  let amount: number | null = null;
  if (typeof raw.amount === 'number') {
    amount = raw.amount;
  } else if (typeof raw.amount === 'string') {
    const cleaned = raw.amount.replace(/\./g, '').replace(',', '.');
    amount = parseFloat(cleaned);
    if (isNaN(amount)) amount = null;
  }

  return {
    transaction_type: raw.transaction_type || 'unknown',
    amount,
    category,
    person,
    description: typeof raw.description === 'string' ? raw.description : '',
    due_date: raw.due_date && /^\d{4}-\d{2}-\d{2}$/.test(raw.due_date) ? raw.due_date : null,
    is_shared: Boolean(raw.is_shared),
  };
}

export async function parseWithGroq(text: string): Promise<ParsedTransaction | null> {
  const prisma = new PrismaClient();
  const botEmail = process.env.BOT_DEFAULT_EMAIL || '';
  let userId = '';
  if (botEmail) {
    const u = await prisma.user.findUnique({ where: { email: botEmail } });
    if (u) userId = u.id;
  }
  const { getSetting } = await import('../../api/services/settings.js');
  const apiKey = await getSetting(userId, 'groqApiKey', process.env.GROQ_API_KEY);

  if (!apiKey) {
    console.warn('[nlp] GROQ_API_KEY not set, skipping Groq parse');
    return null;
  }

  const client = new Groq({ apiKey });

  try {
    const result = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: PARSING_PROMPT },
        { role: 'user', content: `Mensagem: "${text}"` },
      ],
      temperature: 0,
      max_tokens: 200,
    });

    const responseText = result.choices[0]?.message?.content?.trim() || '';

    console.log('[nlp] Groq response:', responseText);

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[nlp] Groq did not return valid JSON:', responseText);
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return normalizeParsed(parsed);
  } catch (err) {
    console.error('[nlp] Groq parse error:', err);
    return null;
  }
}

export async function chatWithGroq(question: string, context: string): Promise<string | null> {
  const botEmail = process.env.BOT_DEFAULT_EMAIL || '';
  let apiKey = process.env.GROQ_API_KEY || '';

  if (botEmail) {
    const prisma = new PrismaClient();
    const u = await prisma.user.findUnique({ where: { email: botEmail } });
    if (u) {
      const { getSetting } = await import('../../api/services/settings.js');
      const key = await getSetting(u.id, 'groqApiKey', process.env.GROQ_API_KEY);
      if (key) apiKey = key;
    }
  }

  if (!apiKey) return null;

  const client = new Groq({ apiKey });

  const result = await client.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: `Voce e um assistente financeiro para casais.

REGRAS CRITICAS:
- Use APENAS os dados fornecidos no contexto
- NAO invente numeros, datas ou valores
- Se um dado nao estiver no contexto, diga exatamente "Nao tenho essa informacao"
- Responda SEMPRE em portugues do Brasil
- Valores monetarios: use R$ com virgula decimal (R$1.500,00)
- Maximo 250 caracteres por resposta
- Seja direto e objetivo`
      },
      {
        role: 'user',
        content: `DADOS OFICIAIS:\n${context}\n\nPergunta: ${question}`
      }
    ],
    temperature: 0,
    max_tokens: 250,
  });

  return result.choices[0]?.message?.content?.trim() || null;
}