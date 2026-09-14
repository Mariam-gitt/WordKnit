# ── Stage 1: Build React app ─────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Point API calls at the backend container via Nginx proxy.
# NOTE: Vite only exposes env vars to the browser if they're prefixed with VITE_ (not
# REACT_APP_ — that was specifically a Create React App convention). Renamed to match, so
# this stays consistent going forward even though nothing in the app code currently reads
# it (api.js has always used a hardcoded URL rather than this variable — worth fixing
# separately if you want the Docker path to actually use the Nginx proxy here).
ENV VITE_API_URL=/api

RUN npm run build

# ── Stage 2: Serve with Nginx ────────────────────────────────────────
FROM nginx:1.25-alpine

# Copy built React files — Vite's default output folder is "dist", not CRA's "build".
COPY --from=build /app/dist /usr/share/nginx/html

# Nginx config: SPA fallback + proxy /api → backend
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
