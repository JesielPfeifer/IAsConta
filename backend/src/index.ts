import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import { PrismaClient } from "@prisma/client";
import authRoutes from "./api/routes/auth.js";
import transactionRoutes, { botRouter } from "./api/routes/transactions.js";
import categoryRoutes from "./api/routes/categories.js";
import billRoutes, { botRouter as billBotRouter } from "./api/routes/bills.js";
import budgetRoutes from "./api/routes/budgets.js";
import dashboardRoutes from "./api/routes/dashboard.js";
import botDashboardRoutes from "./api/routes/botDashboard.js";
import userRoutes from "./api/routes/users.js";
import chatRoutes from "./api/routes/chat.js";
import whatsappRoutes from "./api/routes/whatsapp.js";
import settingsRoutes from "./api/routes/settings.js";
import { startWhatsApp, sendMessage } from "./bot/platforms/whatsapp.js";
import { startDiscord } from "./bot/platforms/discord.js";
import { startTelegram } from "./bot/platforms/telegram.js";
import { processMessage } from "./bot/nlp/parser.js";
import { parseNubankCSV } from "./parsers/nubank-csv.js";
import { parseCaixaPDF } from "./parsers/caixa-pdf.js";
import { callApi } from "./bot/client.js";

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/transactions/bot", botRouter);
app.use("/api/transactions", transactionRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/bills/bot", billBotRouter);
app.use("/api/bills", billRoutes);
app.use("/api/budgets", budgetRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/bot/dashboard", botDashboardRoutes);
app.use("/api/users", userRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/whatsapp", whatsappRoutes);
app.use("/api/settings", settingsRoutes);

app.post("/api/parse/nubank", upload.single("file"), async (req, res) => {
  try {
    const content = req.file ? req.file.buffer.toString("utf-8") : req.body.csv;
    if (!content) {
      res.status(400).json({ success: false, transactions: [], errors: ["CSV file or field required"] });
      return;
    }
    res.json(parseNubankCSV(content));
  } catch (err) {
    res.status(400).json({ success: false, transactions: [], errors: [err instanceof Error ? err.message : "Unknown error"] });
  }
});

app.post("/api/parse/caixa", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, transactions: [], errors: ["PDF file required"] });
      return;
    }
    const password = req.body?.password || undefined;
    res.json(await parseCaixaPDF(req.file.buffer, password));
  } catch (err) {
    res.status(400).json({ success: false, transactions: [], errors: [err instanceof Error ? err.message : "Unknown error"] });
  }
});

