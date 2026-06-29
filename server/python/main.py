#!/usr/bin/env python3
"""FastAPI wrapper around research_analysis.py.

Deployed as a standalone service (Railway/Render/Fly) so the real Python
statistics stack (pandas/scipy/scikit-learn/matplotlib) runs in an environment
that actually has Python — unlike the Vercel Node serverless runtime, which can
only fall back to the lightweight JS implementation.

It re-uses research_analysis.py unchanged: the same JSON payload that the Node
backend used to pipe to the script via stdin is forwarded here over HTTP.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Request

app = FastAPI(title="paper-ai research stats")

SCRIPT = Path(__file__).parent / "research_analysis.py"
INTERNAL_SECRET = os.environ.get("INTERNAL_SECRET", "")
ANALYSIS_TIMEOUT_S = int(os.environ.get("ANALYSIS_TIMEOUT_S", "150"))


@app.get("/health")
def health():
    return {"ok": True, "script": SCRIPT.exists()}


@app.post("/analyze")
async def analyze(request: Request, x_internal_secret: str = Header(default="")):
    # Optional shared-secret gate so the service is not openly callable.
    if INTERNAL_SECRET and x_internal_secret != INTERNAL_SECRET:
        raise HTTPException(status_code=401, detail="unauthorized")

    body = await request.body()
    try:
        proc = subprocess.run(
            [sys.executable, str(SCRIPT)],
            input=body,
            capture_output=True,
            timeout=ANALYSIS_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="analysis timed out")

    out = proc.stdout.decode("utf-8", "replace").strip()
    if not out:
        err = proc.stderr.decode("utf-8", "replace")[:1000]
        raise HTTPException(status_code=500, detail=err or "no output from analysis")

    try:
        return json.loads(out)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail=f"invalid analysis output: {out[:500]}")
