import { Router, Request, Response } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();
const prisma = new PrismaClient();

const createBudgetSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "Formato: YYYY-MM"),
  amount: z.number().positive(),
  categoryId: z.string().uuid(),
});

const updateBudgetSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  amount: z.number().positive().optional(),
  categoryId: z.string().uuid().optional(),
});

router.use(authMiddleware);

router.get("/", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { month } = req.query;

    const where: Record<string, unknown> = { userId: user.id };
    if (month) where.month = month as string;

    const budgets = await prisma.budget.findMany({
      where: where as any,
      include: { category: true },
      orderBy: { month: "desc" },
    });

    res.json(budgets);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const data = createBudgetSchema.parse(req.body);

    const budget = await prisma.budget.create({
      data: {
        month: data.month,
        amount: data.amount,
        categoryId: data.categoryId,
        userId: user.id,
      },
      include: { category: true },
    });

    res.status(201).json(budget);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Dados inválidos", details: err.errors });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.put("/:id", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const data = updateBudgetSchema.parse(req.body);

    const existing = await prisma.budget.findFirst({
      where: { id: id as string, userId: user.id },
    });

    if (!existing) {
      res.status(404).json({ error: "Orçamento não encontrado" });
      return;
    }

    const budget = await prisma.budget.update({
      where: { id: id as string },
      data: data as any,
      include: { category: true },
    });

    res.json(budget);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Dados inválidos", details: err.errors });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;

    const existing = await prisma.budget.findFirst({
      where: { id: id as string, userId: user.id },
    });

    if (!existing) {
      res.status(404).json({ error: "Orçamento não encontrado" });
      return;
    }

    await prisma.budget.delete({ where: { id: id as string } });

    res.json({ message: "Orçamento removido" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

export default router;
