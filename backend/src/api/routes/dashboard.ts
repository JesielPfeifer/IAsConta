import { logger } from '../../lib/logger.js';
import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();
const prisma = new PrismaClient();

router.use(authMiddleware);

/**
 * Internal transfers between the user's own accounts (e.g. Caixa ↔ Nubank)
 * are NOT income nor expense — they just move money between the couple's own
 * accounts. No bank/name is hardcoded. A transfer pair is detected from Open
 * Finance data: one leg out (EXPENSE) and one leg in (INCOME) on DIFFERENT
 * accounts of the same user, same amount, dates within 3 days, both
 * descriptions indicating a transfer — AND the two descriptions must share a
 * common remainder after stripping direction words ("pix", "envio",
 * "recebimento"...). The fingerprint requirement prevents an unrelated
 * outgoing PIX and an unrelated incoming PIX of the same value from being
 * wrongly removed (e.g. a payment to a store and a reimbursement).
 */
const TRANSFER_RE = /(?:pix|transfer|ted|doc|envio|recebimento)/i;
// Direction/boilerplate words stripped before comparing transfer descriptions
const TRANSFER_NOISE_RE =
  /(?:enviad[oa]|recebid[oa]|transfer|transf|ted|doc|pix|pagamento|pagto|entre|contas|conta)/gi;

function transferFingerprint(description: string): string {
  return (description || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(TRANSFER_NOISE_RE, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function descriptionsMatchTransferPair(a: string, b: string): boolean {
  const fa = transferFingerprint(a);
  const fb = transferFingerprint(b);
  if (!fa || !fb) return false;
  return fa === fb || fa.includes(fb) || fb.includes(fa);
}

export function filterInternalTransfers<T extends { id: string; type: string; amount: number; date: Date; description: string; pluggyAccountId?: string | null }>(
  transactions: T[]
): T[] {
  const transferCandidates = transactions.filter(
    (tx) => TRANSFER_RE.test(tx.description) && tx.pluggyAccountId
  );
  const isInternalTransfer = (tx: T): boolean => {
    if (!TRANSFER_RE.test(tx.description) || !tx.pluggyAccountId) return false;
    const wantedType = tx.type === "EXPENSE" ? "INCOME" : "EXPENSE";
    const matches = transferCandidates.filter((other) => {
      if (other.id === tx.id) return false;
      if (other.type !== wantedType) return false;
      if (other.pluggyAccountId === tx.pluggyAccountId) return false; // same account
      if (Math.abs(Math.abs(other.amount) - Math.abs(tx.amount)) >= 0.01) return false;
      const days = Math.abs(other.date.getTime() - tx.date.getTime()) / 86400000;
      if (days > 3) return false;
      return true;
    });
    if (matches.length === 0) return false;
    // Both legs describe the same transfer (same counterparty/bank after
    // removing direction words) — certainly internal.
    if (matches.some((o) => descriptionsMatchTransferPair(tx.description, o.description))) return true;
    // No shared fingerprint (e.g. "PIX RECEBIDO DADOS CONTA" has no name),
    // but there is a single exact-value counterpart within 3 days between
    // two DIFFERENT own accounts: overwhelmingly an internal transfer
    // (own money moved between accounts), otherwise it would inflate totals.
    // With more than one candidate the fingerprint stays mandatory (safe).
    return matches.length === 1;
  };
  return transactions.filter((tx) => !isInternalTransfer(tx));
}

function getMonthRange(month?: string): { start: Date; end: Date } {
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split("-").map(Number);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1);
    return { start, end };
  }
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end };
}

/**
 * Shared credit-card predicate for /credit-card-total and /credit-card-detail.
 * A transaction is "card" when it was synced from Pluggy (isCreditCard=true)
 * or its payment method is configured as CARD. The isCreditCard flag is the
 * stable classifier — a payment-method rename or deletion cannot hide
 * historical card transactions (the name list only covers legacy rows).
 */
