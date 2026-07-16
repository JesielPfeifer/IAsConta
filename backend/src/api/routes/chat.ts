import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authMiddleware } from "../middleware/auth.js";
import { getSetting } from "../services/settings.js";

const router = Router();
const prisma = new PrismaClient();

router.use(authMiddleware);

function getMonthRange(month?: string) {
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split("-").map(Number);
    return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
  }
  const now = new Date();
  return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: new Date(now.getFullYear(), now.getMonth() + 1, 1) };
}

async function getSalaryData(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  let husbandSalary = user?.salary ?? 0;
  let wifeSalary = 0;

  if (user?.partnerId) {
    const partner = await prisma.user.findUnique({ where: { id: user.partnerId } });
    if (partner) {
      wifeSalary = partner.salary ?? 0;
      husbandSalary = user.salary ?? 0;
    }
  }

  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  const husbandName = settings?.husbandName || user?.name || "Marido";
  const wifeName = settings?.wifeName || (user?.partnerId ? "Esposa" : "");

  return { husbandSalary, wifeSalary, husbandName, wifeName };
}

async function buildFinancialContext(userId: string): Promise<string> {
  const { start, end } = getMonthRange();

  const [transactions, bills, salaryData] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId, date: { gte: start, lt: end } },
      include: { category: true },
      orderBy: { date: "desc" },
    }),
    prisma.bill.findMany({
      where: { userId, dueDate: { gte: start, lt: end } },
      include: { category: true },
    }),
    getSalaryData(userId),
  ]);

  let totalIncome = 0;
  let totalExpense = 0;
  let husbandExpense = 0;
  let wifeExpense = 0;

  for (const tx of transactions) {
    if (tx.type === "INCOME") {
      totalIncome += tx.amount;
    } else {
      totalExpense += tx.amount;
      if (tx.person === "COUPLE") { husbandExpense += tx.amount / 2; wifeExpense += tx.amount / 2; }
      else if (tx.person === "WIFE") { wifeExpense += tx.amount; }
      else { husbandExpense += tx.amount; }
    }
  }

  for (const bill of bills) {
    totalExpense += bill.amount;
    if (bill.person === "COUPLE" || bill.isShared) { husbandExpense += bill.amount / 2; wifeExpense += bill.amount / 2; }
    else if (bill.person === "WIFE") { wifeExpense += bill.amount; }
    else { husbandExpense += bill.amount; }
  }

  const balance = totalIncome - totalExpense;
  const totalSalary = salaryData.husbandSalary + salaryData.wifeSalary;

  const txList = transactions.slice(0, 10).map(t =>
    `- ${t.date.toISOString().slice(0, 10)} | ${t.type === "INCOME" ? "+" : "-"}R$${t.amount.toFixed(2)} | ${t.description} | ${t.category?.name || "sem categoria"}`
  ).join("\n");

  return `DADOS OFICIAIS DO MES ATUAL:

Salario ${salaryData.husbandName}: R$${salaryData.husbandSalary.toFixed(2)}
Salario ${salaryData.wifeName}: R$${salaryData.wifeSalary.toFixed(2)}
Salario total do casal: R$${totalSalary.toFixed(2)}

Saldo: R$${balance.toFixed(2)}
Receitas totais: R$${totalIncome.toFixed(2)}
Despesas totais: R$${totalExpense.toFixed(2)}
Gastos ${salaryData.husbandName}: R$${husbandExpense.toFixed(2)}
Gastos ${salaryData.wifeName}: R$${wifeExpense.toFixed(2)}

Ultimas transacoes:\n${txList || "Nenhuma"}`;
}

