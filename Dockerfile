# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build stage: compile TypeScript -> JavaScript with dev dependencies
# available. Nothing from this stage ships in the final image.
#
# Uses the Debian-based "slim" image rather than Alpine: @temporalio/worker
# ships a prebuilt native addon (core-bridge) linked against glibc, which
# fails to load under Alpine's musl libc (`Error loading shared library
# ld-linux-x86-64.so.2`). node:20-slim gives us glibc while staying much
# smaller than the full node:20 image.
# ---------------------------------------------------------------------------
FROM node:20-slim AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------------------------------------------------------------------------
# Production stage: only the compiled JavaScript + production dependencies.
# The TypeScript source, dev dependencies, and compiler never reach here.
# ---------------------------------------------------------------------------
FROM node:20-slim AS production
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/dist ./dist

# Run as a non-root user rather than the image's default root.
RUN groupadd --system appgroup && useradd --system --gid appgroup appuser
USER appuser

# Overridden by docker-compose.yml's `command:` to select api vs worker.
CMD ["node", "dist/api/server.js"]
