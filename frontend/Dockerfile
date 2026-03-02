# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# VITE env vars must be passed at build time
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

COPY package.json package-lock.json ./
RUN npm ci --prefer-offline

COPY . .
RUN npm run build

# ─── Stage 2: Serve ───────────────────────────────────────────────────────────
FROM nginx:1.27-alpine

# Copy built SPA to nginx html directory
COPY --from=builder /app/dist /usr/share/nginx/html

# Nginx config as template (${BACKEND_HOST} substituted at runtime)
COPY nginx.conf /etc/nginx/conf.d/default.conf.template

# Remove default nginx config
RUN rm -f /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf.dpkg-old

EXPOSE 80

# Substitute BACKEND_HOST at container start, then run nginx
CMD ["/bin/sh", "-c", "BACKEND_HOST=${BACKEND_HOST:-backend} envsubst '${BACKEND_HOST}' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
