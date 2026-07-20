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

HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "process.exit(0)"

CMD ["node", "dist/index.js"]
