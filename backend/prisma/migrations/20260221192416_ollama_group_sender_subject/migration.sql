-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Application" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyName" TEXT NOT NULL DEFAULT 'Unknown Company',
    "companyDomain" TEXT NOT NULL,
    "roleTitle" TEXT NOT NULL,
    "normalizedRoleTitle" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "sourceEmailMessageId" TEXT,
    "groupSenderDomain" TEXT NOT NULL DEFAULT '',
    "groupSubjectKey" TEXT NOT NULL DEFAULT '',
    "firstSeenAt" DATETIME NOT NULL,
    "lastActivityAt" DATETIME NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "manualStatusLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Application" (
    "companyDomain",
    "companyName",
    "createdAt",
    "firstSeenAt",
    "id",
    "lastActivityAt",
    "manualStatusLocked",
    "normalizedRoleTitle",
    "notes",
    "roleTitle",
    "sourceEmailMessageId",
    "status",
    "updatedAt",
    "groupSenderDomain",
    "groupSubjectKey"
)
SELECT
    "companyDomain",
    "companyName",
    "createdAt",
    "firstSeenAt",
    "id",
    "lastActivityAt",
    "manualStatusLocked",
    "normalizedRoleTitle",
    "notes",
    "roleTitle",
    "sourceEmailMessageId",
    "status",
    "updatedAt",
    CASE
        WHEN length(trim("companyDomain")) > 0 THEN lower(trim("companyDomain"))
        ELSE 'unknown-sender-' || substr("id", 1, 8)
    END,
    CASE
        WHEN length(trim("normalizedRoleTitle")) > 0 THEN lower(trim("normalizedRoleTitle")) || '--' || substr("id", 1, 8)
        ELSE 'unknown-subject-' || substr("id", 1, 8)
    END
FROM "Application";
DROP TABLE "Application";
ALTER TABLE "new_Application" RENAME TO "Application";
CREATE INDEX "Application_companyDomain_normalizedRoleTitle_idx" ON "Application"("companyDomain", "normalizedRoleTitle");
CREATE INDEX "Application_status_lastActivityAt_idx" ON "Application"("status", "lastActivityAt");
CREATE UNIQUE INDEX "Application_groupSenderDomain_groupSubjectKey_key" ON "Application"("groupSenderDomain", "groupSubjectKey");
CREATE TABLE "new_EmailMessage" (
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
    "groupSenderDomain" TEXT NOT NULL DEFAULT '',
    "groupSubjectKey" TEXT NOT NULL DEFAULT '',
    "aiExtractionJson" TEXT NOT NULL DEFAULT '{}',
    "aiConfidence" REAL NOT NULL DEFAULT 0,
    "applicationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailMessage_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_EmailMessage" (
    "applicationId",
    "bodyHtml",
    "bodyText",
    "classification",
    "createdAt",
    "direction",
    "fromEmail",
    "gmailMessageId",
    "id",
    "normalizedRole",
    "parsedCompanyDomain",
    "parsedRole",
    "rawHeadersJson",
    "receivedAt",
    "sentAt",
    "subject",
    "threadId",
    "toEmail",
    "groupSenderDomain",
    "groupSubjectKey",
    "aiExtractionJson",
    "aiConfidence"
)
SELECT
    "applicationId",
    "bodyHtml",
    "bodyText",
    "classification",
    "createdAt",
    "direction",
    "fromEmail",
    "gmailMessageId",
    "id",
    "normalizedRole",
    "parsedCompanyDomain",
    "parsedRole",
    "rawHeadersJson",
    "receivedAt",
    "sentAt",
    "subject",
    "threadId",
    "toEmail",
    CASE
        WHEN length(trim("parsedCompanyDomain")) > 0 THEN lower(trim("parsedCompanyDomain"))
        ELSE 'unknown-sender-' || substr("id", 1, 8)
    END,
    CASE
        WHEN length(trim("subject")) > 0 THEN lower(trim("subject"))
        ELSE 'unknown-subject-' || substr("id", 1, 8)
    END,
    '{}',
    0
FROM "EmailMessage";
DROP TABLE "EmailMessage";
ALTER TABLE "new_EmailMessage" RENAME TO "EmailMessage";
CREATE UNIQUE INDEX "EmailMessage_gmailMessageId_key" ON "EmailMessage"("gmailMessageId");
CREATE INDEX "EmailMessage_parsedCompanyDomain_normalizedRole_idx" ON "EmailMessage"("parsedCompanyDomain", "normalizedRole");
CREATE INDEX "EmailMessage_groupSenderDomain_groupSubjectKey_idx" ON "EmailMessage"("groupSenderDomain", "groupSubjectKey");
CREATE INDEX "EmailMessage_applicationId_idx" ON "EmailMessage"("applicationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
