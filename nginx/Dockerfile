# syntax=docker/dockerfile:1.7
# Edge nginx image. Build context is the repo root so we can also run the Vite
# build for @jasojeon/web in an earlier stage and copy the output into nginx.

ARG NODE_IMAGE=node:22-alpine
ARG NGINX_IMAGE=nginx:alpine

# ---------- web-build stage ----------
# Installs deps for the whole workspace (web depends on @jasojeon/shared which
# must be compiled first so its `dist/` exists for path-alias resolution) and
# produces packages/web/dist.
FROM ${NODE_IMAGE} AS web-build
WORKDIR /app

# Public base URL for the backend — baked into the Vite bundle at build time
# to flip the UI into hosted mode (packages/web/src/App.tsx reads this).
ARG HOSTED_API_BASE
ENV VITE_HOSTED_API_BASE=${HOSTED_API_BASE}

COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages/shared/package.json   packages/shared/package.json
COPY packages/runner/package.json   packages/runner/package.json
COPY packages/web/package.json      packages/web/package.json
COPY packages/backend/package.json  packages/backend/package.json

RUN npm ci --workspaces --include-workspace-root

COPY packages/shared ./packages/shared
COPY packages/web    ./packages/web

# Shared must be compiled before web's tsc --project runs against it.
RUN node ./node_modules/typescript/lib/tsc.js -p ./packages/shared/tsconfig.json

# Vite build. `tsc -p` first to surface type errors, then vite bundles.
# Vite 5.x `build` subcommand rejects `--root`; cd into the package instead.
RUN node ./node_modules/typescript/lib/tsc.js -p ./packages/web/tsconfig.json \
 && cd ./packages/web \
 && node ../../node_modules/vite/bin/vite.js build

# ---------- nginx runtime ----------
FROM ${NGINX_IMAGE} AS runtime

# Replace the default site config. conf.d/default.conf is the file nginx:alpine
# loads first via /etc/nginx/nginx.conf's `include /etc/nginx/conf.d/*.conf`.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx/conf.d/jasojeon.conf /etc/nginx/conf.d/default.conf

# Vite bundle.
COPY --from=web-build /app/packages/web/dist/ /usr/share/nginx/html/

# Placeholder certbot webroot (mounted over in compose but create the path so
# the HTTP acme-challenge location works even without a bind mount).
RUN mkdir -p /var/www/certbot

EXPOSE 80 443
