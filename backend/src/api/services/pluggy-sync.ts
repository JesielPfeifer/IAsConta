import { logger } from '../../lib/logger.js';
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
  // Transações que o Pluggy ainda reporta mas que o usuário EXCLUIU na UI
  // (soft-delete isHidden=true): puladas na reimportação para respeitar a
  // exclusão. Logadas e retornadas no resultado do sync.
  skippedHidden: number;
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

/**
 * Resolve the real bank behind a Pluggy item. For MeuPluggy (Open Finance
 * proxy) items the connector name is just "MeuPluggy" — the actual institution
 * is in connector.institutionUrl (e.g. "caixa.gov.br" → "Caixa"). Falls back
 * to BANK_ALIASES against the connector name itself.
 */
function getBankName(
  connector?: { name?: string | null; institutionUrl?: string | null } | null,
  accounts?: Array<{ name?: string | null }>
): string | null {
  const url = connector?.institutionUrl || "";
  const host = url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  // Match by domain so "banco.caixa.gov.br" and "www.caixa.gov.br" both hit.
  for (const [pattern, label] of [
    ["caixa", "Caixa"],
    ["nubank", "Nubank"],
    ["bb.com.br", "Banco do Brasil"],
    ["bancodobrasil", "Banco do Brasil"],
    ["itau", "Itaú"],
    ["bradesco", "Bradesco"],
    ["santander", "Santander"],
    ["inter", "Inter"],
    ["c6bank", "C6 Bank"],
    ["banrisul", "Banrisul"],
    ["sicoob", "Sicoob"],
    ["sicredi", "Sicredi"],
    ["pan", "PAN"],
    ["original", "Original"],
    ["btg", "BTG Pactual"],
    ["will", "Will Bank"],
    ["picpay", "PicPay"],
    ["mercadopago|mercadolivre", "Mercado Pago"],
    ["neon|pagmenos", "Neon"],
    ["next|meubanco", "Next"],
  ] as Array<[string, string]>) {
    if (new RegExp(pattern, "i").test(host)) return label;
  }
  // No institutionUrl (or unrecognized host — MeuPluggy's own connector URL
  // points at meu.pluggy.ai, not the bank): derive from the item's account
  // names ("CAIXA VISA INFINITE CREDITO" → CAIXA), then the connector name.
  const fromAccounts = accounts
    ?.map((a) => bankNameFromAccountName(a.name || ""))
    .find((n) => !!n);
  return (
    fromAccounts ||
    bankNameFromAccountName(connector?.name || "")
  );
}

/**
 * Shifts a "YYYY-MM" month key by deltaMonths. Returns the key untouched when
 * it's absent/malformed or the delta is zero.
 */
