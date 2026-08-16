/**
 * Pluggy sync engine: pulls accounts, transactions and credit card faturas
 * from Pluggy into the IAsConta data model.
 *
 * Mapping rules (validated against the current app behavior):
 *  - Bank account DEBIT  -> Transaction EXPENSE
 *  - Bank account CREDIT -> Transaction INCOME
 *  - Credit card purchase -> Transaction EXPENSE with isCreditCard=true,
 *    paymentMethod = bank name, and installments mapped from creditCardMetadata.
 *    amount stores the TOTAL purchase value (app convention: monthly parcel =
 *    amount / totalInstallments).
 *  - Credit card bill (fatura) -> Bill row (source PLUGGY, externalId = bill id),
 *    isPaid=true when the bill's payments cover its totalAmount.
 *  - Credit card transactions linked to a bill get billId set -> the dashboard
 *    summary excludes them (the Bill row counts the expense once). Transactions
 *    with no bill yet (PENDING, open bill) count as regular expenses.
 *  - Dedupe by externalId (Pluggy transaction/bill id).
 */
import { PrismaClient } from "@prisma/client";
import { autoCategorize } from "../../parsers/categories.js";
import {
  createPluggyClient,
  resolveCredentials,
  isCreditCardAccount,
  isBankAccount,
  installmentGroupKey,
  pluggyCategoryToLocal,
  type PluggyCredentials,
  type PluggyAccount,
  type PluggyTransaction,
  type PluggyBill,
} from "./pluggy.js";

const prisma = new PrismaClient();

/** Resolves the Pluggy credentials for a user (own settings -> global env). */
export async function resolveCredentialsForUser(
  userId: string
): Promise<PluggyCredentials | null> {
  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  const userCreds =
    settings?.pluggyClientId && settings?.pluggyClientSecret
      ? { clientId: settings.pluggyClientId, clientSecret: settings.pluggyClientSecret }
      : null;
  return resolveCredentials(userCreds);
}

export interface SyncResult {
  itemId: string;
  status: string;
  accounts: number;
  transactionsCreated: number;
  transactionsUpdated: number;
  billsCreated: number;
  billsUpdated: number;
  errors: string[];
}

/** Bank aliases seen in Meu Pluggy account names → clean display name. */
const BANK_ALIASES: Array<[RegExp, string]> = [
  [/NU\s*PAGAMENTOS|NUBANK|NU\b/i, "NUBANK"],
  [/CAIXA\s*ECONOMICA|CAIXA\b/i, "CAIXA"],
  [/BANCO\s*DO\s*BRASIL|\bBB\b/i, "BANCO DO BRASIL"],
  [/ITAU/i, "ITAU"],
  [/BRADESCO/i, "BRADESCO"],
  [/SANTANDER/i, "SANTANDER"],
  [/INTER\b|BANCO\s*INTER/i, "INTER"],
  [/SICREDI/i, "SICREDI"],
  [/SICOOB/i, "SICOOB"],
  [/MERCADO\s*PAGO|MERCADOPAGO/i, "MERCADO PAGO"],
  [/PAGSEGURO|PAGBANK/i, "PAGBANK"],
  [/C6\s*BANK|C6\b/i, "C6"],
  [/NEON/i, "NEON"],
  [/SOFISA/i, "SOFISA"],
  [/ORIGINAL/i, "ORIGINAL"],
  [/BANCO\s*PAN|\bPAN\b/i, "PAN"],
  [/BANRISUL/i, "BANRISUL"],
  [/BRADESCO/i, "BRADESCO"],
];

function bankNameFromAccountName(raw: string): string | null {
  if (!raw) return null;
  for (const [re, name] of BANK_ALIASES) {
    if (re.test(raw)) return name;
  }
  return null;
}

