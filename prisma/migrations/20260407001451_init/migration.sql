-- CreateTable
CREATE TABLE "Faction" (
    "id" TEXT NOT NULL,
    "bsdataId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Faction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Detachment" (
    "id" TEXT NOT NULL,
    "bsdataId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "factionId" TEXT NOT NULL,
    "ruleName" TEXT,
    "ruleDescription" TEXT,

    CONSTRAINT "Detachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enhancement" (
    "id" TEXT NOT NULL,
    "bsdataId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "detachmentId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "description" TEXT,
    "restriction" TEXT,

    CONSTRAINT "Enhancement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "bsdataId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "factionId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "scaledCosts" TEXT NOT NULL DEFAULT '[]',
    "role" TEXT NOT NULL,
    "keywords" TEXT[],
    "factionKeywords" TEXT[],
    "movement" TEXT,
    "toughness" INTEGER,
    "save" TEXT,
    "wounds" INTEGER,
    "leadership" TEXT,
    "objectiveControl" INTEGER,
    "invulnSave" TEXT,
    "isLeader" BOOLEAN NOT NULL DEFAULT false,
    "leaderOf" TEXT[],
    "minModels" INTEGER NOT NULL DEFAULT 1,
    "maxModels" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeaponProfile" (
    "id" TEXT NOT NULL,
    "bsdataId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "weaponType" TEXT NOT NULL,
    "range" TEXT,
    "attacks" TEXT,
    "skill" TEXT,
    "strength" TEXT,
    "armorPen" TEXT,
    "damage" TEXT,
    "keywords" TEXT[],

    CONSTRAINT "WeaponProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeaponOption" (
    "id" TEXT NOT NULL,
    "bsdataId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "slotName" TEXT NOT NULL,
    "modelType" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "choices" TEXT[],
    "minSelections" INTEGER NOT NULL DEFAULT 1,
    "maxSelections" INTEGER NOT NULL DEFAULT 1,
    "conditionalThreshold" INTEGER,
    "conditionalMax" INTEGER,
    "defaultChoice" TEXT,

    CONSTRAINT "WeaponOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ability" (
    "id" TEXT NOT NULL,
    "bsdataId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Ability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArmyList" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "factionId" TEXT NOT NULL,
    "detachmentId" TEXT NOT NULL,
    "pointsLimit" INTEGER NOT NULL DEFAULT 2000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArmyList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArmyListUnit" (
    "id" TEXT NOT NULL,
    "armyListId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "modelCount" INTEGER NOT NULL DEFAULT 5,
    "notes" TEXT,

    CONSTRAINT "ArmyListUnit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Faction_bsdataId_key" ON "Faction"("bsdataId");

-- CreateIndex
CREATE UNIQUE INDEX "Detachment_bsdataId_key" ON "Detachment"("bsdataId");

-- CreateIndex
CREATE UNIQUE INDEX "Enhancement_bsdataId_key" ON "Enhancement"("bsdataId");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_bsdataId_key" ON "Unit"("bsdataId");

-- CreateIndex
CREATE UNIQUE INDEX "WeaponProfile_bsdataId_key" ON "WeaponProfile"("bsdataId");

-- CreateIndex
CREATE UNIQUE INDEX "Ability_bsdataId_key" ON "Ability"("bsdataId");

-- AddForeignKey
ALTER TABLE "Detachment" ADD CONSTRAINT "Detachment_factionId_fkey" FOREIGN KEY ("factionId") REFERENCES "Faction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enhancement" ADD CONSTRAINT "Enhancement_detachmentId_fkey" FOREIGN KEY ("detachmentId") REFERENCES "Detachment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_factionId_fkey" FOREIGN KEY ("factionId") REFERENCES "Faction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeaponProfile" ADD CONSTRAINT "WeaponProfile_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeaponOption" ADD CONSTRAINT "WeaponOption_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ability" ADD CONSTRAINT "Ability_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArmyList" ADD CONSTRAINT "ArmyList_detachmentId_fkey" FOREIGN KEY ("detachmentId") REFERENCES "Detachment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArmyListUnit" ADD CONSTRAINT "ArmyListUnit_armyListId_fkey" FOREIGN KEY ("armyListId") REFERENCES "ArmyList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArmyListUnit" ADD CONSTRAINT "ArmyListUnit_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
