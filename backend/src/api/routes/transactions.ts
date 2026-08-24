import { logger } from '../../lib/logger.js';
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
  // NOTE: source is limited to manual/bot/import origins on purpose — PLUGGY
  // and the Pluggy-owned identity fields (externalId, billId, pluggyAccountId,
  // isCreditCard) are server-controlled: only the Pluggy sync service may set
  // them. A caller-controlled externalId would let a client hijack the
  // dedupe key and make sync skip the real imported transaction.
  source: z.enum(["MANUAL", "BOT", "NUBANK_CSV", "CAIXA_PDF"]).optional(),
  paymentMethod: z.string().optional().nullable(),
  totalInstallments: z.number().int().optional(),
  currentInstallment: z.number().int().optional(),
  installmentGroupId: z.string().optional(),
  isFixed: z.boolean().optional(),
});

const updateTransactionSchema = z.object({
  referenceMonth: z.string().regex(/^\d{4}-\d{2}$/).nullable().optional(),
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
  userId: z.string().optional(),
  paymentMethod: z.string().optional().nullable(),
  totalInstallments: z.number().int().optional(),
  currentInstallment: z.number().int().optional(),
  installmentGroupId: z.string().optional(),
});

router.use(authMiddleware);


// GET /api/transactions/card-cycle?month=YYYY-MM — compras por cartão na fatura
// do mês informado. O mês da fatura vem direto do Pluggy (billForecastMonth em
// cada transação); transações antigas sem esse campo caem no mês-civil.
router.get("/card-cycle", async (req: Request, res: Response) => {
  const user = req.user!;
  const month = String(req.query.month || "");
  if (!/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "month inválido" });
    return;
  }
  const [y, m] = month.split("-").map(Number);

  try {
    // Cartões de crédito: agrupa por paymentMethod (nome do cartão), unindo
    // contas sincronizadas (Pluggy) e lançamentos manuais. Assim cada cartão
    // aparece UMA vez na UI, independente de ter transações Pluggy, manuais ou
    // ambas.
    const pmRows = await prisma.transaction.findMany({
      where: { userId: user.id, isCreditCard: true },
      select: { pluggyAccountId: true, paymentMethod: true },
      distinct: ["paymentMethod"],
    });
    type Group = { paymentMethod: string };
    const groups: Group[] = pmRows
      .map((r) => ({ paymentMethod: r.paymentMethod || "Cartão" }))
      .filter((v, i, arr) => arr.findIndex((x) => x.paymentMethod === v.paymentMethod) === i);

    // Filtra pela FATURA informada pelo Pluggy (billForecastMonth = "YYYY-MM"),
    // igual ao card de cartão do Dashboard. Não há mais dia de fechamento
    // configurável pelo usuário: o Pluggy já retorna em qual mês a compra entra
    // na fatura. Fallback: compras manuais/legado sem billForecastMonth caem no
    // mês civil (date).
    const monthKey = month; // "YYYY-MM" vindo da query
    const [y0, m0] = month.split("-").map(Number);
    const startOfMonth = new Date(Date.UTC(y0, m0 - 1, 1, 0, 0, 0));
    const endOfMonth = new Date(Date.UTC(y0, m0, 1, 0, 0, 0));

    const result = [];

    for (const g of groups) {
      const pm = g.paymentMethod;
      const txs = await prisma.transaction.findMany({
        where: {
          userId: user.id,
          isCreditCard: true,
          paymentMethod: pm,
          OR: [
            { billForecastMonth: monthKey },
            { billForecastMonth: null, date: { gte: startOfMonth, lt: endOfMonth } },
          ],
        },
        orderBy: { date: "desc" },
        include: { category: { select: { name: true } } },
      });

      const paymentMethod = pm || txs[0]?.paymentMethod || "Cartão";
      const total = txs.reduce((s, t) => s + Math.abs(t.amount), 0);
      result.push({
        id: paymentMethod,
        pluggyAccountId: txs[0]?.pluggyAccountId ?? null,
        paymentMethod,
        invoiceDay: null,
        // Mês da fatura informado pelo Pluggy (billForecastMonth = "YYYY-MM").
        // Substitui o ciclo de dia de fechamento (removido).
        invoiceMonth: month,
        start: null,
        end: null,
        total: Math.round(total * 100) / 100,
        count: txs.length,
        txs: txs.map((t) => ({
          id: t.id,
          date: t.date,
          description: t.description,
          amount: Math.abs(t.amount),
          paymentMethod: t.paymentMethod,
          categoryName: t.category?.name || null,
          person: t.person,
          type: t.type,
        })),
      });
    }

    result.sort((a, b) => (b.total || 0) - (a.total || 0));
    res.json(result);
  } catch (err) {
    logger.error("[transactions] card-cycle:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { month, categoryId, person, type, source, isShared, paymentMethod } = req.query;

    const where: Record<string, unknown> = { userId: user.id };

    if (month) {
      const startOfMonth = new Date(`${month}-01T00:00:00.000Z`);
      const endOfMonth = new Date(startOfMonth);
      endOfMonth.setUTCMonth(endOfMonth.getUTCMonth() + 1);
      delete where.date;
      // Compras de cartão seguem o mês da FATURA (billForecastMonth informado
      // pelo Pluggy), igual ao dashboard e ao card-cycle — ex.: compra de
      // 18/08 com fatura 2026-09 aparece na lista de setembro. Lançamentos
      // manuais/legado (sem billForecastMonth) ficam no mês civil da data.
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        {
          OR: [
            // Cartão: fatura informada pelo Pluggy
            { isCreditCard: true, billForecastMonth: month },
            // Débito/crédito em conta com competência explícita (ex.:
            // prestação de julho debitada em agosto) — vence o mês da data.
            { referenceMonth: month },
            // Demais lançamentos: mês civil da data
            {
              billForecastMonth: null,
              referenceMonth: null,
              date: { gte: startOfMonth, lt: endOfMonth },
            },
          ],
        },
      ];
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
    logger.error(err);
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
    logger.error(err);
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
    if (data.referenceMonth !== undefined) {
      // Competência ("YYYY-MM") definida pelo usuário: mês a que a despesa se
      // refere quando o débito caiu em outro mês (ex.: prestação de julho
      // debitada em 05/08). null limpa (volta a competir pela data).
      updateData.referenceMonth = data.referenceMonth;
    }
    // Competência ("YYYY-MM") definida pelo usuário: mês a que a despesa se
    // refere quando o débito caiu em outro mês (ex.: prestação de julho
    // debitada em 05/08). Null limpa (volta a competir pela data).
    // Importada do Pluggy + editada pelo usuário → o sync não sobrescreve mais
    // esta linha no re-sincronismo (preserva correções de valor/data/etc.).
    if (existing.source === "PLUGGY") {
      updateData.manuallyEdited = true;
    }

    const transaction = await prisma.transaction.update({
      where: { id: id as string },
      data: updateData as any,
      include: { category: true },
    });

    // If this is part of an installment series, update siblings too
    if (existing.totalInstallments > 1) {
      // Use installmentGroupId if available, fallback to description+date matching
      const siblingWhere: Record<string, unknown> = {
        userId: user.id,
        totalInstallments: existing.totalInstallments,
        id: { not: id as string },
      };
      
      if (existing.installmentGroupId) {
        siblingWhere.installmentGroupId = existing.installmentGroupId;
      } else {
        // Legacy: match by description + date range, offset by currentInstallment
        const idx = (existing.currentInstallment ?? 1) - 1;
        const monthStart = new Date(existing.date.getFullYear(), existing.date.getMonth() - idx, 1);
        const monthEnd = new Date(existing.date.getFullYear(), existing.date.getMonth() + (existing.totalInstallments - idx), 1);
        siblingWhere.description = existing.description;
        siblingWhere.date = { gte: monthStart, lt: monthEnd };
      }
      
      // Propagate changed fields to all siblings
      const siblingData: Record<string, unknown> = {};
      if (data.description) siblingData.description = data.description;
      if (data.amount) siblingData.amount = data.amount;
      if (data.categoryId !== undefined) siblingData.categoryId = data.categoryId;
      if (data.person !== undefined) siblingData.person = data.person;
      if (data.paymentMethod !== undefined) siblingData.paymentMethod = data.paymentMethod;
      if (data.isShared !== undefined) siblingData.isShared = data.isShared;
      if (data.type) siblingData.type = data.type;
      
      if (Object.keys(siblingData).length > 0) {
        await prisma.transaction.updateMany({
          where: siblingWhere as any,
          data: siblingData as any,
        });
      }
    }

    res.json(transaction);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Dados inválidos", details: err.errors });
      return;
    }
    logger.error(err);
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
      // Idempotente: se a transação já não existe, considera removida. Evita
      // 404 em exclusões em lote/parceladas, onde a exclusão em cascata de uma
      // parcela já removeu as irmãs selecionadas.
      res.json({ message: "Transação já removida" });
      return;
    }

    // If part of installment series, delete siblings too
    if (existing.totalInstallments > 1) {
      if (existing.installmentGroupId) {
        await prisma.transaction.deleteMany({
          where: { userId: user.id, installmentGroupId: existing.installmentGroupId },
        });
      } else {
        const idx = (existing.currentInstallment ?? 1) - 1;
        const monthStart = new Date(existing.date.getFullYear(), existing.date.getMonth() - idx, 1);
        const monthEnd = new Date(
          existing.date.getFullYear(),
          existing.date.getMonth() + (existing.totalInstallments - idx),
          1
        );
        await prisma.transaction.deleteMany({
          where: {
            userId: user.id,
            totalInstallments: existing.totalInstallments,
            description: existing.description,
            date: { gte: monthStart, lt: monthEnd },
          },
        });
      }
    } else {
      await prisma.transaction.delete({ where: { id: id as string } });
    }

    res.json({ message: "Transação removida" });
  } catch (err) {
    logger.error(err);
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
    logger.error(err);
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

async function getBotUserId(req: Request): Promise<string> {
  // Verify userId from body against active WhatsAppUser
  if (req.body?.userId) {
    const linked = await prisma.whatsAppUser.findFirst({
      where: { userId: req.body.userId, isActive: true },
    });
    if (linked) return linked.userId;
  }
  
  // Find first user with linked WhatsApp (deterministic ordering)
  const wa = await prisma.whatsAppUser.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (wa) return wa.userId;
  
  // Fallback: first user
  const first = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  return first?.id || '';
}

botRouter.post("/", async (req: Request, res: Response) => {
  try {
    const data = botTransactionSchema.parse(req.body);

    const userId = await getBotUserId(req);
    if (!userId) {
      res.status(400).json({ error: "No user found. Link a WhatsApp number first." });
      return;
    }

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
        paymentMethod: data.paymentMethod || null,
        totalInstallments: data.totalInstallments || 1,
        currentInstallment: data.currentInstallment || 1,
        installmentGroupId: data.installmentGroupId || null,
      },
      include: { category: true },
    });

    res.status(201).json(transaction);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Dados inválidos", details: err.errors });
      return;
    }
    logger.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// Bot-authenticated PUT for updating transactions (isFixed, installments, etc.)
