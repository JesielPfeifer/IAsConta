import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { botAuthMiddleware } from "../middleware/botAuth.js";

const router = Router();
const prisma = new PrismaClient();

router.use(botAuthMiddleware);

function getCurrentMonthRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end };
}

async function getBotUser() {
  // Find first user with a linked WhatsApp phone
  const wa = await prisma.whatsAppUser.findFirst({
    where: { isActive: true },
  });
  if (wa) {
    const user = await prisma.user.findUnique({ where: { id: wa.userId } });
    if (user) return user;
  }
  
  // Fallback: first user
  const first = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!first) throw new Error("No users found");
  return first;
}

router.get("/summary", async (req: Request, res: Response) => {
  try {
    const user = await getBotUser();
    const { start, end } = getCurrentMonthRange();

    const [transactions, bills] = await Promise.all([
      prisma.transaction.findMany({
        where: {
          userId: user.id,
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
      }),
    ]);

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

    const balance = totalIncome - totalExpense;

    res.json({
      totalIncome,
      totalExpense,
      balance,
      byPerson: {
        husband: { income: husbandIncome, expense: husbandExpense },
        wife: { income: wifeIncome, expense: wifeExpense },
      },
    });
  } catch (err: any) {
    if (err.message) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal error" });
  }
});

router.get("/by-category", async (req: Request, res: Response) => {
  try {
    const user = await getBotUser();
    const { start, end } = getCurrentMonthRange();

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
  } catch (err: any) {
    if (err.message) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal error" });
  }
});

router.get("/percentage", async (req: Request, res: Response) => {
  try {
    const user = await getBotUser();
    const { start, end } = getCurrentMonthRange();

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
  } catch (err: any) {
    if (err.message) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal error" });
  }
});

router.get("/last-7-days", async (req: Request, res: Response) => {
  try {
    const user = await getBotUser();
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);

    const transactions = await prisma.transaction.findMany({
      where: {
        userId: user.id,
        date: { gte: start, lte: end },
        billId: null,
      },
      include: { category: true },
      orderBy: { date: 'desc' },
    });

    res.json(transactions.map(tx => ({
      date: tx.date.toISOString().split('T')[0],
      description: tx.description,
      amount: tx.amount,
      type: tx.type,
      category: tx.category?.name || 'Sem categoria',
      person: tx.person,
      paymentMethod: tx.paymentMethod,
    })));
  } catch (err: any) {
    if (err.message) { res.status(400).json({ error: err.message }); return; }
    res.status(500).json({ error: "Internal error" });
  }
});