function normalizePaymentMethod(account: PluggyAccount, connectorName?: string | null): string {
  // Meu Pluggy proxy: account.name carries the REAL bank name (e.g. "CAIXA",
  // "CAIXA VISA INFINITE CREDITO", "NUBANK"). Strip card product suffixes so
  // all purchases of the same bank share one payment method (e.g. "CAIXA").
  if (connectorName && connectorName.toLowerCase().includes("meupluggy")) {
    const raw = account.name || "";

    // 1) Known bank alias (handles "Nu Pagamentos S.A. - Instituição de
    //    Pagamento" → NUBANK, "platinum" → NUBANK via account-level fallback
    //    is done by the caller; here aliases win for the raw name).
    const alias = bankNameFromAccountName(raw);
    if (alias) return alias.replace(/\s+/g, "_");

    const cleaned = raw
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/\b(VISA|MASTERCARD|MASTER|ELO|HIPERCARD|AMEX|AMERICAN\s*EXPRESS|CREDITO|CREDIT|CARD|INTERNACIONAL|INTERNATIONAL|INFINITE|INFINITY|BLACK|PLATINUM|GOLD|SIGNATURE|CLASSIC|UNICLASS|PERSONALITE|PERSONALIZED|NACIONAL|NACIONAL\s*INTERNACIONAL|ESTILO|OURO|STANDARD|BASIC|BASICO)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const name = cleaned.replace(/\s+/g, "_");
    if (name) return name;
    return "CARTAO";
  }
  if (connectorName) {
    const cleaned = connectorName
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\b(banco|bank|sa|s\/a|ltda|instituto|instituicao|pluggy|do|da|de)\b/gi, "")
      .trim()
      .replace(/\s+/g, "_");
    const name = cleaned.toUpperCase();
    if (name) return name;
    // Fallback: use the full connector name normalized (e.g. "PLUGGY_BANK")
    const full = connectorName
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/\s+/g, "_");
    if (full) return full;
  }
  return "CARTAO";
}

/** True when a bank-account transaction looks like a payment (boleto, PIX,
 * transfer, invoice settlement...). Generic — the amount check against the
 * user's faturas happens separately, so no bank/name is hardcoded. */
function isCreditCardBillPayment(description: string): boolean {
  const d = description
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return (
    /\b(pag|pgto|pagto|pagamento|pix|transfer|boleto|fatura|invoice)\b/.test(d) ||
    /(fatura|invoice).*(cartao|card|credito|visa|master|elo)/.test(d) ||
    /(cartao|card).*(fatura|invoice)/.test(d)
  );
}

/**
 * Bank-account transaction that pays a credit card fatura ("PAGTO.BOLETO",
 * "Pagamento efetuado|CARTOES...", "Pagamento de fatura"...). Detected by a
 * generic payment keyword + the amount matching one of the user's faturas.
 * Without the amount check, any boleto/PIX payment would be wrongly excluded.
 */
async function isCreditCardBillPaymentByAmount(
  tx: PluggyTransaction,
  bills: Array<{ amount: number }>,
  opts: { allowCredit?: boolean } = {}
): Promise<boolean> {
  // On bank accounts a fatura payment is a DEBIT (money out). On the credit
  // card account the same payment arrives as CREDIT (the card is credited
  // when the fatura is paid) — allowCredit covers that case. An INCOME row
  // on a bank account ("PIX RECEBIDO") is never a bill payment.
  if (tx.type !== "DEBIT" && !(opts.allowCredit && tx.type === "CREDIT")) {
    return false;
  }
  if (!isCreditCardBillPayment(tx.description)) return false;
  const amount = Math.abs(tx.amount);
  // Matches a fatura value within R$ 0,01 (payment = fatura exact value).
  return bills.some((b) => Math.abs(b.amount - amount) < 0.01);
}

/**
 * Credit card "previous invoice balance" marker row (feeTypeAdditionalInfo
 * "SALDO INICIAL", description like "TOTAL DA FATURA ANTERIOR"). Not a
 * purchase — importing it would inflate the month totals.
 */
function isInvoiceBalanceMarker(tx: PluggyTransaction): boolean {
  const meta = tx.creditCardMetadata || {};
  if (typeof meta.feeTypeAdditionalInfo === "string" &&
      meta.feeTypeAdditionalInfo.toUpperCase().includes("SALDO INICIAL")) {
    return true;
  }
  const d = (tx.description || "").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return d.includes("total da fatura");
}

