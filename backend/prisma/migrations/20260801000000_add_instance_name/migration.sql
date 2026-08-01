-- Add instanceName column to WhatsAppUser
ALTER TABLE "WhatsAppUser" ADD COLUMN "instanceName" TEXT;

-- Generate instance names for existing records based on phone
-- This sets instanceName to wa-{phone} format
UPDATE "WhatsAppUser" SET "instanceName" = 'wa-' || "phone" WHERE "instanceName" IS NULL;

-- Now make it NOT NULL and UNIQUE
ALTER TABLE "WhatsAppUser" ALTER COLUMN "instanceName" SET NOT NULL;
CREATE UNIQUE INDEX "WhatsAppUser_instanceName_key" ON "WhatsAppUser"("instanceName");