async function cardTransactionWhere(userId: string, start: Date, end: Date) {
  const cardMethods = await prisma.paymentMethod.findMany({
    where: { userId, type: "CARD" },
    select: { name: true },
  });
  // Apenas COMPRAS de cartão de crédito. Transferências/PIX/TED não são
  // compras no cartão mesmo quando saem de uma conta de cartão (Pluggy
  // marca isCreditCard=true nessas transações) — excluímos por padrão de
  // descrição. Entradas (INCOME) já são excluídas pelo type:"EXPENSE".
  const notTransfer = [
    "transferência enviada",
    "transferência recebida",
    "pix enviado",
    "pix recebido",
    "pix enviad",
    "recebimento ted",
    "ted ",
    "doc enviado",
    "doc recebido",
  ].map((s) => ({ NOT: { description: { contains: s, mode: "insensitive" as const } } }));
  // Filtra pela FATURA (mês correto da fatura), não pela data da compra.
  // billForecastMonth é String "YYYY-MM" informada pelo Pluggy (mês em que a
  // fatura fecha). Ex.: compra de 18/08 com billForecastMonth="2026-09" deve
  // aparecer em Setembro no card de cartão, não em Agosto. Compras manuais/
  // legado sem billForecastMonth definido caem no mês da data da compra.
  const monthKey = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
  const invoiceFilter = {
    OR: [
      { billForecastMonth: monthKey },
      { billForecastMonth: null, date: { gte: start, lt: end } },
    ],
  };
  return {
    userId,
    type: "EXPENSE" as const,
    AND: [
      ...notTransfer,
      // Filtro pela FATURA (mês correto): billForecastMonth = mês filtrado,
      // ou (sem fatura definida) a data da compra no mês.
      {
        OR: [
          { billForecastMonth: monthKey },
          { billForecastMonth: null, date: { gte: start, lt: end } },
        ],
      },
      // Apenas compras de cartão de crédito.
      {
        OR: [
          { isCreditCard: true },
          // Legacy rows: payment method configured as CARD by the user
          { paymentMethod: { in: cardMethods.map((m) => m.name) } },
        ],
      },
    ],
  };
}

/**
 * Parcela do mês de uma transação de cartão. Semântica do amount:
 *  - transações Pluggy: amount = parcela do mês (totalAmount = total da compra)
 *  - transações manuais/bot: amount = total da compra; parcela = amount/N
 * À vista (totalInstallments <= 1) a parcela é o próprio amount.
 */
function monthlyInstallmentAmount(tx: {
  amount: number;
  totalAmount?: number | null;
  totalInstallments: number;
}): number {
  if (tx.totalAmount != null) return tx.amount; // Pluggy: amount já é a parcela
  return tx.totalInstallments > 1 ? tx.amount / tx.totalInstallments : tx.amount;
}