// GET /api/bot/dashboard/financial-health — couple's financial health:
// fixed monthly income, current commitments (faturas + open installments),
// leftover after commitments, and installments about to finish (which free
// up money in the coming months).
router.get("/financial-health", async (req: Request, res: Response) => {
  try {
    const user = await getBotUser();
    const { start, end } = getCurrentMonthRange();

    const [fixedIncomes, faturas, installments, cardMonthTx] = await Promise.all([
      prisma.fixedIncome.findMany({
        where: { userId: user.id },
        select: { name: true, amount: true, person: true },
      }),
      prisma.bill.findMany({
        where: {
          userId: user.id,
          dueDate: { gte: start, lt: end },
          isPaid: false,
        },
        select: { name: true, amount: true, dueDate: true },
      }),
      // Open installments (parcelas) — grouped by purchase. Amount stored is
      // the monthly parcel value; remaining = parcels yet to be paid.
      prisma.transaction.findMany({
        where: {
          userId: user.id,
          source: "PLUGGY",
          totalInstallments: { gt: 1 },
        },
        select: {
          description: true,
          amount: true,
          currentInstallment: true,
          totalInstallments: true,
          installmentGroupId: true,
          paymentMethod: true,
          isCreditCard: true,
          date: true,
        },
      }),
      // Card purchases of the current month not yet inside a fatura (open
      // billing cycle) — they become the next fatura, so they count as a
      // monthly commitment too.
      prisma.transaction.findMany({
        where: {
          userId: user.id,
          source: "PLUGGY",
          isCreditCard: true,
          billId: null,
          date: { gte: start, lt: end },
        },
        select: { amount: true },
      }),
    ]);

    // Keep only open installments (current < total)
    const open = installments.filter((tx) => tx.currentInstallment < tx.totalInstallments);

    // Group installments by purchase (installmentGroupId)
    const groups = new Map<string, (typeof open)[number][]>();
    for (const tx of open) {
      const key = tx.installmentGroupId || `${tx.description}|${tx.paymentMethod}`;
      const g = groups.get(key);
      if (g) g.push(tx);
      else groups.set(key, [tx]);
    }

    const openPurchases = Array.from(groups.values())
      .map((txs) => {
        // Latest installment row of the purchase
        const latest = txs.reduce((a, b) =>
          b.currentInstallment > a.currentInstallment ? b : a
        );
        const remaining = latest.totalInstallments - latest.currentInstallment;
        return {
          description: latest.description,
          paymentMethod: latest.paymentMethod,
          isCreditCard: latest.isCreditCard,
          currentInstallment: latest.currentInstallment,
          totalInstallments: latest.totalInstallments,
          monthlyAmount: latest.amount,
          remaining,
          remainingTotal: latest.amount * remaining,
        };
      })
      .sort((a, b) => a.remaining - b.remaining);

    // Installments finishing soon: 1-2 parcels left AND the purchase is well
    // underway (already paid >= 3 parcels) — a fresh 1/2 purchase is NOT
    // "ending", it just started.
    const endingSoon = openPurchases.filter(
      (p) => p.remaining <= 2 && p.currentInstallment >= 3
    );
    const endingSoonMonthly = endingSoon.reduce((s, p) => s + p.monthlyAmount, 0);

    const monthlyIncome = fixedIncomes.reduce((s, i) => s + i.amount, 0);
    const faturasTotal = faturas.reduce((s, b) => s + b.amount, 0);
    // Card purchases of the current month not yet in a fatura (open cycle)
    const cardMonthTotal = cardMonthTx.reduce((s, t) => s + t.amount, 0);
    // Monthly commitment: faturas of the month + open card cycle purchases +
    // monthly parcels of NON-card purchases (checking-account installments
    // like "Tio jairo" are paid directly each month).
    const nonCardMonthlyParcels = openPurchases
      .filter((p) => !p.isCreditCard)
      .reduce((s, p) => s + p.monthlyAmount, 0);
    const commitments = faturasTotal + cardMonthTotal + nonCardMonthlyParcels;
    const leftover = monthlyIncome - commitments;

    res.json({
      monthlyIncome,
      monthlyIncomeByPerson: fixedIncomes,
      faturas: faturas.map((f) => ({
        name: f.name,
        amount: f.amount,
        dueDate: f.dueDate,
      })),
      faturasTotal,
      commitments,
      leftover,
      leftoverPercent: monthlyIncome > 0 ? Math.round((leftover / monthlyIncome) * 100) : 0,
      openPurchases: openPurchases.slice(0, 15),
      openPurchasesCount: openPurchases.length,
      openPurchasesTotal: openPurchases.reduce((s, p) => s + p.remainingTotal, 0),
      endingSoon: endingSoon.slice(0, 10),
      endingSoonCount: endingSoon.length,
      endingSoonMonthly,
    });
  } catch (err) {
    console.error("[botDashboard] financial-health error:", err);
    res.status(500).json({ error: "Erro ao calcular saúde financeira" });
  }
});

router.get("/upcoming-bills", async (req: Request, res: Response) => {
  try {
    const user = await getBotUser();
    const now = new Date();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const bills = await prisma.bill.findMany({
      where: {
        userId: user.id,
        dueDate: { gte: now, lt: endOfMonth },
      },
      orderBy: { dueDate: "asc" },
    });

    res.json(bills);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

export default router;
