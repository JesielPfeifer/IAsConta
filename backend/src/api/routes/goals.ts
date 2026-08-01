import { Router, Request, Response } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();
const prisma = new PrismaClient();

const createGoalSchema = z.object({
  name: z.string().min(1),
  totalAmount: z.number().positive(),
  targetDate: z.string().datetime().nullable().optional(),
});

const updateGoalSchema = z.object({
  name: z.string().min(1).optional(),
  totalAmount: z.number().positive().optional(),
  targetDate: z.string().datetime().nullable().optional(),
});

const upsertGoalMonthSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "Formato: YYYY-MM"),
  amount: z.number().min(0),
});

router.use(authMiddleware);

// GET / — list goals with sum of months
router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const goals = await prisma.goal.findMany({
      where: { userId },
      include: { months: true },
      orderBy: { createdAt: "desc" },
    });

    const enriched = goals.map((goal) => ({
      ...goal,
      savedAmount: goal.months.reduce((sum: number, m) => sum + m.amount, 0),
    }));

    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// GET /:id — single goal with months
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const id = req.params.id as string;

    const goal = await prisma.goal.findFirst({
      where: { id, userId },
      include: { months: true },
    });

    if (!goal) {
      res.status(404).json({ error: "Meta não encontrada" });
      return;
    }

    const savedAmount = goal.months.reduce((sum: number, m) => sum + m.amount, 0);

    res.json({ ...goal, savedAmount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// POST / — create goal
router.post("/", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const data = createGoalSchema.parse(req.body);

    const goal = await prisma.goal.create({
      data: {
        name: data.name,
        totalAmount: data.totalAmount,
        targetDate: data.targetDate ? new Date(data.targetDate) : null,
        userId,
      },
      include: { months: true },
    });

    res.status(201).json({ ...goal, savedAmount: 0 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Dados inválidos", details: err.errors });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// PUT /:id — update goal
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const id = req.params.id as string;
    const data = updateGoalSchema.parse(req.body);

    const existing = await prisma.goal.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      res.status(404).json({ error: "Meta não encontrada" });
      return;
    }

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.totalAmount !== undefined) updateData.totalAmount = data.totalAmount;
    if (data.targetDate !== undefined) updateData.targetDate = data.targetDate ? new Date(data.targetDate) : null;

    const goal = await prisma.goal.update({
      where: { id },
      data: updateData,
      include: { months: true },
    });

    const savedAmount = goal.months.reduce((sum: number, m) => sum + m.amount, 0);

    res.json({ ...goal, savedAmount });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Dados inválidos", details: err.errors });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// DELETE /:id — remove goal (cascades months)
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const id = req.params.id as string;

    const existing = await prisma.goal.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      res.status(404).json({ error: "Meta não encontrada" });
      return;
    }

    await prisma.goal.delete({ where: { id } });

    res.json({ message: "Meta removida" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// POST /:id/months — upsert monthly amount
router.post("/:id/months", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const id = req.params.id as string;
    const data = upsertGoalMonthSchema.parse(req.body);

    const goal = await prisma.goal.findFirst({
      where: { id, userId },
    });

    if (!goal) {
      res.status(404).json({ error: "Meta não encontrada" });
      return;
    }

    const existing = await prisma.goalMonth.findFirst({
      where: { goalId: id, month: data.month },
    });

    let month;
    if (existing) {
      month = await prisma.goalMonth.update({
        where: { id: existing.id },
        data: { amount: data.amount },
      });
    } else {
      month = await prisma.goalMonth.create({
        data: {
          goalId: id,
          month: data.month,
          amount: data.amount,
        },
      });
    }

    res.json(month);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Dados inválidos", details: err.errors });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

export default router;
