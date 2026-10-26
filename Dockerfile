# =============================================================================
# Multi-stage Dockerfile for Amrutam Healthcare Backend
# Stage 1: Build TypeScript
# Stage 2: Production runtime (non-root, minimal image)
# =============================================================================

# ---- Stage 1: Builder ----
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm ci --ignore-scripts

# Copy source
COPY tsconfig*.json ./
COPY src/ ./src/
COPY prisma/ ./prisma/

# Generate Prisma client and compile TypeScript
RUN npx prisma generate
RUN npm run build

# ---- Stage 2: Production runtime ----
FROM node:22-bookworm-slim AS production

# Security: run as non-root user
RUN groupadd --gid 1001 amrutam && \
    useradd --uid 1001 --gid 1001 --no-create-home amrutam

WORKDIR /app

# Copy package files to install production-only dependencies
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && \
    npm cache clean --force

# Copy compiled output and Prisma artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma/migrations ./prisma/migrations

# Copy docs (for Swagger)
COPY docs/ ./docs/ 2>/dev/null || true

# Set ownership
RUN chown -R amrutam:amrutam /app

USER amrutam

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3000) + '/health/live', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

EXPOSE 3000

# Graceful shutdown with proper SIGTERM handling
CMD ["node", "dist/server.js"]
