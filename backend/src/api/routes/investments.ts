import { Router, Request, Response } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();
const prisma = new PrismaClient();

const createInvestmentSchema = z.object({
  type: z.enum(["RESERVA", "RENDA_FIXA", "RENDA_VARIAVEL"]),
  amount: z.number().positive(),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Formato: YYYY-MM"),
  date: z.string().optional(),
});

const updateInvestmentSchema = z.object({
  type: z.enum(["RESERVA", "RENDA_FIXA", "RENDA_VARIAVEL"]).optional(),
  amount: z.number().positive().optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  date: z.string().nullable().optional(),
});

router.use(authMiddleware);

// GET / — list investments, optional month filter + aggregation by type
router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { month } = req.query;

    const where: any = { userId };
    if (month && typeof month === "string") where.month = month;

    const investments = await prisma.investment.findMany({
      where,
      orderBy: [{ month: "desc" }, { createdAt: "desc" }],
    });

    // Aggregate by type
    const byType = {
      RESERVA: 0,
      RENDA_FIXA: 0,
      RENDA_VARIAVEL: 0,
      total: 0,
    };

    for (const inv of investments) {
      if (inv.type === "RESERVA") byType.RESERVA += inv.amount;
      else if (inv.type === "RENDA_FIXA") byType.RENDA_FIXA += inv.amount;
      else if (inv.type === "RENDA_VARIAVEL") byType.RENDA_VARIAVEL += inv.amount;
      byType.total += inv.amount;
    }

    // Aggregate by month
    const byMonthMap = new Map<string, { RESERVA: number; RENDA_FIXA: number; RENDA_VARIAVEL: number; total: number }>();
    for (const inv of investments) {
      if (!byMonthMap.has(inv.month)) {
        byMonthMap.set(inv.month, { RESERVA: 0, RENDA_FIXA: 0, RENDA_VARIAVEL: 0, total: 0 });
      }
      const m = byMonthMap.get(inv.month)!;
      if (inv.type === "RESERVA") m.RESERVA += inv.amount;
      else if (inv.type === "RENDA_FIXA") m.RENDA_FIXA += inv.amount;
      else if (inv.type === "RENDA_VARIAVEL") m.RENDA_VARIAVEL += inv.amount;
      m.total += inv.amount;
    }

    const byMonth = Array.from(byMonthMap.entries())
      .map(([monthKey, data]) => ({ month: monthKey, ...data }))
      .sort((a, b) => b.month.localeCompare(a.month));

    res.json({ investments, byType, byMonth });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// POST / — create investment
router.post("/", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const data = createInvestmentSchema.parse(req.body);

    const investment = await prisma.investment.create({
      data: {
        type: data.type,
        amount: data.amount,
        month: data.month,
        date: data.date ? new Date(data.date) : null,
        userId,
      },
    });

    res.status(201).json(investment);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Dados inválidos", details: err.errors });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// PUT /:id — update investment
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const id = req.params.id as string;
    const data = updateInvestmentSchema.parse(req.body);

    const existing = await prisma.investment.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      res.status(404).json({ error: "Investimento não encontrado" });
      return;
    }

    const updateData: any = {};
    if (data.type !== undefined) updateData.type = data.type;
    if (data.amount !== undefined) updateData.amount = data.amount;
    if (data.month !== undefined) updateData.month = data.month;
    if (data.date !== undefined) updateData.date = data.date ? new Date(data.date) : null;

    const investment = await prisma.investment.update({
      where: { id },
      data: updateData,
    });

    res.json(investment);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Dados inválidos", details: err.errors });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// DELETE /:id — remove investment
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const id = req.params.id as string;

    const existing = await prisma.investment.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      res.status(404).json({ error: "Investimento não encontrado" });
      return;
    }

    await prisma.investment.delete({ where: { id } });

    res.json({ message: "Investimento removido" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

export default router;
