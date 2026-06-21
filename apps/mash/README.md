# MASH — the vivify showcase demo

A browser MASH-clone that brings Microsoft Agent characters back to life. It is the
showcase and dogfood for `@vivify/core`'s public API — built **only** on `createAgent`
+ the Agent control surface, no internals, no `@vivify/acs`. It's a static single-page
app: the engine and all logic run in the browser; the only server it talks to is the
voice service, and that call happens **client-side** from the browser.

Ships **no** `.acs` files and **no** Microsoft/L&H IP. Upload your own `.acs` to use it.

The package name is `mash` (so pnpm filters are `--filter mash`, not `@vivify/mash`).

## Run it (Docker)

One command builds it, one runs it. Build from the **repo root** — the build context is
the repo root because MASH imports the workspace packages (`@vivify/core` & friends).

```sh
docker build -f apps/mash/Dockerfile -t vivify-mash .
docker run --rm -p 8090:8090 vivify-mash
```

Then open <http://localhost:8090>.

### Change the host port
The container always listens on **8090** internally. Map any host port with the standard
Docker flag — the internal port never changes:

```sh
docker run --rm -p 9000:8090 vivify-mash   # now on http://localhost:9000
```

## The two containers

MASH (static, **8090**) and the voice service (`services/voice-server`, **8080**) are
**separate** images. They are not networked container-to-container: the voice call is
made by the **browser** on the host, so both just publish their ports, and the browser
reaches `localhost:8090` and `localhost:8080`. (CORS is handled — the voice server
reflects the request Origin.)

The MASH image contains **no** Wine/SAPI4 and ships no MS/L&H IP.

## Voice URL default

MASH pre-fills the "Voice server URL" field with `http://localhost:8080`, so sound works
automatically when the voice container is running — no manual paste. The field is
editable (point it at another host), and **clearing it goes silent** (stub provider).

Bake a different default into the bundle at build time:

```sh
docker build -f apps/mash/Dockerfile \
  --build-arg VITE_VOICE_SERVER_URL=https://my-voice.example \
  -t vivify-mash .
```

## Run both together

From the repo root:

```sh
docker compose up          # MASH on 8090 + voice on 8080
docker compose up mash     # just the demo (no voice binaries needed)
```

## The voice binaries

The authentic voice needs user-supplied engine files. Drop `spchapi.exe` and
`tv_enua.exe` into `services/voice-server/vendor/` (gitignored; never committed) and
build the voice container. We ship none. See `../../services/voice-server/README.md` and
`../../docs/legal-and-assets.md`.

## Local dev (non-Docker)

```sh
pnpm --filter mash dev     # Vite dev server
```
