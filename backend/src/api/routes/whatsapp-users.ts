import { logger } from '../../lib/logger.js';
import { Router, Request, Response } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";
import { ensureInstanceForUser, removeInstance, getQRCode, getConnectionState, disconnectInstance } from "../../bot/platforms/whatsapp.js";

const router = Router();
const prisma = new PrismaClient();

router.use(authMiddleware);

const linkSchema = z.object({
  phone: z.string().regex(/^\d{10,15}$/, "Telefone deve ter 10-15 dígitos").optional(),
});

function userInstanceName(userId: string): string {
  return `wa-${userId}`;
}

// GET / — get the current user's WhatsApp instance with connection status
router.get("/", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    
    // Each user has ONE WhatsAppUser entry
    let wa = await prisma.whatsAppUser.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    if (!wa) {
      res.json({ exists: false, connected: false, connectionState: "none" });
      return;
    }

    try {
      const state = await getConnectionState(wa.instanceName, user.id);
      res.json({ ...wa, exists: true, connectionState: state, connected: state === "open" });
    } catch {
      res.json({ ...wa, exists: true, connectionState: "error", connected: false });
    }
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// POST / — create the user's WhatsApp instance (one per user)
router.post("/", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const data = linkSchema.parse(req.body);
    const phone = data.phone || null;
    const instanceName = userInstanceName(user.id);

    // Check if user already has an instance
    const existing = await prisma.whatsAppUser.findFirst({
      where: { userId: user.id },
    });

    if (existing) {
      // Reactivate if inactive, update phone if provided
      await prisma.whatsAppUser.update({
        where: { id: existing.id },
        data: { 
          isActive: true,
          ...(phone ? { phone } : {}),
        },
      });
      // Recreate Evolution instance if needed
      try {
        await ensureInstanceForUser(instanceName, user.id);
      } catch (err: any) {
        logger.error(`[whatsapp-users] Failed to ensure instance:`, err);
      }
      res.json({
        message: "WhatsApp já vinculado",
        instanceName: existing.instanceName,
        phone: phone || existing.phone,
      });
      return;
    }

    // Create Evolution API instance for this user
    await ensureInstanceForUser(instanceName, user.id);

    // Save to database
    const waUser = await prisma.whatsAppUser.create({
      data: {
        phone: phone || null,
        userId: user.id,
        isActive: true,
        instanceName,
      },
    });

    res.json({
      message: "WhatsApp vinculado com sucesso",
      phone: waUser.phone,
      instanceName: waUser.instanceName,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Telefone inválido", details: err.errors });
      return;
    }
    logger.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// DELETE / — remove the user's WhatsApp instance
router.delete("/", async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    const existing = await prisma.whatsAppUser.findFirst({
      where: { userId: user.id },
    });
    if (!existing) {
      res.status(404).json({ error: "Nenhum WhatsApp vinculado" });
      return;
    }

    // Remove Evolution API instance
    await removeInstance(existing.instanceName, user.id).catch((err) => {
      logger.error(`[whatsapp-users] Failed to remove instance ${existing.instanceName}:`, err);
    });

    // Delete from DB
    await prisma.whatsAppUser.delete({
      where: { id: existing.id },
    });

    res.json({ message: "WhatsApp desvinculado e instância removida" });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// GET /qrcode — get QR code for the current user's instance
router.get("/qrcode", async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    const wa = await prisma.whatsAppUser.findFirst({
      where: { userId: user.id },
    });
    if (!wa) {
      res.status(404).json({ error: "WhatsApp não vinculado. Vincule primeiro." });
      return;
    }

    const result = await getQRCode(wa.instanceName, user.id);
    res.json(result);
  } catch (err) {
    logger.error("[whatsapp-users] qrcode error:", err);
    res.status(500).json({ error: "Erro ao gerar QR Code" });
  }
});

// POST /disconnect — disconnect the current user's instance
router.post("/disconnect", async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    const wa = await prisma.whatsAppUser.findFirst({
      where: { userId: user.id },
    });
    if (!wa) {
      res.status(404).json({ error: "WhatsApp não vinculado" });
      return;
    }

    const ok = await disconnectInstance(wa.instanceName, user.id);
    res.json({ success: ok });
  } catch (err) {
    logger.error("[whatsapp-users] disconnect error:", err);
    res.status(500).json({ success: false, error: "Erro ao desconectar" });
  }
});

export default router;
