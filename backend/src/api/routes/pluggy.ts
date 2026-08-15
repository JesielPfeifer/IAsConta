import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";
import {
  isPluggyConfigured,
  createConnectToken,
  listConnectors,
  createItem,
  updateItem,
  deleteItem,
  getItem,
  sendItemMFA,
  PluggyError,
} from "../services/pluggy.js";
import { syncItem, syncAllForUser, handlePluggyWebhook } from "../services/pluggy-sync.js";

const router = Router();
const prisma = new PrismaClient();

function pluggyWebhookUrl(): string | null {
  return process.env.PLUGGY_WEBHOOK_URL || null;
}

// All routes except /webhook require auth
router.use((req, res, next) => {
  if (req.path === "/webhook") return next();
  authMiddleware(req as Request, res as Response, next as () => void);
});

// GET /api/pluggy/status — config status
router.get("/status", async (_req: Request, res: Response) => {
  res.json({
    configured: isPluggyConfigured(),
    webhookUrl: pluggyWebhookUrl(),
  });
});

// GET /api/pluggy/connectors?search=&sandbox= — institutions available
router.get("/connectors", async (req: Request, res: Response) => {
  try {
    const search = (req.query.search as string) || undefined;
    const sandbox = req.query.sandbox === "true";
    const connectors = await listConnectors(search, sandbox);
    res.json(connectors);
  } catch (err) {
    console.error("[pluggy] listConnectors:", err);
    res.status(500).json({ error: err instanceof PluggyError ? err.message : "Erro interno" });
  }
});

// POST /api/pluggy/connect-token — token for the Connect Widget (frontend)
router.post("/connect-token", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { itemId } = req.body as { itemId?: string };
    const token = await createConnectToken({
      clientUserId: user.id,
      webhookUrl: pluggyWebhookUrl() || undefined,
      itemId,
      avoidDuplicates: true,
    });
    res.json({ accessToken: token });
  } catch (err) {
    console.error("[pluggy] connect-token:", err);
    res.status(500).json({ error: err instanceof PluggyError ? err.message : "Erro interno" });
  }
});

// POST /api/pluggy/items — create a connection via API (sandbox/testing or custom flows)
router.post("/items", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { connectorId, credentials, products } = req.body as {
      connectorId: number;
      credentials: Record<string, string>;
      products?: string[];
    };
    if (!connectorId || !credentials) {
      res.status(400).json({ error: "connectorId e credentials são obrigatórios" });
      return;
    }
    const item = await createItem({
      connectorId,
      credentials,
      webhookUrl: pluggyWebhookUrl() || undefined,
      clientUserId: user.id,
      products,
    });

    // Persist the connection locally (will be enriched on sync)
    await prisma.bankConnection.create({
      data: {
        bankName: item.connector?.name || `Conexão ${connectorId}`,
        itemId: item.id,
        connectorId,
        connectorName: item.connector?.name || null,
        status: item.status,
        userId: user.id,
      },
    });

    res.status(201).json(item);
  } catch (err) {
    console.error("[pluggy] create item:", err);
    res.status(500).json({ error: err instanceof PluggyError ? err.message : "Erro interno" });
  }
});

// GET /api/pluggy/items — list user connections (with latest item status)
router.get("/items", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const connections = await prisma.bankConnection.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    // Refresh status from Pluggy for item-based connections
    const enriched = await Promise.all(
      connections.map(async (conn) => {
        if (!conn.itemId) return conn;
        try {
          const item = await getItem(conn.itemId);
          return { ...conn, status: item.status, lastSyncAt: item.lastSyncAt || conn.lastSyncAt };
        } catch {
          return conn;
        }
      })
    );

    res.json(enriched);
  } catch (err) {
    console.error("[pluggy] list items:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// POST /api/pluggy/items/:itemId/sync — trigger sync of one item
router.post("/items/:itemId/sync", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const itemId = req.params.itemId as string;
    const result = await syncItem(itemId, user.id);
    res.json(result);
  } catch (err) {
    console.error("[pluggy] sync:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Erro interno" });
  }
});

