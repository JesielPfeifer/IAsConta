import { useState, useRef, type DragEvent } from 'react';
import { api } from '../api/client';
import { X, UploadCloud, CheckCircle, FileText } from 'lucide-react';
import dayjs from 'dayjs';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

interface ParsedTx {
  date: string;
  description: string;
  amount: number;
  category?: string;
  source: string;
  installments?: { current: number; total: number };
}

interface ParseResult {
  success: boolean;
  transactions: ParsedTx[];
  errors: string[];
  metadata?: { bank: string; period?: string; totalAmount?: number; accountHolder?: string };
}

interface ImportSummary {
  transactions: number;
  bills: number;
  failed: number;
  months: string[];
}

function parseInstallment(description: string, provided?: { current: number; total: number }): { current: number; total: number } | null {
  if (provided) return provided;

  const match = description.match(/parcela\s+(\d+)\s*(?:\/|de\s+)\s*(\d+)/i);
  if (match) {
    const current = parseInt(match[1]);
    const total = parseInt(match[2]);
    if (current >= 1 && total >= 1 && current <= total) return { current, total };
  }

  const slashMatch = description.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?:\s|$)/);
  if (slashMatch) {
    const current = parseInt(slashMatch[1]);
    const total = parseInt(slashMatch[2]);
    if (current >= 1 && total >= 1 && current <= total && total <= 120) {
      return { current, total };
    }
  }

  const deMatch = description.match(/(\d{1,2})\s+de\s+(\d{1,2})/i);
  if (deMatch) {
    const current = parseInt(deMatch[1]);
    const total = parseInt(deMatch[2]);
    if (current >= 1 && total >= 1 && current <= total && total <= 120) {
      return { current, total };
    }
  }

  return null;
}

