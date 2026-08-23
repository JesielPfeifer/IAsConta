-- Remove cardInvoiceDays from UserSettings
-- The invoice month is now sourced directly from Pluggy (billForecastMonth on
-- Transaction), so the manual closing-day config is dead code.

ALTER TABLE "UserSettings" DROP COLUMN "cardInvoiceDays";
