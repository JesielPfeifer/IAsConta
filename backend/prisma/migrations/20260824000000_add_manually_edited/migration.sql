-- Proteção de edição manual: quando o usuário edita uma transação/fatura
-- importada do Pluggy, o sync passa a preservar os campos editados em vez de
-- sobrescrevê-los no re-sincronismo.
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "manuallyEdited" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "manuallyEdited" BOOLEAN NOT NULL DEFAULT false;
