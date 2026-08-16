-- Pluggy Open Finance integration (PR #6)
-- Adds the PLUGGY source value, Pluggy-owned fields on Transaction/Bill,
-- per-user Pluggy credentials on UserSettings, and the BankConnection model.

-- 1. Source enum: add PLUGGY value
ALTER TYPE "Source" ADD VALUE IF NOT EXISTS 'PLUGGY';

-- 2. Transaction: Pluggy fields
ALTER TABLE "Transaction" ADD COLUMN "externalId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "isCreditCard" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Transaction" ADD COLUMN "billId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "pluggyAccountId" TEXT;
-- totalAmount = total purchase value for installments (amount = monthly parcel)
ALTER TABLE "Transaction" ADD COLUMN "totalAmount" DOUBLE PRECISION;

-- Dedupe key used by the Pluggy sync (idempotent re-syncs)
CREATE UNIQUE INDEX "Transaction_userId_externalId_key" ON "Transaction"("userId", "externalId");

-- 3. Bill: Pluggy fields (credit card faturas)
ALTER TABLE "Bill" ADD COLUMN "source" "Source" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "Bill" ADD COLUMN "externalId" TEXT;
ALTER TABLE "Bill" ADD COLUMN "pluggyAccountId" TEXT;

CREATE UNIQUE INDEX "Bill_userId_externalId_key" ON "Bill"("userId", "externalId");

-- 4. UserSettings: per-user Pluggy credentials
ALTER TABLE "UserSettings" ADD COLUMN "pluggyClientId" TEXT;
ALTER TABLE "UserSettings" ADD COLUMN "pluggyClientSecret" TEXT;

-- 5. BankConnection: one row per Pluggy item (bank connection)
CREATE TABLE "BankConnection" (
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
CREATE UNIQUE INDEX "BankConnection_itemId_key" ON "BankConnection"("itemId");

-- CreateIndex
CREATE INDEX "BankConnection_userId_idx" ON "BankConnection"("userId");

-- AddForeignKey
ALTER TABLE "BankConnection" ADD CONSTRAINT "BankConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
