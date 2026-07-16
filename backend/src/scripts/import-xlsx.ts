import "dotenv/config";
import * as readline from "node:readline/promises";
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const FILE_PATH = "C:\\Users\\jesie\\Downloads\\Financeiro - 2026.xlsx";

const MONTH_SHEETS: Record<string, number> = {
  Janeiro: 1,
  Fevereiro: 2,
  "Março": 3,
  Abril: 4,
  Maio: 5,
  Junho: 6,
  Julho: 7,
  Agosto: 8,
  Setembro: 9,
  Outubro: 10,
  Novembro: 11,
  Dezembro: 12,
};

const CATEGORY_MAP: Record<string, string> = {
  Beleza: "Beleza",
  "Saúde": "Saúde",
  Assinaturas: "Assinaturas",
  Gasolina: "Gasolina",
  "IFood/restaurante": "IFood/restaurante",
  "Despesas eventuais": "Despesas eventuais",
  Desenvolvimento: "Educação",
  "Eletrônicos": "Eletrônicos",
  "Uber/transporte": "Uber/transporte",
  Mercado: "Alimentação",
  Roupa: "Vestuário",
  Aluguel: "Moradia",
  Lazer: "Lazer",
  Presentes: "Presentes",
  Necessidades: "Necessidades",
};

function mapPaymentMethod(method: string): string {
  if (!method) return "";
  const upper = method.toUpperCase().trim();
  if (upper.includes("NUBANK")) return "NUBANK";
  if (upper === "DÉBITO" || upper === "DEBITO") return "DEBITO";
  if (upper === "CAIXA") return "CAIXA";
  if (upper === "CRÉDITO" || upper === "CREDITO") return "CREDITO";
  return method.trim();
}

function mapContas(description: string): string {
  const lower = description.toLowerCase();
  if (/carro|pneu|manutenc[aoa]|civic|palio|estacionamento/i.test(lower)) return "Veículo";
  if (/\bap\b|aluguel/i.test(lower)) return "Moradia";
  if (/juros|parcel/i.test(lower)) return "Financiamento";
  if (/fies|pucrs/i.test(lower)) return "Educação";
  if (/celular/i.test(lower)) return "Telefonia";
  if (/shopee|mercadolivre|amazon|superlegal/i.test(lower)) return "Compras";
  if (/hostinger|cartao|salete/i.test(lower)) return "Serviços";
  return "Contas";
}

function mapCategory(oldCategory: string, description: string): string {
  if (oldCategory === "Contas") {
    return mapContas(description);
  }
  return CATEGORY_MAP[oldCategory] || oldCategory;
}

function parseInstallments(raw: string): { current: number; total: number } | null {
  if (!raw) return null;
  const match = raw.trim().match(/^\((\d+)\/(\d+)\)$/);
  if (!match) return null;
  return { current: parseInt(match[1], 10), total: parseInt(match[2], 10) };
}

