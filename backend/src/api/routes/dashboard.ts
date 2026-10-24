import { logger } from '../../lib/logger.js';
import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";

const router = Router();
const prisma = new PrismaClient();

router.use(authMiddleware);

/**
 * Internal transfers between the user's own accounts (e.g. Caixa ↔ Nubank)
 * are NOT income nor expense — they just move money between the couple's own
 * accounts. No bank/name is hardcoded. A transfer pair is detected from Open
 * Finance data: one leg out (EXPENSE) and one leg in (INCOME) on DIFFERENT
 * accounts of the same user, same amount, dates within 3 days, both
 * descriptions indicating a transfer — AND the two descriptions must share a
 * common remainder after stripping direction words ("pix", "envio",
 * "recebimento"...). The fingerprint requirement prevents an unrelated
 * outgoing PIX and an unrelated incoming PIX of the same value from being
 * wrongly removed (e.g. a payment to a store and a reimbursement).
 */
const TRANSFER_RE = /(?:pix|transfer|ted|doc|envio|recebimento)/i;
// Direction/boilerplate words stripped before comparing transfer descriptions
const TRANSFER_NOISE_RE =
  /(?:enviad[oa]|recebid[oa]|transfer|transf|ted|doc|pix|pagamento|pagto|entre|contas|conta)/gi;

function transferFingerprint(description: string): string {
  return (description || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(TRANSFER_NOISE_RE, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function descriptionsMatchTransferPair(a: string, b: string): boolean {
  const fa = transferFingerprint(a);
  const fb = transferFingerprint(b);
  if (!fa || !fb) return false;
  return fa === fb || fa.includes(fb) || fb.includes(fa);
}

export function filterInternalTransfers<T extends { id: string; type: string; amount: number; date: Date; description: string; pluggyAccountId?: string | null }>(
  transactions: T[]
): T[] {
  // TRANSFER_HINT_RE: any description that smells like a transfer between
  // accounts (not a purchase). The counterparty/bank name is irrelevant — we
  // only use it to avoid flagging a real purchase as internal.
  const TRANSFER_HINT_RE =
    /(?:pix|transfer|ted|doc|envio|recebimento|deb\s*pix|entre contas|chave)/i;
  const isTransferLike = (tx: T): boolean =>
    !!tx.pluggyAccountId && TRANSFER_HINT_RE.test(tx.description);

  const transferLike = transactions.filter(isTransferLike);

  const isInternalTransfer = (tx: T): boolean => {
    if (!isTransferLike(tx)) return false;
    const wantedType = tx.type === "EXPENSE" ? "INCOME" : "EXPENSE";
    const matches = transferLike.filter((other) => {
      if (other.id === tx.id) return false;
      if (other.type !== wantedType) return false;
      if (other.pluggyAccountId === tx.pluggyAccountId) return false; // same account
      if (Math.abs(Math.abs(other.amount) - Math.abs(tx.amount)) >= 0.01) return false;
      const days = Math.abs(other.date.getTime() - tx.date.getTime()) / 86400000;
      if (days > 3) return false;
      return true;
    });
    if (matches.length === 0) return false;
    // Strong signal: the two legs share a fingerprint (same counterparty/bank
    // after stripping direction words).
    if (matches.some((o) => descriptionsMatchTransferPair(tx.description, o.description)))
      return true;
    // Otherwise: a single exact-value counterpart within 3 days between two
    // DIFFERENT own accounts, both transfer-like — almost certainly own money
    // moved between accounts (e.g. "DEB PIX CHAVE" out vs "Transferência
    // Recebida|JESIEL" in). Without this, internal transfers inflate totals.
    return matches.length === 1;
  };
  return transactions.filter((tx) => !isInternalTransfer(tx));
}

function getMonthRange(month?: string): { start: Date; end: Date } {
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split("-").map(Number);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1);
    return { start, end };
  }
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end };
}

