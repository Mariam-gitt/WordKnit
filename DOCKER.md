# WordKnit — Docker Setup

## Architecture

```
Browser
  └─ :80  → Nginx (frontend container)
               ├─ /         → React SPA (static files)
               └─ /api/*    → Node backend :5000
                                ├─ MongoDB        :27017  (container)
                                ├─ pdf_service    :5001   (container)
                                ├─ rag_service    :5002   (container)
                                ├─ ocr_service    :5003   (container)
                                └─ rag_llm_service:5004   (container)
```

## Quick Start

### 1. Add your secrets

Copy and edit the environment file:

```bash
cp backend/.env.docker backend/.env.docker
```

Open `backend/.env.docker` and set:
- `JWT_SECRET`  — any long random string, e.g. `openssl rand -hex 32`
- `GROQ_API_KEY` — your key from https://console.groq.com
- `MAX_PDF_MB=11` — optional; the default upload limit is 4 MB (Vercel's limit), but a self-hosted Docker setup can allow bigger PDFs
- `FRONTEND_URL=http://localhost` — the address you open the app at; the API refuses write requests (POST/PATCH/DELETE) from any other origin
- `COOKIE_SAMESITE=lax` and `COOKIE_SECURE=false` — the login cookie travels over plain http://localhost here, and frontend + backend share one address through nginx

### 2. Build and run

```bash
docker compose up --build
```

First build takes ~3–5 minutes (downloads base images, installs Tesseract, etc.).

App is live at **http://localhost**

### 3. Useful commands

```bash
# Run in background
docker compose up -d --build

# View logs (all services)
docker compose logs -f

# View logs (one service)
docker compose logs -f backend
docker compose logs -f ocr_service

# Stop everything
docker compose down

# Stop and wipe database
docker compose down -v

# Rebuild one service after code change
docker compose up -d --build backend
docker compose up -d --build ocr_service
```

## Service Ports (host machine)

| Service          | Port |
|------------------|------|
| Frontend (Nginx) | 80   |
| Backend (Node)   | 5000 |
| pdf_service      | 5001 |
| rag_service      | 5002 |
| ocr_service      | 5003 |
| rag_llm_service  | 5004 |

## Files added / changed for Docker

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Orchestrates all 7 containers |
| `backend/Dockerfile` | Node backend image |
| `backend/Dockerfile.python` | Generic Python services (pdf, rag, rag_llm) |
| `backend/Dockerfile.ocr` | OCR service — includes Tesseract install |
| `backend/requirements.txt` | Python dependencies |
| `backend/.env.docker` | Environment variables for containers |
| `frontend/Dockerfile` | React build + Nginx |
| `frontend/nginx.conf` | SPA routing + /api proxy |
| `.dockerignore` | Excludes node_modules etc. |

## Deploying later

When you're ready to deploy (e.g. to a VPS, Railway, Render, AWS):

1. Push to a Git repo
2. The `docker-compose.yml` works on any server with Docker installed
3. For production, set `MONGO_URI` to MongoDB Atlas instead of the local container
4. Put a real domain + SSL in front (Nginx Proxy Manager or Caddy)

More on deployment later — this setup is ready for it.
