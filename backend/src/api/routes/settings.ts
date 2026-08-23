import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();
const prisma = new PrismaClient();

router.use(authMiddleware);

const SETTINGS_KEYS = [
  "groqApiKey",
  "wifeName",
  "husbandName",
  "whatsappGroupId",
  "evolutionApiKey",
  "evolutionApiUrl",
  "discordToken",
  "telegramToken",
  "geminiApiKey",
  "pluggyClientId",
] as const;

// The Pluggy secret is WRITE-only: the UI can save it, but it is never
// returned by GET/PUT responses (only a {key}Set presence flag).
const WRITE_KEYS = [...SETTINGS_KEYS, "pluggyClientSecret"] as const;

// Secrets are NEVER returned by the API — the frontend only needs to know
// whether one is set (it never reads the value back).
const SECRET_KEYS = ["pluggyClientSecret"] as const;

/** Removes secret values from a settings payload, replacing them with a
 *  `{key}Set` boolean flag so clients can tell whether one is configured. */
function sanitizeSettings(
  settings: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...settings };
  for (const key of SECRET_KEYS) {
    const value = out[key];
    delete out[key];
    out[`${key}Set`] = Boolean(value);
  }
  return out;
}

router.get("/", async (req: Request, res: Response) => {
  try {
    const settings = await prisma.userSettings.findUnique({
      where: { userId: req.user!.id },
    });
    
    // Normalize: replace null with empty string for all string fields
    const normalized: Record<string, unknown> = { userId: req.user!.id };
    if (settings) {
      for (const [key, value] of Object.entries(settings)) {
        normalized[key] = value ?? '';
      }
    }
    
    res.json(sanitizeSettings(normalized));
  } catch (err) {
    console.error("[settings] get error:", err);
    res.status(500).json({ error: "Erro ao buscar configuracoes" });
  }
});

router.put("/", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const data: Record<string, string | null> = {};

    for (const key of WRITE_KEYS) {
      if (typeof req.body[key] === "string") {
        data[key] = req.body[key] || null;
      }
    }

    const settings = await prisma.userSettings.upsert({
      where: { userId },
      update: data as any,
      create: { userId, ...(data as any) },
    });

    // Never echo the secret back to the client
    res.json(sanitizeSettings(settings as unknown as Record<string, unknown>));
  } catch (err) {
    console.error("[settings] put error:", err);
    res.status(500).json({ error: "Erro ao salvar configuracoes" });
  }
});

export default router;
