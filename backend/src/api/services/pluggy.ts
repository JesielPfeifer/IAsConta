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
 * Item = one bank connection. Products: accounts, transactions, credit card bills (faturas).
 */
import crypto from "crypto";

const BASE_URL = "https://api.pluggy.ai";

const CLIENT_ID = process.env.PLUGGY_CLIENT_ID as string;
const CLIENT_SECRET = process.env.PLUGGY_CLIENT_SECRET as string;

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
// API Key cache (expires after 2h per docs)
// ---------------------------------------------------------------
let cachedApiKey: string | null = null;
let apiKeyExpiresAt = 0;

export function isPluggyConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

export function getPluggyClientId(): string {
  return CLIENT_ID;
}

export async function getApiKey(force = false): Promise<string> {
  if (!isPluggyConfigured()) {
    throw new PluggyError("Pluggy não configurado (PLUGGY_CLIENT_ID/SECRET ausentes)", 500);
  }
  const now = Date.now();
  if (!force && cachedApiKey && now < apiKeyExpiresAt) {
    return cachedApiKey;
  }

  const res = await fetch(`${BASE_URL}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
  });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new PluggyError(
      body?.message || "Falha ao autenticar na Pluggy",
      res.status,
      body?.codeDescription
    );
  }

  cachedApiKey = body.apiKey as string;
  // Renew 5 minutes before the 2h expiry
  apiKeyExpiresAt = now + (2 * 60 - 5) * 60 * 1000;
  return cachedApiKey;
}

async function api<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  const apiKey = await getApiKey();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
      ...(options.headers || {}),
    },
  });

  // Token may have expired mid-flight -> retry once with a forced refresh
  if (res.status === 401 && retry) {
    await getApiKey(true);
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

// ---------------------------------------------------------------
// Connect Token (for the Connect Widget — frontend)
// ---------------------------------------------------------------
export interface ConnectTokenOptions {
  clientUserId?: string;
  webhookUrl?: string;
  itemId?: string; // when updating an existing item
  avoidDuplicates?: boolean;
}

export async function createConnectToken(options: ConnectTokenOptions = {}): Promise<string> {
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
}

// ---------------------------------------------------------------
// Connectors (financial institutions)
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

export async function listConnectors(search?: string, sandbox = false): Promise<PluggyConnector[]> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (sandbox) params.set("sandbox", "true");
  const qs = params.toString();
  const body = await api<{ results: PluggyConnector[] }>(
    `/connectors${qs ? `?${qs}` : ""}`
  );
  return body.results || [];
}

// ---------------------------------------------------------------
// Items (bank connections)
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
}

export async function getItem(itemId: string): Promise<PluggyItem> {
  return api<PluggyItem>(`/items/${itemId}`);
}

export async function updateItem(itemId: string): Promise<PluggyItem> {
  return api<PluggyItem>(`/items/${itemId}`, { method: "POST" });
}

export interface CreateItemParams {
  connectorId: number;
  credentials: Record<string, string>;
  webhookUrl?: string;
  clientUserId?: string;
  products?: string[];
}

export async function createItem(params: CreateItemParams): Promise<PluggyItem> {
  const payload: Record<string, unknown> = {
    connectorId: params.connectorId,
    parameters: params.credentials,
  };
  if (params.webhookUrl) payload.webhookUrl = params.webhookUrl;
  if (params.clientUserId) payload.clientUserId = params.clientUserId;
  if (params.products) payload.products = params.products;
  return api<PluggyItem>("/items", { method: "POST", body: JSON.stringify(payload) });
}

export async function deleteItem(itemId: string): Promise<void> {
  await api(`/items/${itemId}`, { method: "DELETE" });
}

export async function sendItemMFA(itemId: string, mfa: string): Promise<PluggyItem> {
  return api<PluggyItem>(`/items/${itemId}/mfa`, {
    method: "POST",
    body: JSON.stringify({ mfa }),
  });
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

export async function listAccounts(itemId: string): Promise<PluggyAccount[]> {
  const body = await api<{ results: PluggyAccount[] }>(`/accounts?itemId=${itemId}`);
  return body.results || [];
}

// ---------------------------------------------------------------
// Transactions (v2 cursor-based)
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

export async function listTransactions(
  accountId: string,
  dateFrom?: string,
  dateTo?: string
): Promise<PluggyTransaction[]> {
  const all: PluggyTransaction[] = [];
  let after: string | null = null;
  const pageSize = 500;

  do {
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

export async function listBills(accountId: string): Promise<PluggyBill[]> {
  const body = await api<{ results: PluggyBill[] }>(`/bills?accountId=${accountId}`);
  return body.results || [];
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------
/** Deterministic group id for installments of the same purchase (Pluggy has no group id). */
export function installmentGroupKey(tx: PluggyTransaction): string {
  const meta = tx.creditCardMetadata || {};
  const total = meta.totalInstallments || 1;
  const base =
    `${tx.description}|${Math.abs(meta.totalAmount ?? tx.amount)}|${total}`;
  return `pluggy-${crypto.createHash("md5").update(base).digest("hex").slice(0, 16)}`;
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