function parseAmount(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace("R$", "").replace(/,/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseDate(raw: string, sheetMonth: number): Date | null {
  if (!raw || !raw.trim()) return null;
  const parts = raw.trim().split("/");
  if (parts.length < 2) return null;

  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const year = parts[2] ? parseInt(parts[2], 10) : null;

  if (isNaN(day) || isNaN(month)) return null;

  let resolvedYear: number;
  if (year && !isNaN(year)) {
    resolvedYear = year < 100 ? 2000 + year : year;
  } else {
    resolvedYear = month > sheetMonth ? 2025 : 2026;
  }

  return new Date(resolvedYear, month - 1, day, 12, 0, 0);
}

function isSummaryRow(name: string): boolean {
  const lower = name.toLowerCase().trim();
  return (
    lower.includes("total de") ||
    lower.includes("saldo") ||
    lower.includes("entradas") ||
    lower.includes("saídas") ||
    lower.includes("saidas") ||
    lower === "fixos" ||
    lower === "gastos do mês" ||
    lower === "cartão de crédito" ||
    lower === "cartao de credito" ||
    lower === "investimentos" ||
    lower === "reserva" ||
    lower === "renda fixa" ||
    lower === "nome" ||
    lower.startsWith("total")
  );
}

interface BillInput {
  name: string;
  amount: number;
  dueDate: Date;
  category: string;
  person: string;
}

interface TxInput {
  description: string;
  date: Date;
  amount: number;
  category: string;
  paymentMethod: string;
  currentInstallment: number;
  totalInstallments: number;
}

function cellStr(val: unknown): string {
  return typeof val === "string" ? val : String(val ?? "");
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const email = await rl.question("Enter user email: ");
  rl.close();

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const password = await bcrypt.hash("123456", 10);
    user = await prisma.user.create({
      data: { email, password, name: email.split("@")[0] },
    });
    console.log(`Created user: ${email}`);
  } else {
    console.log(`Found existing user: ${email}`);
  }

  const userSettings = await prisma.userSettings.findUnique({ where: { userId: user.id } });
  const wifeName = userSettings?.wifeName ?? null;
  const husbandName = userSettings?.husbandName ?? null;

  const existingCategories = await prisma.category.findMany({
    where: { userId: user.id },
  });
  const categoryCache = new Map<string, string>();
  for (const cat of existingCategories) {
    categoryCache.set(cat.name.toLowerCase(), cat.id);
  }

  async function getOrCreateCategory(name: string): Promise<string> {
    const key = name.toLowerCase();
    if (categoryCache.has(key)) return categoryCache.get(key)!;
    const cat = await prisma.category.create({
      data: { name, userId: user!.id },
    });
    categoryCache.set(key, cat.id);
    return cat.id;
  }

  const workbook = XLSX.readFile(FILE_PATH);
  let totalBills = 0;
  let totalExpenses = 0;
  let totalIncome = 0;

  for (const [sheetName, sheetMonth] of Object.entries(MONTH_SHEETS)) {
    if (!workbook.SheetNames.includes(sheetName)) {
      console.log(`  Sheet "${sheetName}" not found, skipping.`);
      continue;
    }

    console.log(`\n--- ${sheetName} ---`);

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: "DD/MM/YYYY" }) as unknown[][];

    let offset = 0;
    for (let col = 0; col < 8; col++) {
      if (rows[8]?.[col] === "Nome") {
        offset = col;
        break;
      }
    }

    // ---------------------------------------------------------------
    // Section 1: FIXOS → Bills
    // ---------------------------------------------------------------
    let fixosNomeRow = -1;
    for (let i = 6; i < Math.min(14, rows.length); i++) {
      if (rows[i]?.[offset] === "Nome") {
        fixosNomeRow = i;
        break;
      }
    }

    let cartaoHeaderRow = -1;
    for (let i = 8; i < rows.length; i++) {
      for (let j = offset; j < offset + 5; j++) {
        const val = cellStr(rows[i]?.[j]).toLowerCase();
        if (val.includes("total de cart")) {
          cartaoHeaderRow = i;
          break;
        }
      }
      if (cartaoHeaderRow >= 0) break;
    }

    const fixosEnd = cartaoHeaderRow > 0 ? cartaoHeaderRow : 26;

    const bills: BillInput[] = [];

    if (fixosNomeRow >= 0) {
      for (let i = fixosNomeRow + 1; i < fixosEnd; i++) {
        const row = rows[i];
        if (!row) continue;

        const name = cellStr(row[offset]).trim();
        if (!name || isSummaryRow(name)) continue;

        const amount = parseAmount(cellStr(row[offset + 6]));
        if (!amount || amount <= 0) continue;

        const date = parseDate(cellStr(row[offset + 3]), sheetMonth);
        if (!date) continue;

        const cat = mapCategory(cellStr(row[offset + 5]).trim(), name);

        bills.push({
          name,
          amount,
          dueDate: date,
          category: cat,
          person: "HUSBAND",
        });
      }
    }

    // ---------------------------------------------------------------
    // Section 2: CARTÃO DE CRÉDITO → Transactions EXPENSE
    // ---------------------------------------------------------------
    let cartaoNomeRow = -1;
    for (let i = cartaoHeaderRow + 1; i < rows.length && cartaoNomeRow < 0; i++) {
      if (rows[i]?.[offset] === "Nome") {
        cartaoNomeRow = i;
      }
    }

    const cartaoTransactions: TxInput[] = [];

    if (cartaoNomeRow > 0) {
      for (let i = cartaoNomeRow + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;

        const name = cellStr(row[offset]).trim();
        if (!name) continue;
        if (isSummaryRow(name)) continue;

        const amount = parseAmount(cellStr(row[offset + 6]));
        if (!amount || amount <= 0) continue;

        const date = parseDate(cellStr(row[offset + 3]), sheetMonth);
        if (!date) continue;

        const parcelas = cellStr(row[offset + 1]);
        const inst = parseInstallments(parcelas);
        const tipo = cellStr(row[offset + 4]).trim();
        const cat = mapCategory(cellStr(row[offset + 5]).trim(), name);

        cartaoTransactions.push({
          description: name,
          date,
          amount,
          category: cat,
          paymentMethod: mapPaymentMethod(tipo),
          currentInstallment: inst?.current ?? 1,
          totalInstallments: inst?.total ?? 1,
        });
      }
    }

    // ---------------------------------------------------------------
    // Section 3: GASTOS DO MÊS → Transactions EXPENSE
    // ---------------------------------------------------------------
    let gastosNomeRow = -1;
    let gastosOffset = -1;

    for (let i = 5; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      for (let j = offset + 8; j < Math.min(offset + 16, row.length); j++) {
        if (row[j] === "Nome") {
          gastosNomeRow = i;
          gastosOffset = j;
          break;
        }
      }
      if (gastosNomeRow >= 0) break;
    }

    const gastosTransactions: TxInput[] = [];

    if (gastosNomeRow >= 0 && gastosOffset >= 0) {
      for (let i = gastosNomeRow + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;

        const name = cellStr(row[gastosOffset]).trim();
        if (!name) continue;
        if (isSummaryRow(name)) continue;

        const amount = parseAmount(cellStr(row[gastosOffset + 5]));
        if (!amount || amount <= 0) continue;

        const date = parseDate(cellStr(row[gastosOffset + 2]), sheetMonth);
        if (!date) continue;

        const tipo = cellStr(row[gastosOffset + 3]).trim();
        const cat = mapCategory(cellStr(row[gastosOffset + 4]).trim(), name);

        gastosTransactions.push({
          description: name,
          date,
          amount,
          category: cat,
          paymentMethod: mapPaymentMethod(tipo),
          currentInstallment: 1,
          totalInstallments: 1,
        });
      }
    }

    // ---------------------------------------------------------------
    // Section 4: ENTRADAS → Transactions INCOME
    // ---------------------------------------------------------------
    let entradasRow = -1;
    let entradasCol = -1;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      for (let j = offset; j < row.length; j++) {
        if (cellStr(row[j]).toLowerCase().includes("entradas")) {
          entradasRow = i;
          entradasCol = j;
          break;
        }
      }
      if (entradasRow >= 0) break;
    }

    const incomeTransactions: TxInput[] = [];

    if (entradasRow >= 0 && entradasCol >= 0) {
      for (let i = entradasRow + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;

        const name = cellStr(row[entradasCol]).trim();
        if (!name || isSummaryRow(name)) continue;

        let amountValue = parseAmount(cellStr(row[entradasCol + 1]));
        if (!amountValue || amountValue <= 0) {
          amountValue = parseAmount(cellStr(row[entradasCol + 2]));
        }
        if (!amountValue || amountValue <= 0) continue;

        let incomeCategory = "Renda";
        if (name.toLowerCase().includes("salário") || name.toLowerCase().includes("salario")) {
          incomeCategory = "Salário";
        }

        incomeTransactions.push({
          description: name,
          date: new Date(2026, sheetMonth - 1, 5, 12, 0, 0),
          amount: amountValue,
          category: incomeCategory,
          paymentMethod: "",
          currentInstallment: 1,
          totalInstallments: 1,
        });
      }
    }

    // ===============================================================
    // PERSIST: Bills
    // ===============================================================
    let billCount = 0;
    for (const bill of bills) {
      try {
        const categoryId = await getOrCreateCategory(bill.category);

        const exists = await prisma.bill.findFirst({
          where: {
            userId: user!.id,
            name: bill.name,
            amount: bill.amount,
            dueDate: bill.dueDate,
          },
        });
        if (exists) continue;

        await prisma.bill.create({
          data: {
            name: bill.name,
            amount: bill.amount,
            dueDate: bill.dueDate,
            categoryId,
            person: "HUSBAND",
            isRecurring: true,
            userId: user!.id,
          },
        });
        billCount++;
      } catch (err) {
        console.error(`  Error inserting bill "${bill.name}" (${bill.amount}):`, (err as Error).message);
      }
    }
    console.log(`  Bills: ${billCount} imported`);

    // ===============================================================
    // PERSIST: Cartão + Gastos (EXPENSE Transactions)
    // ===============================================================
    const allExpenses = [...cartaoTransactions, ...gastosTransactions];
    let expenseCount = 0;

    for (const tx of allExpenses) {
      try {
        const categoryId = await getOrCreateCategory(tx.category);

        const exists = await prisma.transaction.findFirst({
          where: {
            userId: user!.id,
            amount: tx.amount,
            description: tx.description,
            date: tx.date,
            type: "EXPENSE",
            paymentMethod: tx.paymentMethod || null,
          },
        });
        if (exists) continue;

        await prisma.transaction.create({
          data: {
            amount: tx.amount,
            type: "EXPENSE",
            description: tx.description,
            categoryId,
            person: "HUSBAND",
            date: tx.date,
            paymentMethod: tx.paymentMethod || null,
            totalInstallments: tx.totalInstallments,
            currentInstallment: tx.currentInstallment,
            isFixed: false,
            userId: user!.id,
          },
        });
        expenseCount++;
      } catch (err) {
        console.error(`  Error inserting expense "${tx.description}" (${tx.amount}):`, (err as Error).message);
      }
    }
    console.log(`  Expenses: ${expenseCount} imported`);

    // ===============================================================
    // PERSIST: Entradas (INCOME Transactions)
    // ===============================================================
    let incomeCount = 0;

    for (const tx of incomeTransactions) {
      try {
        const categoryId = await getOrCreateCategory(tx.category);

        let person: string = "HUSBAND";
        const nameLower = tx.description.toLowerCase();
        if (wifeName && nameLower.includes(wifeName.toLowerCase())) {
          person = "WIFE";
        } else if (husbandName && nameLower.includes(husbandName.toLowerCase())) {
          person = "HUSBAND";
        }

        const exists = await prisma.transaction.findFirst({
          where: {
            userId: user!.id,
            amount: tx.amount,
            description: tx.description,
            date: tx.date,
            type: "INCOME",
          },
        });
        if (exists) continue;

        await prisma.transaction.create({
          data: {
            amount: tx.amount,
            type: "INCOME",
            description: tx.description,
            categoryId,
            person: person as "HUSBAND" | "WIFE",
            date: tx.date,
            paymentMethod: null,
            totalInstallments: 1,
            currentInstallment: 1,
            isFixed: false,
            userId: user!.id,
          },
        });
        incomeCount++;
      } catch (err) {
        console.error(`  Error inserting income "${tx.description}" (${tx.amount}):`, (err as Error).message);
      }
    }
    console.log(`  Income: ${incomeCount} imported`);

    totalBills += billCount;
    totalExpenses += expenseCount;
    totalIncome += incomeCount;
  }

  console.log(`\n========================================`);
  console.log(`Done! Import summary for ${email}:`);
  console.log(`  Bills:    ${totalBills}`);
  console.log(`  Expenses: ${totalExpenses}`);
  console.log(`  Income:   ${totalIncome}`);
  console.log(`  Total:    ${totalBills + totalExpenses + totalIncome}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
