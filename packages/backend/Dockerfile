# syntax=docker/dockerfile:1.7
# Multi-stage build for @jasojeon/backend.
# Build context is the repo root (see docker-compose.yml: `context: .`).
# All stages use multi-arch images so this builds natively on OCI arm64.

ARG NODE_IMAGE=node:22-alpine

# ---------- deps stage ----------
# Installs the full workspace dep tree. Copies only package manifests first so
# this layer stays cached when source changes.
FROM ${NODE_IMAGE} AS deps
WORKDIR /app

# Root manifests
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./

# Workspace manifests (one COPY per package so Docker's layer cache invalidates
# only when the specific package.json changes).
COPY packages/shared/package.json   packages/shared/package.json
COPY packages/runner/package.json   packages/runner/package.json
COPY packages/web/package.json      packages/web/package.json
COPY packages/backend/package.json  packages/backend/package.json

RUN npm ci --workspaces --include-workspace-root

# ---------- build stage ----------
# Compiles @jasojeon/shared then @jasojeon/backend (backend depends on shared).
FROM ${NODE_IMAGE} AS build
WORKDIR /app

# Reuse installed modules from deps
COPY --from=deps /app/node_modules            ./node_modules
COPY --from=deps /app/package.json            ./package.json
COPY --from=deps /app/package-lock.json       ./package-lock.json
COPY --from=deps /app/tsconfig.base.json      ./tsconfig.base.json
COPY --from=deps /app/tsconfig.json           ./tsconfig.json

# Bring in the source for shared + backend only (web/runner not needed here).
COPY packages/shared  ./packages/shared
COPY packages/backend ./packages/backend

# Build shared first (backend references ../shared/dist/index.d.ts).
RUN node ./node_modules/typescript/lib/tsc.js -p ./packages/shared/tsconfig.json

# Generate drizzle SQL only if drizzle.config.ts exists (it does today; guarded
# so the stage keeps working if the backend ever switches migration tools).
RUN if [ -f ./packages/backend/drizzle.config.ts ]; then \
      cd ./packages/backend && \
      node ../../node_modules/.bin/drizzle-kit generate || true; \
    fi

# Build backend.
RUN node ./node_modules/typescript/lib/tsc.js -p ./packages/backend/tsconfig.json

# NOTE: we intentionally do NOT `npm prune --omit=dev` here. The runtime
# entrypoint invokes `drizzle-kit migrate`, and drizzle-kit is declared as a
# devDependency. Pruning would strip it. Image size cost is acceptable for a
# single-node self-host; revisit if this ever ships to many hosts.

# ---------- runtime stage ----------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Minimal runtime toolchain. `tini` gives proper PID 1 signal handling.
RUN apk add --no-cache tini

# Copy only the artefacts needed at runtime.
COPY --from=build /app/package.json                    ./package.json
COPY --from=build /app/package-lock.json               ./package-lock.json
COPY --from=build /app/node_modules                    ./node_modules
COPY --from=build /app/packages/shared/package.json    ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist            ./packages/shared/dist
COPY --from=build /app/packages/backend/package.json   ./packages/backend/package.json
COPY --from=build /app/packages/backend/dist           ./packages/backend/dist
# Migrations live under src/db/migrations — drizzle-kit migrate reads them at runtime.
COPY --from=build /app/packages/backend/drizzle.config.ts ./packages/backend/drizzle.config.ts
COPY --from=build /app/packages/backend/src/db/migrations  ./packages/backend/src/db/migrations

# Entrypoint runs migrations then starts the server.
COPY packages/backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Drop to the unprivileged `node` user that's shipped in the base image.
USER node

EXPOSE 4000

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "packages/backend/dist/index.js"]
