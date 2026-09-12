# Crocle — Documentation

Crocle is a service that zips up folders on demand by orchestrating throwaway
`crazymax/7zip` Docker containers, and sends files or folders to any number of
recipients via throwaway `schollz/croc` containers. Both report live status over
a JSON API. A small React UI ships with it.

Stack: **Bun + Hono (API) + Vite + React (UI)**, all in one package.

---

## Architecture

Single npm/Bun package, no workspaces. API and UI live side by side and are
built into one `dist/` directory; one process serves both in production.

```
crocle/
├── src/
│   ├── server/           # Hono API
│   │   ├── index.ts      # bootstrap: docker client, sweep timer, Bun.serve
│   │   ├── app.ts        # createApp: /api routes + static UI serving
│   │   ├── files.ts      # file listing for the UI (traversal-safe)
│   │   ├── zip.ts        # ZipJob lifecycle: create, track, settle, stop, sweep
│   │   └── transfer.ts   # TransferJob lifecycle: croc send containers, stop, sweep
│   ├── components/ui/    # shadcn/ui components
│   ├── lib/utils.ts      # shadcn cn()
│   └── ui/               # React app
│       ├── main.tsx      # BrowserRouter + globals.css
│       ├── App.tsx       # header layout + routes
│       ├── Dashboard.tsx # file browser + selection card + jobs panel
│       ├── FileBrowser.tsx
│       ├── JobsPanel.tsx
│       ├── Acknowledgements.tsx
│       ├── types.ts      # FileEntry, ZipJob, mirrors the API
│       └── globals.css   # Tailwind v4 + theme variables (old Crocle palette)
├── components.json       # shadcn/ui config (style radix-nova)
├── index.html            # Vite entry
├── public/               # static files served as-is (logo.png)
├── vite.config.ts        # outDir dist/ui, dev proxy /api -> :3000, Tailwind plugin
├── scripts/dev.ts        # dev: spawns API + Vite together
├── data/                 # default FILES_DIR (gitignored)
├── dist/                 # build output (gitignored)
└── Dockerfile
```

### Development

`bun run dev` (via `scripts/dev.ts`) starts both apps; Ctrl-C stops both:

- **Hono API** on `:3000` (`bun --hot src/server/index.ts`)
- **Vite dev server** on `:5173`, proxying `/api/*` to `:3000`

The browser talks to Vite only; the proxy keeps dev CORS-free. In dev the API
serves no UI (no `dist/`), so `:3000` is API-only.

### Production

`bun run build` produces:

- `dist/ui/` — Vite build (fingerprinted assets)
- `dist/server.js` — the API bundled with `bun build --target bun`
  (plus two native `.node` assets from `ssh2`, a transitive dependency of
  `dockerode`)

`bun dist/server.js` serves everything from `:3000`:

- `/api/*` — JSON API
- `/assets/*` — hashed Vite assets, `Cache-Control: immutable, 1 year`
- any other path — the file from `dist/ui/` if it exists, else `index.html`
  (SPA fallback)
- unmatched `/api/*` — `404 {"error":"not found"}` (never the SPA page)

Static serving uses `serveStatic` from `hono/bun`.

### Docker

Two stages, mirroring the build:

1. **build**: `oven/bun:1-debian`, `bun install --frozen-lockfile`, `bun run build`
2. **runtime**: `oven/bun:1-alpine`, copies only `dist/` (no `node_modules`),
   non-root user, `HEALTHCHECK` on `/api/health`, `CMD bun dist/server.js`

The container needs `/var/run/docker.sock` mounted (Docker-in-Docker) to
spawn 7za and croc containers.

---

## Features

### 1. Zip a folder

`POST /api/compress` with body `{"path": "<relative to FILES_DIR>"}`.

Flow:

1. Path is resolved against `FILES_DIR`; anything escaping it is rejected (400).
2. Missing folder → 404.
3. If `<name>.zip` already exists, or a job for that output is already running → 409.
4. Any stale `.name.zip.partial` is deleted (7za `a` *appends*, so starting on a
   leftover partial would corrupt the archive).
