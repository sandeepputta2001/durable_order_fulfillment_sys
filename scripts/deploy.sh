#!/usr/bin/env bash
#
# Idempotent deployment script for a single exe.dev VM (or any Docker host).
# Safe to run multiple times: pulls the latest code, rebuilds images, starts
# (or recreates only changed) services, waits for health checks, and prints
# status. See README.md "Deployment to exe.dev" for the full walkthrough.
#
# Usage: ./scripts/deploy.sh
# Run from the root of a git clone of this repository, on the target host.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

log() { echo "[deploy] $*"; }

log "Pulling latest code..."
if [ -d .git ] && git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  git pull --ff-only
else
  log "No upstream tracking branch (or not a git checkout) - skipping git pull, deploying working tree as-is"
fi

if [ ! -f .env ]; then
  log "No .env found, creating one from .env.example (edit it before relying on it in production)"
  cp .env.example .env
fi

log "Building images..."
docker compose build

log "Starting services (recreating only what changed)..."
docker compose up -d

log "Waiting for API to become ready..."
API_URL="http://localhost:8085"
for _ in $(seq 1 30); do
  if curl -fsS "$API_URL/ready" >/dev/null 2>&1; then
    log "API is ready."
    break
  fi
  sleep 2
done

if ! curl -fsS "$API_URL/ready" >/dev/null 2>&1; then
  log "ERROR: API did not become ready in time. Recent logs:"
  docker compose logs --tail=100 api worker
  exit 1
fi

log "Deployment status:"
docker compose ps

log "Health check:"
curl -fsS "$API_URL/health" && echo
curl -fsS "$API_URL/ready" && echo

log "Deploy complete."
