-- CreateTable
CREATE TABLE "TargetCompany" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userEmail" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "industry" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Application" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userEmail" TEXT NOT NULL DEFAULT '',
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
    "updatedAt" DATETIME NOT NULL,
    "cvId" TEXT,
    CONSTRAINT "Application_cvId_fkey" FOREIGN KEY ("cvId") REFERENCES "CV" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Application" ("companyDomain", "companyName", "createdAt", "cvId", "firstSeenAt", "groupSenderDomain", "groupSubjectKey", "id", "lastActivityAt", "manualStatusLocked", "normalizedRoleTitle", "notes", "roleTitle", "sourceEmailMessageId", "status", "updatedAt") SELECT "companyDomain", "companyName", "createdAt", "cvId", "firstSeenAt", "groupSenderDomain", "groupSubjectKey", "id", "lastActivityAt", "manualStatusLocked", "normalizedRoleTitle", "notes", "roleTitle", "sourceEmailMessageId", "status", "updatedAt" FROM "Application";
DROP TABLE "Application";
ALTER TABLE "new_Application" RENAME TO "Application";
CREATE INDEX "Application_userEmail_idx" ON "Application"("userEmail");
CREATE INDEX "Application_companyDomain_normalizedRoleTitle_idx" ON "Application"("companyDomain", "normalizedRoleTitle");
CREATE INDEX "Application_status_lastActivityAt_idx" ON "Application"("status", "lastActivityAt");
CREATE INDEX "Application_cvId_idx" ON "Application"("cvId");
CREATE UNIQUE INDEX "Application_userEmail_groupSenderDomain_groupSubjectKey_key" ON "Application"("userEmail", "groupSenderDomain", "groupSubjectKey");
CREATE TABLE "new_CV" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userEmail" TEXT NOT NULL DEFAULT '',
    "filename" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "extractedText" TEXT,
    "skills" TEXT,
    "summary" TEXT,
    "rolePrimary" TEXT,
    "experienceYears" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_CV" ("createdAt", "extractedText", "filePath", "fileType", "filename", "id", "isDefault", "skills", "summary", "updatedAt") SELECT "createdAt", "extractedText", "filePath", "fileType", "filename", "id", "isDefault", "skills", "summary", "updatedAt" FROM "CV";
DROP TABLE "CV";
ALTER TABLE "new_CV" RENAME TO "CV";
CREATE INDEX "CV_userEmail_idx" ON "CV"("userEmail");
CREATE TABLE "new_EmailMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userEmail" TEXT NOT NULL DEFAULT '',
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
INSERT INTO "new_EmailMessage" ("aiConfidence", "aiExtractionJson", "applicationId", "bodyHtml", "bodyText", "classification", "createdAt", "direction", "fromEmail", "gmailMessageId", "groupSenderDomain", "groupSubjectKey", "id", "normalizedRole", "parsedCompanyDomain", "parsedRole", "rawHeadersJson", "receivedAt", "sentAt", "subject", "threadId", "toEmail") SELECT "aiConfidence", "aiExtractionJson", "applicationId", "bodyHtml", "bodyText", "classification", "createdAt", "direction", "fromEmail", "gmailMessageId", "groupSenderDomain", "groupSubjectKey", "id", "normalizedRole", "parsedCompanyDomain", "parsedRole", "rawHeadersJson", "receivedAt", "sentAt", "subject", "threadId", "toEmail" FROM "EmailMessage";
DROP TABLE "EmailMessage";
ALTER TABLE "new_EmailMessage" RENAME TO "EmailMessage";
CREATE INDEX "EmailMessage_userEmail_idx" ON "EmailMessage"("userEmail");
CREATE INDEX "EmailMessage_parsedCompanyDomain_normalizedRole_idx" ON "EmailMessage"("parsedCompanyDomain", "normalizedRole");
CREATE INDEX "EmailMessage_groupSenderDomain_groupSubjectKey_idx" ON "EmailMessage"("groupSenderDomain", "groupSubjectKey");
CREATE INDEX "EmailMessage_applicationId_idx" ON "EmailMessage"("applicationId");
CREATE UNIQUE INDEX "EmailMessage_userEmail_gmailMessageId_key" ON "EmailMessage"("userEmail", "gmailMessageId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "TargetCompany_userEmail_idx" ON "TargetCompany"("userEmail");

-- CreateIndex
CREATE INDEX "TargetCompany_createdAt_idx" ON "TargetCompany"("createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "TargetCompany_userEmail_url_key" ON "TargetCompany"("userEmail", "url");
