import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();
const prisma = new PrismaClient();

router.use(authMiddleware);

// GET /api/fixed-incomes — list recurring incomes
router.get("/", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const incomes = await prisma.fixedIncome.findMany({
      where: { userId: user.id },
      orderBy: { name: "asc" },
    });
    res.json(incomes);
  } catch (err) {
    console.error("[fixed-incomes] list:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// POST /api/fixed-incomes — create recurring income
router.post("/", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { name, amount, person, active } = req.body as {
      name?: string;
      amount?: number;
      person?: string | null;
      active?: boolean;
    };
    const cleanName = (name || "").trim();
    const value = Number(amount);
    if (!cleanName) {
      res.status(400).json({ error: "Nome é obrigatório" });
      return;
    }
    if (!isFinite(value) || value <= 0) {
      res.status(400).json({ error: "Valor deve ser maior que zero" });
      return;
    }
    const personVal =
      person === "HUSBAND" || person === "WIFE" || person === "COUPLE"
        ? person
        : null;
    const created = await prisma.fixedIncome.create({
      data: {
        name: cleanName,
        amount: value,
        person: personVal as any,
        active: active !== false,
        userId: user.id,
      },
    });
    res.status(201).json(created);
  } catch (err) {
    console.error("[fixed-incomes] create:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// PUT /api/fixed-incomes/:id
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const id = req.params.id as string;
    const { name, amount, person, active } = req.body as {
      name?: string;
      amount?: number;
      person?: string | null;
      active?: boolean;
    };

    const existing = await prisma.fixedIncome.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      res.status(404).json({ error: "Renda não encontrada" });
      return;
    }

    const data: Record<string, unknown> = {};
    if (typeof name === "string" && name.trim()) data.name = name.trim();
    if (typeof amount === "number" && isFinite(amount) && amount > 0) {
      data.amount = amount;
    }
    if (person === "HUSBAND" || person === "WIFE" || person === "COUPLE") {
      data.person = person;
    } else if (person === null) {
      data.person = null;
    }
    if (typeof active === "boolean") data.active = active;

    const updated = await prisma.fixedIncome.update({ where: { id }, data });
    res.json(updated);
  } catch (err) {
    console.error("[fixed-incomes] update:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// DELETE /api/fixed-incomes/:id
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const id = req.params.id as string;
    const existing = await prisma.fixedIncome.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      res.status(404).json({ error: "Renda não encontrada" });
      return;
    }
    await prisma.fixedIncome.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    console.error("[fixed-incomes] delete:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// POST /api/fixed-incomes/apply?month=YYYY-MM
// Creates INCOME transactions for all active fixed incomes of the month
// (idempotent: skips months already applied via externalId suffix).
router.post("/apply", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) {
      res.status(400).json({ error: "Mês deve estar no formato YYYY-MM" });
      return;
    }
    const [y, m] = month.split("-").map(Number);
    // Reject calendar-invalid months (2026-00, 2026-13): Date.UTC would
    // silently normalize them to another month and create incomes in the
    // wrong reporting period.
    if (y < 1970 || y > 9999 || m < 1 || m > 12) {
      res.status(400).json({ error: "Mês deve estar no formato YYYY-MM" });
      return;
    }
    // Reject FUTURE months: the transaction date would fall back to
    // Date.now() (current month) while externalId records the future month —
    // the later apply for that month would skip an incorrectly dated row.
    // Compare in local time (matches the frontend's "Lançar no mês").
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    if (month > currentMonth) {
      res.status(400).json({ error: "Não é possível lançar renda em um mês futuro" });
      return;
    }
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 1));

    const incomes = await prisma.fixedIncome.findMany({
      where: { userId: user.id, active: true },
    });

    const created: string[] = [];
    const skipped: string[] = [];

    for (const income of incomes) {
      const externalId = `fixed-income:${income.id}:${month}`;
      const existing = await prisma.transaction.findUnique({
        where: { userId_externalId: { userId: user.id, externalId } },
      });
      if (existing) {
        skipped.push(income.name);
        continue;
      }
      const category = await prisma.category.findFirst({
        where: { userId: user.id, name: { contains: "renda", mode: "insensitive" } },
      });
      try {
        await prisma.transaction.create({
          data: {
            amount: income.amount,
            type: "INCOME",
            description: income.name,
            date: new Date(Math.min(Date.now(), end.getTime() - 1)),
            person: income.person as any,
            isShared: income.person === "COUPLE",
            source: "MANUAL",
            isFixed: true,
            categoryId: category?.id || null,
            externalId,
            userId: user.id,
          },
        });
      } catch (err: any) {
        // Unique conflict (P2002): a concurrent request applied this month
        // first — treat as skipped instead of failing the whole batch.
        if (err?.code === "P2002") {
          skipped.push(income.name);
          continue;
        }
        throw err;
      }
      created.push(income.name);
    }

    res.json({ month, created, skipped });
  } catch (err) {
    console.error("[fixed-incomes] apply:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

export default router;
