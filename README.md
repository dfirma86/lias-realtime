# Alias Name Game — Realtime (Next.js + Socket.IO)

## Quick start
```bash
npm install
npm run dev
# http://localhost:3000 (frontend)
# ws://localhost:4000    (socket server)
```

## Deploy (minimal steps)
1) Push this repo to GitHub.
2) **Render → New → Blueprint** (reads `render.yaml`) → Deploy server → copy URL (e.g., `https://alias-ws.onrender.com`).
3) **Vercel → New Project** → root directory `web/` → set env var:
   - `NEXT_PUBLIC_WS_URL`: your Render URL
4) Deploy & play.

## Production notes
- The server exposes `/health` and listens on `PORT`/`WS_PORT` for cloud hosts.
- Set `FRONTEND_ORIGIN` on the server to your final Vercel domain to tighten CORS.
- State is in-memory; add Postgres/Redis if you need persistence across restarts.
