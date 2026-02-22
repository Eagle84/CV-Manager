# CV Manager – Project Initialization Workflow

---
description: How to initialize and start the CV Manager project from scratch
---

## Prerequisites
- Node.js >= 20 installed
- Google Cloud project with Gmail API enabled and OAuth 2.0 credentials created

---

## Step 1 – Install all dependencies (root monorepo)

```bash
npm install
```

This installs shared, backend, and frontend dependencies via npm workspaces.

---

## Step 2 – Configure the backend environment

1. Copy `backend/.env.example` to `backend/.env` if it doesn't already exist:

```bash
copy backend\.env.example backend\.env
```

2. Edit `backend/.env` and set the following required values:

```env
GOOGLE_CLIENT_ID=<your-google-client-id>
GOOGLE_CLIENT_SECRET=<your-google-client-secret>
GOOGLE_REDIRECT_URI=http://localhost:8787/api/auth/google/callback
ALLOWED_GMAIL=<your-gmail-address>
ENCRYPTION_KEY=<at-least-32-random-characters>
DATABASE_URL="file:C:\path\to\CV_manager\dev.db"
FRONTEND_ORIGIN=http://localhost:5173
APP_BASE_URL=http://localhost:8787
SYNC_SUBJECT_FOCUS=thanks for applying
SYNC_LOOKBACK_DAYS=120
```

> **Note:** `SYNC_SUBJECT_FOCUS` controls which emails are scanned. 
> It defaults to `"thanks for applying"`. When this term is set, the system 
> also automatically adds: `"thank you for applying"`, `"thank you for your interest"`, 
> and `"thank you for"` to the Gmail query to maximize coverage.
> To add more focus terms, separate them with `|` or `,` e.g.:
> `SYNC_SUBJECT_FOCUS=thanks for applying|application received|we received your`

---

## Step 3 – Apply database migrations

```bash
npm run prisma:deploy -w backend
```

This runs all pending Prisma migrations to set up or update the SQLite database schema.

---

## Step 4 – Build the shared package

```bash
npm run build -w shared
```

---

## Step 5 – Start the development servers

```bash
npm run dev
```

This starts both backend (port 8787) and frontend (port 5173) concurrently.

- Backend API: http://localhost:8787
- Frontend UI: http://localhost:5173

---

## Step 6 – Connect your Gmail account

1. Open http://localhost:5173/settings in your browser.
2. Click "Connect Gmail Account".
3. Complete the Google OAuth flow.
4. Confirm the connection shows your email address.

---

## Step 7 – Run initial sync

After connecting Gmail, trigger the first sync:

- Via UI: click "Sync Now" on the dashboard or settings page.
- Via API: `POST http://localhost:8787/api/sync/run`

The sync will:
1. Query Gmail inbox for emails matching `SYNC_SUBJECT_FOCUS` within the last `SYNC_LOOKBACK_DAYS`.
2. Parse and classify each email (company name, role title, status).
3. Create or update application records.

---

## Troubleshooting: Missing applications

If you submitted CVs that are not showing in the dashboard, check:

1. **Email subject doesn't match focus terms** – The sync only picks up emails whose subject contains one of the focus terms. Check `SYNC_SUBJECT_FOCUS` in `backend/.env` and add relevant terms for your confirmation emails.

2. **Lookback window too short** – If the application was submitted more than `SYNC_LOOKBACK_DAYS` ago (default: 120 days), it will be pruned. Increase `SYNC_LOOKBACK_DAYS` if needed.

3. **Email is not in INBOX** – The sync only scans the Gmail INBOX label. Emails in Spam, Promotions, or All Mail but not in INBOX will be missed.

4. **AI skipped the email** – When Ollama is enabled and confident, it can set `include: false` for emails it deems unrelated to job applications. Check logs or lower `OLLAMA_MIN_CONFIDENCE`.

5. **`STATUS_FORCE_OVERRIDE=false`** – If a status was manually locked, future emails for the same application won't overwrite it.

6. **No confirmation email received** – The system only tracks emails you *receive*, not emails you *send*. If a company didn't send a confirmation, it won't appear.

7. **Domain deduplication** – Applications are grouped by `groupSenderDomain + groupSubjectKey`. If two jobs at the same company have very similar email subjects, they may be collapsed into one entry.
