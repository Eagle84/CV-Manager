-- CreateTable
CREATE TABLE "CV" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filename" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "extractedText" TEXT,
    "skills" TEXT,
    "summary" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

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
    "updatedAt" DATETIME NOT NULL,
    "cvId" TEXT,
    CONSTRAINT "Application_cvId_fkey" FOREIGN KEY ("cvId") REFERENCES "CV" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Application" ("companyDomain", "companyName", "createdAt", "firstSeenAt", "groupSenderDomain", "groupSubjectKey", "id", "lastActivityAt", "manualStatusLocked", "normalizedRoleTitle", "notes", "roleTitle", "sourceEmailMessageId", "status", "updatedAt") SELECT "companyDomain", "companyName", "createdAt", "firstSeenAt", "groupSenderDomain", "groupSubjectKey", "id", "lastActivityAt", "manualStatusLocked", "normalizedRoleTitle", "notes", "roleTitle", "sourceEmailMessageId", "status", "updatedAt" FROM "Application";
DROP TABLE "Application";
ALTER TABLE "new_Application" RENAME TO "Application";
CREATE INDEX "Application_companyDomain_normalizedRoleTitle_idx" ON "Application"("companyDomain", "normalizedRoleTitle");
CREATE INDEX "Application_status_lastActivityAt_idx" ON "Application"("status", "lastActivityAt");
CREATE INDEX "Application_cvId_idx" ON "Application"("cvId");
CREATE UNIQUE INDEX "Application_groupSenderDomain_groupSubjectKey_key" ON "Application"("groupSenderDomain", "groupSubjectKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
