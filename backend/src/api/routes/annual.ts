import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();
const prisma = new PrismaClient();

router.use(authMiddleware);

router.get("/", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const yearParam = req.query.year as string;
    const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();

    const start = new Date(year, 0, 1);
    const end = new Date(year + 1, 0, 1);

    const transactions = await prisma.transaction.findMany({
      where: {
        userId: user.id,
        date: { gte: start, lt: end },
      },
    });

    const bills = await prisma.bill.findMany({
      where: {
        userId: user.id,
        dueDate: { gte: start, lt: end },
      },
    });

    const monthsData: Record<string, { income: number; expense: number }> = {};

    for (let m = 0; m < 12; m++) {
      const key = `${year}-${String(m + 1).padStart(2, "0")}`;
      monthsData[key] = { income: 0, expense: 0 };
    }

    for (const tx of transactions) {
      const m = `${tx.date.getFullYear()}-${String(tx.date.getMonth() + 1).padStart(2, "0")}`;
      if (!monthsData[m]) continue;
      if (tx.type === "INCOME") {
        monthsData[m].income += tx.amount;
      } else {
        monthsData[m].expense += tx.amount;
      }
    }

    for (const bill of bills) {
      const m = `${bill.dueDate.getFullYear()}-${String(bill.dueDate.getMonth() + 1).padStart(2, "0")}`;
      if (!monthsData[m]) continue;
      monthsData[m].expense += bill.amount;
    }

    const months = Object.entries(monthsData)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, { income, expense }]) => ({
        month,
        income: Math.round(income * 100) / 100,
        expense: Math.round(expense * 100) / 100,
        balance: Math.round((income - expense) * 100) / 100,
      }));

    const totalIncome = Math.round(months.reduce((s, m) => s + m.income, 0) * 100) / 100;
    const totalExpense = Math.round(months.reduce((s, m) => s + m.expense, 0) * 100) / 100;
    const totalBalance = Math.round((totalIncome - totalExpense) * 100) / 100;

    const monthsWithData = months.filter((m) => m.income > 0 || m.expense > 0);
    const avgIncome = monthsWithData.length > 0
      ? Math.round((totalIncome / monthsWithData.length) * 100) / 100
      : 0;
    const avgExpense = monthsWithData.length > 0
      ? Math.round((totalExpense / monthsWithData.length) * 100) / 100
      : 0;

    res.json({
      months,
      totals: {
        income: totalIncome,
        expense: totalExpense,
        balance: totalBalance,
      },
      avgPerMonth: {
        income: avgIncome,
        expense: avgExpense,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

export default router;
