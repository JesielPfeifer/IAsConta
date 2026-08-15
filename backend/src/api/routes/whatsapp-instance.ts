import { Router, Request, Response } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();
const prisma = new PrismaClient();

router.use(authMiddleware);

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || "http://evolution-api:8080";
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || "secret_api_key";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const WEBHOOK_URL = process.env.WEBHOOK_URL || "http://api:3001/webhook/evolution";

const linkSchema = z.object({
  phone: z.string().regex(/^\d{10,15}$/, "Telefone deve ter 10-15 dígitos").optional(),
});

// Monta o nome da instância: {primeiro-nome}-{timestamp}
// ex: jesiel-20260806-1435 (sem número de celular)
function buildInstanceName(name: string): string {
  const slug = (name || "user")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${slug}-${ts}`;
}

async function evolutionRequest(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(`${EVOLUTION_API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      apikey: EVOLUTION_API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, data };
}

// POST / — cria instância única para o usuário e retorna o QR code
router.post("/", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { phone } = linkSchema.parse(req.body);

    // Já existe instância ativa? Regenera o QR da MESMA (não bloqueia)
    const existing = await prisma.whatsAppUser.findFirst({
      where: { userId: user.id, isActive: true },
    });
    if (existing) {
      try {
        // Se a instância já está conectada, não precisa de QR
        const st = await evolutionRequest("GET", `/instance/connectionState/${existing.instanceName}`);
        const state = st.data?.instance?.state || "close";
        if (state === "open") {
          res.json({
            message: "Instância já conectada",
            instanceName: existing.instanceName,
            connected: true,
            phone: existing.phone,
          });
          return;
        }
        // Não conectada: regenera o QR da MESMA instância
        const qr = await evolutionRequest("GET", `/instance/connect/${existing.instanceName}`);
        const qrBase64 = qr.data?.base64 || "";
        if (qrBase64) {
          res.json({
            message: "Instância já existia — QR regenerado",
            instanceName: existing.instanceName,
            qrCode: qrBase64,
            connected: false,
            phone: existing.phone,
          });
          return;
        }
      } catch (err) {
        console.error("[whatsapp-instance] Erro ao regenerar QR:", err);
      }
      res.status(409).json({
        error: "Você já possui uma instância ativa",
        instanceName: existing.instanceName,
      });
      return;
    }

    // Número é opcional — se informado, normaliza DDI (10-11 dígitos → prefixo 55)
    let normalizedPhone: string | null = null;
    if (phone) {
      normalizedPhone = phone.length <= 11 ? `55${phone}` : phone;
      const phoneTaken = await prisma.whatsAppUser.findUnique({ where: { phone: normalizedPhone } });
      if (phoneTaken && phoneTaken.userId !== user.id) {
        res.status(409).json({ error: "Este número já está vinculado a outra conta" });
        return;
      }
    }

    const instanceName = buildInstanceName(user.name || "user");

    // 1. Cria a instância no Evolution API
    const create = await evolutionRequest("POST", "/instance/create", {
      instanceName,
      integration: "WHATSAPP-BAILEYS",
    });
    if (create.status !== 200 && create.status !== 201 && create.data?.status !== 200) {
      // Se já existe, segue; se outro erro, falha
      const errMsg = create.data?.response?.message || create.data?.message || `HTTP ${create.status}`;
      if (create.status === 400 && String(errMsg).includes("already")) {
        // instância já existe — ok, segue
      } else {
        res.status(502).json({ error: `Falha ao criar instância: ${errMsg}` });
        return;
      }
    }

    // 2. Configura o webhook da instância (secret + eventos)
    const wh = await evolutionRequest("POST", `/webhook/set/${instanceName}`, {
      webhook: {
        url: WEBHOOK_URL,
        enabled: true,
        events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"],
        headers: { "x-webhook-secret": WEBHOOK_SECRET },
      },
    });

    // 3. Gera o QR code
    const qr = await evolutionRequest("GET", `/instance/connect/${instanceName}`);
    const qrBase64 = qr.data?.base64 || "";

    // 4. Persiste o vínculo (phone opcional — preenchido ao conectar)
    const waUser = await prisma.whatsAppUser.create({
      data: { phone: normalizedPhone, userId: user.id, isActive: true, instanceName },
    });

    res.json({
      message: "Instância criada. Escaneie o QR code.",
      instanceName,
      qrCode: qrBase64,
      phone: waUser.phone,
      webhookConfigured: wh.status === 200 || wh.status === 201,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Telefone inválido", details: err.errors });
      return;
    }
    console.error("[whatsapp-instance] Erro:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// GET /state — estado da instância do usuário
router.get("/state", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const waUser = await prisma.whatsAppUser.findFirst({
      where: { userId: user.id, isActive: true },
    });
    if (!waUser) {
      res.json({ connected: false, instanceName: null });
      return;
    }

    const st = await evolutionRequest("GET", `/instance/connectionState/${waUser.instanceName}`);
    const state = st.data?.instance?.state || "close";
    res.json({
      connected: state === "open",
      state,
      instanceName: waUser.instanceName,
      phone: waUser.phone,
    });
  } catch (err) {
    console.error("[whatsapp-instance] state:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// DELETE / — desvincula e remove a instância
router.delete("/", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const waUser = await prisma.whatsAppUser.findFirst({
      where: { userId: user.id, isActive: true },
    });
    if (!waUser) {
      res.status(404).json({ error: "Nenhuma instância encontrada" });
      return;
    }

    // Desconecta e remove no Evolution
    await evolutionRequest("POST", `/instance/logout/${waUser.instanceName}`).catch(() => {});
    await evolutionRequest("DELETE", `/instance/delete/${waUser.instanceName}`).catch(() => {});

    await prisma.whatsAppUser.update({
      where: { id: waUser.id },
      data: { isActive: false },
    });

    res.json({ message: "Instância removida", instanceName: waUser.instanceName });
  } catch (err) {
    console.error("[whatsapp-instance] delete:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

export default router;
