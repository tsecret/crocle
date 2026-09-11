# ── Build ────────────────────────────────────────────────────────────────────
FROM oven/bun:1-debian AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY index.html vite.config.ts tsconfig.json ./
COPY public/ public/
COPY src/ src/

RUN bun run build

# ── Runtime ──────────────────────────────────────────────────────────────────
# The server is bundled (plus two native .node assets from ssh2, a dockerode
# transitive dependency), so the runtime image carries no node_modules at all.
FROM oven/bun:1-alpine
WORKDIR /app

# oven/bun:1-alpine already ships a non-root user (node, uid/gid 1000)
COPY --from=build --chown=node:node /app/dist dist

ENV PORT=3000
EXPOSE 3000
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "dist/server.js"]
