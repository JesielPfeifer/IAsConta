import { Router, Request, Response } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();
const prisma = new PrismaClient();

router.use(authMiddleware);

const linkSchema = z.object({
  phone: z.string().regex(/^\d{10,15}$/, "Telefone deve ter 10-15 dígitos"),
});

// GET / — list linked WhatsApp numbers
router.get("/", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const waUsers = await prisma.whatsAppUser.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    res.json(waUsers);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// POST / — link WhatsApp number
router.post("/", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const data = linkSchema.parse(req.body);

    // Check if phone already linked to another user
    const existing = await prisma.whatsAppUser.findUnique({
      where: { phone: data.phone },
    });
    if (existing && existing.userId !== user.id) {
      res.status(409).json({ error: "Este número já está vinculado a outra conta" });
      return;
    }

    const waUser = await prisma.whatsAppUser.upsert({
      where: { phone: data.phone },
      create: { phone: data.phone, userId: user.id, isActive: true, instanceName: `wa-${user.id}` },
      update: { userId: user.id, isActive: true },
    });

    res.json({ message: "WhatsApp vinculado com sucesso", phone: waUser.phone });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Telefone inválido", details: err.errors });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// DELETE /:phone — unlink WhatsApp number
router.delete("/:phone", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const phone = req.params.phone as string;

    const existing = await prisma.whatsAppUser.findFirst({
      where: { phone, userId: user.id },
    });
    if (!existing) {
      res.status(404).json({ error: "Número não encontrado" });
      return;
    }

    await prisma.whatsAppUser.update({
      where: { id: existing.id },
      data: { isActive: false },
    });

    res.json({ message: "WhatsApp desvinculado" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

export default router;
