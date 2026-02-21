-- CreateTable
CREATE TABLE "GmailAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiry" DATETIME,
    "lastHistoryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gmailMessageId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL DEFAULT '',
    "bodyHtml" TEXT NOT NULL DEFAULT '',
    "sentAt" DATETIME,
    "receivedAt" DATETIME,
    "rawHeadersJson" TEXT NOT NULL DEFAULT '{}',
    "parsedCompanyDomain" TEXT NOT NULL DEFAULT '',
    "parsedRole" TEXT NOT NULL DEFAULT 'unknown-role',
    "normalizedRole" TEXT NOT NULL DEFAULT 'unknown-role',
    "classification" TEXT NOT NULL DEFAULT 'unclassified',
    "applicationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailMessage_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyName" TEXT NOT NULL DEFAULT 'Unknown Company',
    "companyDomain" TEXT NOT NULL,
    "roleTitle" TEXT NOT NULL,
    "normalizedRoleTitle" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "sourceEmailMessageId" TEXT,
    "firstSeenAt" DATETIME NOT NULL,
    "lastActivityAt" DATETIME NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "manualStatusLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ApplicationEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventAt" DATETIME NOT NULL,
    "emailMessageId" TEXT,
    "detailsJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApplicationEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ApplicationEvent_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "EmailMessage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FollowupTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "reason" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FollowupTask_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClassificationRuleLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "emailMessageId" TEXT NOT NULL,
    "matchedRule" TEXT NOT NULL,
    "predictedStatus" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClassificationRuleLog_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "EmailMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "GmailAccount_email_key" ON "GmailAccount"("email");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_gmailMessageId_key" ON "EmailMessage"("gmailMessageId");

-- CreateIndex
CREATE INDEX "EmailMessage_parsedCompanyDomain_normalizedRole_idx" ON "EmailMessage"("parsedCompanyDomain", "normalizedRole");

-- CreateIndex
CREATE INDEX "EmailMessage_applicationId_idx" ON "EmailMessage"("applicationId");

-- CreateIndex
CREATE INDEX "Application_status_lastActivityAt_idx" ON "Application"("status", "lastActivityAt");

-- CreateIndex
CREATE UNIQUE INDEX "Application_companyDomain_normalizedRoleTitle_key" ON "Application"("companyDomain", "normalizedRoleTitle");

-- CreateIndex
CREATE INDEX "ApplicationEvent_applicationId_eventAt_idx" ON "ApplicationEvent"("applicationId", "eventAt");

-- CreateIndex
CREATE INDEX "FollowupTask_state_dueAt_idx" ON "FollowupTask"("state", "dueAt");

-- CreateIndex
CREATE INDEX "ClassificationRuleLog_emailMessageId_idx" ON "ClassificationRuleLog"("emailMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "AppSetting_key_key" ON "AppSetting"("key");
