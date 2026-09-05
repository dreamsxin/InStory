# Builds and serves the Next.js reader/creator app.
FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/story-engine/package.json packages/story-engine/
COPY packages/ai-orchestrator/package.json packages/ai-orchestrator/

RUN npm ci --include=dev --ignore-scripts

COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web

# NEXT_PUBLIC_* values are inlined at build time, so the API base must be known here.
ARG NEXT_PUBLIC_API_BASE=http://localhost:4000
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w apps/web

FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules node_modules
COPY --from=builder /app/packages packages
COPY --from=builder /app/apps/web apps/web

USER node
EXPOSE 3000

# ADMIN_TOKEN is read by server components and server actions only; it must be
# supplied at runtime and must never be exposed as a NEXT_PUBLIC_* variable.
CMD ["npm", "run", "start", "-w", "apps/web"]
