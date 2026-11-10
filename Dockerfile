# syntax=docker/dockerfile:1

# The whole game in one image: the API, which also serves the built web page.
# Same origin for both means the login cookie needs no cross-site setup.

# ---- Stage 1: install every dependency and compile both apps ----
FROM node:24-alpine AS build
WORKDIR /app

# Copy only the package files first. Docker caches each step, so as long as
# these don't change, the slow `npm ci` is reused even when source code changes.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY . .
RUN npm run build

# ---- Stage 2: only what's needed to run ----
# Starts again from a clean image: compilers, dev dependencies and source code
# from stage 1 are left behind, so the final image is smaller and exposes less.
FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    STATIC_DIR=/app/public
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace apps/api && npm cache clean --force

COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/migrations apps/api/migrations
COPY apps/api/data apps/api/data
COPY --from=build /app/apps/web/dist public

# Run as the unprivileged "node" user that the base image provides. The files
# above stay owned by root, so the running app can read its code but not change it.
USER node
WORKDIR /app/apps/api
EXPOSE 3000

# Lets Docker (and hosts that read it) know when the server is actually answering.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server.js"]
