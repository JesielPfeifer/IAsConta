import { Router, Request, Response } from "express";
import { getQRCode, getConnectionState, disconnectInstance, findGroupByName } from "../../bot/platforms/whatsapp.js";

const router = Router();

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

router.get("/find-group", async (req: Request, res: Response) => {
  try {
    const name = req.query.name as string;
    if (!name) { res.status(400).json({ error: "Nome do grupo obrigatorio" }); return; }
    const group = await findGroupByName(name);
    if (group) res.json(group);
    else res.status(404).json({ error: "Grupo nao encontrado" });
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar grupo" });
  }
});

export default router;
