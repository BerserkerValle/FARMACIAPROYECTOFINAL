# Agent Guide

## Repository Shape
- This is an npm workspace: `backend` is the Express/TypeScript API and `frontend` is the React/Vite client. Run workspace commands from the repository root.
- Backend bootstrap is `backend/src/index.ts`; routes are mounted in `backend/src/app.ts` under `/api/auth`, `/api/public`, `/api/pos`, `/api/warehouse`, and `/api/admin`.
- Frontend entrypoint is `frontend/src/main.tsx`; its API client is `frontend/src/api.ts` and reads `VITE_API_URL`.

## Commands
- Install all workspace dependencies with `npm install`.
- Run both development servers with `npm run dev` (`http://localhost:4000` API and `http://localhost:5173` frontend).
- Run one server with `npm run dev --workspace backend` or `npm run dev --workspace frontend`.
- Build with `npm run build`; this deliberately compiles the backend before the frontend. Focused builds are `npm run build --workspace backend` and `npm run build --workspace frontend`.
- There are no test, lint, formatter, or typecheck scripts; `npm run build` is the available TypeScript/Vite verification.

## Runtime Constraints
- Copy `backend/.env.example` and `frontend/.env.example` to local `.env` files. Secrets and all `.env*` files are ignored; never commit database or Stripe credentials.
- Backend startup waits for `store.waitUntilReady()`. With `DATABASE_URL` or complete `PG*`/`DB_*` variables it uses PostgreSQL; without them it persists development data in `backend/data/dev-store.json`.
- Uploaded files default to `backend/uploads`; set `UPLOADS_DIR` for another location. Render sets it to `/var/data/uploads` on the persistent disk.
- Stripe webhooks must reach `/api/webhooks/stripe` with the raw request body; do not move that route after JSON body parsing.

## Deployment
- Render's backend build/start commands are `npm install && npm run build --workspace backend` and `npm run start --workspace backend`.
- Render's frontend build publishes `frontend/dist` using `npm install && npm run build --workspace frontend`; `VITE_API_URL` must point to the deployed API.
