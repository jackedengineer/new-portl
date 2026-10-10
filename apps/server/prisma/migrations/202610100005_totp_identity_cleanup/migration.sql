-- Replay claims must disappear with the associated identity.
ALTER TABLE portl_auth."AdminTotpUse" ADD CONSTRAINT "AdminTotpUse_userId_fkey" FOREIGN KEY ("userId") REFERENCES portl_auth."User"(id) ON DELETE CASCADE ON UPDATE CASCADE;