function getOrCreateCategoryName(
  pluggyCategory: string | null | undefined,
  description: string
): string | null {
  // 1) Try the app's local keyword categorizer (PT-BR categories)
  const local = autoCategorize(description);
  if (local) return local;
  // 2) Try mapping the Pluggy category (EN names) to local categories
  const mapped = pluggyCategoryToLocal(pluggyCategory);
  if (mapped) return mapped;
  return null;
}

export async function syncItem(itemId: string, userId: string): Promise<SyncResult> {
  const result: SyncResult = {
    itemId,
    status: "UNKNOWN",
    accounts: 0,
    transactionsCreated: 0,
    transactionsUpdated: 0,
    billsCreated: 0,
    billsUpdated: 0,
    errors: [],
  };

  const connection = await prisma.bankConnection.findFirst({
    where: { itemId, userId },
  });

  if (!connection) {
    throw new Error(`Conexão Pluggy não encontrada para item ${itemId}`);
  }

  const creds = await resolveCredentialsForUser(userId);
  if (!creds) {
    const err = "Pluggy não configurado para este usuário";
    result.errors.push(err);
    await prisma.bankConnection.update({
      where: { id: connection.id },
      data: { status: "ERROR", errorMessage: err, lastSyncAt: new Date() },
    });
    return result;
  }
  const client = createPluggyClient(creds);

  // 1. Item status from Pluggy
  let pluggyItem;
  try {
    pluggyItem = await client.getItem(itemId);
    result.status = pluggyItem.status;
  } catch (err) {
    result.errors.push(`Falha ao buscar item: ${(err as Error).message}`);
    await prisma.bankConnection.update({
      where: { id: connection.id },
      data: { status: "ERROR", errorMessage: (err as Error).message, lastSyncAt: new Date() },
    });
    return result;
  }

  if (pluggyItem.status !== "UPDATED" && pluggyItem.status !== "PARTIAL_SUCCESS") {
    const errMsg = pluggyItem.error?.message || pluggyItem.statusDetail || pluggyItem.status;
    result.errors.push(`Item não sincronizado: ${errMsg}`);
    await prisma.bankConnection.update({
      where: { id: connection.id },
      data: {
        status: pluggyItem.status,
        errorMessage: errMsg,
        lastSyncAt: new Date(),
      },
    });
    return result;
  }

  // 2. Accounts
  const accounts = await client.listAccounts(itemId);
  result.accounts = accounts.length;

  // Bank of the item: from the first BANK account with a recognizable name
  // (e.g. "Nu Pagamentos S.A." → NUBANK). Used as fallback for credit cards
  // whose account.name is generic ("platinum", "gold"...).
  const itemBankName =
    accounts
      .map((a) => bankNameFromAccountName(a.name || ""))
      .find((n) => !!n) || null;

  for (const account of accounts) {
    try {
      if (isBankAccount(account)) {
        await syncBankAccount(client, account, userId, result, pluggyItem.connector?.name);
      } else if (isCreditCardAccount(account)) {
        await syncCreditCard(client, account, userId, result, pluggyItem.connector?.name, itemBankName);
      }
      // Other account types (investment, loan) are ignored for now
    } catch (err) {
      result.errors.push(`Conta ${account.id} (${account.subtype}): ${(err as Error).message}`);
    }
  }

  await prisma.bankConnection.update({
    where: { id: connection.id },
    data: {
      status: pluggyItem.status,
      errorMessage: null,
      lastSyncAt: new Date(),
      connectorName: pluggyItem.connector?.name || connection.connectorName,
    },
  });

  return result;
}