/** Chave "YYYY-MM" do mês filtrado (mesma normalização do getMonthRange). */
function getMonthKey(month?: string): string {
  const { start } = getMonthRange(month);
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Filtro do "mês vigente" para as transações do dashboard — a mesma regra de
 * /api/transactions: compras de cartão pela FATURA (billForecastMonth),
 * competência explícita (referenceMonth) vence e, no resto, o mês civil da
 * data. O cartão não é somado individualmente nos totais: ele entra pela
 * fatura (Bill) do mês em que vence.
 */
function monthTransactionsWhere(
  userId: string,
  monthKey: string,
  start: Date,
  end: Date
) {
  return {
    userId,
    billId: null,
    isHidden: false,
    AND: [
      {
        OR: [
          { isCreditCard: true, billForecastMonth: monthKey },
          { referenceMonth: monthKey },
          {
            billForecastMonth: null,
            referenceMonth: null,
            date: { gte: start, lt: end },
          },
        ],
      },
    ],
  };
}

/**
 * Regra única dos totais do dashboard: transações importadas do Pluggy que
 * NÃO são de cartão de crédito (PIX, TED, débito em conta) não entram em
 * nenhum total — só contam quando lançadas manualmente (MANUAL/BOT). Vale
 * para QUALQUER pessoa (HUSBAND/WIFE/COUPLE) e mantém /summary, /comparison,
 * /by-category, /by-payment, /year-analysis e /percentage coerentes entre si.
 */
export function isCountableTx<
  T extends { source?: string | null; isCreditCard?: boolean | null }
>(tx: T): boolean {
  return tx.source !== "PLUGGY" || !!tx.isCreditCard;
}

/**
 * Shared credit-card predicate for /credit-card-total and /credit-card-detail.
 * A transaction is "card" when it was synced from Pluggy (isCreditCard=true)
 * or its payment method is configured as CARD. The isCreditCard flag is the
 * stable classifier — a payment-method rename or deletion cannot hide
 * historical card transactions (the name list only covers legacy rows).
 */
async function cardTransactionWhere(userId: string, start: Date, end: Date) {
  const cardMethods = await prisma.paymentMethod.findMany({
    where: { userId, type: "CARD" },
    select: { name: true },
  });
  // Apenas COMPRAS de cartão de crédito. Transferências/PIX/TED não são
  // compras no cartão mesmo quando saem de uma conta de cartão (Pluggy
  // marca isCreditCard=true nessas transações) — excluímos por padrão de
  // descrição. Entradas (INCOME) já são excluídas pelo type:"EXPENSE".
  const notTransfer = [
    "transferência enviada",
    "transferência recebida",
    "pix enviado",
    "pix recebido",
    "pix enviad",
    "recebimento ted",
    "ted ",
    "doc enviado",
    "doc recebido",
  ].map((s) => ({ NOT: { description: { contains: s, mode: "insensitive" as const } } }));
  // Filtra pela FATURA (mês correto da fatura), não pela data da compra.
  // billForecastMonth é String "YYYY-MM" informada pelo Pluggy (mês em que a
  // fatura fecha). Ex.: compra de 18/08 com billForecastMonth="2026-09" deve
  // aparecer em Setembro no card de cartão, não em Agosto. Compras manuais/
  // legado sem billForecastMonth definido caem no mês da data da compra.
  const monthKey = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
  const invoiceFilter = {
    OR: [
      { billForecastMonth: monthKey },
      { billForecastMonth: null, date: { gte: start, lt: end } },
    ],
  };
  return {
    userId,
    type: "EXPENSE" as const,
    isHidden: false,
    AND: [
      ...notTransfer,
      // Filtro pela FATURA (mês correto): billForecastMonth = mês filtrado,
      // ou (sem fatura definida) a data da compra no mês.
      {
        OR: [
          { billForecastMonth: monthKey },
          { billForecastMonth: null, date: { gte: start, lt: end } },
        ],
      },
      // Apenas compras de cartão de crédito.
      {
        OR: [
          { isCreditCard: true },
          // Legacy/manual rows: forma de pagamento marcada como CARD pelo
          // usuário — restrito a lançamentos NÃO-Pluggy, senão PIX/TED/débito
          // importados da conta corrente (mesmo nome do banco) entrariam como
          // compra do cartão e inflariam o total (ex.: DEB PIX CHAVE).
          { source: { not: "PLUGGY" as const }, paymentMethod: { in: cardMethods.map((m) => m.name) } },
        ],
      },
    ],
  };
}

/**
 * Parcela do mês de uma transação de cartão. Semântica do amount:
 *  - transações Pluggy: amount = parcela do mês (totalAmount = total da compra)
 *  - transações manuais/bot: amount = total da compra; parcela = amount/N
 * À vista (totalInstallments <= 1) a parcela é o próprio amount.
 */
function monthlyInstallmentAmount(tx: {
  amount: number;
  totalAmount?: number | null;
  totalInstallments: number;
}): number {
  if (tx.totalAmount != null) return tx.amount; // Pluggy: amount já é a parcela
  return tx.totalInstallments > 1 ? tx.amount / tx.totalInstallments : tx.amount;
}

/** Soma meses com "clamp" no último dia do mês alvo (31/01 + 1 mês = 28/02). */
function addMonthsClamped(date: Date, months: number): Date {
  const targetMonth = date.getMonth() + months;
  const targetYear = date.getFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(targetYear, normalizedMonth + 1, 0).getDate();
  return new Date(targetYear, normalizedMonth, Math.min(date.getDate(), lastDay));
}

router.get("/summary", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const monthKey = getMonthKey(req.query.month as string);
    const { start, end } = getMonthRange(req.query.month as string);

    const cardWhere = await cardTransactionWhere(user.id, start, end);
    const [rawTransactions, bills, cardPurchases] = await Promise.all([
      // Mês vigente (mesma regra de /api/transactions): compras de cartão vêm
      // pela fatura (billForecastMonth), referenceMonth explícito vence e o
      // resto segue o mês civil da data. Transações vinculadas a uma fatura
      // (billId) ficam de fora: o Bill correspondente já conta a despesa.
      prisma.transaction.findMany({
        where: monthTransactionsWhere(user.id, monthKey, start, end),
        include: { category: true },
      }),
      prisma.bill.findMany({
        where: {
          userId: user.id,
          dueDate: { gte: start, lt: end },
        },
      }),
      // Cartão do mês (informativo) — mesmo critério do /credit-card-total,
      // incluindo as compras já vinculadas à fatura.
      prisma.transaction.findMany({ where: cardWhere }),
    ]);

    // Internal transfers between the user's own accounts are not income nor
    // expense (same rule as the annual panorama).
    // Compras de cartão também ficam fora do total individual: elas são a
    // fatura (Bill) do mês — o valor do cartão segue exposto em
    // creditCardExpense apenas como informativo.
    const transactions = filterInternalTransfers(rawTransactions).filter(
      (tx) => !(tx.type === "EXPENSE" && tx.isCreditCard)
    );

    let totalIncome = 0;
    let totalExpense = 0;
    let husbandIncome = 0;
    let husbandExpense = 0;
    let wifeIncome = 0;
    let wifeExpense = 0;

    for (const tx of transactions) {
      const isExpense = tx.type === "EXPENSE";
      const amount = tx.amount;
      const person = tx.person;

      // REGRA: transações importadas do Pluggy que NÃO são fatura de cartão
      // (PIX, TED, débito em conta) não entram nos totais — só passam a
      // contar quando lançadas manualmente. Vale para QUALQUER pessoa
      // (HUSBAND/WIFE/COUPLE), não só para lançamentos sem pessoa atribuída.
      if (!isCountableTx(tx)) continue;

      if (person === "COUPLE") {
        const half = amount / 2;
        if (isExpense) {
          totalExpense += amount;
          husbandExpense += half;
          wifeExpense += half;
        } else {
          totalIncome += amount;
          husbandIncome += half;
          wifeIncome += half;
        }
      } else if (person === "HUSBAND") {
        if (isExpense) {
          totalExpense += amount;
          husbandExpense += amount;
        } else {
          totalIncome += amount;
          husbandIncome += amount;
        }
      } else if (person === "WIFE") {
        if (isExpense) {
          totalExpense += amount;
          wifeExpense += amount;
        } else {
          totalIncome += amount;
          wifeIncome += amount;
        }
      } else {
        // Lançamentos manuais/bot sem pessoa atribuída contam normalmente
        // (os importados não-cartão já foram excluídos acima).
        if (isExpense) {
          totalExpense += amount;
        } else {
          totalIncome += amount;
        }
      }
    }

    for (const bill of bills) {
      const amount = bill.amount;
      totalExpense += amount;

      if (bill.person === "COUPLE" || bill.isShared) {
        husbandExpense += amount / 2;
        wifeExpense += amount / 2;
      } else if (bill.person === "WIFE") {
        wifeExpense += amount;
      } else {
        husbandExpense += amount;
      }
    }

    const billsTotal = bills.reduce((sum, b) => sum + b.amount, 0);
    const balance = totalIncome - totalExpense;

    // Cartão do mês (informativo): parcelas das compras cuja FATURA é deste
    // mês — mesmo critério do /credit-card-total (inclui as compras já
    // vinculadas à fatura). Não soma no totalExpense: a fatura (Bill) já as
    // representa.
    const creditCardExpense = cardPurchases.reduce(
      (sum, t) => sum + monthlyInstallmentAmount(t),
      0
    );
    // "Outros" = lançamentos fora das contas/faturas (PIX, débito, dinheiro).
    const expenseOther = Math.max(0, totalExpense - billsTotal);

    res.json({
      totalIncome,
      totalExpense,
      expenseOther,
      creditCardExpense,
      balance,
      billsTotal,
      byPerson: {
        husband: { income: husbandIncome, expense: husbandExpense },
        wife: { income: wifeIncome, expense: wifeExpense },
      },
    });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/by-category", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { start, end } = getMonthRange(req.query.month as string);

    // Internal transfers are excluded here too (same rule as /summary)
    const transactions = filterInternalTransfers(
      await prisma.transaction.findMany({
        where: {
          userId: user.id,
          type: "EXPENSE",
          date: { gte: start, lt: end },
          isHidden: false,
          billId: null,
        },
        include: { category: true },
      })
    ).filter(isCountableTx);
    const bills = await prisma.bill.findMany({
      where: {
        userId: user.id,
        dueDate: { gte: start, lt: end },
      },
      include: { category: true },
    });

    const byCategory: Record<string, number> = {};

    for (const tx of transactions) {
      const catName = tx.category?.name || "Sem categoria";
      byCategory[catName] = (byCategory[catName] || 0) + tx.amount;
    }

    for (const bill of bills) {
      const catName = bill.category?.name || "Contas Fixas";
      byCategory[catName] = (byCategory[catName] || 0) + bill.amount;
    }

    const result = Object.entries(byCategory).map(([name, total]) => ({
      category: name,
      total,
    }));

    result.sort((a, b) => b.total - a.total);

    res.json(result);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/percentage", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { start, end } = getMonthRange(req.query.month as string);

    // Internal transfers are excluded here too (same rule as /summary)
    const transactions = filterInternalTransfers(
      await prisma.transaction.findMany({
        where: {
          userId: user.id,
          type: "EXPENSE",
          date: { gte: start, lt: end },
          isHidden: false,
          billId: null,
        },
      })
    ).filter(isCountableTx);
    const bills = await prisma.bill.findMany({
      where: {
        userId: user.id,
        dueDate: { gte: start, lt: end },
      },
    });

    let husbandExpense = 0;
    let wifeExpense = 0;

    for (const tx of transactions) {
      if (tx.person === "COUPLE") {
        husbandExpense += tx.amount / 2;
        wifeExpense += tx.amount / 2;
      } else if (tx.person === "HUSBAND") {
        husbandExpense += tx.amount;
      } else if (tx.person === "WIFE") {
        wifeExpense += tx.amount;
      }
    }

    for (const bill of bills) {
      if (bill.person === "COUPLE" || bill.isShared) {
        husbandExpense += bill.amount / 2;
        wifeExpense += bill.amount / 2;
      } else if (bill.person === "WIFE") {
        wifeExpense += bill.amount;
      } else {
        husbandExpense += bill.amount;
      }
    }

    // Salário configurado nas Rendas Fixas (FixedIncome) entra na previsão.
    // O campo user.salary (legado) é somado às rendas fixas ativas.
    const fixedIncomes = await prisma.fixedIncome.findMany({
      where: { userId: user.id, active: true },
      select: { amount: true, person: true },
    });
    const fixedByPerson = { HUSBAND: 0, WIFE: 0, COUPLE: 0 };
    for (const fi of fixedIncomes) {
      const p = fi.person === "HUSBAND" || fi.person === "WIFE" || fi.person === "COUPLE" ? fi.person : "COUPLE";
      fixedByPerson[p] += fi.amount;
    }

    // Renda do casal (COUPLE) entra MEIO a meio no salário de cada cônjuge —
    // mesma regra da soma da parceira abaixo (fixedByPerson.COUPLE/2). Sem
    // isso, o denominador do percentual do marido ficava maior que o da esposa.
    let husbandSalary = (user.salary ?? 0) + fixedByPerson.HUSBAND + fixedByPerson.COUPLE / 2;
    let wifeSalary = 0;

    if (user.partnerId) {
      const partner = await prisma.user.findUnique({
        where: { id: user.partnerId },
      });
      if (partner) {
        const partnerFixed = await prisma.fixedIncome.findMany({
          where: { userId: partner.id, active: true },
          select: { amount: true, person: true },
        });
        let partnerFixedSum = 0;
        for (const fi of partnerFixed) {
          const p = fi.person === "WIFE" || fi.person === "HUSBAND" || fi.person === "COUPLE" ? fi.person : "COUPLE";
          if (p === "WIFE") partnerFixedSum += fi.amount;
          else if (p === "COUPLE") partnerFixedSum += fi.amount / 2;
        }
        wifeSalary = (partner.salary ?? 0) + partnerFixedSum;
      }
    } else {
      wifeSalary = fixedByPerson.WIFE;
    }

    const husbandPercentage = husbandSalary > 0 ? (husbandExpense / husbandSalary) * 100 : 0;
    const wifePercentage = wifeSalary > 0 ? (wifeExpense / wifeSalary) * 100 : 0;

    res.json({
      husband: { expense: husbandExpense, salary: husbandSalary, percentage: Math.round(husbandPercentage * 100) / 100 },
      wife: { expense: wifeExpense, salary: wifeSalary, percentage: Math.round(wifePercentage * 100) / 100 },
    });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/by-payment", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { start, end } = getMonthRange(req.query.month as string);

    // Bill-aware: card purchases linked to a fatura are counted once via the
    // Bill row (paymentMethod "Fatura Cartão"), same rule as /summary.
    const [transactions, bills] = await Promise.all([
      prisma.transaction.findMany({
        where: { userId: user.id, type: "EXPENSE", date: { gte: start, lt: end }, billId: null, isHidden: false },
      }),
      prisma.bill.findMany({
        where: { userId: user.id, dueDate: { gte: start, lt: end } },
      }),
    ]);

    const byPayment: Record<string, number> = {};
    for (const tx of filterInternalTransfers(transactions).filter(isCountableTx)) {
      const method = tx.paymentMethod || "Outros";
      byPayment[method] = (byPayment[method] || 0) + tx.amount;
    }
    for (const bill of bills) {
      const method = "Fatura Cartão";
      byPayment[method] = (byPayment[method] || 0) + bill.amount;
    }

    const result = Object.entries(byPayment).map(([method, total]) => ({ method, total }));
    result.sort((a, b) => b.total - a.total);
    res.json(result);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/credit-card-total", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { start, end } = getMonthRange(req.query.month as string);

    const transactions = await prisma.transaction.findMany({
      where: await cardTransactionWhere(user.id, start, end),
    });

    let total = 0;
    for (const tx of transactions) {
      // amount = parcela do mês para transações Pluggy (totalAmount setado);
      // para parcelas criadas manualmente/bot, amount = total da compra e a
      // parcela é amount/totalInstallments. O total do mês = soma das parcelas.
      total += monthlyInstallmentAmount(tx);
    }

    res.json({ total, count: transactions.length });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/comparison", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const monthKey = getMonthKey(req.query.month as string);
    const { start, end } = getMonthRange(req.query.month as string);

    const prevStart = new Date(start);
    prevStart.setMonth(prevStart.getMonth() - 1);
    const prevEnd = new Date(start);
    const prevMonthKey = `${prevStart.getFullYear()}-${String(prevStart.getMonth() + 1).padStart(2, "0")}`;

    // Bill-aware comparison (mesma regra do /summary): a fatura do mês conta
    // 1x, compras de cartão não somam individualmente e o "mês vigente" segue
    // /api/transactions (fatura/referenceMonth/data).
    const [currTx, prevTx, currBills, prevBills] = await Promise.all([
      prisma.transaction.findMany({ where: monthTransactionsWhere(user.id, monthKey, start, end) }),
      prisma.transaction.findMany({ where: monthTransactionsWhere(user.id, prevMonthKey, prevStart, prevEnd) }),
      prisma.bill.findMany({ where: { userId: user.id, dueDate: { gte: start, lt: end } } }),
      prisma.bill.findMany({ where: { userId: user.id, dueDate: { gte: prevStart, lt: prevEnd } } }),
    ]);

    const currTxCounted = filterInternalTransfers(currTx)
      .filter(isCountableTx)
      .filter((t) => !(t.type === "EXPENSE" && t.isCreditCard));
    const prevTxCounted = filterInternalTransfers(prevTx)
      .filter(isCountableTx)
      .filter((t) => !(t.type === "EXPENSE" && t.isCreditCard));
    const currIncome = currTxCounted.filter((t) => t.type === "INCOME").reduce((s, t) => s + t.amount, 0);
    const currExpense = currTxCounted.filter((t) => t.type === "EXPENSE").reduce((s, t) => s + t.amount, 0)
      + currBills.reduce((s, b) => s + b.amount, 0);
    const prevIncome = prevTxCounted.filter((t) => t.type === "INCOME").reduce((s, t) => s + t.amount, 0);
    const prevExpense = prevTxCounted.filter((t) => t.type === "EXPENSE").reduce((s, t) => s + t.amount, 0)
      + prevBills.reduce((s, b) => s + b.amount, 0);

    const diffIncome = currIncome - prevIncome;
    const diffExpense = currExpense - prevExpense;
    const diffPercent = prevExpense > 0 ? ((currExpense - prevExpense) / prevExpense) * 100 : 0;

    res.json({
      current: { income: currIncome, expense: currExpense },
      previous: { income: prevIncome, expense: prevExpense },
      diffIncome,
      diffExpense,
      diffPercent: Math.round(diffPercent),
    });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/year-analysis", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const year = new Date().getFullYear();
    const start = new Date(year, 0, 1);
    const end = new Date(year + 1, 0, 1);

    // Bill-aware year analysis: faturas (Bills) count once, same rule as
    // /summary; internal transfers are excluded from the aggregates.
    const [transactions, bills] = await Promise.all([
      prisma.transaction.findMany({
        where: { userId: user.id, type: "EXPENSE", date: { gte: start, lt: end }, billId: null, isHidden: false },
        include: { category: true },
      }),
      prisma.bill.findMany({
        where: { userId: user.id, dueDate: { gte: start, lt: end } },
        include: { category: true },
      }),
    ]);

    const byMonth: Record<string, number> = {};
    const byCategory: Record<string, number> = {};

    for (const tx of filterInternalTransfers(transactions).filter(isCountableTx)) {
      const m = `${tx.date.getFullYear()}-${String(tx.date.getMonth() + 1).padStart(2, "0")}`;
      byMonth[m] = (byMonth[m] || 0) + tx.amount;
      const cat = tx.category?.name || "Outros";
      byCategory[cat] = (byCategory[cat] || 0) + tx.amount;
    }
    for (const bill of bills) {
      const m = `${bill.dueDate.getFullYear()}-${String(bill.dueDate.getMonth() + 1).padStart(2, "0")}`;
      byMonth[m] = (byMonth[m] || 0) + bill.amount;
      const cat = bill.category?.name || "Contas Fixas";
      byCategory[cat] = (byCategory[cat] || 0) + bill.amount;
    }

    const months = Object.entries(byMonth).sort((a, b) => b[1] - a[1]);
    const categories = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);

    const totalExpense = Object.values(byMonth).reduce((s, v) => s + v, 0);
    const avgPerMonth = months.length > 0 ? totalExpense / months.length : 0;

    res.json({
      worstMonth: months[0] || ["N/A", 0],
      bestMonth: months[months.length - 1] || ["N/A", 0],
      topCategory: categories[0] || ["N/A", 0],
      avgPerMonth,
      totalExpense,
      allMonths: months,
    });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/tip", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { start, end } = getMonthRange(req.query.month as string);

    // Bill-aware tip: same aggregation rule as /summary (faturas contam 1x).
    const [transactions, bills] = await Promise.all([
      prisma.transaction.findMany({
        where: { userId: user.id, type: "EXPENSE", date: { gte: start, lt: end }, billId: null, isHidden: false },
        include: { category: true },
      }),
      prisma.bill.findMany({
        where: { userId: user.id, dueDate: { gte: start, lt: end } },
        include: { category: true },
      }),
    ]);

    const byCategory = new Map<string, number>();
    for (const tx of filterInternalTransfers(transactions).filter(isCountableTx)) {
      const cat = tx.category?.name || "Outros";
      byCategory.set(cat, (byCategory.get(cat) || 0) + tx.amount);
    }
    for (const bill of bills) {
      const cat = bill.category?.name || "Contas Fixas";
      byCategory.set(cat, (byCategory.get(cat) || 0) + bill.amount);
    }

    const topCategories = [...byCategory.entries()]
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 3);

    const groqKey = process.env.GROQ_API_KEY || "";
    if (groqKey) {
      try {
        const ctx = topCategories.map((c) => `${c.name}: R$${c.total.toFixed(2)}`).join(", ");
        const prompt = `Analise estes gastos do mes e de UMA dica simples e direta para economizar (max 100 caracteres): ${ctx}`;

        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 100,
            temperature: 0.5,
          }),
        });
        const json = await groqRes.json();
        const tip = json.choices?.[0]?.message?.content?.trim();
        if (tip) {
          res.json({ tip, topCategories });
          return;
        }
      } catch {}
    }

    const fallback =
      topCategories.length > 0
        ? `Sua maior despesa e ${topCategories[0].name} (R$${topCategories[0].total.toFixed(2)}). Tente definir um limite mensal!`
        : "Registre seus gastos para receber dicas personalizadas.";
    res.json({ tip: fallback, topCategories });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/credit-card-detail", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { start, end } = getMonthRange(req.query.month as string);

    const transactions = await prisma.transaction.findMany({
      where: await cardTransactionWhere(user.id, start, end),
      include: { category: true },
      orderBy: { date: "desc" },
    });

    const result = transactions.map((t) => ({
      id: t.id,
      description: t.description,
      // amount = total da compra (parcela × nº de parcelas, ou totalAmount
      // para transações Pluggy); à vista = valor.
      amount: t.totalAmount ?? t.amount,
      // installmentAmount = parcela do mês (o que é cobrado na fatura).
      installmentAmount: monthlyInstallmentAmount(t),
      date: t.date,
      categoryName: t.category?.name || null,
      paymentMethod: t.paymentMethod || "Cartao",
      totalInstallments: t.totalInstallments,
      currentInstallment: t.currentInstallment,
    }));

    res.json(result);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/income-detail", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { start, end } = getMonthRange(req.query.month as string);

    const transactions = await prisma.transaction.findMany({
      where: {
        userId: user.id,
        type: "INCOME",
        date: { gte: start, lt: end },
        isHidden: false,
        // Transferências entre contas próprias/do casal não são receita —
        // mesma regra da lista de Transações.
        isInternalTransfer: false,
      },
      orderBy: { date: "desc" },
    });

    res.json(transactions);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/** Normaliza a descrição para a chave de SÉRIE de parcelas: remove o sufixo
 * " n/m" e "(prev.)". Os installmentGroupId da Pluggy são POR PARCELA — a
 * série real é (descrição normalizada + valor), como o sync usa. */
