-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "portl_auth";

-- CreateTable
CREATE TABLE "portl_auth"."User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portl_auth"."Session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portl_auth"."Account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portl_auth"."Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portl_auth"."RateLimit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portl_auth"."OtpThrottle" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OtpThrottle_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "portl_auth"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "portl_auth"."Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "portl_auth"."Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "portl_auth"."Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "portl_auth"."Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Verification_identifier_key" ON "portl_auth"."Verification"("identifier");

-- CreateIndex
CREATE INDEX "Verification_expiresAt_idx" ON "portl_auth"."Verification"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimit_key_key" ON "portl_auth"."RateLimit"("key");

-- CreateIndex
CREATE INDEX "OtpThrottle_resetAt_idx" ON "portl_auth"."OtpThrottle"("resetAt");

-- AddForeignKey
ALTER TABLE "portl_auth"."Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "portl_auth"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portl_auth"."Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "portl_auth"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

