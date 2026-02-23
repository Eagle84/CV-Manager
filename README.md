# CV Manager

A local-first monorepo that connects to your Gmail account, tracks job application confirmations and responses, classifies outcomes, and prevents duplicate CV submissions by `company domain + role`.

## Legal
- [Privacy Policy](PRIVACY.md)
- [Terms of Service](TERMS.md)

## Maintainer
Created and maintained by **Igal Boguslavsky** ([igal.bogu@gmail.com](mailto:igal.bogu@gmail.com))

## Stack

- Backend: Node.js + TypeScript + Express
- Database: SQLite (Prisma ORM)
- Frontend: React + TypeScript + Vite
- Scheduler: node-cron (poll sync + daily digest)

## Features

- Google OAuth connect/disconnect for one Gmail account
- Polling inbox sync (default every 5 minutes)
- Confirmation detection (includes keywords like `thank you for applying` and `thanks for applying`)
- Status classification (`received`, `rejected`, `interview`, `assessment`, `offer`)
- Manual status/notes override with lock
- Duplicate check endpoint and UI panel using `companyDomain + normalizedRole`
- Follow-up task generation for stale applications
- Daily digest sender to your Gmail
- Dashboard, applications detail/timeline, duplicate check, settings

## Project Layout

- `backend`: API, Prisma schema/migrations, Gmail integration, sync/classification
- `frontend`: React dashboard
- `shared`: shared DTO/types package

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure backend environment:

- Copy `backend/.env.example` to `backend/.env`.
- For this workspace path (contains `#`), keep the value quoted:

```env
DATABASE_URL="file:D:/#Projects/AI Projects/CV_manager/dev.db"
```

3. Google OAuth credentials (Google Cloud Console):

- Enable Gmail API.
- Create OAuth Client (Desktop/Web).
- Add redirect URI:

```text
http://127.0.0.1:8787/api/auth/google/callback
```

4. Set these variables in `backend/.env`:

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://127.0.0.1:8787/api/auth/google/callback
ALLOWED_GMAIL=your@gmail.com
ENCRYPTION_KEY=your-long-random-secret
```

5. Apply migrations:

```bash
npm run prisma:deploy -w backend
```

## Run

Start both backend and frontend:

```bash
npm run dev
```

- Backend: `http://127.0.0.1:8787`
- Frontend: `http://127.0.0.1:5173`

## Useful Commands

```bash
npm run build
npm run test
npm run dev:backend
npm run dev:frontend
npm run prisma:generate -w backend
npm run prisma:migrate -w backend -- --name your_migration_name
npm run prisma:deploy -w backend
```

## API Surface

- `GET /api/health`
- `GET /api/auth/google/start`
- `GET /api/auth/google/status`
- `GET /api/auth/google/callback`
- `POST /api/auth/google/disconnect`
- `POST /api/sync/run`
- `GET /api/dashboard`
- `GET /api/applications`
- `GET /api/applications/:id`
- `PATCH /api/applications/:id`
- `GET /api/duplicates/check`
- `GET /api/followups`
- `POST /api/followups/:id/done`
- `POST /api/digest/send`
- `GET /api/settings`
- `PATCH /api/settings`

## Notes

- Vite warns if the project path includes `#`. Build is configured and validated in this workspace.
- Gmail API sync/classification is rule-based in v1 and intended for manual review + override where needed.
