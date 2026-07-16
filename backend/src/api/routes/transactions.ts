import { Router, Request, Response } from "express";
import { z } from "zod";
import { PrismaClient, Prisma } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";
import { botAuthMiddleware } from "../middleware/botAuth.js";
import multer from "multer";

const router = Router();
const prisma = new PrismaClient();
const upload = multer({ storage: multer.memoryStorage() });

const createTransactionSchema = z.object({
  amount: z.number(),
  type: z.enum(["EXPENSE", "INCOME"]),
  description: z.string().min(1),
  categoryId: z.string().uuid().optional().nullable(),
  date: z.string().datetime(),
  person: z.enum(["HUSBAND", "WIFE", "COUPLE"]).optional().nullable(),
  isShared: z.boolean().optional(),
  source: z.enum(["MANUAL", "BOT", "NUBANK_CSV", "CAIXA_PDF"]).optional(),
  paymentMethod: z.string().optional().nullable(),
  totalInstallments: z.number().int().optional(),
  currentInstallment: z.number().int().optional(),
  isFixed: z.boolean().optional(),
});

const updateTransactionSchema = z.object({
  amount: z.number().optional(),
  type: z.enum(["EXPENSE", "INCOME"]).optional(),
  description: z.string().min(1).optional(),
  categoryId: z.string().uuid().optional().nullable(),
  date: z.string().datetime().optional(),
  person: z.enum(["HUSBAND", "WIFE", "COUPLE"]).optional().nullable(),
  isShared: z.boolean().optional(),
  source: z.enum(["MANUAL", "BOT", "NUBANK_CSV", "CAIXA_PDF"]).optional(),
  paymentMethod: z.string().optional().nullable(),
  totalInstallments: z.number().int().optional(),
  currentInstallment: z.number().int().optional(),
  isFixed: z.boolean().optional(),
});

const botTransactionSchema = z.object({
  type: z.enum(["expense", "income", "EXPENSE", "INCOME"]),
  amount: z.number(),
  description: z.string().min(1).optional(),
  category: z.string().optional().nullable(),
  person: z.enum(["husband", "wife", "couple", "HUSBAND", "WIFE", "COUPLE"]).optional().nullable(),
  isShared: z.boolean().optional(),
  dueDate: z.string().optional().nullable(),
  platform: z.string().optional(),
  rawMessage: z.string().optional(),
  senderInfo: z.any().optional(),
});

router.use(authMiddleware);

router.get("/", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { month, categoryId, person, type, source, isShared, paymentMethod } = req.query;

    const where: Record<string, unknown> = { userId: user.id };

    if (month) {
      const startOfMonth = new Date(`${month}-01T00:00:00.000Z`);
      const endOfMonth = new Date(startOfMonth);
      endOfMonth.setMonth(endOfMonth.getMonth() + 1);
      where.date = { gte: startOfMonth, lt: endOfMonth };
    }

    if (categoryId) where.categoryId = categoryId as string;
    if (person) where.person = person as string;
    if (type) where.type = type as string;
    if (source) where.source = source as string;
    if (paymentMethod) where.paymentMethod = paymentMethod as string;
    if (isShared !== undefined) where.isShared = isShared === "true";

    const transactions = await prisma.transaction.findMany({
      where: where as any,
      include: { category: true },
      orderBy: { date: "desc" },
    });

    res.json(transactions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const data = createTransactionSchema.parse(req.body);

    const transaction = await prisma.transaction.create({
      data: {
        ...data,
        date: new Date(data.date),
        userId: user.id,
      },
      include: { category: true },
    });

    res.status(201).json(transaction);
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
    const data = updateTransactionSchema.parse(req.body);

    const existing = await prisma.transaction.findFirst({
      where: { id: id as string, userId: user.id },
    });

    if (!existing) {
      res.status(404).json({ error: "Transação não encontrada" });
      return;
    }

    const updateData: Record<string, unknown> = { ...data };
    if (data.date) {
      updateData.date = new Date(data.date);
    }

    const transaction = await prisma.transaction.update({
      where: { id: id as string },
      data: updateData as any,
      include: { category: true },
    });

    res.json(transaction);
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

    const existing = await prisma.transaction.findFirst({
      where: { id: id as string, userId: user.id },
    });

    if (!existing) {
      res.status(404).json({ error: "Transação não encontrada" });
      return;
    }

    await prisma.transaction.delete({ where: { id: id as string } });

    res.json({ message: "Transação removida" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/import", upload.single("file"), async (req: Request, res: Response) => {
  try {
    const _user = req.user!;
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: "Arquivo não enviado" });
      return;
    }

    res.json({ message: "Arquivo recebido, processamento pendente", received: true, filename: file.originalname });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

function normalizeString(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

async function findOrCreateCategory(
  name: string,
  userId: string
): Promise<string> {
  const original = name.trim();
  const normalized = normalizeString(name);

  const allCategories = await prisma.category.findMany({
    where: { userId },
  });

  const existing = allCategories.find(
    (c) => normalizeString(c.name) === normalized
  );
  if (existing) return existing.id;

  const created = await prisma.category.create({
    data: {
      name: original.charAt(0).toUpperCase() + original.slice(1).toLowerCase(),
      userId,
    },
  });
  return created.id;
}

const BOT_DEFAULT_EMAIL = process.env.BOT_DEFAULT_EMAIL || "";

const botRouter = Router();
botRouter.use(botAuthMiddleware);

botRouter.post("/", async (req: Request, res: Response) => {
  try {
    const data = botTransactionSchema.parse(req.body);

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

    const type = data.type.toUpperCase() as "EXPENSE" | "INCOME";

    let categoryId: string | null = null;
    if (data.category && data.category !== "outros") {
      try {
        categoryId = await findOrCreateCategory(data.category, userId);
      } catch {
        categoryId = null;
      }
    }

    let person: Prisma.TransactionCreateInput["person"] = null;
    if (data.person) {
      const p = data.person.toUpperCase();
      if (p === "HUSBAND" || p === "WIFE" || p === "COUPLE") {
        person = p as "HUSBAND" | "WIFE" | "COUPLE";
      }
    }
    if (data.isShared && !person) {
      person = "COUPLE";
    }

    const date = data.dueDate
      ? new Date(data.dueDate)
      : new Date();

    const transaction = await prisma.transaction.create({
      data: {
        amount: data.amount,
        type: type === "EXPENSE" ? "EXPENSE" : "INCOME",
        description: data.description || data.rawMessage || "Sem descrição",
        categoryId,
        date,
        person,
        isShared: data.isShared ?? false,
        userId,
        source: "BOT",
      },
      include: { category: true },
    });

    res.status(201).json(transaction);
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