// POST /api/pluggy/sync-all — sync every connection of the user
router.post("/sync-all", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const results = await syncAllForUser(user.id);
    res.json(results);
  } catch (err) {
    console.error("[pluggy] sync-all:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Erro interno" });
  }
});

// POST /api/pluggy/items/:itemId/update — trigger Pluggy-side re-collection
router.post("/items/:itemId/update", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const itemId = req.params.itemId as string;
    const conn = await prisma.bankConnection.findFirst({ where: { itemId, userId: user.id } });
    if (!conn) {
      res.status(404).json({ error: "Conexão não encontrada" });
      return;
    }
    const item = await updateItem(itemId);
    res.json(item);
  } catch (err) {
    console.error("[pluggy] update item:", err);
    res.status(500).json({ error: err instanceof PluggyError ? err.message : "Erro interno" });
  }
});

// POST /api/pluggy/items/:itemId/mfa — send MFA code when item waits for user input
router.post("/items/:itemId/mfa", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const itemId = req.params.itemId as string;
    const { mfa } = req.body as { mfa?: string };
    if (!mfa) {
      res.status(400).json({ error: "Código MFA é obrigatório" });
      return;
    }
    const conn = await prisma.bankConnection.findFirst({ where: { itemId, userId: user.id } });
    if (!conn) {
      res.status(404).json({ error: "Conexão não encontrada" });
      return;
    }
    const item = await sendItemMFA(itemId, mfa);
    res.json(item);
  } catch (err) {
    console.error("[pluggy] mfa:", err);
    res.status(500).json({ error: err instanceof PluggyError ? err.message : "Erro interno" });
  }
});

// DELETE /api/pluggy/items/:itemId — remove connection (Pluggy + local)
router.delete("/items/:itemId", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const itemId = req.params.itemId as string;
    const conn = await prisma.bankConnection.findFirst({ where: { itemId, userId: user.id } });
    if (!conn) {
      res.status(404).json({ error: "Conexão não encontrada" });
      return;
    }

    try {
      await deleteItem(itemId);
    } catch (err) {
      // Item may already be gone on Pluggy's side — continue cleanup
      console.warn("[pluggy] delete item remoto falhou:", (err as Error).message);
    }

    // Remove imported data (transactions + faturas from this item's accounts)
    await prisma.$transaction([
      prisma.transaction.deleteMany({
        where: { userId: user.id, pluggyAccountId: { in: await getAccountIds(itemId) } },
      }),
      prisma.bill.deleteMany({
        where: { userId: user.id, pluggyAccountId: { in: await getAccountIds(itemId) } },
      }),
      prisma.bankConnection.delete({ where: { id: conn.id } }),
    ]);

    res.json({ ok: true });
  } catch (err) {
    console.error("[pluggy] delete item:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Erro interno" });
  }
});

async function getAccountIds(itemId: string): Promise<string[]> {
  const { listAccounts } = await import("../services/pluggy.js");
  try {
    const accounts = await listAccounts(itemId);
    return accounts.map((a) => a.id);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------
// Webhook (public, validated via header X-Webhook-Secret)
// ---------------------------------------------------------------
router.post("/webhook", async (req: Request, res: Response) => {
  const expected = process.env.WEBHOOK_SECRET;
  if (expected) {
    const received = (req.headers["x-webhook-secret"] as string) || "";
    if (received !== expected) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  const body = (req.body || {}) as Record<string, unknown>;
  console.log("[pluggy-webhook] evento:", body.eventName, "item:", body.itemId);

  try {
    const summary = await handlePluggyWebhook(body);
    if (summary) console.log("[pluggy-webhook]", summary);
    res.sendStatus(200);
  } catch (err) {
    console.error("[pluggy-webhook] erro:", err);
    res.sendStatus(200); // always ack to avoid Pluggy retry storms
  }
});

export default router;
