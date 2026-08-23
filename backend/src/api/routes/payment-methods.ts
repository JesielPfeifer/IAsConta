import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();
const prisma = new PrismaClient();

router.use(authMiddleware);

// GET /api/payment-methods — list user's payment methods
// Optional ?active=true returns only active methods (for transaction forms)
router.get("/", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const methods = await prisma.paymentMethod.findMany({
      where: {
        userId: user.id,
        ...(req.query.active === "true" ? { active: true } : {}),
      },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    });
    res.json(methods);
  } catch (err) {
    console.error("[payment-methods] list:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// POST /api/payment-methods — create (name + type CARD|ACCOUNT)
router.post("/", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { name, type } = req.body as { name?: string; type?: string };
    const cleanName = (name || "").trim();
    if (!cleanName) {
      res.status(400).json({ error: "Nome é obrigatório" });
      return;
    }
    if (type !== "CARD" && type !== "ACCOUNT") {
      res.status(400).json({ error: "Tipo deve ser CARD ou ACCOUNT" });
      return;
    }
    const existing = await prisma.paymentMethod.findFirst({
      where: { userId: user.id, name: cleanName },
    });
    if (existing) {
      res.status(409).json({ error: "Já existe um método com esse nome" });
      return;
    }
    const created = await prisma.paymentMethod.create({
      data: { name: cleanName, type, userId: user.id },
    });
    res.status(201).json(created);
  } catch (err: any) {
    // Unique conflict on [userId, name] (P2002): a concurrent request created
    // the same name — translate to 409 instead of a generic 500.
    if (err?.code === "P2002") {
      res.status(409).json({ error: "Já existe um método com esse nome" });
      return;
    }
    console.error("[payment-methods] create:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// PUT /api/payment-methods/:id — rename / change type / toggle active
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const id = req.params.id as string;
    const { name, type, active } = req.body as {
      name?: string;
      type?: string;
      active?: boolean;
    };

    const existing = await prisma.paymentMethod.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      res.status(404).json({ error: "Método não encontrado" });
      return;
    }

    const data: Record<string, unknown> = {};
    if (typeof name === "string" && name.trim()) {
      const cleanName = name.trim();
      const dup = await prisma.paymentMethod.findFirst({
        where: { userId: user.id, name: cleanName, NOT: { id } },
      });
      if (dup) {
        res.status(409).json({ error: "Já existe um método com esse nome" });
        return;
      }
      data.name = cleanName;
    }
    if (type === "CARD" || type === "ACCOUNT") data.type = type;
    if (typeof active === "boolean") data.active = active;

    const updated = await prisma.paymentMethod.update({
      where: { id },
      data,
    });
    res.json(updated);
  } catch (err: any) {
    // Unique conflict on [userId, name] (P2002): a concurrent request renamed
    // to the same name — translate to 409 instead of a generic 500.
    if (err?.code === "P2002") {
      res.status(409).json({ error: "Já existe um método com esse nome" });
      return;
    }
    console.error("[payment-methods] update:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// DELETE /api/payment-methods/:id
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const id = req.params.id as string;
    const existing = await prisma.paymentMethod.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      res.status(404).json({ error: "Método não encontrado" });
      return;
    }
    await prisma.paymentMethod.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    console.error("[payment-methods] delete:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

export default router;
