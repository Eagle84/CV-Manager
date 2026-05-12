# Frontend (React + TypeScript + Webpack)

Scripts:

- `npm run dev -w frontend` starts Webpack dev server on `http://localhost:5173`
- `npm run build -w frontend` builds production assets into `frontend/dist`
- `npm run preview -w frontend` serves `frontend/dist` on port `4173`

Notes:

- By default, the frontend calls the API on the same origin (for example `http://cv-manager.duckdns.org/api/...`).
- Local dev uses a Webpack proxy from `/api` to `http://127.0.0.1:8787`.
- Optional override: set `VITE_API_BASE` to an API origin (for example `https://api.example.com`, without `/api` suffix).
