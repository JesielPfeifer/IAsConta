import { Router, Request, Response } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";
import { botAuthMiddleware } from "../middleware/botAuth.js";

const router = Router();
const prisma = new PrismaClient();

const createBillSchema = z.object({
  name: z.string().min(1),
  amount: z.number(),
  dueDate: z.string().datetime(),
  isRecurring: z.boolean().optional(),
  isShared: z.boolean().optional(),
  isPaid: z.boolean().optional(),
  person: z.enum(["HUSBAND", "WIFE", "COUPLE"]).optional().nullable(),
  categoryId: z.string().uuid().optional().nullable(),
  totalInstallments: z.number().int().min(1).optional(),
  currentInstallment: z.number().int().min(1).optional(),
});

const updateBillSchema = z.object({
  name: z.string().min(1).optional(),
  amount: z.number().optional(),
  dueDate: z.string().datetime().optional(),
  isRecurring: z.boolean().optional(),
  isShared: z.boolean().optional(),
  isPaid: z.boolean().optional(),
  person: z.enum(["HUSBAND", "WIFE", "COUPLE"]).optional().nullable(),
  categoryId: z.string().uuid().optional().nullable(),
  totalInstallments: z.number().int().min(1).optional(),
  currentInstallment: z.number().int().min(1).optional(),
});

router.use(authMiddleware);

router.get("/", async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    const bills = await prisma.bill.findMany({
      where: { userId: user.id },
      include: { category: true },
      orderBy: { dueDate: "asc" },
    });

    res.json(bills);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const data = createBillSchema.parse(req.body);

    const bill = await prisma.bill.create({
      data: {
        name: data.name,
        amount: data.amount,
        dueDate: new Date(data.dueDate),
        isRecurring: data.isRecurring ?? false,
        isShared: data.isShared ?? false,
        isPaid: data.isPaid ?? false,
        userId: user.id,
      },
    });

    res.status(201).json(bill);
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
    const data = updateBillSchema.parse(req.body);

    const existing = await prisma.bill.findFirst({
      where: { id: id as string, userId: user.id },
    });

    if (!existing) {
      res.status(404).json({ error: "Conta não encontrada" });
      return;
    }

    const updateData: Record<string, unknown> = { ...data };
    if (data.dueDate) {
      updateData.dueDate = new Date(data.dueDate);
    }

    const bill = await prisma.bill.update({
      where: { id: id as string },
      data: updateData as any,
    });

    res.json(bill);
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

    const existing = await prisma.bill.findFirst({
      where: { id: id as string, userId: user.id },
    });

    if (!existing) {
      res.status(404).json({ error: "Conta não encontrada" });
      return;
    }

    await prisma.bill.delete({ where: { id: id as string } });

    res.json({ message: "Conta removida" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

const BOT_DEFAULT_EMAIL = process.env.BOT_DEFAULT_EMAIL || "";

const botBillSchema = z.object({
  description: z.string().min(1),
  amount: z.number().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  isShared: z.boolean().optional(),
  person: z.string().optional().nullable(),
  platform: z.string().optional(),
  rawMessage: z.string().optional(),
  senderInfo: z.any().optional(),
  totalInstallments: z.number().int().min(1).optional(),
  currentInstallment: z.number().int().min(1).optional(),
});

const botRouter = Router();
botRouter.use(botAuthMiddleware);

botRouter.post("/", async (req: Request, res: Response) => {
  try {
    const data = botBillSchema.parse(req.body);

    if (!BOT_DEFAULT_EMAIL) {
      res.status(400).json({ error: "BOT_DEFAULT_EMAIL not configured" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email: BOT_DEFAULT_EMAIL } });
    if (!user) {
      res.status(404).json({ error: "Usuário padrão do bot não encontrado. Verifique BOT_DEFAULT_EMAIL no .env" });
      return;
    }

    const userId = user.id;

    const dueDate = data.dueDate
      ? new Date(data.dueDate)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    let person: any = null;
    if (data.person) {
      const p = data.person.toUpperCase();
      if (p === "HUSBAND" || p === "WIFE" || p === "COUPLE") {
        person = p;
      }
    }

    let categoryId: string | null = null;
    if (data.category && data.category !== "outros") {
      const existing = await prisma.category.findFirst({
        where: { userId, name: { equals: data.category, mode: "insensitive" } },
      });
      if (existing) {
        categoryId = existing.id;
      } else {
        const created = await prisma.category.create({
          data: { name: data.category.charAt(0).toUpperCase() + data.category.slice(1), userId },
        });
        categoryId = created.id;
      }
    }

    const bill = await prisma.bill.create({
      data: {
        name: data.description,
        amount: data.amount ?? 0,
        dueDate,
        isRecurring: false,
        isShared: data.isShared ?? false,
        isPaid: false,
        person,
        categoryId,
        totalInstallments: data.totalInstallments ?? 1,
        currentInstallment: data.currentInstallment ?? 1,
        userId,
      },
    });

    res.status(201).json(bill);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Dados inválidos", details: err.errors });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

export { botRouter };
export default router;
