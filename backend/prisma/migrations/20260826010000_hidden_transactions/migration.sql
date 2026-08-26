-- Transações ocultas: exclusão de transação importada do Pluggy vira
-- soft-delete ("ocultar") em vez de apagar a linha. Assim o dedupe por
-- @@unique([userId, externalId]) continua funcionando e o sync encontra a
-- linha oculta e PULA a reimportação — a exclusão do usuário sobrevive ao
-- re-sincronismo. Ocultas ficam revisáveis/restauráveis na aba "Ocultas".
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "isHidden" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "hiddenAt" TIMESTAMP(3);
