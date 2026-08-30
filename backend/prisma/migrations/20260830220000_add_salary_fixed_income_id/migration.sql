-- Add salaryFixedIncomeId to Transaction (was missing when 20260826010000 was applied)
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "salaryFixedIncomeId" TEXT;