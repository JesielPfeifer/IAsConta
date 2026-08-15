import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { getQRCode, getConnectionState, disconnectInstance, findGroupByName } from "../../bot/platforms/whatsapp.js";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();
const prisma = new PrismaClient();

// find-group precisa de auth: usa a instância do usuário logado
router.get("/find-group", authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const name = req.query.name as string;
    if (!name) { res.status(400).json({ error: "Nome do grupo obrigatorio" }); return; }

    const waUser = await prisma.whatsAppUser.findFirst({
      where: { userId: user.id, isActive: true },
    });
    if (!waUser) {
      res.status(404).json({ error: "Nenhuma instância WhatsApp ativa. Gere o QR Code primeiro." });
      return;
    }

    const group = await findGroupByName(name, waUser.instanceName);
    if (group) res.json(group);
    else res.status(404).json({ error: "Grupo nao encontrado" });
  } catch (err) {
    console.error("[whatsapp] find-group error:", err);
    res.status(500).json({ error: "Erro ao buscar grupo" });
  }
});

router.get("/qrcode", async (_req: Request, res: Response) => {
  try {
    const result = await getQRCode();
    res.json(result);
  } catch (err) {
    console.error("[whatsapp] qrcode error:", err);
    res.status(500).json({ error: "Erro ao gerar QR Code" });
  }
});

router.get("/status", async (_req: Request, res: Response) => {
  try {
    const state = await getConnectionState();
    res.json({ connected: state === "open", state });
  } catch (err) {
    console.error("[whatsapp] status error:", err);
    res.status(500).json({ connected: false, state: "error" });
  }
});

router.post("/disconnect", async (_req: Request, res: Response) => {
  try {
    const ok = await disconnectInstance();
    res.json({ success: ok });
  } catch (err) {
    console.error("[whatsapp] disconnect error:", err);
    res.status(500).json({ success: false, error: "Erro ao desconectar" });
  }
});


export default router;
