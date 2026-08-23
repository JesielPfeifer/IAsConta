import { useState, useEffect } from "react";
import { api } from "../api/client";
import { CalendarDays } from "lucide-react";

interface CardInfo {
  pluggyAccountId: string;
  paymentMethod: string;
  invoiceDay: number;
  configurado: boolean;
}

export default function CardInvoiceSettings() {
  const [cards, setCards] = useState<CardInfo[]>([]);
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api("/api/cards/fechamento")
      .then((d: CardInfo[]) => {
        setCards(d);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function save(c: CardInfo) {
    const day = Number(drafts[c.pluggyAccountId] ?? c.invoiceDay);
    if (!Number.isInteger(day) || day < 1 || day > 31) return;
    setSaving(c.pluggyAccountId);
    try {
      await api("/api/cards/fechamento/" + c.pluggyAccountId, {
        method: "PUT",
        body: JSON.stringify({ day }),
      });
      setCards((prev) =>
        prev.map((x) => (x.pluggyAccountId === c.pluggyAccountId ? { ...x, invoiceDay: day, configurado: true } : x))
      );
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="rounded-2xl bg-gray-900/60 border border-white/5 p-5">
      <div className="flex items-center gap-3 mb-1">
        <CalendarDays className="w-5 h-5 text-emerald-400" />
        <h2 className="text-lg font-semibold text-white">Dia de fechamento da fatura (cartões)</h2>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Define o ciclo de cada cartão de crédito para agrupar as compras na fatura correta
        (não o mês civil). Ex.: fechamento dia 25 =&gt; fatura cobra de 25 do mês anterior a 24 deste.
      </p>

      {!loaded ? (
        <p className="text-sm text-gray-600">Carregando…</p>
      ) : cards.length === 0 ? (
        <p className="text-sm text-gray-600">Nenhum cartão sincronizado.</p>
      ) : (
        <div className="space-y-3">
          {cards.map((c) => (
            <div key={c.pluggyAccountId} className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-medium text-white">{c.paymentMethod}</p>
                <p className="text-xs text-gray-500">
                  Fechamento dia {c.invoiceDay}
                  {c.configurado ? "" : " (inferido do vencimento)"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={31}
                  className="w-20 bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                  value={drafts[c.pluggyAccountId] ?? c.invoiceDay}
                  onChange={(e) => setDrafts((d) => ({ ...d, [c.pluggyAccountId]: Number(e.target.value) }))}
                />
                <button
                  onClick={() => save(c)}
                  disabled={saving === c.pluggyAccountId}
                  className="px-3 py-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-sm disabled:opacity-50"
                >
                  {saving === c.pluggyAccountId ? "Salvando…" : "Salvar"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
