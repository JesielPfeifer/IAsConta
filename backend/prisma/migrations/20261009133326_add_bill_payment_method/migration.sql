-- Método de pagamento normalizado do cartão na Bill (mesmo critério usado nas
-- transações): permite esconder a "fatura prevista" no front quando a fatura
-- oficial (Pluggy) do mês já existe, mesmo que o nome da conta do cartão não
-- contenha o método.
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT;
