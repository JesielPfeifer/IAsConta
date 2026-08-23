/**
 * Pluggy API client (server-side).
 *
 * Docs reviewed: https://docs.pluggy.ai/reference/items and llms.txt index.
 *
 * Auth flow:
 *   1. POST /auth with clientId+clientSecret -> apiKey (expires in 2h). Cache it.
 *   2. POST /connect_token -> accessToken (30min, Connect Widget only — cannot read product data).
 *   3. All data endpoints use X-API-KEY header with the apiKey.
 *
 * Multi-user: each IAsConta user may configure their OWN Pluggy credentials
 * (clientId/clientSecret from dashboard.pluggy.ai) in the Settings page.
 * `createPluggyClient()` returns an isolated client with its own API key cache,
 * so one server instance can serve many Pluggy accounts. The module-level
 * helpers (getPluggyClient) fall back to the global env credentials.
 *
 * Item = one bank connection. Products: accounts, transactions, credit card bills (faturas).
 */
import crypto from "crypto";

const BASE_URL = "https://api.pluggy.ai";

export interface PluggyCredentials {
  clientId: string;
  clientSecret: string;
}

export class PluggyError extends Error {
  code: number;
  codeDescription?: string;
  constructor(message: string, code: number, codeDescription?: string) {
    super(message);
    this.code = code;
    this.codeDescription = codeDescription;
  }
}

// ---------------------------------------------------------------
// API Key cache per credential pair (expires after 2h per docs)
// ---------------------------------------------------------------
const apiKeyCache = new Map<string, { apiKey: string; expiresAt: number }>();

function credsKey(creds: PluggyCredentials): string {
  return `${creds.clientId}:${creds.clientSecret}`;
}

export function isPluggyConfigured(creds?: PluggyCredentials | null): boolean {
  const c = creds || globalCredentials();
  return Boolean(c?.clientId && c?.clientSecret);
}

