-- Saldo diário das contas bancárias (snapshot do sync do Pluggy): permite ao
-- dashboard medir saldo de abertura/fechamento do mês e quanto do saldo
-- acumulado foi usado nas contas.
CREATE TABLE IF NOT EXISTS "AccountBalance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pluggyAccountId" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccountBalance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AccountBalance_pluggyAccountId_date_key" ON "AccountBalance"("pluggyAccountId", "date");
CREATE INDEX IF NOT EXISTS "AccountBalance_userId_date_idx" ON "AccountBalance"("userId", "date");
