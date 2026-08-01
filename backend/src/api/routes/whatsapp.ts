import { Router, Request, Response } from "express";
import { getQRCode, getConnectionState, disconnectInstance, findGroupByName } from "../../bot/platforms/whatsapp.js";

const router = Router();

// GET /qrcode — legacy: get QR code for default instance
router.get("/qrcode", async (req: Request, res: Response) => {
  try {
    const instanceName = req.query.instance as string | undefined;
    const result = await getQRCode(instanceName);
    res.json(result);
  } catch (err) {
    console.error("[whatsapp] qrcode error:", err);
    res.status(500).json({ error: "Erro ao gerar QR Code" });
  }
});

// GET /status — legacy: check connection status
router.get("/status", async (req: Request, res: Response) => {
  try {
    const instanceName = req.query.instance as string | undefined;
    const state = await getConnectionState(instanceName);
    res.json({ connected: state === "open", state });
  } catch (err) {
    console.error("[whatsapp] status error:", err);
    res.status(500).json({ connected: false, state: "error" });
  }
});

// POST /disconnect — legacy: disconnect default instance
router.post("/disconnect", async (req: Request, res: Response) => {
  try {
    const instanceName = req.query.instance as string | undefined;
    const ok = await disconnectInstance(instanceName);
    res.json({ success: ok });
  } catch (err) {
    console.error("[whatsapp] disconnect error:", err);
    res.status(500).json({ success: false, error: "Erro ao desconectar" });
  }
});

// GET /find-group — find WhatsApp group by name
router.get("/find-group", async (req: Request, res: Response) => {
  try {
    const name = req.query.name as string;
    const instanceName = req.query.instance as string | undefined;
    if (!name) { res.status(400).json({ error: "Nome do grupo obrigatorio" }); return; }
    const group = await findGroupByName(name, instanceName);
    if (group) res.json(group);
    else res.status(404).json({ error: "Grupo nao encontrado" });
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar grupo" });
  }
});

export default router;