export function shiftMonthKey(
  monthKey: string | null | undefined,
  deltaMonths: number
): string | null {
  if (!monthKey) return null;
  const m = /^(\d{4})-(\d{2})/.exec(monthKey);
  if (!m || deltaMonths === 0) return monthKey;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const shifted = new Date(Date.UTC(y, mo - 1 + deltaMonths, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Detects the constant offset between Pluggy's per-transaction
 * billForecastDate tag and the REAL invoice month of one card account.
 *
 * Some institutions (e.g. CAIXA via MeuPluggy) tag purchases with the month
 * BEFORE the invoice that actually charges them: a purchase made 16/07–14/08
 * that appears on the invoice due 25/08 arrives tagged "2026-07" instead of
 * "2026-08". Installment rows carry creditCardMetadata.billId, which points at
 * the Pluggy bill (= our local Bill.externalId) — comparing that bill's due
 * date month against the transaction's tag yields the offset directly.
 *
 * Returns the most frequent non-negative difference (0 = tags are already the
 * real invoice month). Ties resolve conservatively to the smaller offset so an
 * ambiguous bank keeps today's behavior instead of being shifted on a guess.
 */
async function detectForecastOffset(
  transactions: Array<{
    creditCardMetadata?: {
      billId?: string | null;
      billForecastDate?: string | null;
    } | null;
  }>,
  localBillDueByExternalId: Map<string, Date>
): Promise<number> {
  const diffCounts = new Map<number, number>();
  for (const tx of transactions) {
    const meta = tx.creditCardMetadata;
    if (!meta?.billId || !meta.billForecastDate) continue;
    const dueDate = localBillDueByExternalId.get(meta.billId);
    if (!dueDate) continue;
    const tagY = Number(meta.billForecastDate.slice(0, 4));
    const tagM = Number(meta.billForecastDate.slice(5, 7));
    const diff = (dueDate.getUTCFullYear() - tagY) * 12 + (dueDate.getUTCMonth() + 1 - tagM);
    if (diff <= 0) continue; // negative/zero diffs are never a shift candidate
    diffCounts.set(diff, (diffCounts.get(diff) || 0) + 1);
  }
  if (diffCounts.size === 0) return 0;
  return [...diffCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

/**
 * Normalize a name for comparison: lowercase, no accents, no punctuation.
 */
function normName(s: string | null | undefined): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Resolve which person owns a Pluggy account based on the Open Finance
 * holder name (account.owner). Compares against the couple's names — no
 * hardcoded names. Returns "HUSBAND" | "WIFE" | null.
 */
function resolveOwnerPerson(
  accountOwner: string | null | undefined,
  user: { name: string },
  spouse: { name: string } | null | undefined
): "HUSBAND" | "WIFE" | null {
  const owner = normName(accountOwner);
  if (!owner) return null;
  if (normName(user.name) && owner.includes(normName(user.name))) return "HUSBAND";
  if (spouse?.name && owner.includes(normName(spouse.name))) return "WIFE";
  return null;
}

/** Resolve the amount to store, in the account's currency (BRL).
 * Pluggy reports a foreign-currency purchase as `amount` in `currencyCode`
 * (e.g. USD) and `amountInAccountCurrency` as the value already converted to
 * the account currency. Prefer the converted value so a $10.41 USD purchase is
 * stored as ~R$ 55,38 instead of R$ 10,41. Falls back to `amount` when the
 * converted field is absent. */
function resolveAmount(tx: PluggyTransaction): number {
  if (typeof tx.amountInAccountCurrency === "number" && !Number.isNaN(tx.amountInAccountCurrency)) {
    return Math.abs(tx.amountInAccountCurrency);
  }
  return Math.abs(tx.amount);
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
      .replace(/\b(VISA|MASTERCARD|MASTER|ELO|HIPERCARD|AMEX|AMERICAN\s*EXPRESS|CREDITO|CREDIT|CARD|INTERNACIONAL|INTERNATIONAL|INFINITE|INFINITY|BLACK|PLATINUM|GOLD|SIGNATURE|CLASSIC|UNICLASS|PERSONALITE|PERSONALIZED|NACIONAL\s*INTERNACIONAL|NACIONAL|ESTILO|OURO|STANDARD|BASIC|BASICO)\b/g, "")
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
 * generic payment keyword + the amount matching ONE of the user's faturas
 * whose due date is within 15 days of the payment. The due-date window
 * prevents an unrelated PIX/boleto with the same amount as some fatura from
 * being wrongly excluded, and a unique amount match prevents one payment from
 * being attributed to the wrong fatura when several faturas share a value.
 * Without a local Bill row (card not connected), nothing matches — the
 * payment is imported normally instead of disappearing from the ledger.
 */
async function isCreditCardBillPaymentByAmount(
  tx: PluggyTransaction,
  bills: Array<{ amount: number; dueDate: Date }>,
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
  const paymentDate = new Date(tx.date);
  // Matches a fatura value within R$ 0,01 (payment = fatura exact value) and
  // paid near its due date (boleto/fatura payments settle around the due day).
  const candidates = bills.filter((b) => Math.abs(b.amount - amount) < 0.01);
  if (candidates.length !== 1) return false;
  const dueDiffDays =
    Math.abs(candidates[0].dueDate.getTime() - paymentDate.getTime()) / 86400000;
  return dueDiffDays <= 15;
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
    skippedHidden: 0,
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

  // Couple names — used to link transactions to the account owner
  // (HUSBAND/WIFE) based on the Open Finance holder name (account.owner).
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { spouse: { select: { name: true } } },
  });
  const spouse = user?.spouse || null;

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
        // Accounts aren't fetched yet on this path — resolve from connector.
        bankLabel: getBankName(pluggyItem.connector) || connection.bankLabel,
      },
    });
    return result;
  }

  // 2. Accounts
  const accounts = await client.listAccounts(itemId);
  result.accounts = accounts.length;

  // Persist the item->account association: the DELETE cleanup uses it to
  // remove ONLY the rows of this item (a userId-wide lookup would wipe
  // every connection's data when one connection is removed).
  await prisma.bankConnection.update({
    where: { id: connection.id },
    data: { accountIds: accounts.map((a) => a.id) },
  });

  // Bank of the item: from the first BANK account with a recognizable name
  // (e.g. "Nu Pagamentos S.A." → NUBANK). Used as fallback for credit cards
  // whose account.name is generic ("platinum", "gold"...).
  const itemBankName =
    accounts
      .map((a) => bankNameFromAccountName(a.name || ""))
      .find((n) => !!n) || null;

  // 2.1 Bill pre-pass: upsert ALL credit-card faturas BEFORE processing any
  // account. Bank-account payment matching (isCreditCardBillPaymentByAmount)
  // reads the user's local bills — if a BANK account is processed first and
  // the card bills don't exist yet, a real fatura payment would be imported
  // and double-counted until a later sync removes it.
  for (const account of accounts) {
    if (!isCreditCardAccount(account)) continue;
    try {
      const bills = await client.listBills(account.id);
      for (const bill of bills) {
        await upsertBill(bill, account, userId, result);
      }
    } catch (err) {
      result.errors.push(
        `Fatura pré-pass conta ${account.id}: ${(err as Error).message}`
      );
    }
  }

  for (const account of accounts) {
    try {
      // Owner of this account (from Open Finance holder name) — links the
      // account's transactions to the husband/wife directly.
      const ownerPerson = user ? resolveOwnerPerson(account.owner, user, spouse) : null;
      if (isBankAccount(account)) {
        await syncBankAccount(client, account, userId, result, pluggyItem.connector?.name, ownerPerson);
      } else if (isCreditCardAccount(account)) {
        await syncCreditCard(client, account, userId, result, pluggyItem.connector?.name, itemBankName, ownerPerson);
      }
      // Other account types (investment, loan) are ignored for now
    } catch (err) {
      result.errors.push(`Conta ${account.id} (${account.subtype}): ${(err as Error).message}`);
    }
  }

  await prisma.bankConnection.update({
    where: { id: connection.id },
    data: {
      // Partial failures must not mark the connection as fully healthy:
      // keep the error detail visible in the UI until a clean sync.
      status:
        result.errors.length > 0 ? "PARTIAL_SUCCESS" : pluggyItem.status,
      errorMessage:
        result.errors.length > 0 ? result.errors.join("; ") : null,
      lastSyncAt: new Date(),
      connectorName: pluggyItem.connector?.name || connection.connectorName,
      bankLabel:
        getBankName(pluggyItem.connector, accounts) || connection.bankLabel,
    },
  });

  return result;
}

