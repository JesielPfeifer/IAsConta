-- Pluggy Open Finance integration (PR #6)
-- Adds the PLUGGY source value, Pluggy-owned fields on Transaction/Bill,
-- per-user Pluggy credentials on UserSettings, and the BankConnection model.
--
-- Idempotent (IF NOT EXISTS): applies cleanly to fresh databases AND to
-- environments where the schema was previously applied via `prisma db push`
-- (dev workflow), which may already carry some of these objects.

-- 1. Source enum: add PLUGGY value
ALTER TYPE "Source" ADD VALUE IF NOT EXISTS 'PLUGGY';

-- 2. Transaction: Pluggy fields
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "isCreditCard" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "billId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "pluggyAccountId" TEXT;
-- totalAmount = total purchase value for installments (amount = monthly parcel)
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "totalAmount" DOUBLE PRECISION;

-- Dedupe key used by the Pluggy sync (idempotent re-syncs)
CREATE UNIQUE INDEX IF NOT EXISTS "Transaction_userId_externalId_key" ON "Transaction"("userId", "externalId");

-- 3. Bill: Pluggy fields (credit card faturas)
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "source" "Source" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "pluggyAccountId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Bill_userId_externalId_key" ON "Bill"("userId", "externalId");

-- 4. UserSettings: per-user Pluggy credentials
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "pluggyClientId" TEXT;
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "pluggyClientSecret" TEXT;

-- 5. BankConnection: one row per Pluggy item (bank connection)
CREATE TABLE IF NOT EXISTS "BankConnection" (
    "id" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "itemId" TEXT,
    "connectorId" INTEGER,
    "connectorName" TEXT,
    "status" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "accountIds" TEXT[] NOT NULL DEFAULT '{}',
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "BankConnection_itemId_key" ON "BankConnection"("itemId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BankConnection_userId_idx" ON "BankConnection"("userId");

-- Column added after the CREATE TABLE so pre-existing tables (created via
-- prisma db push) also receive it — CREATE TABLE IF NOT EXISTS is a no-op
-- when the table already exists.
ALTER TABLE "BankConnection" ADD COLUMN IF NOT EXISTS "accountIds" TEXT[] NOT NULL DEFAULT '{}';

-- AddForeignKey (only if the table was just created or the FK is missing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BankConnection_userId_fkey'
  ) THEN
    ALTER TABLE "BankConnection" ADD CONSTRAINT "BankConnection_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 6. Backfills
-- Legacy card transactions: rows whose payment method is configured as CARD
-- are classified as credit-card transactions (stable classifier for the
-- dashboard card reports — survives payment-method renames/deletions).
UPDATE "Transaction" SET "isCreditCard" = true
WHERE "paymentMethod" IN (SELECT "name" FROM "PaymentMethod" WHERE "type" = 'CARD');

-- Rows synced before this change stored the purchase TOTAL in amount when
-- creditCardMetadata.totalAmount was present. Preserve that total; the next
-- sync corrects amount to the monthly parcel.
UPDATE "Transaction" SET "totalAmount" = "amount"
WHERE "isCreditCard" = true AND "source" = 'PLUGGY' AND "totalInstallments" > 1 AND "totalAmount" IS NULL;