app.post("/webhook/evolution", async (req, res) => {
  try {
    const body = req.body;
    const data = body?.data;
    if (!data) { res.sendStatus(200); return; }

    const isFromMe = data.key?.fromMe || false;
    const message = data.message || data.conversation || data.extendedTextMessage;
    const senderId = data.key?.remoteJid || data.remoteJid || "";
    const instanceName = body.instance || data.instance || "default";
    const isGroup = senderId?.includes("@g.us");
    const senderName = data.pushName || data.senderName || "";
    const rawText = message?.conversation || message?.extendedTextMessage?.text || data.body?.message || "";

    if (isFromMe) {
      if (!rawText || !rawText.toLowerCase().includes("@contas")) {
        res.sendStatus(200);
        return;
      }
    }

    const text = rawText.replace(/@contas/gi, "").trim();

    const prisma = new PrismaClient();
    const botEmail = process.env.BOT_DEFAULT_EMAIL || '';
    let botUserId = '';
    if (botEmail) {
      const u = await prisma.user.findUnique({ where: { email: botEmail } });
      if (u) botUserId = u.id;
    }
    const { getSetting } = await import('./api/services/settings.js');
    const allowedGroup = await getSetting(botUserId, 'whatsappGroupId', process.env.WHATSAPP_GROUP_ID || '');
    if (isGroup && allowedGroup && senderId !== allowedGroup) {
      res.sendStatus(200);
      return;
    }

    if (!isGroup && !allowedGroup) {
    } else if (!isGroup && allowedGroup) {
      res.sendStatus(200);
      return;
    }

    if (text && text.trim().length > 0) {
      const result = await processMessage(text, "whatsapp", { senderId, senderName, instanceName, isGroup });
      if (result.message) {
        await sendMessage(instanceName, senderId, result.message);
      }
      res.sendStatus(200);
      return;
    }

    // Handle file messages (document, image with caption about finance)
    const documentMessage = message?.documentMessage;
    const imageMessage = message?.imageMessage;

    const mediaMessage = documentMessage || imageMessage;
    if (mediaMessage) {
      const fileName = (documentMessage?.fileName || imageMessage?.caption || "arquivo").toLowerCase();
      const caption = (documentMessage?.caption || imageMessage?.caption || "").toLowerCase();

      const isNubankCsv = fileName.endsWith(".csv") || caption.includes("nubank");
      const isCaixaPdf = fileName.endsWith(".pdf") || caption.includes("caixa") || caption.includes("fatura");

      if (isNubankCsv || isCaixaPdf) {
        try {
          let fileBuffer: Buffer | null = null;

          // Try to get base64 from the message
          if (mediaMessage.base64 || mediaMessage.mediaBase64) {
            fileBuffer = Buffer.from(mediaMessage.base64 || mediaMessage.mediaBase64, "base64");
          } else if (mediaMessage.url) {
            // Download from Evolution API media URL
            const mediaUrl = mediaMessage.url;
            const downloadRes = await fetch(mediaUrl, {
              headers: { apikey: process.env.EVOLUTION_API_KEY || "" },
            });
            if (downloadRes.ok) {
              const arrayBuf = await downloadRes.arrayBuffer();
              fileBuffer = Buffer.from(arrayBuf);
            }
          } else {
            // Evolution API stores media and can be fetched
            const evoUrl = `${process.env.EVOLUTION_API_URL || "http://evolution-api:8080"}/chat/getMedia/${instanceName}`;
            const fetchRes = await fetch(evoUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                apikey: process.env.EVOLUTION_API_KEY || "",
              },
              body: JSON.stringify({
                message: { key: data.key },
                convertToMp4: false,
              }),
            });
            if (fetchRes.ok) {
              const fetchData = await fetchRes.json();
              if (fetchData.base64) {
                fileBuffer = Buffer.from(fetchData.base64, "base64");
              } else if (fetchData.url) {
                const dlRes = await fetch(fetchData.url);
                if (dlRes.ok) {
                  const arr = await dlRes.arrayBuffer();
                  fileBuffer = Buffer.from(arr);
                }
              }
            }
          }

          if (fileBuffer) {
            if (isNubankCsv && !isCaixaPdf) {
              const csvContent = fileBuffer.toString("utf-8");
              const parsed = parseNubankCSV(csvContent);

              if (parsed.success && parsed.transactions.length > 0) {
                let imported = 0;
                for (const tx of parsed.transactions) {
                  try {
                    await callApi("/api/transactions/bot", {
                      type: tx.amount < 0 ? "expense" : "income",
                      amount: Math.abs(tx.amount),
                      description: tx.description,
                      category: tx.category || "outros",
                      person: "couple",
                      isShared: true,
                      dueDate: tx.date,
                      platform: "whatsapp",
                      rawMessage: `Nubank CSV import: ${tx.description}`,
                      senderInfo: { senderId, senderName },
                    });
                    imported++;
                  } catch (e) {
                    console.error("[webhook] Failed to import CSV tx:", e);
                  }
                }
                await sendMessage(instanceName, senderId, `Nubank CSV processado: ${imported} transacoes importadas de ${parsed.transactions.length} encontradas.`);
              } else {
                await sendMessage(instanceName, senderId, `Erro ao processar CSV do Nubank: ${parsed.errors.join("; ")}`);
              }
            } else if (isCaixaPdf) {
              const parsed = await parseCaixaPDF(fileBuffer);

              if (parsed.success && parsed.transactions.length > 0) {
                let imported = 0;
                for (const tx of parsed.transactions) {
                  try {
                    await callApi("/api/transactions/bot", {
                      type: "expense",
                      amount: Math.abs(tx.amount),
                      description: tx.description,
                      category: tx.category || "outros",
                      person: "couple",
                      isShared: true,
                      dueDate: tx.date,
                      platform: "whatsapp",
                      rawMessage: `Caixa PDF import: ${tx.description}`,
                      senderInfo: { senderId, senderName },
                    });
                    imported++;
                  } catch (e) {
                    console.error("[webhook] Failed to import PDF tx:", e);
                  }
                }
                const periodStr = parsed.metadata?.period || "periodo nao identificado";
                const totalStr = parsed.metadata?.totalAmount
                  ? `Total da fatura: R$${parsed.metadata.totalAmount.toFixed(2).replace(".", ",")}`
                  : "";
                await sendMessage(instanceName, senderId, `Fatura Caixa processada (${periodStr}): ${imported} gastos mapeados. ${totalStr}`);
              } else {
                await sendMessage(instanceName, senderId, `Erro ao processar PDF da Caixa: ${parsed.errors.join("; ")}`);
              }
            }
          } else {
            await sendMessage(instanceName, senderId, "Nao foi possivel baixar o arquivo. Tente enviar novamente ou use o painel web para importar.");
          }
        } catch (err) {
          console.error("[webhook] File processing error:", err);
          await sendMessage(instanceName, senderId, "Erro ao processar o arquivo enviado.");
        }
      }

      res.sendStatus(200);
      return;
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("[webhook] Error:", err);
    res.sendStatus(200);
  }
});

app.use(
  (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
);

app.listen(PORT, async () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  try {
    await startWhatsApp();
    await startDiscord();
    await startTelegram();
  } catch (err) {
    console.error("[bot] Init error:", err);
  }
});

export default app;
