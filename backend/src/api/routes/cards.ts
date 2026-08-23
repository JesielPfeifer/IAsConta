import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();
const prisma = new PrismaClient();
router.use(authMiddleware);

// GET /api/cards/fechamento — cartões de crédito + dia de fechamento configurado
router.get("/fechamento", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    // contas de cartão de crédito sincronizadas (pluggy)
    const rows = await prisma.transaction.findMany({
      where: { userId: user.id, isCreditCard: true, pluggyAccountId: { not: null } },
      select: { pluggyAccountId: true, paymentMethod: true },
      distinct: ["pluggyAccountId", "paymentMethod"],
    });
    // tenta inferir o dia de fechamento a partir do vencimento das faturas Pluggy
    const inferred: Record<string, number> = {};
    const bills = await prisma.bill.findMany({
      where: { userId: user.id, source: "PLUGGY", pluggyAccountId: { in: rows.map((r) => r.pluggyAccountId).filter(Boolean) as string[] } },
      select: { pluggyAccountId: true, dueDate: true },
    });
    for (const b of bills) {
      if (b.pluggyAccountId && !inferred[b.pluggyAccountId]) inferred[b.pluggyAccountId] = b.dueDate.getUTCDate();
    }
    const settings = await prisma.userSettings.findUnique({ where: { userId: user.id } });
    const cfg: any = (settings?.cardInvoiceDays as any) || {};
    const accounts = rows.map((r) => {
      const acc = r.pluggyAccountId as string;
      return {
        pluggyAccountId: acc,
        paymentMethod: r.paymentMethod,
        invoiceDay: cfg[acc] || inferred[acc] || 25,
        configurado: Boolean(cfg[acc]),
      };
    });
    res.json(accounts);
  } catch (err) {
    logger.error("[cards] fechamento:", err);
    res.status(500).json({ error: "Erro ao carregar cartões" });
  }
});

// PUT /api/cards/fechamento/:accountId — { day: 1..31 }
router.put("/fechamento/:accountId", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const accountId = String(req.params.accountId);
    const day = Number((req.body as any).day);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      res.status(400).json({ error: "day deve ser 1..31" });
      return;
    }
    const prev = await prisma.userSettings.findUnique({ where: { userId: user.id } });
    const cfg: any = { ...((prev?.cardInvoiceDays as any) || {}) };
    cfg[accountId] = day;
    await prisma.userSettings.upsert({
      where: { userId: user.id },
      create: { userId: user.id, cardInvoiceDays: cfg },
      update: { cardInvoiceDays: cfg },
    });
    res.json({ ok: true });
  } catch (err) {
    logger.error("[cards] fechamento PUT:", err);
    res.status(500).json({ error: "Erro ao salvar" });
  }
});

export default router;
