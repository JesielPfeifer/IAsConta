import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();
const prisma = new PrismaClient();

router.use(authMiddleware);

/**
 * Internal transfers between the user's own accounts (e.g. Caixa ↔ Nubank)
 * are NOT income nor expense — they just move money between the couple's own
 * accounts. No bank/name is hardcoded: a transfer pair is detected purely
 * from Open Finance data — one leg out (EXPENSE) and one leg in (INCOME) on
 * DIFFERENT accounts of the same user, same amount, dates within 3 days,
 * both descriptions indicating a transfer (PIX/transfer).
 */
const TRANSFER_RE = /(?:pix|transfer|ted|doc|envio|recebimento)/i;

export function filterInternalTransfers<T extends { id: string; type: string; amount: number; date: Date; description: string; pluggyAccountId?: string | null }>(
  transactions: T[]
): T[] {
  const transferCandidates = transactions.filter(
    (tx) => TRANSFER_RE.test(tx.description) && tx.pluggyAccountId
  );
  const isInternalTransfer = (tx: T): boolean => {
    if (!TRANSFER_RE.test(tx.description) || !tx.pluggyAccountId) return false;
    const wantedType = tx.type === "EXPENSE" ? "INCOME" : "EXPENSE";
    return transferCandidates.some((other) => {
      if (other.id === tx.id) return false;
      if (other.type !== wantedType) return false;
      if (other.pluggyAccountId === tx.pluggyAccountId) return false; // same account
      if (Math.abs(Math.abs(other.amount) - Math.abs(tx.amount)) >= 0.01) return false;
      const days = Math.abs(other.date.getTime() - tx.date.getTime()) / 86400000;
      if (days > 3) return false;
      return true;
    });
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
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/by-category", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { start, end } = getMonthRange(req.query.month as string);

    const [transactions, bills] = await Promise.all([
      prisma.transaction.findMany({
        where: {
          userId: user.id,
          type: "EXPENSE",
          date: { gte: start, lt: end },
          billId: null,
        },
        include: { category: true },
      }),
      prisma.bill.findMany({
        where: {
          userId: user.id,
          dueDate: { gte: start, lt: end },
        },
        include: { category: true },
      }),
    ]);

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
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/percentage", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { start, end } = getMonthRange(req.query.month as string);

    const [transactions, bills] = await Promise.all([
      prisma.transaction.findMany({
        where: {
          userId: user.id,
          type: "EXPENSE",
          date: { gte: start, lt: end },
          billId: null,
        },
      }),
      prisma.bill.findMany({
        where: {
          userId: user.id,
          dueDate: { gte: start, lt: end },
        },
      }),
    ]);

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
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/by-payment", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { start, end } = getMonthRange(req.query.month as string);

    const transactions = await prisma.transaction.findMany({
      where: { userId: user.id, type: "EXPENSE", date: { gte: start, lt: end }, billId: null },
    });

    const byPayment: Record<string, number> = {};
    for (const tx of transactions) {
      const method = tx.paymentMethod || "Outros";
      byPayment[method] = (byPayment[method] || 0) + tx.amount;
    }

    const result = Object.entries(byPayment).map(([method, total]) => ({ method, total }));
    result.sort((a, b) => b.total - a.total);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/credit-card-total", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { start, end } = getMonthRange(req.query.month as string);

    // Payment methods configured as CARD by the user (Nubank, Caixa, ...)
    const cardMethods = await prisma.paymentMethod.findMany({
      where: { userId: user.id, type: "CARD" },
      select: { name: true },
    });
    const cardNames = cardMethods.map((m) => m.name);

    const transactions = await prisma.transaction.findMany({
      where: {
        userId: user.id,
        type: "EXPENSE",
        date: { gte: start, lt: end },
        OR: [
          { paymentMethod: { in: cardNames } },
          { isCreditCard: true },
        ],
      },
    });

    let total = 0;
    for (const tx of transactions) {
      // Parcelado: a parcela do mês (amount/totalInstallments); à vista: amount.
      total += tx.totalInstallments > 1 ? tx.amount / tx.totalInstallments : tx.amount;
    }

    res.json({ total, count: transactions.length });
  } catch (err) {
    console.error(err);
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

    const [currTx, prevTx] = await Promise.all([
      prisma.transaction.findMany({ where: { userId: user.id, date: { gte: start, lt: end }, billId: null } }),
      prisma.transaction.findMany({ where: { userId: user.id, date: { gte: prevStart, lt: prevEnd }, billId: null } }),
    ]);

    const currIncome = currTx.filter((t) => t.type === "INCOME").reduce((s, t) => s + t.amount, 0);
    const currExpense = currTx.filter((t) => t.type === "EXPENSE").reduce((s, t) => s + t.amount, 0);
    const prevIncome = prevTx.filter((t) => t.type === "INCOME").reduce((s, t) => s + t.amount, 0);
    const prevExpense = prevTx.filter((t) => t.type === "EXPENSE").reduce((s, t) => s + t.amount, 0);

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
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/year-analysis", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const year = new Date().getFullYear();
    const start = new Date(year, 0, 1);
    const end = new Date(year + 1, 0, 1);

    const transactions = await prisma.transaction.findMany({
      where: { userId: user.id, type: "EXPENSE", date: { gte: start, lt: end }, billId: null },
      include: { category: true },
    });

    const byMonth: Record<string, number> = {};
    const byCategory: Record<string, number> = {};

    for (const tx of transactions) {
      const m = `${tx.date.getFullYear()}-${String(tx.date.getMonth() + 1).padStart(2, "0")}`;
      byMonth[m] = (byMonth[m] || 0) + tx.amount;
      const cat = tx.category?.name || "Outros";
      byCategory[cat] = (byCategory[cat] || 0) + tx.amount;
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
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/tip", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { start, end } = getMonthRange(req.query.month as string);

    const [transactions, categories] = await Promise.all([
      prisma.transaction.findMany({
        where: { userId: user.id, type: "EXPENSE", date: { gte: start, lt: end } },
        include: { category: true },
      }),
      prisma.transaction.groupBy({
        by: ["categoryId"],
        where: {
          userId: user.id,
          type: "EXPENSE",
          date: { gte: start, lt: end },
          billId: null,
          categoryId: { not: null },
        },
        _sum: { amount: true },
        orderBy: { _sum: { amount: "desc" } },
      }),
    ]);

    const topCategories = await Promise.all(
      categories.slice(0, 3).map(async (c) => {
        const cat = await prisma.category.findUnique({ where: { id: c.categoryId! } });
        return { name: cat?.name || "Outros", total: c._sum.amount || 0 };
      })
    );

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
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/credit-card-detail", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { start, end } = getMonthRange(req.query.month as string);

    // Payment methods configured as CARD by the user
    const cardMethods = await prisma.paymentMethod.findMany({
      where: { userId: user.id, type: "CARD" },
      select: { name: true },
    });
    const cardNames = cardMethods.map((m) => m.name);

    const transactions = await prisma.transaction.findMany({
      where: {
        userId: user.id,
        type: "EXPENSE",
        date: { gte: start, lt: end },
        OR: [
          { paymentMethod: { in: cardNames } },
          { isCreditCard: true },
        ],
      },
      include: { category: true },
      orderBy: { date: "desc" },
    });

    const result = transactions.map((t) => ({
      id: t.id,
      description: t.description,
      amount: t.amount,
      installmentAmount: t.totalInstallments > 0 ? t.amount / t.totalInstallments : t.amount,
      date: t.date,
      categoryName: t.category?.name || null,
      paymentMethod: t.paymentMethod || "Cartao",
      totalInstallments: t.totalInstallments,
      currentInstallment: t.currentInstallment,
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
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
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

export default router;