router.get("/summary", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { start, end } = getMonthRange(req.query.month as string);

    const [rawTransactions, bills] = await Promise.all([
      prisma.transaction.findMany({
        where: {
          userId: user.id,
          date: { gte: start, lt: end },
          // Transactions linked to a credit card fatura are excluded: the
          // corresponding Bill row already counts that expense once.
          billId: null,
        },
        include: { category: true },
      }),
      prisma.bill.findMany({
        where: {
          userId: user.id,
          dueDate: { gte: start, lt: end },
        },
      }),
    ]);

    // Internal transfers between the user's own accounts are not income nor
    // expense (same rule as the annual panorama).
    const transactions = filterInternalTransfers(rawTransactions);

    let totalIncome = 0;
    let totalExpense = 0;
    let husbandIncome = 0;
    let husbandExpense = 0;
    let wifeIncome = 0;
    let wifeExpense = 0;

    for (const tx of transactions) {
      const isExpense = tx.type === "EXPENSE";
      const amount = tx.amount;
      const person = tx.person;

      if (person === "COUPLE") {
        const half = amount / 2;
        if (isExpense) {
          totalExpense += amount;
          husbandExpense += half;
          wifeExpense += half;
        } else {
          totalIncome += amount;
          husbandIncome += half;
          wifeIncome += half;
        }
      } else if (person === "HUSBAND") {
        if (isExpense) {
          totalExpense += amount;
          husbandExpense += amount;
        } else {
          totalIncome += amount;
          husbandIncome += amount;
        }
      } else if (person === "WIFE") {
        if (isExpense) {
          totalExpense += amount;
          wifeExpense += amount;
        } else {
          totalIncome += amount;
          wifeIncome += amount;
        }
      } else {
        if (isExpense) {
          totalExpense += amount;
        } else {
          totalIncome += amount;
        }
      }
    }

    for (const bill of bills) {
      const amount = bill.amount;
      totalExpense += amount;

      if (bill.person === "COUPLE" || bill.isShared) {
        husbandExpense += amount / 2;
        wifeExpense += amount / 2;
      } else if (bill.person === "WIFE") {
        wifeExpense += amount;
      } else {
        husbandExpense += amount;
      }
    }

    const billsTotal = bills.reduce((sum, b) => sum + b.amount, 0);
    const balance = totalIncome - totalExpense;

    res.json({
      totalIncome,
      totalExpense,
      balance,
      billsTotal,
      byPerson: {
        husband: { income: husbandIncome, expense: husbandExpense },
        wife: { income: wifeIncome, expense: wifeExpense },
      },
    });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/by-category", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { start, end } = getMonthRange(req.query.month as string);

    // Internal transfers are excluded here too (same rule as /summary)
    const transactions = filterInternalTransfers(
      await prisma.transaction.findMany({
        where: {
          userId: user.id,
          type: "EXPENSE",
          date: { gte: start, lt: end },
          billId: null,
        },
        include: { category: true },
      })
    );
    const bills = await prisma.bill.findMany({
      where: {
        userId: user.id,
        dueDate: { gte: start, lt: end },
      },
      include: { category: true },
    });

    const byCategory: Record<string, number> = {};

    for (const tx of transactions) {
      const catName = tx.category?.name || "Sem categoria";
      byCategory[catName] = (byCategory[catName] || 0) + tx.amount;
    }

    for (const bill of bills) {
      const catName = bill.category?.name || "Contas Fixas";
      byCategory[catName] = (byCategory[catName] || 0) + bill.amount;
    }

    const result = Object.entries(byCategory).map(([name, total]) => ({
      category: name,
      total,
    }));

    result.sort((a, b) => b.total - a.total);

    res.json(result);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/percentage", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { start, end } = getMonthRange(req.query.month as string);

    // Internal transfers are excluded here too (same rule as /summary)
    const transactions = filterInternalTransfers(
      await prisma.transaction.findMany({
        where: {
          userId: user.id,
          type: "EXPENSE",
          date: { gte: start, lt: end },
          billId: null,
        },
      })
    );
    const bills = await prisma.bill.findMany({
      where: {
        userId: user.id,
        dueDate: { gte: start, lt: end },
      },
    });

    let husbandExpense = 0;
    let wifeExpense = 0;

    for (const tx of transactions) {
      if (tx.person === "COUPLE") {
        husbandExpense += tx.amount / 2;
        wifeExpense += tx.amount / 2;
      } else if (tx.person === "HUSBAND") {
        husbandExpense += tx.amount;
      } else if (tx.person === "WIFE") {
        wifeExpense += tx.amount;
      }
    }

    for (const bill of bills) {
      if (bill.person === "COUPLE" || bill.isShared) {
        husbandExpense += bill.amount / 2;
        wifeExpense += bill.amount / 2;
      } else if (bill.person === "WIFE") {
        wifeExpense += bill.amount;
      } else {
        husbandExpense += bill.amount;
      }
    }

    let husbandSalary = 0;
    let wifeSalary = 0;

    if (user.partnerId) {
      const partner = await prisma.user.findUnique({
        where: { id: user.partnerId },
      });
      if (partner) {
        wifeSalary = partner.salary ?? 0;
        husbandSalary = user.salary ?? 0;
      }
    } else {
      husbandSalary = user.salary ?? 0;
    }

    const husbandPercentage = husbandSalary > 0 ? (husbandExpense / husbandSalary) * 100 : 0;
    const wifePercentage = wifeSalary > 0 ? (wifeExpense / wifeSalary) * 100 : 0;

    res.json({
      husband: { expense: husbandExpense, salary: husbandSalary, percentage: Math.round(husbandPercentage * 100) / 100 },
      wife: { expense: wifeExpense, salary: wifeSalary, percentage: Math.round(wifePercentage * 100) / 100 },
    });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/by-payment", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { start, end } = getMonthRange(req.query.month as string);

    // Bill-aware: card purchases linked to a fatura are counted once via the
    // Bill row (paymentMethod "Fatura Cartão"), same rule as /summary.
    const [transactions, bills] = await Promise.all([
      prisma.transaction.findMany({
        where: { userId: user.id, type: "EXPENSE", date: { gte: start, lt: end }, billId: null },
      }),
      prisma.bill.findMany({
        where: { userId: user.id, dueDate: { gte: start, lt: end } },
      }),
    ]);

    const byPayment: Record<string, number> = {};
    for (const tx of filterInternalTransfers(transactions)) {
      const method = tx.paymentMethod || "Outros";
      byPayment[method] = (byPayment[method] || 0) + tx.amount;
    }
    for (const bill of bills) {
      const method = "Fatura Cartão";
      byPayment[method] = (byPayment[method] || 0) + bill.amount;
    }

    const result = Object.entries(byPayment).map(([method, total]) => ({ method, total }));
    result.sort((a, b) => b.total - a.total);
    res.json(result);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/credit-card-total", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { start, end } = getMonthRange(req.query.month as string);

    const transactions = await prisma.transaction.findMany({
      where: await cardTransactionWhere(user.id, start, end),
    });

    let total = 0;
    for (const tx of transactions) {
      // amount = parcela do mês para transações Pluggy (totalAmount setado);
      // para parcelas criadas manualmente/bot, amount = total da compra e a
      // parcela é amount/totalInstallments. O total do mês = soma das parcelas.
      total += monthlyInstallmentAmount(tx);
    }

    res.json({ total, count: transactions.length });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/comparison", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { start, end } = getMonthRange(req.query.month as string);

    const prevStart = new Date(start);
    prevStart.setMonth(prevStart.getMonth() - 1);
    const prevEnd = new Date(start);

    // Bill-aware comparison (same rule as /summary): faturas count once.
    const [currTx, prevTx, currBills, prevBills] = await Promise.all([
      prisma.transaction.findMany({ where: { userId: user.id, date: { gte: start, lt: end }, billId: null } }),
      prisma.transaction.findMany({ where: { userId: user.id, date: { gte: prevStart, lt: prevEnd }, billId: null } }),
      prisma.bill.findMany({ where: { userId: user.id, dueDate: { gte: start, lt: end } } }),
      prisma.bill.findMany({ where: { userId: user.id, dueDate: { gte: prevStart, lt: prevEnd } } }),
    ]);

    const currIncome = filterInternalTransfers(currTx).filter((t) => t.type === "INCOME").reduce((s, t) => s + t.amount, 0);
    const currExpense = filterInternalTransfers(currTx).filter((t) => t.type === "EXPENSE").reduce((s, t) => s + t.amount, 0)
      + currBills.reduce((s, b) => s + b.amount, 0);
    const prevIncome = filterInternalTransfers(prevTx).filter((t) => t.type === "INCOME").reduce((s, t) => s + t.amount, 0);
    const prevExpense = filterInternalTransfers(prevTx).filter((t) => t.type === "EXPENSE").reduce((s, t) => s + t.amount, 0)
      + prevBills.reduce((s, b) => s + b.amount, 0);

    const diffIncome = currIncome - prevIncome;
    const diffExpense = currExpense - prevExpense;
    const diffPercent = prevExpense > 0 ? ((currExpense - prevExpense) / prevExpense) * 100 : 0;

    res.json({
      current: { income: currIncome, expense: currExpense },
      previous: { income: prevIncome, expense: prevExpense },
      diffIncome,
      diffExpense,
      diffPercent: Math.round(diffPercent),
    });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/year-analysis", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const year = new Date().getFullYear();
    const start = new Date(year, 0, 1);
    const end = new Date(year + 1, 0, 1);

    // Bill-aware year analysis: faturas (Bills) count once, same rule as
    // /summary; internal transfers are excluded from the aggregates.
    const [transactions, bills] = await Promise.all([
      prisma.transaction.findMany({
        where: { userId: user.id, type: "EXPENSE", date: { gte: start, lt: end }, billId: null },
        include: { category: true },
      }),
      prisma.bill.findMany({
        where: { userId: user.id, dueDate: { gte: start, lt: end } },
        include: { category: true },
      }),
    ]);

    const byMonth: Record<string, number> = {};
    const byCategory: Record<string, number> = {};

    for (const tx of filterInternalTransfers(transactions)) {
      const m = `${tx.date.getFullYear()}-${String(tx.date.getMonth() + 1).padStart(2, "0")}`;
      byMonth[m] = (byMonth[m] || 0) + tx.amount;
      const cat = tx.category?.name || "Outros";
      byCategory[cat] = (byCategory[cat] || 0) + tx.amount;
    }
    for (const bill of bills) {
      const m = `${bill.dueDate.getFullYear()}-${String(bill.dueDate.getMonth() + 1).padStart(2, "0")}`;
      byMonth[m] = (byMonth[m] || 0) + bill.amount;
      const cat = bill.category?.name || "Contas Fixas";
      byCategory[cat] = (byCategory[cat] || 0) + bill.amount;
    }

    const months = Object.entries(byMonth).sort((a, b) => b[1] - a[1]);
    const categories = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);

    const totalExpense = Object.values(byMonth).reduce((s, v) => s + v, 0);
    const avgPerMonth = months.length > 0 ? totalExpense / months.length : 0;

    res.json({
      worstMonth: months[0] || ["N/A", 0],
      bestMonth: months[months.length - 1] || ["N/A", 0],
      topCategory: categories[0] || ["N/A", 0],
      avgPerMonth,
      totalExpense,
      allMonths: months,
    });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/tip", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { start, end } = getMonthRange(req.query.month as string);

    // Bill-aware tip: same aggregation rule as /summary (faturas contam 1x).
    const [transactions, bills] = await Promise.all([
      prisma.transaction.findMany({
        where: { userId: user.id, type: "EXPENSE", date: { gte: start, lt: end }, billId: null },
        include: { category: true },
      }),
      prisma.bill.findMany({
        where: { userId: user.id, dueDate: { gte: start, lt: end } },
        include: { category: true },
      }),
    ]);

    const byCategory = new Map<string, number>();
    for (const tx of filterInternalTransfers(transactions)) {
      const cat = tx.category?.name || "Outros";
      byCategory.set(cat, (byCategory.get(cat) || 0) + tx.amount);
    }
    for (const bill of bills) {
      const cat = bill.category?.name || "Contas Fixas";
      byCategory.set(cat, (byCategory.get(cat) || 0) + bill.amount);
    }

    const topCategories = [...byCategory.entries()]
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 3);

    const groqKey = process.env.GROQ_API_KEY || "";
    if (groqKey) {
      try {
        const ctx = topCategories.map((c) => `${c.name}: R$${c.total.toFixed(2)}`).join(", ");
        const prompt = `Analise estes gastos do mes e de UMA dica simples e direta para economizar (max 100 caracteres): ${ctx}`;

        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 100,
            temperature: 0.5,
          }),
        });
        const json = await groqRes.json();
        const tip = json.choices?.[0]?.message?.content?.trim();
        if (tip) {
          res.json({ tip, topCategories });
          return;
        }
      } catch {}
    }

    const fallback =
      topCategories.length > 0
        ? `Sua maior despesa e ${topCategories[0].name} (R$${topCategories[0].total.toFixed(2)}). Tente definir um limite mensal!`
        : "Registre seus gastos para receber dicas personalizadas.";
    res.json({ tip: fallback, topCategories });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/credit-card-detail", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { start, end } = getMonthRange(req.query.month as string);

    const transactions = await prisma.transaction.findMany({
      where: await cardTransactionWhere(user.id, start, end),
      include: { category: true },
      orderBy: { date: "desc" },
    });

    const result = transactions.map((t) => ({
      id: t.id,
      description: t.description,
      // amount = total da compra (parcela × nº de parcelas, ou totalAmount
      // para transações Pluggy); à vista = valor.
      amount: t.totalAmount ?? t.amount,
      // installmentAmount = parcela do mês (o que é cobrado na fatura).
      installmentAmount: monthlyInstallmentAmount(t),
      date: t.date,
      categoryName: t.category?.name || null,
      paymentMethod: t.paymentMethod || "Cartao",
      totalInstallments: t.totalInstallments,
      currentInstallment: t.currentInstallment,
    }));

    res.json(result);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/income-detail", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { start, end } = getMonthRange(req.query.month as string);

    const transactions = await prisma.transaction.findMany({
      where: {
        userId: user.id,
        type: "INCOME",
        date: { gte: start, lt: end },
      },
      orderBy: { date: "desc" },
    });

    res.json(transactions);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

export default router;