function formatMonthLabel(monthStr: string): string {
  const months = ['Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const [year, month] = monthStr.split('-');
  const monthIdx = parseInt(month) - 1;
  return `${months[monthIdx] || month} ${year}`;
}

export default function FileImport({ onClose, onSuccess }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const isPdf = file.name.toLowerCase().endsWith('.pdf');
      const parseEndpoint = isPdf ? '/api/parse/caixa' : '/api/parse/nubank';

      if (password && isPdf) {
        formData.append('password', password);
      }

      const result: ParseResult = await api(parseEndpoint, {
        method: 'POST',
        body: formData,
      });

      if (!result.success && result.transactions.length === 0) {
        setError(result.errors?.join('; ') || 'Formato nao reconhecido');
        setUploading(false);
        return;
      }

      if (!result.transactions || result.transactions.length === 0) {
        setError('Nenhuma transacao encontrada no arquivo.');
        setUploading(false);
        return;
      }

      let importedTx = 0;
      let importedBills = 0;
      let failed = 0;
      const monthsSet = new Set<string>();

      for (const tx of result.transactions) {
        try {
          const isIncome = isPdf ? false : tx.amount < 0;
          const absAmount = Math.abs(tx.amount);
          const installment = parseInstallment(tx.description, tx.installments);
          const txDate = new Date(tx.date + 'T12:00:00.000Z');
          const txMonth = dayjs(txDate).format('YYYY-MM');
          monthsSet.add(txMonth);

          if (installment && !isIncome) {
            const remaining = installment.total - installment.current;

            await api('/api/transactions', {
              method: 'POST',
              body: JSON.stringify({
                amount: absAmount,
                type: 'EXPENSE',
                description: tx.description,
                date: txDate.toISOString(),
                person: 'COUPLE',
                isShared: true,
                source: isPdf ? 'CAIXA_PDF' : 'NUBANK_CSV',
                categoryId: null,
              }),
            });
            importedTx++;

            if (remaining > 0) {
              const baseDate = new Date(txDate);
              for (let i = 1; i <= remaining; i++) {
                const nextDate = new Date(baseDate);
                nextDate.setMonth(nextDate.getMonth() + i);
                const targetMonth = nextDate.getMonth();
                nextDate.setDate(Math.min(baseDate.getDate(), new Date(nextDate.getFullYear(), targetMonth + 1, 0).getDate()));
                monthsSet.add(dayjs(nextDate).format('YYYY-MM'));

                await api('/api/bills', {
                  method: 'POST',
                  body: JSON.stringify({
                    name: tx.description,
                    amount: absAmount,
                    dueDate: nextDate.toISOString(),
                    person: 'COUPLE',
                    isShared: true,
                    totalInstallments: installment.total,
                    currentInstallment: installment.current + i,
                  }),
                });
                importedBills++;
              }
            }
          } else {
            await api('/api/transactions', {
              method: 'POST',
              body: JSON.stringify({
                amount: absAmount,
                type: isIncome ? 'INCOME' : 'EXPENSE',
                description: tx.description,
                date: txDate.toISOString(),
                person: 'COUPLE',
                isShared: true,
                source: isPdf ? 'CAIXA_PDF' : 'NUBANK_CSV',
                categoryId: null,
              }),
            });
            importedTx++;
          }
        } catch {
          failed++;
        }
      }

      setSummary({
        transactions: importedTx,
        bills: importedBills,
        failed,
        months: Array.from(monthsSet).sort(),
      });
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Erro ao processar arquivo');
    } finally {
      setUploading(false);
    }
  }

  if (summary) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
        <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
            <h2 className="text-lg font-semibold text-white">Importacao Concluida</h2>
            <button onClick={onClose} className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
          </div>
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-center py-4">
              <CheckCircle className="w-16 h-16 text-emerald-400" />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center bg-gray-800 rounded-lg px-4 py-3">
                <span className="text-sm text-gray-400">Transacoes importadas</span>
                <span className="text-lg font-bold text-emerald-400">{summary.transactions}</span>
              </div>
              {summary.bills > 0 && (
                <div className="flex justify-between items-center bg-gray-800 rounded-lg px-4 py-3">
                  <span className="text-sm text-gray-400">Parcelas futuras (contas fixas)</span>
                  <span className="text-lg font-bold text-yellow-400">{summary.bills}</span>
                </div>
              )}
              {summary.failed > 0 && (
                <div className="flex justify-between items-center bg-gray-800 rounded-lg px-4 py-3">
                  <span className="text-sm text-gray-400">Falhas</span>
                  <span className="text-lg font-bold text-red-400">{summary.failed}</span>
                </div>
              )}
            </div>

            <div className="bg-gray-800 rounded-lg px-4 py-3">
              <p className="text-sm text-gray-400 mb-2">Adicionadas aos meses:</p>
              <div className="flex flex-wrap gap-2">
                {summary.months.map(m => (
                  <span key={m} className="px-3 py-1 bg-emerald-500/10 text-emerald-400 rounded-full text-xs font-medium">
                    {formatMonthLabel(m)}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={onClose} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2.5 rounded-lg text-sm font-medium">Concluir</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">Importar Arquivo</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          {!file ? (
            <div
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => inputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${dragOver ? 'border-emerald-400 bg-emerald-500/5' : 'border-gray-700 hover:border-gray-500'}`}
            >
              <UploadCloud className="w-10 h-10 text-gray-500 mx-auto mb-2" />
              <p className="text-sm text-gray-400">Arraste um arquivo CSV (Nubank) ou PDF (Caixa) aqui</p>
              <p className="text-xs text-gray-500 mt-1">ou clique para selecionar</p>
            </div>
          ) : (
            <div className="flex items-center gap-3 bg-gray-800 rounded-lg px-4 py-3">
              <FileText className="w-8 h-8 text-gray-400" />
              <div className="flex-1">
                <p className="text-sm text-white font-medium">{file.name}</p>
                <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(0)} KB</p>
              </div>
              <button onClick={() => { setFile(null); setPassword(''); }} className="text-gray-400 hover:text-red-400">
                <X className="w-5 h-5" />
              </button>
            </div>
          )}
          <input ref={inputRef} type="file" accept=".csv,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setPassword(''); } }} />

          {file && file.name.toLowerCase().endsWith('.pdf') && (
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Senha do PDF (se houver)</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Senha do PDF..."
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              />
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2 text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2.5 rounded-lg text-sm">Cancelar</button>
            <button onClick={handleUpload} disabled={!file || uploading} className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-medium">{uploading ? 'Processando...' : 'Importar'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}