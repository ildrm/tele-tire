-- Tenant ownership is enforced by composite keys as well as service authorization.
DO $$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['Chat','Policy','Plan','PlanVersion','Subscriber','Checkout','Inbox','Payment','Subscription','Refund','Grant','Membership','AccessOperation','Job','Notification','Audit','Incident','ProviderEvent'] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id)',tab,tab||'_tenant_fk');
  END LOOP;
  FOREACH tab IN ARRAY ARRAY['Chat','Subscriber','Checkout','Inbox','Payment','Subscription','Refund','Grant','Membership','AccessOperation','Job','Notification','Incident','ProviderEvent'] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("tenantId","botId") REFERENCES "Bot"("tenantId",id)',tab,tab||'_bot_scope_fk');
  END LOOP;
  FOREACH tab IN ARRAY ARRAY['Checkout','Payment','Subscription','Grant','Membership','AccessOperation','Notification'] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("tenantId","subscriberId") REFERENCES "Subscriber"("tenantId",id)',tab,tab||'_subscriber_scope_fk');
  END LOOP;
  FOREACH tab IN ARRAY ARRAY['Grant','Membership','AccessOperation'] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("tenantId","chatId") REFERENCES "Chat"("tenantId",id)',tab,tab||'_chat_scope_fk');
  END LOOP;
END $$;
ALTER TABLE "Plan" ADD CONSTRAINT "plan_current_version_fk" FOREIGN KEY ("tenantId","currentVersionId") REFERENCES "PlanVersion"("tenantId",id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "PlanVersion" ADD CONSTRAINT "version_plan_fk" FOREIGN KEY ("tenantId","planId") REFERENCES "Plan"("tenantId",id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "PlanVersion" ADD CONSTRAINT "version_policy_fk" FOREIGN KEY ("tenantId","policyId") REFERENCES "Policy"("tenantId",id);
ALTER TABLE "Checkout" ADD CONSTRAINT "checkout_version_fk" FOREIGN KEY ("tenantId","versionId") REFERENCES "PlanVersion"("tenantId",id);
ALTER TABLE "Checkout" ADD CONSTRAINT "checkout_policy_fk" FOREIGN KEY ("tenantId","policyId") REFERENCES "Policy"("tenantId",id);
ALTER TABLE "Payment" ADD CONSTRAINT "payment_checkout_fk" FOREIGN KEY ("tenantId","checkoutId") REFERENCES "Checkout"("tenantId",id);
ALTER TABLE "Payment" ADD CONSTRAINT "payment_version_fk" FOREIGN KEY ("tenantId","versionId") REFERENCES "PlanVersion"("tenantId",id);
ALTER TABLE "Subscription" ADD CONSTRAINT "subscription_checkout_fk" FOREIGN KEY ("tenantId","checkoutId") REFERENCES "Checkout"("tenantId",id);
ALTER TABLE "Grant" ADD CONSTRAINT "grant_payment_fk" FOREIGN KEY ("tenantId","paymentId") REFERENCES "Payment"("tenantId",id);
ALTER TABLE "PlanVersion" ADD CONSTRAINT "positive_stars" CHECK (stars > 0 AND stars <= 1000000 AND (kind <> 'RECURRING_30D' OR stars <= 10000));
ALTER TABLE "PlanVersion" ADD CONSTRAINT "valid_kind" CHECK (kind IN ('RECURRING_30D','PREPAID_90D','PREPAID_365D'));
ALTER TABLE "Payment" ADD CONSTRAINT "positive_charge" CHECK (stars > 0 AND "periodEnd" > "periodStart");
ALTER TABLE "Refund" ADD CONSTRAINT "positive_refund" CHECK (stars > 0);
ALTER TABLE "Grant" ADD CONSTRAINT "valid_interval" CHECK ("expiresAt" > "startsAt");
ALTER TABLE "Checkout" ADD CONSTRAINT "bounded_payload" CHECK (octet_length(id) <= 128);
CREATE FUNCTION immutable_financial_fact() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Append-only record'; END $$;
CREATE TRIGGER immutable_payment BEFORE UPDATE OR DELETE ON "Payment" FOR EACH ROW EXECUTE FUNCTION immutable_financial_fact();
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON "Audit" FOR EACH ROW EXECUTE FUNCTION immutable_financial_fact();
CREATE TRIGGER immutable_version BEFORE UPDATE OR DELETE ON "PlanVersion" FOR EACH ROW EXECUTE FUNCTION immutable_financial_fact();
CREATE TRIGGER immutable_policy BEFORE UPDATE OR DELETE ON "Policy" FOR EACH ROW EXECUTE FUNCTION immutable_financial_fact();
CREATE FUNCTION validate_chat_grants() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cid text;
BEGIN
  FOREACH cid IN ARRAY NEW."chatIds" LOOP
    IF NOT EXISTS (SELECT 1 FROM "Chat" WHERE id=cid AND "tenantId"=NEW."tenantId") THEN RAISE EXCEPTION 'Cross-tenant chat grant'; END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER plan_chat_scope BEFORE INSERT ON "PlanVersion" FOR EACH ROW EXECUTE FUNCTION validate_chat_grants();
