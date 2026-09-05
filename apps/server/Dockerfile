# Runs the Fastify API. The server is executed through tsx because `npm run build`
# currently only typechecks (tsc --noEmit) and emits no JavaScript; switch this to a
# compiled entrypoint once the build step produces dist output.
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

# Copy every workspace manifest first so dependency installation stays cacheable.
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/story-engine/package.json packages/story-engine/
COPY packages/ai-orchestrator/package.json packages/ai-orchestrator/

# tsx is a devDependency and is required at runtime, so dev deps are kept.
RUN npm ci --include=dev --ignore-scripts

COPY tsconfig.base.json ./
COPY packages packages
COPY apps/server apps/server

# SQLITE_DATABASE_PATH should point into a mounted volume in real deployments.
ENV SQLITE_DATABASE_PATH=/app/data/instory.sqlite
ENV HOST=0.0.0.0
ENV PORT=4000
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start", "-w", "apps/server"]
