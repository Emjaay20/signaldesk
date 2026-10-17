-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "healthReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "healthScore" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "healthy" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "cases" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reasons" TEXT[],
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cases_workspaceId_status_idx" ON "cases"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "cases_productId_status_idx" ON "cases"("productId", "status");

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
