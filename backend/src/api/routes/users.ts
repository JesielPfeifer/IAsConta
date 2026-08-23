import { Router, Request, Response } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();
const prisma = new PrismaClient();

const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  salary: z.number().positive().optional().nullable(),
});

router.use(authMiddleware);

router.get("/me", async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    const fullUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        name: true,
        salary: true,
        partnerId: true,
        createdAt: true,
      },
    });

    if (!fullUser) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }

    let partner: {
      id: string;
      name: string;
      email: string;
    } | null = null;

    if (fullUser.partnerId) {
      const partnerData = await prisma.user.findUnique({
        where: { id: fullUser.partnerId },
        select: { id: true, name: true, email: true },
      });
      partner = partnerData ?? null;
    }

    res.json({ ...fullUser, partner });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.put("/me", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const data = updateUserSchema.parse(req.body);

    const updated = await prisma.user.update({
      where: { id: user.id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        salary: true,
        partnerId: true,
        createdAt: true,
      },
    });

    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Dados inválidos", details: err.errors });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/couple", async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    if (!user.partnerId) {
      res.status(400).json({ error: "Usuário não possui parceiro vinculado" });
      return;
    }

    const partner = await prisma.user.findUnique({
      where: { id: user.partnerId },
      select: {
        id: true,
        email: true,
        name: true,
        salary: true,
        partnerId: true,
      },
    });

    if (!partner) {
      res.status(404).json({ error: "Parceiro não encontrado" });
      return;
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        name: true,
        salary: true,
        partnerId: true,
      },
    });

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const transactions = await prisma.transaction.findMany({
      where: {
        userId: user.id,
        date: { gte: start, lt: end },
      },
    });

    let totalIncome = 0;
    let totalExpense = 0;

    for (const tx of transactions) {
      if (tx.type === "INCOME") totalIncome += tx.amount;
      else totalExpense += tx.amount;
    }

    res.json({
      currentUser,
      partner,
      combined: {
        salary: (currentUser?.salary ?? 0) + (partner.salary ?? 0),
        monthIncome: totalIncome,
        monthExpense: totalExpense,
        balance: totalIncome - totalExpense,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

export default router;
