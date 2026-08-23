import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.GEMINI_API_KEY || '';
const genAI = new GoogleGenerativeAI(apiKey);

const PARSING_PROMPT = `Voce e um assistente financeiro que extrai informacoes de mensagens em portugues.

Analise a mensagem e extraia:
- transaction_type: "expense" (gasto), "income" (receita), ou "reminder" (lembrete)
- amount: valor numerico em reais (ex: 50.00)
- category: categoria (supermercado, farmacia, transporte, restaurante, salario, contas, lazer, saude, educacao, moradia, assinaturas, vestuario, investimentos, outros)
- person: quem fez o gasto - "husband", "wife", "couple", ou null se nao especificado
- description: descricao resumida
- due_date: data de vencimento em YYYY-MM-DD, se mencionada
- is_shared: boolean, se e gasto do casal

Regras:
- Se a pessoa nao for mencionada, assuma que foi quem enviou a mensagem (person=null, o sistema decide)
- "conta do casal", "casa", "carro", "financiamento" geralmente sao is_shared=true
- "meu", "minha", "eu" indica gasto pessoal
- "meu marido", "marido", "Joao" (nome masculino) -> person="husband"
- "minha esposa", "esposa", "Maria" (nome feminino) -> person="wife"
- Valores como "50 reais", "R$50", "50 pila", "50 conto" sao amount=50
- "mil" = 1000, "milhao" = 1000000

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
  'supermercado', 'farmacia', 'transporte', 'restaurante',
  'salario', 'contas', 'lazer', 'saude', 'educacao',
  'moradia', 'assinaturas', 'vestuario', 'investimentos', 'outros',
];

function normalizeParsed(raw: any): ParsedTransaction {
  const category = VALID_CATEGORIES.includes(raw.category) ? raw.category : 'outros';
  const validPersons = ['husband', 'wife', 'couple'];
  const person = validPersons.includes(raw.person) ? raw.person : null;

  return {
    transaction_type: raw.transaction_type || 'unknown',
    amount: typeof raw.amount === 'number' ? raw.amount : null,
    category,
    person,
    description: typeof raw.description === 'string' ? raw.description : '',
    due_date: raw.due_date && /^\d{4}-\d{2}-\d{2}$/.test(raw.due_date) ? raw.due_date : null,
    is_shared: Boolean(raw.is_shared),
  };
}

export async function parseWithGemini(text: string): Promise<ParsedTransaction | null> {
  if (!apiKey) {
    console.warn('[nlp] GEMINI_API_KEY not set, skipping Gemini parse');
    return null;
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const result = await model.generateContent([
      { text: PARSING_PROMPT },
      { text: `Mensagem: "${text}"` },
    ]);

    const response = result.response;
    const responseText = response.text().trim();

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[nlp] Gemini did not return valid JSON:', responseText);
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return normalizeParsed(parsed);
  } catch (err) {
    console.error('[nlp] Gemini parse error:', err);
    return null;
  }
}
