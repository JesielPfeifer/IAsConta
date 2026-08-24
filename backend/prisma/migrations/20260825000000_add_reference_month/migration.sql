-- Mês de competência ("YYYY-MM") para despesas cujo débito difere do mês de
-- referência (ex.: prestação habitacional debitada dia 5 do mês seguinte).
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "referenceMonth" TEXT;
CREATE INDEX IF NOT EXISTS idx_tx_reference_month ON "Transaction"("referenceMonth");
