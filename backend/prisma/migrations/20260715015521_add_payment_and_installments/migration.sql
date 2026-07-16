-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "currentInstallment" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "isFixed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paymentMethod" TEXT,
ADD COLUMN     "totalInstallments" INTEGER NOT NULL DEFAULT 1;