5. The 7za image is pulled on first use, then a container is created:
   - `7za a -tzip -mx=1 -bsp1 /out/.name.zip.partial /data/.`
   - folder bound `:ro` at `/data`, output dir at `/out`
   - 500 MB memory limit
   - TTY so 7za emits progress and Docker stream headers are suppressed
   - labels: `crocle=true`, `crocle.job=zip`, `crocle.filename`,
     `crocle.output`, `crocle.partial`
6. Returns `202` with `{container_id, filename, status: "compressing"}`.

### 2. Live progress

Docker's log driver only flushes on newlines, and 7za's progress line
(` 47% 202 + file.bin`) never ends one — so `docker logs` shows nothing until the
job exits. Instead `track()` **attaches to the live container stream** and keeps
the latest parsed progress in an in-memory `Map` keyed by container id.

- `parseProgress` handles 7za's backspace-redraw format and keeps the highest
  percentage seen (readings can briefly go backwards).
- If crocle restarts mid-job, the next `GET /api/compress/:id` re-attaches and
  progress resumes from the next redraw.
- Once the container has exited, the log driver has flushed everything, so status
  reads parse the full `docker logs` instead.

### 3. Settle & publish

`settle()` (idempotent, called from the `wait()` callback, status reads, and the
sweep) finalizes finished containers:

- exit code 0 and no existing output → rename `<name>.zip.partial` → `<name>.zip`
- otherwise → delete the partial

### 4. Stop a job

`DELETE /api/compress/:id` force-removes the container and deletes the partial
zip unless the job had already finished successfully.

### 5. Cleanup sweep

`sweepZipJobs()` runs at startup and every 60 s:

- settles finished-but-unsettled containers (covers jobs that finished while
  crocle was down)
- removes finished containers older than 10 min (`FINISHED_TTL_MS`)

### 6. Send via croc

`POST /api/transfer` with body `{"path": "<relative to FILES_DIR>", "copies": 1}`.

Flow:

1. Path is resolved against `FILES_DIR`; anything escaping it is rejected (400).
2. Missing file/folder → 404. `copies` must be an integer between 1 and 10.
3. The croc image is pulled on first use, then **one container per copy** is
   created and started:
   - `croc send /data/<name>` (trailing `/` for folders, which croc ships as a zip)
   - target bound `:ro` at `/data/<name>`, 500 MB memory limit
   - TTY so logs stay free of Docker's stream headers
   - labels: `crocle=true`, `crocle.job=transfer`, `crocle.filename`
4. Returns `202` with the list of started jobs.

Each container prints `your croc code is: <code>` once it is ready; the code is
parsed from the container logs and exposed as `code` on the job. Status is
`waiting` while the container runs, `done` when the recipient finished the
download (exit 0), `failed` otherwise. `DELETE /api/transfer/:id` force-removes
the container. The sweep removes finished transfer containers after 10 min.

Note: croc coordinates through its public relay and then prefers a direct P2P
connection to the container. If the host is behind NAT without port mapping,
transfers fall back to the (slower) relayed path.

### 7. Web UI

React app (`src/ui/`), Tailwind CSS v4 + shadcn/ui, react-router. The dark
theme (`#0f0f0f` background, `#1a1a1a` cards, `#2a2a2a` borders, `#22c55e`
green primary, Inter + JetBrains Mono) is the original Crocle palette, kept in
CSS variables in `src/ui/globals.css`.

- **Dashboard (`/`)**: file browser (`GET /api/files`; click to select,
  double-click a folder to open, breadcrumb + back), selection card with the
  Send action (files and folders; opens a dialog asking how many copies to
  create, one croc code per copy) and Zip Folder action (folders only), a
  "Transfers" panel showing each transfer's croc code with a copy button and a
  stop button, and a "Current jobs" panel with status badge, progress bar,
  current file and stop button. Jobs and transfers poll their list endpoints
  every 5 s (15 s when the tab is hidden).
- **Acknowledgements (`/acknowledgements`)**: credits for the 7za container
  image and the logo artwork.

