import { Router, Request, Response } from "express";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";
import {
  createPluggyClient,
  resolveCredentials,
  PluggyError,
  type PluggyCredentials,
  type PluggyClient,
} from "../services/pluggy.js";
import {
  syncItem,
  syncAllForUser,
  handlePluggyWebhook,
  resolveCredentialsForUser,
} from "../services/pluggy-sync.js";

const router = Router();
const prisma = new PrismaClient();

const WEBHOOK_EVENTS = [
  "item/updated",
  "transactions/created",
  "transactions/updated",
  "transactions/deleted",
];

function pluggyWebhookUrl(): string | null {
  return process.env.PLUGGY_WEBHOOK_URL || null;
}

/** Credentials for the logged-in user: own settings first, global env as fallback. */
async function credsForUser(userId: string): Promise<PluggyCredentials | null> {
  return resolveCredentialsForUser(userId);
}

// All routes except /webhook require auth
router.use((req, res, next) => {
  if (req.path === "/webhook") return next();
  authMiddleware(req as Request, res as Response, next as () => void);
});

// GET /api/pluggy/status — config status for the current user
router.get("/status", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const settings = await prisma.userSettings.findUnique({ where: { userId: user.id } });
    const hasUserCreds = Boolean(settings?.pluggyClientId && settings?.pluggyClientSecret);
    const globalConfigured = Boolean(process.env.PLUGGY_CLIENT_ID && process.env.PLUGGY_CLIENT_SECRET);
    res.json({
      configured: hasUserCreds || globalConfigured,
      userConfigured: hasUserCreds,
      globalConfigured,
      webhookUrl: pluggyWebhookUrl(),
    });
  } catch (err) {
    console.error("[pluggy] status:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// GET /api/pluggy/connectors?search=&sandbox= — institutions available
router.get("/connectors", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const creds = await credsForUser(user.id);
    if (!creds) {
      res.status(400).json({ error: "Configure suas credenciais Pluggy nas Configurações primeiro" });
      return;
    }
    const client = createPluggyClient(creds);
    const search = (req.query.search as string) || undefined;
    const sandbox = req.query.sandbox === "true";
    const connectors = await client.listConnectors(search, sandbox);
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
    const creds = await credsForUser(user.id);
    if (!creds) {
      res.status(400).json({ error: "Configure suas credenciais Pluggy nas Configurações primeiro" });
      return;
    }
    const client = createPluggyClient(creds);
    const { itemId } = req.body as { itemId?: string };
    const token = await client.createConnectToken({
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
    const creds = await credsForUser(user.id);
    if (!creds) {
      res.status(400).json({ error: "Configure suas credenciais Pluggy nas Configurações primeiro" });
      return;
    }
    const client = createPluggyClient(creds);
    const { connectorId, credentials, products } = req.body as {
      connectorId: number;
      credentials: Record<string, string>;
      products?: string[];
    };
    if (!connectorId || !credentials) {
      res.status(400).json({ error: "connectorId e credentials são obrigatórios" });
      return;
    }
    const item = await client.createItem({
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

// POST /api/pluggy/items/attach — attach an EXISTING Pluggy item to this user
// (created on dashboard.pluggy.ai / Meu Pluggy). Unlike POST /items it does
// NOT create a new item on Pluggy, so it never hits ITEM_USER_ALREADY_EXISTS.
router.post("/items/attach", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { itemId } = req.body as { itemId?: string };
    if (!itemId || typeof itemId !== "string" || !/^[0-9a-f-]{36}$/i.test(itemId.trim())) {
      res.status(400).json({ error: "itemId é obrigatório (formato UUID)" });
      return;
    }
    const cleanItemId = itemId.trim();

    const existing = await prisma.bankConnection.findFirst({
      where: { itemId: cleanItemId },
    });
    if (existing) {
      res.status(409).json({ error: "Este item já está vinculado a uma conta" });
      return;
    }

    const creds = await credsForUser(user.id);
    if (!creds) {
      res.status(400).json({ error: "Pluggy não configurado para este usuário" });
      return;
    }
    const client = createPluggyClient(creds);

    // Confirm the item exists on Pluggy before registering it locally
    let item;
    try {
      item = await client.getItem(cleanItemId);
    } catch (err) {
      res.status(404).json({
        error: `Item não encontrado na Pluggy: ${err instanceof PluggyError ? err.message : "erro desconhecido"}`,
      });
      return;
    }

    // Ownership: when the item carries a clientUserId (created via Connect
    // Widget/API with our identity), it must match this user. Items WITHOUT
    // clientUserId (created outside the widget, e.g. Meu Pluggy) are claimed
    // here — the itemId itself is the claim proof, and getItem only succeeds
    // with credentials that can see the item.
    if (item.clientUserId && item.clientUserId !== user.id) {
      res.status(403).json({ error: "Este item pertence a outro usuário" });
      return;
    }

    const connection = await prisma.bankConnection.create({
      data: {
        bankName: item.connector?.name || "Conexão Pluggy",
        itemId: cleanItemId,
        connectorId: item.connector?.id ?? null,
        connectorName: item.connector?.name || null,
        status: item.status,
        userId: user.id,
      },
    });

    // Sync immediately so the user sees data right away
    const result = await syncItem(cleanItemId, user.id);
    res.status(201).json({
      connection,
      sync: {
        status: result.status,
        accounts: result.accounts,
        transactionsCreated: result.transactionsCreated,
        transactionsUpdated: result.transactionsUpdated,
        skippedHidden: result.skippedHidden,
        billsCreated: result.billsCreated,
        billsUpdated: result.billsUpdated,
        errors: result.errors,
      },
    });
  } catch (err) {
    console.error("[pluggy] attach item:", err);
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

    const creds = await credsForUser(user.id);
    const client = creds ? createPluggyClient(creds) : null;

    // Refresh status from Pluggy for item-based connections
    const enriched = await Promise.all(
      connections.map(async (conn) => {
        if (!conn.itemId || !client) return conn;
        try {
          const item = await client.getItem(conn.itemId);
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

    // Server-side persistence for the Connect Widget flow: the widget returns
    // an itemId that may not have a bankConnection row yet (no local create
    // happens before onSuccess). Persist it here so sync works and the
    // connection is listed in the UI. Repeated calls are idempotent.
    let conn = await prisma.bankConnection.findFirst({
      where: { itemId, userId: user.id },
    });
    if (!conn) {
      const creds = await credsForUser(user.id);
      if (!creds) {
        res.status(400).json({ error: "Pluggy não configurado para este usuário" });
        return;
      }
      let item;
      try {
        item = await createPluggyClient(creds).getItem(itemId);
      } catch (err) {
        res.status(404).json({
          error: `Item não encontrado na Pluggy: ${err instanceof PluggyError ? err.message : "erro desconhecido"}`,
        });
        return;
      }
      // Ownership: a clientUserId set on the item (Connect Widget flow) must
      // match this user — never import another user's item.
      if (item.clientUserId && item.clientUserId !== user.id) {
        res.status(403).json({ error: "Este item pertence a outro usuário" });
        return;
      }
      conn = await prisma.bankConnection.create({
        data: {
          bankName: item.connector?.name || "Conexão Pluggy",
          itemId,
          connectorId: item.connector?.id ?? null,
          connectorName: item.connector?.name || null,
          status: item.status,
          userId: user.id,
        },
      });
    }

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
    const creds = await credsForUser(user.id);
    if (!creds) {
      res.status(400).json({ error: "Pluggy não configurado" });
      return;
    }
    const client = createPluggyClient(creds);
    const item = await client.updateItem(itemId);
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
    const creds = await credsForUser(user.id);
    if (!creds) {
      res.status(400).json({ error: "Pluggy não configurado" });
      return;
    }
    const client = createPluggyClient(creds);
    const item = await client.sendItemMFA(itemId, mfa);
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

    // Resolve the account IDs belonging to THIS item from the association
    // persisted at sync time (bankConnection.accountIds). A userId-wide
    // lookup would wipe every connection's data when one connection is
    // removed. Fallback to a remote listing only when no sync ever ran
    // (the item may still exist on Pluggy).
    let accountIds = conn.accountIds || [];
    if (accountIds.length === 0) {
      const creds = await credsForUser(user.id);
      if (creds) {
        try {
          const accounts = await createPluggyClient(creds).listAccounts(itemId);
          accountIds = accounts.map((a) => a.id);
        } catch {
          accountIds = [];
        }
      }
    }

    const creds = await credsForUser(user.id);
    if (creds) {
      const client = createPluggyClient(creds);
      try {
        await client.deleteItem(itemId);
      } catch (err) {
        // Item may already be gone on Pluggy's side — continue cleanup
        console.warn("[pluggy] delete item remoto falhou:", (err as Error).message);
      }
    }

    // Remove imported data (transactions + faturas from this item's accounts)
    await prisma.$transaction([
      prisma.transaction.deleteMany({
        where: { userId: user.id, pluggyAccountId: { in: accountIds } },
      }),
      prisma.bill.deleteMany({
        where: { userId: user.id, pluggyAccountId: { in: accountIds } },
      }),
      prisma.bankConnection.delete({ where: { id: conn.id } }),
    ]);

    res.json({ ok: true });
  } catch (err) {
    console.error("[pluggy] delete item:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Erro interno" });
  }
});

// POST /api/pluggy/webhooks/register — register user webhooks pointing to our endpoint
router.post("/webhooks/register", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const creds = await credsForUser(user.id);
    if (!creds) {
      res.status(400).json({ error: "Configure suas credenciais Pluggy nas Configurações primeiro" });
      return;
    }
    const webhookUrl = pluggyWebhookUrl();
    if (!webhookUrl) {
      res.status(500).json({ error: "PLUGGY_WEBHOOK_URL não configurado no servidor" });
      return;
    }
    const client = createPluggyClient(creds);
    // Secret DEDICADO e obrigatório para a integração Pluggy (sem fallback —
    // validação no startup do servidor): uma divulgação aqui não forja o
    // webhook do Evolution.
    const secret = process.env.PLUGGY_WEBHOOK_SECRET;
    const headers = secret ? { "x-webhook-secret": secret } : undefined;

    const results: Array<{ event: string; id?: string; error?: string }> = [];
    for (const event of WEBHOOK_EVENTS) {
      try {
        const created = await client.createWebhook(event, webhookUrl, headers) as { id: string };
        results.push({ event, id: created.id });
      } catch (err) {
        // Already registered (duplicate) — try to find the existing one
        results.push({ event, error: (err as Error).message });
      }
    }
    res.json({ ok: true, results });
  } catch (err) {
    console.error("[pluggy] register webhooks:", err);
    res.status(500).json({ error: err instanceof PluggyError ? err.message : "Erro interno" });
  }
});

// ---------------------------------------------------------------
// Webhook (public, validated via header X-Webhook-Secret)
// ---------------------------------------------------------------
router.post("/webhook", async (req: Request, res: Response) => {
  const expected = process.env.PLUGGY_WEBHOOK_SECRET;
  // Fail fast when the secret is not configured (startup also refuses to
  // boot without it): skipping the check would accept unauthenticated
  // webhook requests and let anyone trigger syncs.
  if (!expected) {
    console.error("[pluggy-webhook] FATAL: PLUGGY_WEBHOOK_SECRET not configured");
    res.status(500).json({ error: "Server misconfiguration" });
    return;
  }
  const received = (req.headers["x-webhook-secret"] as string) || "";
  if (!timingSafeEqualStr(received, expected)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const body = (req.body || {}) as Record<string, unknown>;
  console.log("[pluggy-webhook] evento:", body.event || body.eventName, "item:", body.itemId);

  try {
    const summary = await handlePluggyWebhook(body);
    if (summary) console.log("[pluggy-webhook]", summary);
    res.sendStatus(200);
  } catch (err) {
    console.error("[pluggy-webhook] erro:", err);
    res.sendStatus(200); // always ack to avoid Pluggy retry storms
  }
});

/** Constant-time string comparison (no length short-circuit). */
function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export default router;