// ---------------------------------------------------------------
// Bank accounts (checking/savings) -> plain transactions
// ---------------------------------------------------------------
async function syncBankAccount(
  client: ReturnType<typeof createPluggyClient>,
  account: PluggyAccount,
  userId: string,
  result: SyncResult,
  connectorName?: string
): Promise<void> {
  const transactions = await client.listTransactions(account.id);
  const paymentMethod = normalizePaymentMethod(account, connectorName);

  // Faturas do usuário — usadas para detectar pagamento de fatura via boleto
  // (PAGTO.BOLETO com valor igual ao da fatura) e não duplicar o gasto.
  const userBills = await prisma.bill.findMany({
    where: { userId, source: "PLUGGY" },
    select: { amount: true },
  });

  for (const tx of transactions) {
    // PENDING purchases (open credit-card cycle / unconfirmed debit) are
    // imported too — dedupe by externalId prevents duplicates once POSTED.

    // Invoice-balance marker ("TOTAL DA FATURA ANTERIOR") — not a real
    // transaction; importing it would inflate month totals.
    if (isInvoiceBalanceMarker(tx)) continue;

    // Skip credit card bill payments: the fatura is already represented as a
    // Bill row (source PLUGGY) and counts the expense once. Importing the
    // payment here too would double-count it. Legacy rows imported before
    // this filter existed are deleted.
    if (await isCreditCardBillPaymentByAmount(tx, userBills)) {
      const legacy = await prisma.transaction.findUnique({
        where: { userId_externalId: { userId, externalId: tx.id } },
      });
      if (legacy) {
        await prisma.transaction.delete({ where: { id: legacy.id } });
        console.log(`[pluggy-sync] removido pagamento de fatura legado: ${tx.description} (${tx.id})`);
      }
      continue;
    }

    const existing = await prisma.transaction.findUnique({
      where: { userId_externalId: { userId, externalId: tx.id } },
    });

    const type: "EXPENSE" | "INCOME" = tx.type === "DEBIT" ? "EXPENSE" : "INCOME";
    const categoryName = getOrCreateCategoryName(tx.category, tx.description);
    const categoryId = categoryName
      ? await findOrCreateCategory(categoryName, userId)
      : null;

    const data = {
      amount: Math.abs(tx.amount),
      type,
      description: tx.description,
      date: new Date(tx.date),
      source: "PLUGGY" as const,
      paymentMethod,
      isFixed: false,
      categoryId,
      pluggyAccountId: account.id,
      externalId: tx.id,
      userId,
    };

    if (existing) {
      // Update mutable fields (description/amount may change on re-sync)
      const changed =
        existing.amount !== data.amount ||
        existing.description !== data.description ||
        existing.date.getTime() !== data.date.getTime() ||
        existing.type !== type;
      if (changed) {
        await prisma.transaction.update({
          where: { id: existing.id },
          data: { amount: data.amount, description: data.description, date: data.date, type },
        });
        result.transactionsUpdated++;
      }
      continue;
    }

    await prisma.transaction.create({ data });
    result.transactionsCreated++;
  }
}

