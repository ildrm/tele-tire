CREATE TABLE "Offer" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "subscriberId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("tenantId","botId") REFERENCES "Bot"("tenantId",id),
  FOREIGN KEY ("tenantId","subscriberId") REFERENCES "Subscriber"("tenantId",id),
  FOREIGN KEY ("tenantId","versionId") REFERENCES "PlanVersion"("tenantId",id),
  FOREIGN KEY ("tenantId","policyId") REFERENCES "Policy"("tenantId",id)
);
CREATE INDEX "Offer_botId_subscriberId_expiresAt_idx" ON "Offer"("botId","subscriberId","expiresAt");
