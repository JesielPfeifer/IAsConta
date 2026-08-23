-- Add billForecastMonth to Transaction
-- Stores Pluggy's creditCardMetadata.billForecastDate ("YYYY-MM") so card
-- purchases are grouped by the invoice month the issuer actually charges them
-- in, instead of inferring a closing cycle. Null for legacy rows.

ALTER TABLE "Transaction" ADD COLUMN "billForecastMonth" TEXT;