// ---------------------------------------------------------------
// Bank accounts (checking/savings) -> plain transactions
// ---------------------------------------------------------------

/**
 * Detecta se uma transação recém-sincronizada é transferência interna
 * (mesmo usuário, entre contas próprias) olhando o banco por um par
 * exato (mesmo valor ±3 dias, type oposto, conta Pluggy diferente, ambas
 * "transfer-like"). Marca isInternalTransfer=true para não inflar totais.
 */
const TRANSFER_HINT_RE =
  /(?:pix|transfer|ted|doc|envio|recebimento|deb\s*pix|entre contas|chave)/i;

export async function detectInternalTransfer(
  userId: string,
  accountId: string,
  type: string,
  amount: number,
  date: Date,
  description: string
): Promise<boolean> {
  if (!TRANSFER_HINT_RE.test(description)) return false;
  const days = 3;
  const since = new Date(date.getTime() - days * 86400000);
  const until = new Date(date.getTime() + days * 86400000);
  const pair = await prisma.transaction.findFirst({
    where: {
      userId,
      type: type === "EXPENSE" ? "INCOME" : "EXPENSE",
      pluggyAccountId: { not: accountId },
      amount: { equals: amount },
      date: { gte: since, lte: until },
      isHidden: false,
    },
  });
  return !!pair;
}

