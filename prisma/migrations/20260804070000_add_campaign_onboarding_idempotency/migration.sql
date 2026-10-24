-- M5A onboarding creation claims are nullable so historical Campaign rows remain valid.
-- Application code sets activeOwnerKey only for the active Campaign created through
-- onboarding and clears it when a future lifecycle operation deactivates that Campaign.
ALTER TABLE "Campaign" ADD COLUMN "activeOwnerKey" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "creationKey" TEXT;

CREATE UNIQUE INDEX "Campaign_activeOwnerKey_key" ON "Campaign"("activeOwnerKey");
CREATE UNIQUE INDEX "Campaign_creationKey_key" ON "Campaign"("creationKey");