function answerDirectly(message: string, ctx: string): string | null {
  const msg = message.toLowerCase();

  const husbandSalary = ctx.match(/Salario (.+?): R\$([\d.]+)/);
  const secondSalary = [...ctx.matchAll(/Salario (.+?): R\$([\d.]+)/g)];
  const totalSalary = ctx.match(/Salario total do casal: R\$([\d.]+)/);
  const saldo = ctx.match(/Saldo: R\$([\d.-]+)/);
  const receitas = ctx.match(/Receitas totais: R\$([\d.]+)/);
  const despesas = ctx.match(/Despesas totais: R\$([\d.]+)/);
  const gastosA = ctx.match(/Gastos (.+?): R\$([\d.]+)/);
  const allGastos = [...ctx.matchAll(/Gastos (.+?): R\$([\d.]+)/g)];

  if (/salario.*(casal|total|soma|juntos|familia)/i.test(msg)) {
    return totalSalary ? `O salario total do casal e de R$${totalSalary[1]}.` : null;
  }

  if (/salario|salário/.test(msg) && secondSalary.length >= 2) {
    const name1 = secondSalary[0][1];
    const val1 = secondSalary[0][2];
    const name2 = secondSalary[1][1];
    const val2 = secondSalary[1][2];
    if (/marido|esposo|homem/.test(msg)) {
      const idx = name1.toLowerCase().includes("marido") || name1.toLowerCase().includes("jesi") ? 0 : 1;
      return `O salario do ${secondSalary[idx][1]} e de R$${secondSalary[idx][2]}.`;
    }
    if (/esposa|mulher|duda/.test(msg)) {
      const idx = name1.toLowerCase().includes("marido") || name1.toLowerCase().includes("jesi") ? 1 : 0;
      return `O salario da ${secondSalary[idx][1]} e de R$${secondSalary[idx][2]}.`;
    }
    return `${secondSalary[0][1]}: R$${secondSalary[0][2]}, ${secondSalary[1][1]}: R$${secondSalary[1][2]}. Total: R$${totalSalary?.[1] || '0'}.`;
  }

  if (/saldo/.test(msg)) {
    return saldo ? `Seu saldo atual e de R$${saldo[1]}.` : null;
  }
  if (/receita|ganho|renda/.test(msg)) {
    return receitas ? `Suas receitas do mes totalizam R$${receitas[1]}.` : null;
  }
  if (/despesa|gasto|custo/.test(msg) && !/marido|esposa|gastos/.test(msg)) {
    return despesas ? `Suas despesas do mes totalizam R$${despesas[1]}.` : null;
  }
  if (/gasto.*marido|marido.*gasto|esposo|jesi/.test(msg)) {
    const found = allGastos.find(g => g[1].toLowerCase().includes("marido") || g[1].toLowerCase().includes("jesi"));
    return found ? `Os gastos do ${found[1]} neste mes somam R$${found[2]}.` : null;
  }
  if (/gasto.*esposa|esposa.*gasto|mulher|duda/.test(msg)) {
    const found = allGastos.find(g => g[1].toLowerCase().includes("esposa") || g[1].toLowerCase().includes("duda"));
    return found ? `Os gastos da ${found[1]} neste mes somam R$${found[2]}.` : null;
  }

  return null;
}

router.post("/", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { message, history } = req.body as {
      message: string;
      history?: { role: string; content: string }[];
    };

    if (!message || !message.trim()) {
      res.status(400).json({ error: "Mensagem vazia" });
      return;
    }

    const ctx = await buildFinancialContext(user.id);

    const direct = answerDirectly(message, ctx);
    if (direct) {
      res.json({ reply: direct });
      return;
    }

    const groqKey = await getSetting(user.id, 'groqApiKey', process.env.GROQ_API_KEY);
    const groqApiUrl = await getSetting(user.id, 'groqApiUrl', process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1');

    if (groqKey) {
      try {
        const systemPrompt = `Voce e um assistente financeiro. Use APENAS os dados abaixo. NAO invente numeros.

REGRAS CRITICAS:
- RESPONDA SOMENTE com dados do contexto abaixo
- Se nao tiver o dado, diga "Nao tenho essa informacao"
- Nunca invente valores, datas ou nomes
- Formate valores como R$X.XXX,XX

${ctx}`;

        const messages: any[] = [
          { role: "system", content: systemPrompt },
          ...(history || []).map((h: { role: string; content: string }) => ({
            role: h.role as "user" | "assistant", content: h.content,
          })),
          { role: "user", content: message },
        ];

        const response = await fetch(`${groqApiUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
          body: JSON.stringify({
            model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
            messages,
            temperature: 0,
            max_tokens: 500,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const reply = data.choices?.[0]?.message?.content;
          if (reply) { res.json({ reply: reply.trim() }); return; }
        } else {
          console.error("[chat] Groq API error:", response.status);
        }
      } catch (err) {
        console.error("[chat] Groq error:", err);
      }
    }

    const fallback = answerDirectly(message, ctx) || `Seu saldo e de ${ctx.match(/Saldo: R\$([\d.-]+)/)?.[1] || 'indisponivel'}. Pergunte sobre salario, gastos ou despesas!`;
    res.json({ reply: fallback });
  } catch (err) {
    console.error("[chat] error:", err);
    res.status(500).json({ error: "Erro interno ao processar chat" });
  }
});

export default router;