// ---------------------------------------------------------------
// Credit card accounts -> faturas (Bills) + purchases (Transactions)
// ---------------------------------------------------------------
async function syncCreditCard(
  client: ReturnType<typeof createPluggyClient>,
  account: PluggyAccount,
  userId: string,
  result: SyncResult,
  connectorName?: string,
  itemBankName?: string | null
): Promise<void> {
  // --- Faturas (bills) ---
  const bills = await client.listBills(account.id);
  for (const bill of bills) {
    await upsertBill(bill, account, userId, result);
  }

  // --- Transactions (purchases) ---
  const transactions = await client.listTransactions(account.id);
  let paymentMethod = normalizePaymentMethod(account, connectorName);
  // Card account name is generic ("platinum", "gold") — use the item's bank
  // (from its checking account) so the payment method reads "NUBANK".
  if (paymentMethod === "CARTAO" && itemBankName) {
    paymentMethod = itemBankName;
  }

  // Faturas do usuário — pagamento da fatura via boleto aparece TAMBÉM na
  // conta do cartão ("PAGTO.BOLETO", "PGTO.BOLETO REGISTRADO" com valor da
  // fatura). Ignorar para não duplicar o gasto (fatura já conta 1x).
  const userBills = await prisma.bill.findMany({
    where: { userId, source: "PLUGGY" },
    select: { id: true, externalId: true, amount: true },
  });
  // Pluggy transaction meta.billId is the PLUGGY bill id; the local Bill row
  // has its own uuid with externalId = pluggy id. Map one to the other so
  // transactions are actually linked to the local fatura (prevents the
  // fatura + its purchases from double-counting in summaries).
  const billByExternalId = new Map(
    userBills.filter((b) => b.externalId).map((b) => [b.externalId as string, b.id])
  );

  for (const tx of transactions) {
    // PENDING purchases are imported too (dedupe by externalId prevents
    // duplicates once POSTED); only the invoice-balance marker is skipped.
    if (isInvoiceBalanceMarker(tx)) continue;

    // Bill payment rows on the credit card account (PAGTO.BOLETO with the
    // fatura value) — the fatura already counts the expense once. Rows
    // imported before this filter existed are deleted (legacy cleanup).
    // On the card account the payment arrives as CREDIT (card credited when
    // the fatura is paid), hence allowCredit.
    if (await isCreditCardBillPaymentByAmount(tx, userBills, { allowCredit: true })) {
      const legacy = await prisma.transaction.findUnique({
        where: { userId_externalId: { userId, externalId: tx.id } },
      });
      if (legacy) {
        await prisma.transaction.delete({ where: { id: legacy.id } });
        console.log(`[pluggy-sync] removido pagamento de fatura legado: ${tx.description} (${tx.id})`);
      }
      continue;
    }

    const existing = await prisma.transaction.findUnique({
      where: { userId_externalId: { userId, externalId: tx.id } },
    });

    const meta = tx.creditCardMetadata || {};
    const totalInstallments = meta.totalInstallments || 1;
    const currentInstallment = meta.installmentNumber || 1;
    // App convention: amount = TOTAL purchase value; monthly parcel = amount/total
    const amount = Math.abs(meta.totalAmount ?? tx.amount);
    const categoryName = getOrCreateCategoryName(tx.category, tx.description);
    const categoryId = categoryName
      ? await findOrCreateCategory(categoryName, userId)
      : null;

    const data = {
      amount,
      type: "EXPENSE" as const,
      description: tx.description,
      date: new Date(tx.date),
      source: "PLUGGY" as const,
      paymentMethod,
      isFixed: false,
      isCreditCard: true,
      billId: meta.billId ? (billByExternalId.get(meta.billId) ?? null) : null,
      pluggyAccountId: account.id,
      totalInstallments,
      currentInstallment,
      installmentGroupId:
        totalInstallments > 1 ? installmentGroupKey(tx) : null,
      categoryId,
      externalId: tx.id,
      userId,
    };

    if (existing) {
      // Keep the user's category/person edits; update only sync-driven fields
      const changed =
        existing.amount !== data.amount ||
        existing.description !== data.description ||
        existing.date.getTime() !== data.date.getTime() ||
        existing.billId !== data.billId ||
        existing.currentInstallment !== data.currentInstallment ||
        existing.totalInstallments !== data.totalInstallments;
      if (changed) {
        await prisma.transaction.update({
          where: { id: existing.id },
          data: {
            amount: data.amount,
            description: data.description,
            date: data.date,
            billId: data.billId,
            currentInstallment: data.currentInstallment,
            totalInstallments: data.totalInstallments,
            installmentGroupId: data.installmentGroupId ?? existing.installmentGroupId,
          },
        });
        result.transactionsUpdated++;
      }
      continue;
    }

    await prisma.transaction.create({ data });
    result.transactionsCreated++;
  }
}

