-- Session renewals update existing rows and cannot recreate a deleted row.
-- Only issuance needs the User lock; taking it inside an UPDATE trigger would
-- invert deletion's User -> Session lock order during a concurrent renewal.
DROP TRIGGER account_session_guard ON portl_auth."Session";
CREATE TRIGGER account_session_guard BEFORE INSERT ON portl_auth."Session" FOR EACH ROW EXECUTE FUNCTION portl_auth.check_account_session();
