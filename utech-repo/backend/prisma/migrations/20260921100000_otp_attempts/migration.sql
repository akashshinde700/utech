-- OTP brute-force limiter: count wrong-code tries against a live code so it
-- can be burned at OTP_MAX_ATTEMPTS instead of staying probeable for its
-- whole TTL.
ALTER TABLE `Otp` ADD COLUMN `attempts` INTEGER NOT NULL DEFAULT 0;