function globalCredentials(): PluggyCredentials | null {
  const clientId = process.env.PLUGGY_CLIENT_ID as string;
  const clientSecret = process.env.PLUGGY_CLIENT_SECRET as string;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Returns the user's credentials when configured, otherwise the global env ones. */
export function resolveCredentials(userCreds?: PluggyCredentials | null): PluggyCredentials | null {
  if (userCreds?.clientId && userCreds?.clientSecret) return userCreds;
  return globalCredentials();
}

export async function getApiKey(creds: PluggyCredentials, force = false): Promise<string> {
  const key = credsKey(creds);
  const now = Date.now();
  const cached = apiKeyCache.get(key);
  if (!force && cached && now < cached.expiresAt) {
    return cached.apiKey;
  }

  const res = await fetch(`${BASE_URL}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: creds.clientId, clientSecret: creds.clientSecret }),
    // Never hang on a stalled Pluggy auth — fail fast and let the caller retry
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new PluggyError(
      body?.message || "Falha ao autenticar na Pluggy",
      res.status,
      body?.codeDescription
    );
  }

  // Renew 5 minutes before the 2h expiry
  apiKeyCache.set(key, { apiKey: body.apiKey, expiresAt: now + (2 * 60 - 5) * 60 * 1000 });
  return body.apiKey;
}

// ---------------------------------------------------------------
// Client factory — every function bound to a specific credential pair
// ---------------------------------------------------------------
export function createPluggyClient(creds: PluggyCredentials) {
  async function api<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
    const apiKey = await getApiKey(creds);
    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      // Bound every request — a stalled Pluggy endpoint must not block syncs forever
      signal: options.signal || AbortSignal.timeout(20_000),
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
        ...(options.headers || {}),
      },
    });

    // Token may have expired mid-flight -> retry once with a forced refresh
    if (res.status === 401 && retry) {
      await getApiKey(creds, true);
      return api<T>(path, options, false);
    }

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new PluggyError(
        body?.message || `Pluggy API error ${res.status}`,
        res.status,
        body?.codeDescription
      );
    }
    return body as T;
  }

  return {
    // --- Connect Token (for the Connect Widget — frontend) ---
    async createConnectToken(options: ConnectTokenOptions = {}): Promise<string> {
      const payload: Record<string, unknown> = {};
      if (options.itemId) payload.itemId = options.itemId;
      const opts: Record<string, unknown> = {};
      if (options.clientUserId) opts.clientUserId = options.clientUserId;
      if (options.webhookUrl) opts.webhookUrl = options.webhookUrl;
      if (options.avoidDuplicates) opts.avoidDuplicates = true;
      if (Object.keys(opts).length > 0) payload.options = opts;

      const body = await api<{ accessToken: string }>("/connect_token", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return body.accessToken;
    },

    // --- Connectors (financial institutions) ---
    async listConnectors(search?: string, sandbox = false): Promise<PluggyConnector[]> {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (sandbox) params.set("sandbox", "true");
      const qs = params.toString();
      const body = await api<{ results: PluggyConnector[] }>(
        `/connectors${qs ? `?${qs}` : ""}`
      );
      return body.results || [];
    },

    // --- Items (bank connections) ---
    getItem: (itemId: string) => api<PluggyItem>(`/items/${itemId}`),
    updateItem: (itemId: string) => api<PluggyItem>(`/items/${itemId}`, { method: "PATCH" }),

    async createItem(params: CreateItemParams): Promise<PluggyItem> {
      const payload: Record<string, unknown> = {
        connectorId: params.connectorId,
        parameters: params.credentials,
      };
      if (params.webhookUrl) payload.webhookUrl = params.webhookUrl;
      if (params.clientUserId) payload.clientUserId = params.clientUserId;
      if (params.products) payload.products = params.products;
      return api<PluggyItem>("/items", { method: "POST", body: JSON.stringify(payload) });
    },

    deleteItem: (itemId: string) => api<void>(`/items/${itemId}`, { method: "DELETE" }),
    sendItemMFA: (itemId: string, mfa: string) =>
      api<PluggyItem>(`/items/${itemId}/mfa`, {
        method: "POST",
        body: JSON.stringify({ mfa }),
      }),

    // --- Accounts ---
    listAccounts: (itemId: string) =>
      api<{ results: PluggyAccount[] }>(`/accounts?itemId=${itemId}`).then((b) => b.results || []),

    // --- Transactions (v2 cursor-based) ---
    async listTransactions(
      accountId: string,
      dateFrom?: string,
      dateTo?: string
    ): Promise<PluggyTransaction[]> {
      const all: PluggyTransaction[] = [];
      let after: string | null = null;
      // Fail explicitly instead of looping forever if Pluggy echoes a cursor
      const seenCursors = new Set<string>();
      const MAX_PAGES = 100;

      do {
        if (after && seenCursors.has(after)) {
          throw new PluggyError(
            `Cursor cycle detectado ao paginar transações (cursor repetido: ${after})`,
            500
          );
        }
        if (after) seenCursors.add(after);
        if (seenCursors.size > MAX_PAGES) {
          throw new PluggyError(
            `Paginação excedeu ${MAX_PAGES} páginas — abortando para evitar loop`,
            500
          );
        }

        const params = new URLSearchParams({ accountId });
        if (dateFrom) params.set("dateFrom", dateFrom);
        if (dateTo) params.set("dateTo", dateTo);
        if (after) params.set("after", after);

        const body = await api<{ results: PluggyTransaction[]; next: string | null }>(
          `/v2/transactions?${params.toString()}`
        );
        all.push(...(body.results || []));

        // 'next' is a ready-to-use query string; extract the 'after' param from it
        after = null;
        if (body.next) {
          const nextParams = new URLSearchParams(body.next.replace(/^\?/, ""));
          after = nextParams.get("after");
        }
      } while (after);

      return all;
    },

    // --- Credit card bills (faturas) ---
    listBills: (accountId: string) =>
      api<{ results: PluggyBill[] }>(`/bills?accountId=${accountId}`).then((b) => b.results || []),

    // --- Webhooks ---
    async createWebhook(event: string, url: string, headers?: Record<string, string>): Promise<unknown> {
      const payload: Record<string, unknown> = { event, url };
      if (headers && Object.keys(headers).length > 0) payload.headers = headers;
      return api("/webhooks", { method: "POST", body: JSON.stringify(payload) });
    },

    async listWebhooks(): Promise<Array<{ id: string; event: string; url: string; disabledAt?: string | null }>> {
      const body = await api<{ results: Array<{ id: string; event: string; url: string; disabledAt?: string | null }> }>("/webhooks");
      return body.results || [];
    },

    async deleteWebhook(webhookId: string): Promise<void> {
      await api(`/webhooks/${webhookId}`, { method: "DELETE" });
    },
  };
}

export type PluggyClient = ReturnType<typeof createPluggyClient>;

// ---------------------------------------------------------------
// Module-level helpers (global env credentials)
// ---------------------------------------------------------------
const globalClient: PluggyClient | null = globalCredentials()
  ? createPluggyClient(globalCredentials() as PluggyCredentials)
  : null;

export function getGlobalPluggyClient(): PluggyClient | null {
  return globalClient;
}

// ---------------------------------------------------------------
// Connect Token options
// ---------------------------------------------------------------
export interface ConnectTokenOptions {
  clientUserId?: string;
  webhookUrl?: string;
  itemId?: string; // when updating an existing item
  avoidDuplicates?: boolean;
}

// ---------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------
export interface PluggyConnector {
  id: number;
  name: string;
  institutionUrl?: string;
  country: string;
  imageUrl?: string;
  isSandbox?: boolean;
  isOpenFinance?: boolean;
  products?: string[];
}

// ---------------------------------------------------------------
// Items
// ---------------------------------------------------------------
export interface PluggyItem {
  id: string;
  connector: { id: number; name: string };
  status: string;
  statusDetail?: string;
  createdAt: string;
  updatedAt: string;
  lastSyncAt?: string;
  nextAutoSyncAt?: string | null;
  error?: { code?: string; message?: string } | null;
  products?: string[];
  executionStatus?: string | null;
  /** External reference to the end-user that owns this item (set when the
   *  item was created via connect token or createItem with clientUserId).
   *  Pluggy does NOT enforce this — WE must validate it before claiming. */
  clientUserId?: string | null;
}

export interface CreateItemParams {
  connectorId: number;
  credentials: Record<string, string>;
  webhookUrl?: string;
  clientUserId?: string;
  products?: string[];
}

// ---------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------
export interface PluggyAccount {
  id: string;
  type: string; // BANK, CREDIT, INVESTMENT, ...
  subtype: string; // CHECKING_ACCOUNT, CREDIT_CARD, ...
  name?: string;
  marketingName?: string;
  number?: string;
  owner?: string; // Open Finance account holder (e.g. "JESIEL VIANA PFEIFER")
  balance: number;
  currencyCode: string;
  creditData?: {
    level?: string;
    brand?: string;
    balanceCloseDate?: string;
    balanceDueDate?: string;
    creditLimit?: number;
    availableCreditLimit?: number;
    minimumPayment?: number;
    status?: string;
  } | null;
  bankData?: {
    transferNumber?: string | null;
    closingBalance?: number | null;
  } | null;
}

// ---------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------
export interface PluggyCreditCardMetadata {
  installmentNumber?: number;
  totalInstallments?: number;
  totalAmount?: number;
  billId?: string | null;
  purchaseDate?: string | null;
  payeeMCC?: number | null;
  cardNumber?: string | null;
  feeType?: string | null;
  feeTypeAdditionalInfo?: string | null;
  billForecastDate?: string | null;
}

export interface PluggyTransaction {
  id: string;
  description: string;
  descriptionRaw?: string | null;
  currencyCode: string;
  amount: number; // negative = money out
  date: string;
  type: "DEBIT" | "CREDIT";
  status: "POSTED" | "PENDING";
  category?: string | null;
  categoryId?: string | null;
  accountId: string;
  creditCardMetadata?: PluggyCreditCardMetadata | null;
  paymentData?: unknown | null;
  merchant?: unknown | null;
  createdAt?: string;
  updatedAt?: string;
}

// ---------------------------------------------------------------
// Credit card bills (faturas)
// ---------------------------------------------------------------
export interface PluggyBillFinanceCharge {
  id: string;
  type: string; // IOF, LATE_PAYMENT_FEE, OTHER...
  amount: number;
  currencyCode: string;
  additionalInfo?: string | null;
}

export interface PluggyBillPayment {
  id: string;
  valueType: string; // FULL_PAYMENT, INSTALLMENT_PAYMENT, OTHER_PAYMENT
  paymentDate: string;
  paymentMode?: string | null;
  amount: number;
  currencyCode: string;
}

export interface PluggyBill {
  id: string;
  dueDate: string;
  billClosingDate?: string | null;
  totalAmount: number;
  totalAmountCurrencyCode: string;
  minimumPaymentAmount?: number;
  allowsInstallments?: boolean;
  financeCharges: PluggyBillFinanceCharge[];
  payments: PluggyBillPayment[];
}

// ---------------------------------------------------------------
// Pure helpers (no credentials needed)
// ---------------------------------------------------------------
/**
 * Deterministic group id for installments of the same purchase (Pluggy has no
 * group id). The description carries the parcel marker ("X/Y" suffix) which
 * differs per installment — strip it so all parcels of the same purchase map
 * to the same group. The account id, the purchase date and the ROUNDED parcel
 * amount are part of the key so two DIFFERENT purchases from the same store
 * (e.g. two CAMPO BOM orders in 10x on the same day) still group together,
 * while cents-level differences between parcels of the same purchase (fees)
 * still group together. SHA-256 (MD5 was flagged by static analysis; this is
 * not security-sensitive but SHA-256 silences the warning at no cost).
 */
export function installmentGroupKey(
  tx: PluggyTransaction,
  accountId?: string | null
): string {
  const meta = tx.creditCardMetadata || {};
  const total = meta.totalInstallments || 1;
  const cleanDescription = (tx.description || "")
    .replace(/\s*\d{1,3}\s*\/\s*\d{1,3}\s*$/i, "")
    .trim();
  const roundedAmount = Math.round(Math.abs(meta.totalAmount ?? tx.amount));
  const purchaseDate = meta.purchaseDate || tx.date || "";
  const base = `${cleanDescription}|${total}|${roundedAmount}|${accountId || ""}|${purchaseDate}`;
  return `pluggy-${crypto.createHash("sha256").update(base).digest("hex").slice(0, 16)}`;
}

/** Credit card account helper */
export function isCreditCardAccount(acc: PluggyAccount): boolean {
  return acc.type === "CREDIT" && acc.subtype === "CREDIT_CARD";
}

export function isBankAccount(acc: PluggyAccount): boolean {
  return acc.type === "BANK";
}

/** Maps a Pluggy category name to the app's local category via keyword matching. */
export function pluggyCategoryToLocal(pluggyCategory?: string | null): string | null {
  if (!pluggyCategory) return null;
  const c = pluggyCategory.toLowerCase();

  const map: Array<[RegExp, string]> = [
    [/salary|payroll|wage|salari/, "Salário"],
    [/restaurant|food|meal|lanchonete|ifood|supermarket|grocery|mercado|padaria/, "Alimentação"],
    [/transport|uber|taxi|fuel|gasoline|posto|gasolina|transporte/, "Transporte"],
    [/health|pharmacy|hospital|doctor|saude|farmacia|medic/, "Saúde"],
    [/subscription|streaming|netflix|spotify|assinatura/, "Assinaturas"],
    [/rent|housing|condo|aluguel|moradia|utility|internet|phone/, "Moradia"],
    [/entertainment|leisure|cinema|theater|lazer|travel|hotel|viagem/, "Lazer"],
    [/clothing|shopping|vestuario|roupa/, "Vestuário"],
    [/education|school|educacao|curso/, "Educação"],
    [/transfer|pix|ted|doc|transferencia/, "Transferências"],
    [/loan|financing|emprestimo|financiamento/, "Empréstimos"],
    [/tax|imposto|tributo|darf|iptu|iss/, "Impostos"],
    [/investment|investimento|renda|poupanca/, "Investimentos"],
    [/cash|withdrawal|saque/, "Saque"],
    [/insurance|seguro/, "Seguros"],
  ];

  for (const [re, cat] of map) {
    if (re.test(c)) return cat;
  }
  return null;
}
