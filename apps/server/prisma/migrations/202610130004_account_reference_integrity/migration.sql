-- These identities must not outlive an account, even if a target changes while
-- another actor is writing. Existing data is validated, never silently purged.
ALTER TABLE portl_registry."GuardAssignment" ADD CONSTRAINT "GuardAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES portl_auth."User"(id) ON DELETE CASCADE;
ALTER TABLE portl_gate."RequestRecipient" ADD CONSTRAINT "RequestRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES portl_auth."User"(id) ON DELETE CASCADE;
