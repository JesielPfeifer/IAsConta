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
  "botApiKey",
  "evolutionApiKey",
  "evolutionApiUrl",
  "discordToken",
  "telegramToken",
  "geminiApiKey",
] as const;

router.get("/", async (req: Request, res: Response) => {
  try {
    const settings = await prisma.userSettings.findUnique({
      where: { userId: req.user!.id },
    });
    res.json(settings || { userId: req.user!.id });
  } catch (err) {
    console.error("[settings] get error:", err);
    res.status(500).json({ error: "Erro ao buscar configuracoes" });
  }
});

router.put("/", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const data: Record<string, string | null> = {};

    for (const key of SETTINGS_KEYS) {
      if (typeof req.body[key] === "string") {
        data[key] = req.body[key] || null;
      }
    }

    const settings = await prisma.userSettings.upsert({
      where: { userId },
      update: data as any,
      create: { userId, ...(data as any) },
    });

    res.json(settings);
  } catch (err) {
    console.error("[settings] put error:", err);
    res.status(500).json({ error: "Erro ao salvar configuracoes" });
  }
});

export default router;