function descNorm(s: string): string {
  return (s || "")
    .replace(/\s*\(prev\.?\)\s*$/i, "")
    .replace(/\s+\d{1,2}\s*\/\s*\d{1,2}\s*$/, "")
    .trim()
    .toLowerCase();
}

// GET /api/dashboard/ending-installments — prestações acabando em breve e
// quanto cada término libera por mês (economia). Agrupa as séries de parcelas
// (mesma chave do bot: installmentGroupId ou descrição+método).
router.get("/ending-installments", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const horizonMonths = 4;
    const horizon = new Date(now.getFullYear(), now.getMonth() + horizonMonths, 1);

    const rows = await prisma.transaction.findMany({
      where: {
        userId: user.id,
        totalInstallments: { gt: 1 },
        isHidden: false,
        isInternalTransfer: false,
      },
      select: {
        description: true,
        amount: true,
        totalAmount: true,
        currentInstallment: true,
        totalInstallments: true,
        installmentGroupId: true,
        paymentMethod: true,
        isCreditCard: true,
        date: true,
      },
      orderBy: { date: "asc" },
    });

    const groups = new Map<string, typeof rows>();
    for (const tx of rows) {
      const key = `${descNorm(tx.description)}|${Math.round(tx.amount * 100)}`;
      const g = groups.get(key);
      if (g) g.push(tx);
      else groups.set(key, [tx]);
    }

    const endingSoon: Array<{
      description: string;
      paymentMethod: string | null;
      isCreditCard: boolean | null;
      currentInstallment: number;
      totalInstallments: number;
      monthlyAmount: number;
      endsAt: Date;
      remainingParcels: number;
      remainingTotal: number;
    }> = [];
    const freedByMonth = new Map<string, number>();

    for (const txs of groups.values()) {
      const latest = txs.reduce((a, b) =>
        b.currentInstallment > a.currentInstallment ? b : a
      );
      // Última parcela da série (pode ser a projeção futura "(prev.)").
      const lastParcel = txs.find((t) => t.currentInstallment === t.totalInstallments);
      const remainingToEnd = latest.totalInstallments - latest.currentInstallment;
      const endsAt = lastParcel
        ? lastParcel.date
        : addMonthsClamped(latest.date, remainingToEnd);
      // Já terminou (última parcela no passado) ou termina depois do horizonte.
      if (endsAt < monthStart || endsAt >= horizon) continue;
      // Posição atual = maior parcela JÁ COBRADA (data até hoje).
      const charged = txs.filter((t) => t.date <= now);
      const currentPos =
        charged.length > 0
          ? charged.reduce((a, b) =>
              b.currentInstallment > a.currentInstallment ? b : a
            ).currentInstallment
          : 0;
      const remaining = latest.totalInstallments - currentPos;
      // Última parcela já cobrada (posição == total): nada mais a pagar.
      if (remaining <= 0) continue;

      // Valor da PARCELA mensal (linha manual guarda a compra inteira em
      // `amount`; a Pluggy guarda a parcela). Total restante = parcelas que
      // faltam × parcela — cobre também parcelas futuras não gravadas.
      const monthly = monthlyInstallmentAmount(latest);
      const remainingTotal = remaining * monthly;

      endingSoon.push({
        // Nome limpo da série (sem " n/m" nem "(prev.)" — o card mostra a
        // posição numa coluna própria).
        description: latest.description
          .replace(/\s*\(prev\.?\)\s*$/i, "")
          .replace(/\s+\d{1,2}\s*\/\s*\d{1,2}\s*$/, "")
          .trim(),
        paymentMethod: latest.paymentMethod,
        isCreditCard: latest.isCreditCard,
        currentInstallment: currentPos,
        totalInstallments: latest.totalInstallments,
        monthlyAmount: monthly,
        endsAt,
        remainingParcels: remaining,
        remainingTotal,
      });

      const mk = `${endsAt.getFullYear()}-${String(endsAt.getMonth() + 1).padStart(2, "0")}`;
      freedByMonth.set(mk, (freedByMonth.get(mk) || 0) + monthly);
    }

    endingSoon.sort((a, b) => a.endsAt.getTime() - b.endsAt.getTime());
    const savings = Array.from(freedByMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, freed]) => ({ month, freed }));
    const totalMonthlyFreed = endingSoon.reduce((sum, g) => sum + g.monthlyAmount, 0);

    res.json({ endingSoon, savings, totalMonthlyFreed, horizonMonths });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

export default router;
