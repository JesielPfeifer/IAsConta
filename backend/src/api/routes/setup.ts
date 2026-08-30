import { logger } from "../../lib/logger.js";
import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();
const prisma = new PrismaClient();

router.use(authMiddleware);

/**
 * GET /api/setup/status — status do setup inicial do usuário.
 *
 * O app usa isto após o login para decidir se exibe o wizard de boas-vindas
 * (onboarding) para usuários que ainda não completaram a configuração básica.
 * "Setup completo" (robusto e simples): salário cadastrado + pelo menos um
 * cartão de crédito (PaymentMethod CARD) + nomes do casal (UserSettings).
 *
 * Retorna:
 *   { complete: boolean, missing: string[] }
 *   missing pode conter "salary" | "card" | "couple" (ou estar vazio).
 */
router.get("/status", async (req, res) => {
  try {
    const userId = req.user!.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { salary: true },
    });

    const [cardCount, settings] = await Promise.all([
      prisma.paymentMethod.count({
        where: { userId, type: "CARD" },
      }),
      prisma.userSettings.findUnique({ where: { userId } }),
    ]);

    const missing: string[] = [];
    if (!user?.salary) missing.push("salary");
    if (cardCount === 0) missing.push("card");
    if (!settings || (!settings.wifeName && !settings.husbandName)) {
      missing.push("couple");
    }

    res.json({ complete: missing.length === 0, missing });
  } catch (err) {
    logger.error("[setup] status error:", err);
    res.status(500).json({ error: "Erro ao verificar o status do setup" });
  }
});

export default router;