async function syncBankAccount(
  client: ReturnType<typeof createPluggyClient>,
  account: PluggyAccount,
  userId: string,
  result: SyncResult,
  connectorName?: string,
  ownerPerson?: "HUSBAND" | "WIFE" | null
): Promise<void> {
  const transactions = await client.listTransactions(account.id);
  const paymentMethod = normalizePaymentMethod(account, connectorName);

  // Faturas do usuário — usadas para detectar pagamento de fatura via boleto
  // (PAGTO.BOLETO com valor igual ao da fatura) e não duplicar o gasto.
  const userBills = await prisma.bill.findMany({
    where: { userId, source: "PLUGGY" },
    select: { amount: true, dueDate: true },
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
        logger.info(`[pluggy-sync] removido pagamento de fatura legado: ${tx.description} (${tx.id})`);
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
      amount: resolveAmount(tx),
      type,
      description: tx.description,
      date: new Date(tx.date),
      source: "PLUGGY" as const,
      paymentMethod,
      // Account owner (Open Finance holder name) → link to husband/wife.
      person: ownerPerson || null,
      isShared: false,
      isFixed: false,
      categoryId,
      pluggyAccountId: account.id,
      externalId: tx.id,
      userId,
      isInternalTransfer: await detectInternalTransfer(
        userId,
        account.id,
        type,
        resolveAmount(tx),
        new Date(tx.date),
        tx.description
      ),
    };

    if (existing) {
      // Oculta (exclusão do usuário sobrevive ao re-sync): PULAR a
      // reimportação — nem recriar, nem atualizar. O externalId continua no
      // banco justamente para o dedupe chegar aqui e respeitar a exclusão.
      if (existing.isHidden) {
        result.skippedHidden++;
        continue;
      }
      // Update mutable fields (description/amount may change on re-sync).
      // Rows the user edited manually keep their values — only genuinely new
      // Pluggy data (e.g. PENDING → POSTED) creates/updates untouched rows.
      if (existing.manuallyEdited) continue;
      const changed =
        existing.amount !== data.amount ||
        existing.description !== data.description ||
        existing.date.getTime() !== data.date.getTime() ||
        existing.type !== type ||
        existing.person !== data.person;
      if (changed) {
        await prisma.transaction.update({
          where: { id: existing.id },
          data: {
            amount: data.amount,
            description: data.description,
            date: data.date,
            type,
            person: data.person,
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

// ---------------------------------------------------------------
// Credit card accounts -> faturas (Bills) + purchases (Transactions)
// ---------------------------------------------------------------
/**
 * Ajustes de financiamento/renegociação que o banco lista fora das compras
 * (bloco "Pagamentos e Financiamentos" da fatura): encerramento de dívida,
 * estornos de juros etc. Não são compras — não devem virar transação.
 * Comparação sem acentos (Pluggy pode mandar "í" composto ou decomposto).
 */
function isFinancingAdjustment(description: string | null | undefined): boolean {
  const n = (description || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return n.includes("encerramento de divida") || n.includes("estorno de juros");
}

async function syncCreditCard(
  client: ReturnType<typeof createPluggyClient>,
  account: PluggyAccount,
  userId: string,
  result: SyncResult,
  connectorName?: string,
  itemBankName?: string | null,
  ownerPerson?: "HUSBAND" | "WIFE" | null
): Promise<void> {
  // --- Faturas (bills) ---
  // Upserted by the bill pre-pass in syncItem() so bank-account payment
  // matching always sees them. Nothing to do here.

  // --- Transactions (purchases) ---
  const transactions = await client.listTransactions(account.id);
  let paymentMethod = normalizePaymentMethod(account, connectorName);
  // Card account name is generic ("platinum", "gold") — use the item's bank
  // (from its checking account) so the payment method reads "NUBANK".
  // Normalize spaces the same way normalizePaymentMethod does, so aliases
  // like "BANCO DO BRASIL" don't create a second payment method.
  if (paymentMethod === "CARTAO" && itemBankName) {
    paymentMethod = itemBankName.replace(/\s+/g, "_");
  }

  // Faturas do usuário — pagamento da fatura via boleto aparece TAMBÉM na
  // conta do cartão ("PAGTO.BOLETO", "PGTO.BOLETO REGISTRADO" com valor da
  // fatura). Ignorar para não duplicar o gasto (fatura já conta 1x).
  const userBills = await prisma.bill.findMany({
    where: { userId, source: "PLUGGY" },
    select: { id: true, externalId: true, amount: true, dueDate: true },
  });
  // Pluggy transaction meta.billId is the PLUGGY bill id; the local Bill row
  // has its own uuid with externalId = pluggy id. Map one to the other so
  // transactions are actually linked to the local fatura (prevents the
  // fatura + its purchases from double-counting in summaries).
  const billByExternalId = new Map(
    userBills.filter((b) => b.externalId).map((b) => [b.externalId as string, b.id])
  );
  // Same mapping, but keeping the invoice's due date — used to measure how far
  // this institution's billForecastDate tags drift from the real invoice month.
  const billDueByExternalId = new Map(
    userBills
      .filter((b) => b.externalId)
      .map((b) => [b.externalId as string, b.dueDate])
  );

  // Some institutions (CAIXA via MeuPluggy) tag purchases with the month BEFORE
  // the invoice that charges them. Detect the constant per-account offset and
  // normalize every tag to the real invoice month below.
  const forecastOffset = await detectForecastOffset(transactions, billDueByExternalId);
  if (forecastOffset > 0) {
    logger.info(
      `[pluggy-sync] conta ${account.id}: billForecastDate deslocado em +${forecastOffset} mês(es) — normalizando para o mês real da fatura`
    );
  }

  for (const tx of transactions) {
    // PENDING purchases are imported too (dedupe by externalId prevents
    // duplicates once POSTED); only the invoice-balance marker is skipped.
    if (isInvoiceBalanceMarker(tx)) continue;

    // Ajustes de financiamento ("Encerramento de dívida", estornos de juros)
    // fazem parte do bloco de pagamentos/renegociação da fatura, não das
    // compras — pular na importação e remover fantasmas de imports antigos
    // (preservando linhas editadas pelo usuário).
    if (isFinancingAdjustment(tx.description)) {
      const ghost = await prisma.transaction.findUnique({
        where: { userId_externalId: { userId, externalId: tx.id } },
      });
      if (ghost && !ghost.manuallyEdited) {
        await prisma.transaction.delete({ where: { id: ghost.id } });
        logger.info(
          `[pluggy-sync] ajuste de financiamento não é compra; removida linha importada: ${tx.description} (${tx.id})`
        );
      }
      continue;
    }

    // CREDIT rows on the card account are bill payments (skipped below when
    // they match a known fatura) or REFUNDS/estornos. Refunds must NOT be
    // stored as positive expenses (they would inflate the card total), so
    // unmatched CREDIT rows are skipped — the fatura's own total already
    // nets refunds.
    if (tx.type === "CREDIT") {
      if (await isCreditCardBillPaymentByAmount(tx, userBills, { allowCredit: true })) {
        const legacy = await prisma.transaction.findUnique({
          where: { userId_externalId: { userId, externalId: tx.id } },
        });
        if (legacy) {
          await prisma.transaction.delete({ where: { id: legacy.id } });
          logger.info(`[pluggy-sync] removido pagamento de fatura legado: ${tx.description} (${tx.id})`);
        }
      } else {
        // Crédito não-pagamento (estorno/ajuste): nunca deve existir como
        // despesa. Remove linhas fantasma de imports antigos que gravavam
        // créditos como EXPENSE positiva (inflavam a fatura). Linhas editadas
        // pelo usuário são preservadas.
        const ghost = await prisma.transaction.findUnique({
          where: { userId_externalId: { userId, externalId: tx.id } },
        });
        if (ghost && !ghost.manuallyEdited && ghost.type === "EXPENSE") {
          await prisma.transaction.delete({ where: { id: ghost.id } });
          logger.info(`[pluggy-sync] removido crédito legado importado como despesa: ${tx.description} (${tx.id})`);
        }
      }
      continue;
    }

    const existing = await prisma.transaction.findUnique({
      where: { userId_externalId: { userId, externalId: tx.id } },
    });

    const meta = tx.creditCardMetadata || {};
    const totalInstallments = meta.totalInstallments || 1;
    const currentInstallment = meta.installmentNumber || 1;
    // App convention: amount = parcela do mês (o que é cobrado na fatura do
    // mês); totalAmount = valor TOTAL da compra (soma das parcelas). Pluggy
    // manda tx.amount = parcela e creditCardMetadata.totalAmount = total
    // (opcional). Quando totalAmount não vem, o total é reconstruído como
    // parcela × nº de parcelas — nunca armazenamos o total no lugar da
    // parcela, senão o total do cartão no dashboard seria N× maior.
    const amount = resolveAmount(tx);
    const totalAmount =
      meta.totalAmount != null
        ? Math.abs(meta.totalAmount)
        : totalInstallments > 1
          ? amount * totalInstallments
          : null;

    const categoryName = getOrCreateCategoryName(tx.category, tx.description);
    const categoryId = categoryName
      ? await findOrCreateCategory(categoryName, userId)
      : null;

    const data = {
      amount,
      totalAmount,
      type: "EXPENSE" as const,
      description: tx.description,
      date: new Date(tx.date),
      source: "PLUGGY" as const,
      paymentMethod,
      // Account owner (Open Finance holder name) → link to husband/wife.
      person: ownerPerson || null,
      isShared: false,
      isFixed: false,
      isCreditCard: true,
      billId: meta.billId ? (billByExternalId.get(meta.billId) ?? null) : null,
      // Pluggy already tells us which invoice month this purchase is charged
      // in (billForecastDate "YYYY-MM") — use it directly instead of inferring
      // a closing cycle, normalized by the institution's offset when its tags
      // point to the month before the real invoice. Null when absent (legacy).
      billForecastMonth: shiftMonthKey(meta.billForecastDate, forecastOffset),
      pluggyAccountId: account.id,
      totalInstallments,
      currentInstallment,
      installmentGroupId:
        totalInstallments > 1 ? installmentGroupKey(tx, account.id) : null,
      categoryId,
      externalId: tx.id,
      userId,
    };

    // -------------------------------------------------------------
    // Projeção de parcelas futuras: alguns bancos (CAIXA via MeuPluggy)
    // só publicam a parcela CORRENTE — as seguintes aparecem só no mês em
    // que vencem, subestimando faturas futuras. Bancos como Nubank já mandam
    // todas. Detecta o caso (nenhuma parcela futura real deste grupo) e cria
    // linhas projetadas com billForecastMonth adiantado; quando o banco
    // publicar a parcela real, ela entra com externalId próprio (as proj_
    // são limpas abaixo para não duplicar).
    // -------------------------------------------------------------
    // Grupo estável por descrição normalizada: a CAIXA gera hash DIFERENTE por
    // parcela (installmentGroupKey), o que quebraria o agrupamento. Mesma compra
    // parcelada => mesma chave aqui.
    const descKey = (tx.description || "").replace(/\s+\d+\/\d+\s*$/, "").trim().toLowerCase();
    const groupPrefix = `desc-${account.id}-${Buffer.from(descKey).toString("base64url")}`;
    const futureReal = await prisma.transaction.count({
      where: {
        userId,
        paymentMethod,
        installmentGroupId: groupPrefix,
        currentInstallment: { gt: currentInstallment },
        NOT: { externalId: { startsWith: "proj_" } },
      },
    });
    const isTopKnown =
      currentInstallment >=
      ((await prisma.transaction.aggregate({
        where: {
          userId,
          paymentMethod,
          installmentGroupId: groupPrefix,
          externalId: { not: { startsWith: "proj_" } },
        },
        _max: { currentInstallment: true },
      }))._max.currentInstallment ?? 0);
    // Só projeta UMA vez por grupo: quando esta tx é a mais avançada conhecida
    if (
      isTopKnown &&
      futureReal === 0 &&
      meta.billForecastDate &&
      totalInstallments > 1 &&
      currentInstallment < totalInstallments
    ) {
      // limpa projeções antigas deste grupo (recalcula do zero)
      await prisma.transaction.deleteMany({
        where: {
          userId,
          installmentGroupId: groupPrefix,
          externalId: { startsWith: "proj_" },
          manuallyEdited: false,
        },
      });
      const descNorm = (tx.description || "").replace(/\s+\d+\/\d+\s*$/, "").trim();
      const baseMonth = shiftMonthKey(meta.billForecastDate, forecastOffset)!;
      const [by, bm] = baseMonth.split("-").map(Number);
      const dayOfPurchase = new Date(tx.date).getUTCDate();
      for (let k = 1; k <= totalInstallments - currentInstallment; k++) {
          const mIdxPre = (bm - 1) + k;
          const fyPre = by + Math.floor(mIdxPre / 12);
          const fmPre = (mIdxPre % 12) + 1;
          // Só interessa parcelas futuras: faturas passadas já foram pagas/realizadas
          const fcPre = `${fyPre}-${String(fmPre).padStart(2, "0")}`;
          if (fcPre <= new Date().toISOString().slice(0, 7)) continue;
        const mIdx = (bm - 1) + k;
        const fy = by + Math.floor(mIdx / 12);
        const fm = (mIdx % 12) + 1;
        const fc = `${fy}-${String(fm).padStart(2, "0")}`;
        const lastDay = new Date(Date.UTC(fy, fm, 0)).getUTCDate();
        const projExternalId = `proj_${tx.id}_${currentInstallment + k}`;
        await prisma.transaction.create({
          data: {
            description: `${descNorm} ${currentInstallment + k}/${totalInstallments} (prev.)`,
            amount: resolveAmount(tx),
            type: "EXPENSE",
            date: new Date(Date.UTC(fy, fm - 1, Math.min(lastDay, dayOfPurchase), 12)),
            person: ownerPerson || null,
            isCreditCard: true,
            paymentMethod,
            totalInstallments,
            currentInstallment: currentInstallment + k,
            installmentGroupId: groupPrefix,
            billForecastMonth: fc,
            pluggyAccountId: account.id,
            source: "PLUGGY",
            externalId: projExternalId,
            categoryId,
            userId,
          },
        });
        result.transactionsCreated++;
      }
    }
    if (existing) {
      // Oculta (exclusão do usuário sobrevive ao re-sync): PULAR — nem
      // atualizar, nem reimportar. Mesma regra da conta corrente.
      if (existing.isHidden) {
        result.skippedHidden++;
        continue;
      }
      // Update sync-driven fields (keep the user's category edits). Rows the
      // user edited manually keep their values — no overwrite on re-sync.
      if (existing.manuallyEdited) continue;
      // Keep the user's category edits; update only sync-driven fields
      // (person is sync-driven too: the account owner decides husband/wife).
      const changed =
        existing.amount !== data.amount ||
        existing.totalAmount !== data.totalAmount ||
        existing.description !== data.description ||
        existing.date.getTime() !== data.date.getTime() ||
        existing.billId !== data.billId ||
        existing.person !== data.person ||
        existing.billForecastMonth !== data.billForecastMonth ||
        existing.installmentGroupId !== data.installmentGroupId ||
        existing.currentInstallment !== data.currentInstallment ||
        existing.totalInstallments !== data.totalInstallments;
      if (changed) {
        await prisma.transaction.update({
          where: { id: existing.id },
          data: {
            amount: data.amount,
            totalAmount: data.totalAmount,
            description: data.description,
            date: data.date,
            billId: data.billId,
            person: data.person,
            billForecastMonth: data.billForecastMonth,
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
    // Fatura editada manualmente: preserva valor/vencimento/status/nome.
    if (existing.manuallyEdited) return;
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
        skippedHidden: 0,
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
    return `${eventName || "webhook"}: ${result.transactionsCreated} criadas, ${result.transactionsUpdated} atualizadas, ${result.skippedHidden} ocultas puladas, ${result.billsCreated} faturas criadas`;
  } catch (err) {
    logger.error(`[pluggy-webhook] sync falhou para item ${itemId}:`, err);
    return null;
  }
}
