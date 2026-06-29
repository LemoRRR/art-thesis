# Standalone Python statistics service (Railway / Render / Fly).
# Build context = this directory (server/python).
FROM python:3.12-slim

WORKDIR /app

# System libs matplotlib/scipy may need at runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Platforms inject $PORT; default to 8000 locally.
ENV PORT=8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
