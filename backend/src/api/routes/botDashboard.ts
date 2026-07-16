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
  const BOT_DEFAULT_EMAIL = process.env.BOT_DEFAULT_EMAIL || "";
  if (BOT_DEFAULT_EMAIL) {
    const user = await prisma.user.findUnique({ where: { email: BOT_DEFAULT_EMAIL } });
    if (user) return user;
  }
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

export default router;
