-- Add cardInvoiceDays (JSON) to UserSettings for per-card invoice/closing day config
ALTER TABLE "UserSettings" ADD COLUMN "cardInvoiceDays" JSONB;
