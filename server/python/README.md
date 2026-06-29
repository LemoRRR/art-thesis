# Research statistics service

FastAPI wrapper around `research_analysis.py`, deployed separately so the real
Python stats stack (pandas / scipy / scikit-learn / matplotlib) runs in an
environment that has Python. The Vercel Node serverless runtime cannot run these
packages, so without this service the backend silently degrades to a lightweight
JS fallback (`analysisProvider: "node-fallback"`) that cannot compute Cronbach's
α, correlations, EFA, or mediation.

## Endpoints
- `GET  /health`  → `{ ok, script }`
- `POST /analyze` → same JSON payload the Node backend builds; returns the same result object.
  - Optional header `X-Internal-Secret` (must match `INTERNAL_SECRET` env if set).

## Run locally
```bash
cd server/python
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
# test:
curl -s localhost:8000/health
```

## Deploy

### Render (free tier, cold-starts after 15 min idle)
1. New → Web Service → connect the GitHub repo.
2. Root Directory: `server/python`  ·  Runtime: Docker (uses the Dockerfile here).
3. Add env var `INTERNAL_SECRET` = a long random string.
4. Deploy → note the URL, e.g. `https://paper-ai-stats.onrender.com`.

### Railway (~$5/mo, always-on)
1. New Project → Deploy from GitHub repo.
2. Settings → Root Directory: `server/python` (Dockerfile auto-detected).
3. Variables → `INTERNAL_SECRET` = same random string.
4. Generate Domain → note the URL.

## Wire the Node backend to it
Set on Vercel (and local `.env.server`):
```
PYTHON_STATS_URL=https://<your-stats-service-url>
INTERNAL_SECRET=<same random string>
```
`server/routes/research.ts` calls this service when `PYTHON_STATS_URL` is set, and
falls back to the local spawn / JS implementation if it is unset or unreachable.

## Verify
After deploy, run an analysis on a dataset with n ≥ 30 and confirm the result
has `analysisProvider` other than `node-fallback` and non-empty `cronbachAlpha`
/ `correlations` / `efa`.