---

## API

| Method | Path              | Body               | Returns |
|--------|-------------------|--------------------|---------|
| GET    | `/api/health`     | —                  | `{status: "ok"}` |
| GET    | `/api/files`      | — (`?path=`)       | `{path, files: FileEntry[]}` (folders first) |
| DELETE | `/api/files`      | — (`?path=`)       | `{status: "deleted"}` (file or folder, recursive) |
| POST   | `/api/compress`   | `{path}`           | `202` `{container_id, filename, status}` |
| GET    | `/api/compress`   | —                  | `ZipJob[]` (all, incl. finished) |
| GET    | `/api/compress/:id`| —                 | `ZipJob` |
| DELETE | `/api/compress/:id`| —                 | `{status: "stopped"}` |
| POST   | `/api/transfer`   | `{path, copies}`   | `202` `TransferJob[]` (one per copy) |
| GET    | `/api/transfer`   | —                  | `TransferJob[]` (all, incl. finished) |
| GET    | `/api/transfer/:id`| —                 | `TransferJob` |
| DELETE | `/api/transfer/:id`| —                 | `{status: "stopped"}` |

### `ZipJob`

```typescript
interface ZipJob {
  container_id: string
  filename: string            // e.g. "game.zip"
  status: 'compressing' | 'done' | 'failed'
  progress: number            // 0-100, forced to 100 when done
  current_file?: string       // file 7za is currently adding
  exit_code?: number          // only when not running
}

interface TransferJob {
  container_id: string
  filename: string            // name of the sent file or folder
  status: 'waiting' | 'done' | 'failed'
  code?: string               // croc code, once printed
  exit_code?: number          // only when not running
}
```

### `FileEntry`

```typescript
interface FileEntry {
  name: string
  kind: 'folder' | 'file'
  path: string            // relative to FILES_DIR, "/"-separated
}
```

### Errors

`ZipError` → JSON `{error: message}` with 400 / 404 / 409; anything else → 500.

| Code | Meaning |
|------|---------|
| 400  | `path` missing, path escapes `FILES_DIR`, or invalid `copies` (1-10) |
| 404  | file/folder not found, or job id unknown / not the requested job type |
| 409  | output zip already exists, or a job for it is already running |

---

## Environment

| Variable | Default | Meaning |
|----------|---------|---------|
| `PORT` | `3000` | HTTP port |
| `FILES_DIR` | `data` | Where crocle sees the files; request paths are relative to this |
| `HOST_FILES_DIR` | `FILES_DIR` | Where the **Docker host** sees them; used for container bind mounts |

`FILES_DIR` vs `HOST_FILES_DIR` exist because when crocle itself runs in a
container with a bind mount, the two paths differ. `toHost()` maps between them.

Docker socket: `/var/run/docker.sock` (hardcoded).

---

## Scripts

| Script | What it does |
|--------|--------------|
| `bun run dev` | API (`:3000`, hot) + Vite (`:5173`) together, Ctrl-C stops both |
| `bun run build` | Vite → `dist/ui`, `bun build` → `dist/server.js` |
| `bun run serve` | Run the production bundle |
| `bun run start` | Build + serve |
| `bun run typecheck` | `tsc --noEmit` |

---

## Security

- **Path traversal**: request paths resolve against `FILES_DIR` and must stay
  inside it.
- **Read-only source**: the folder is bound `:ro`; 7za can only read it.
- **Isolation & limits**: one container per job, 500 MB memory cap, containers
  auto-removed after finishing.
- **Docker socket exposure**: crocle has full Docker daemon access. Anyone with
  API access effectively has host access. Keep the port private (e.g. reverse
  proxy + auth) if exposed beyond localhost.

---

## Known gaps

- **No tests.**
- `liveProgress` is in-memory; after a crocle restart, in-flight jobs report
  progress from the next 7za redraw only (see Live progress).
- Croc codes are in-memory only in the sense that they live in the container
  logs; stopping a transfer (`DELETE /api/transfer/:id`) revokes its code.
