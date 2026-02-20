#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# TakeSmart — Server Deployment Script
# Run this ON the server after uploading the code
#
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh           # First deploy / update
#   ./deploy.sh --build   # Force rebuild all images
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${GREEN}[INFO]${NC}  $*"; }
warning() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

FORCE_BUILD=${1:-""}

# ── Checks ────────────────────────────────────────────────────────────────────
command -v docker  >/dev/null 2>&1 || error "Docker not installed. Run: curl -fsSL https://get.docker.com | sh"
command -v docker  >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 || error "Docker Compose v2 not found"

# ── .env file ─────────────────────────────────────────────────────────────────
if [ ! -f ".env" ]; then
    if [ -f ".env.prod.example" ]; then
        cp .env.prod.example .env
        warning ".env was missing — copied from .env.prod.example"
        warning "⚠️  EDIT .env with your real values, then re-run ./deploy.sh"
        exit 1
    else
        error ".env file not found! Create it from .env.prod.example"
    fi
fi

# Check for placeholder values
if grep -q "CHANGE_ME" .env; then
    error ".env contains placeholder values (CHANGE_ME). Please set real values first!"
fi

info "✅ .env file looks good"

# ── Pull latest code ──────────────────────────────────────────────────────────
if [ -d ".git" ]; then
    info "Pulling latest code from git..."
    git pull --ff-only || warning "git pull failed — continuing with current code"
fi

# ── Build & start ─────────────────────────────────────────────────────────────
if [ "$FORCE_BUILD" == "--build" ] || [ "$FORCE_BUILD" == "-b" ]; then
    info "Force rebuilding all images..."
    docker compose build --no-cache
fi

info "Starting services..."
docker compose up -d --build

# ── Wait for backend health ────────────────────────────────────────────────────
info "Waiting for backend to become healthy..."
MAX_WAIT=120
ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
    STATUS=$(docker compose ps --format json backend 2>/dev/null | python3 -c "
import sys, json
data = sys.stdin.read().strip()
if not data: print('unknown'); exit()
try:
    lines = [l for l in data.splitlines() if l.strip()]
    obj = json.loads(lines[0])
    print(obj.get('Health', obj.get('Status', 'unknown')))
except: print('unknown')
" 2>/dev/null || echo "starting")
    
    if [[ "$STATUS" == "healthy" ]]; then
        info "✅ Backend is healthy"
        break
    fi
    sleep 5
    ELAPSED=$((ELAPSED + 5))
    echo -n "."
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
    warning "Backend healthcheck timeout — check logs: docker compose logs backend"
fi

# ── Show status ────────────────────────────────────────────────────────────────
echo ""
info "═══════════════════════════════════════"
info "  Deployment complete!"
info "═══════════════════════════════════════"
docker compose ps
echo ""
info "Useful commands:"
echo "  docker compose logs -f          # Follow all logs"
echo "  docker compose logs -f backend  # Backend logs only"
echo "  docker compose down             # Stop all services"
echo "  ./deploy.sh --build             # Rebuild & redeploy"