botRouter.put("/:id", async (req: Request, res: Response) => {
  try {
    const userId = await getBotUserId(req);
    if (!userId) {
      res.status(400).json({ error: "No user found" });
      return;
    }

    const { id } = req.params;
    const existing = await prisma.transaction.findFirst({
      where: { id: id as string, userId },
    });
    if (!existing) {
      res.status(404).json({ error: "Transação não encontrada" });
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (req.body.isFixed !== undefined) updateData.isFixed = req.body.isFixed;
    if (req.body.totalInstallments !== undefined) updateData.totalInstallments = req.body.totalInstallments;
    if (req.body.currentInstallment !== undefined) updateData.currentInstallment = req.body.currentInstallment;
    if (req.body.installmentGroupId !== undefined) updateData.installmentGroupId = req.body.installmentGroupId;

    const transaction = await prisma.transaction.update({
      where: { id: id as string },
      data: updateData as any,
    });

    res.json(transaction);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// Bot-authenticated PUT for updating transactions (isFixed, installments, etc.)
botRouter.put("/:id", async (req: Request, res: Response) => {
  try {
    const userId = await getBotUserId(req);
    if (!userId) {
      res.status(400).json({ error: "No user found" });
      return;
    }

    const { id } = req.params;
    const existing = await prisma.transaction.findFirst({
      where: { id: id as string, userId },
    });
    if (!existing) {
      res.status(404).json({ error: "Transação não encontrada" });
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (req.body.isFixed !== undefined) updateData.isFixed = req.body.isFixed;
    if (req.body.totalInstallments !== undefined) updateData.totalInstallments = req.body.totalInstallments;
    if (req.body.currentInstallment !== undefined) updateData.currentInstallment = req.body.currentInstallment;
    if (req.body.installmentGroupId !== undefined) updateData.installmentGroupId = req.body.installmentGroupId;

    const transaction = await prisma.transaction.update({
      where: { id: id as string },
      data: updateData as any,
    });

    res.json(transaction);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

export { botRouter };
export default router;
