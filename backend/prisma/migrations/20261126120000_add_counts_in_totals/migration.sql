-- Decisão explícita do usuário sobre a transação entrar ou não nos totais.
-- NULL = regra automática (Pluggy que não é cartão não conta).
ALTER TABLE "Transaction" ADD COLUMN "countsInTotals" BOOLEAN;
