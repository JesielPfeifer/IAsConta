-- Re-add cardInvoiceDays to UserSettings
-- The closing-day cycle per card is the source of truth for grouping card
-- purchases into the correct invoice (the Pluggy billForecastDate is unreliable
-- for some issuers, e.g. CAIXA). Stored as Json: { pluggyAccountId: day }.

ALTER TABLE "UserSettings" ADD COLUMN "cardInvoiceDays" JSONB;
