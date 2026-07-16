function removeAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'Alimentação': ['ifood', 'restaurante', 'padaria', 'mercado', 'supermercado', 'carrefour', 'pao', 'acougue', 'hortifruti', 'lanchonete'],
  'Transporte': ['uber', '99', 'posto', 'ipiranga', 'shell', 'gasolina', 'estacionamento', 'pedagio', 'onibus', 'metro'],
  'Saúde': ['farmacia', 'drogaria', 'medico', 'hospital', 'clinica', 'dentista', 'exame', 'consultorio'],
  'Assinaturas': ['netflix', 'spotify', 'amazon', 'disney', 'hbo', 'apple', 'google', 'youtube'],
  'Moradia': ['aluguel', 'condominio', 'iptu', 'luz', 'agua', 'gas', 'internet', 'telefone'],
  'Lazer': ['cinema', 'teatro', 'show', 'bar', 'cerveja', 'viagem', 'hotel'],
  'Vestuário': ['roupa', 'calcado', 'tenis', 'camisa', 'shopping', 'renner', 'cea'],
};

export function autoCategorize(description: string): string | null {
  const lower = removeAccents(description).toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) {
      return category;
    }
  }
  return null;
}
