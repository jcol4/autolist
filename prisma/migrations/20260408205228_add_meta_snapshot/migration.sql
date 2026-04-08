-- CreateTable
CREATE TABLE "MetaSnapshot" (
    "id" TEXT NOT NULL,
    "faction" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "scrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" TEXT NOT NULL,

    CONSTRAINT "MetaSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetaSnapshot_faction_scrapedAt_idx" ON "MetaSnapshot"("faction", "scrapedAt");
