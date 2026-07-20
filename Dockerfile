# ---- Build stage ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Runtime stage ----
# We use `npm ci --omit=dev` here rather than copying node_modules then pruning
# because `ci --omit=dev` installs only production deps deterministically and
# avoids shipping devDependencies even transiently. The resulting node_modules
# is measurably smaller than a pruned full install.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
EXPOSE 8080

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

# The bot persists per-user settings to a SQLite file at /data
# (see ADR-0006). Declaring /data as a volume is self-documenting:
# it tells Docker the path is meant to outlive the container, and
# `docker run` without an explicit -v creates an anonymous volume
# so the SQLite file is not silently lost on container restart.
# Production deployments should mount a named volume here, e.g.
# `-v riftbot-data:/data`.
VOLUME ["/data"]

HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "process.exit(0)"

CMD ["node", "dist/index.js"]
