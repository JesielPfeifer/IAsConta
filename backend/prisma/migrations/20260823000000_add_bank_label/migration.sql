-- Adiciona rótulo legível do banco na conexão (ex.: "Caixa", "Nubank").
-- Para itens MeuPluggy o connector.name é só "MeuPluggy"; o nome real do
-- banco vem do institutionUrl do conector Pluggy.
ALTER TABLE "BankConnection" ADD COLUMN IF NOT EXISTS "bankLabel" TEXT;
