# Build the static site, then serve it with Caddy behind HTTP basic auth.
# Build context is the project root (workout-program/) so the build can read
# PLAN.md and tracking/. Deploy with:
#   flyctl deploy --config site/fly.toml --dockerfile site/Dockerfile \
#     --build-arg GIT_SHA=$SHA --build-arg BUILD_TIME="$WHEN"
# run from inside workout-program/.

# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /app
COPY site/package.json ./site/
RUN cd site && npm install --no-audit --no-fund
# Markdown sources (the source of truth) + the generator.
COPY PLAN.md athlete-profile.md ./
COPY tracking ./tracking
COPY site ./site
ARG GIT_SHA=dev
ARG BUILD_TIME=
ENV GIT_SHA=$GIT_SHA
ENV BUILD_TIME=$BUILD_TIME
RUN cd site && node build.mjs

# ---- serve stage ----
FROM caddy:2-alpine
COPY site/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/site/dist /srv
EXPOSE 8080
