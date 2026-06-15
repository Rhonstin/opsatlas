# ── Build stage ──────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
ENV NO_UPDATE_NOTIFIER=true

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NO_UPDATE_NOTIFIER=true

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# node:20-alpine ships a non-root 'node' user — same posture as the frontend image
USER node

EXPOSE 4000

CMD ["node", "dist/index.js"]
