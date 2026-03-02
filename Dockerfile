# ─────────────────────────────────────────────
#  TakeSmart Frontend — Timeweb App Platform
# ─────────────────────────────────────────────

# ── Stage 1: Build React SPA ────────────────
FROM node:20-alpine AS builder

WORKDIR /app

ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --prefer-offline

COPY frontend/ .
RUN npm run build

# ── Stage 2: Nginx ──────────────────────────
FROM nginx:1.27-alpine

COPY --from=builder /app/dist /usr/share/nginx/html

# Nginx config as template (${BACKEND_HOST} substituted at runtime)
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf.template
RUN rm -f /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf.dpkg-old

EXPOSE 80

CMD ["/bin/sh", "-c", "BACKEND_HOST=${BACKEND_HOST:-backend} envsubst '${BACKEND_HOST}' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
