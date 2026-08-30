-- Transações ocultas: exclusão de transação importada do Pluggy vira
-- soft-delete ("ocultar") em vez de apagar a linha. Assim o dedupe por
-- @@unique([userId, externalId]) continua funcionando e o sync encontra a
-- linha oculta e PULA a reimportação — a exclusão do usuário sobrevive ao
-- re-sincronismo. Ocultas ficam revisáveis/restauráveis na aba "Ocultas".
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "isHidden" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "hiddenAt" TIMESTAMP(3);
-- Classificações persistidas pelo sync (transferência interna entre contas
-- próprias e revisão de salário pendente) e o vínculo com a FixedIncome que
-- gerou a revisão. O sync recalcula e persiste estes campos no re-sincronismo.
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "isInternalTransfer" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "salaryReviewPending" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "salaryFixedIncomeId" TEXT;
