# vivify MASH demo — the showcase web app (apps/mash) as a static container.
#
# MASH is a static SPA: the @vivify/core engine runs entirely in the browser, and the
# only server it talks to is the (SEPARATE) voice container, which the *browser* calls
# directly. So this image ships NO Node runtime and NO voice/Wine/SAPI4 stack — just the
# production Vite build served by nginx. The voice service lives in services/voice-server.
#
# Build context is the REPO ROOT (MASH imports @vivify/core et al. from the pnpm
# workspace, so the build needs packages/* + the lockfile):
#   docker build -f apps/mash/Dockerfile -t vivify-mash .
# Run (internal port is fixed at 8090; map any host port with the standard -p flag):
#   docker run --rm -p 8090:8090 vivify-mash        # or -p 9000:8090 for a different host port
# See docs/cycles/cycle-9-dockerize-demo.md and ADR-0021.

# --- stage 1: build the production bundle ---
FROM node:20-slim AS build
RUN corepack enable
WORKDIR /repo

# The whole workspace (minus .dockerignore) — MASH's vite build resolves @vivify/core,
# @vivify/acs, @vivify/types from packages/* source, so we need them all present.
COPY . .
RUN pnpm install --frozen-lockfile

# Bake the default voice-server URL into the bundle (overridable, runtime-editable in the
# UI). Default is the local voice service so sound works out of the box; see characters.ts
# (resolveVoiceServerUrl). Override: docker build --build-arg VITE_VOICE_SERVER_URL=...
ARG VITE_VOICE_SERVER_URL=http://localhost:8080
ENV VITE_VOICE_SERVER_URL=${VITE_VOICE_SERVER_URL}

# Emit the workspace dependencies' dist/*.d.ts first. MASH's build runs `tsc --noEmit`,
# which resolves @vivify/core et al. from their built declarations (their `typecheck`
# script is `tsc --build`, which emits dist). `mash^...` selects mash's deps, not mash.
RUN pnpm --filter "mash^..." run typecheck
RUN pnpm --filter mash build

# --- stage 2: serve the static bundle ---
FROM nginx:alpine
# Replace the default server block with our SPA config (listens on 8090).
COPY apps/mash/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/mash/dist /usr/share/nginx/html
EXPOSE 8090
# nginx:alpine's entrypoint runs nginx in the foreground via its default CMD.
