-- Retain every accepted code during its validity window, including adjacent TOTP periods.
ALTER TABLE portl_auth."AdminTotpUse" DROP CONSTRAINT "AdminTotpUse_pkey";
ALTER TABLE portl_auth."AdminTotpUse" ADD CONSTRAINT "AdminTotpUse_pkey" PRIMARY KEY ("userId", digest);