async function upsertBill(
  bill: PluggyBill,
  account: PluggyAccount,
  userId: string,
  result: SyncResult
): Promise<void> {
  const existing = await prisma.bill.findUnique({
    where: { userId_externalId: { userId, externalId: bill.id } },
  });

  const paymentsTotal = (bill.payments || []).reduce((s, p) => s + p.amount, 0);
  const financeTotal = (bill.financeCharges || []).reduce((s, f) => s + f.amount, 0);
  // A bill is settled when the NEXT cycle's payments cover it; Pluggy bills
  // themselves carry payments when already paid. If totalAmount <= 0 -> paid.
  const isPaid = bill.totalAmount <= 0 || paymentsTotal >= bill.totalAmount + financeTotal;

  const due = new Date(bill.dueDate);
  const cardName = account.marketingName || account.name || "Cartão de Crédito";
  const name = `Fatura ${cardName} — ${due.toLocaleDateString("pt-BR", {
    month: "short",
    year: "numeric",
  })}`;

  const data = {
    name,
    amount: Math.abs(bill.totalAmount),
    dueDate: due,
    isRecurring: false,
    isShared: false,
    isPaid,
    source: "PLUGGY" as const,
    externalId: bill.id,
    pluggyAccountId: account.id,
    userId,
  };

  if (existing) {
    const changed =
      existing.amount !== data.amount ||
      existing.dueDate.getTime() !== data.dueDate.getTime() ||
      existing.isPaid !== data.isPaid ||
      existing.name !== data.name;
    if (changed) {
      await prisma.bill.update({
        where: { id: existing.id },
        data: { amount: data.amount, dueDate: data.dueDate, isPaid: data.isPaid, name: data.name },
      });
      result.billsUpdated++;
    }
    return;
  }

  await prisma.bill.create({ data });
  result.billsCreated++;
}

// ---------------------------------------------------------------
// Categories
// ---------------------------------------------------------------
async function findOrCreateCategory(name: string, userId: string): Promise<string | null> {
  try {
    const existing = await prisma.category.findFirst({
      where: { name, OR: [{ userId }, { isDefault: true }] },
    });
    if (existing) return existing.id;
    const created = await prisma.category.create({
      data: { name, userId, isDefault: false },
    });
    return created.id;
  } catch {
    // Race: another sync may have created it
    const again = await prisma.category.findFirst({
      where: { name, OR: [{ userId }, { isDefault: true }] },
    });
    return again?.id ?? null;
  }
}

/** Syncs ALL connections of a user. Returns per-item results. */
export async function syncAllForUser(userId: string): Promise<SyncResult[]> {
  const connections = await prisma.bankConnection.findMany({
    where: { userId, itemId: { not: null } },
  });
  const results: SyncResult[] = [];
  for (const conn of connections) {
    try {
      results.push(await syncItem(conn.itemId as string, userId));
    } catch (err) {
      results.push({
        itemId: conn.itemId as string,
        status: "ERROR",
        accounts: 0,
        transactionsCreated: 0,
        transactionsUpdated: 0,
        billsCreated: 0,
        billsUpdated: 0,
        errors: [(err as Error).message],
      });
    }
  }
  return results;
}

/** Process a Pluggy webhook event: trigger a re-sync of the affected item. */
export async function handlePluggyWebhook(body: Record<string, unknown>): Promise<string | null> {
  // Pluggy sends "event" (e.g. "item/updated"); some legacy payloads used
  // "eventName". Accept both.
  const eventName = (body.event as string) || (body.eventName as string) || undefined;
  const itemId = (body.itemId as string) || (body.data as any)?.item?.id;

  if (!itemId) return null;

  // Only sync on events that bring new data
  const syncEvents = [
    "item/updated",
    "transactions/created",
    "transactions/updated",
    "transactions/deleted",
    "bill/created",
    "bill/updated",
  ];
  if (eventName && !syncEvents.includes(eventName)) return null;

  const connection = await prisma.bankConnection.findFirst({ where: { itemId } });
  if (!connection) return null;

  try {
    const result = await syncItem(itemId, connection.userId);
    return `${eventName || "webhook"}: ${result.transactionsCreated} criadas, ${result.transactionsUpdated} atualizadas, ${result.billsCreated} faturas criadas`;
  } catch (err) {
    console.error(`[pluggy-webhook] sync falhou para item ${itemId}:`, err);
    return null;
  }
}
