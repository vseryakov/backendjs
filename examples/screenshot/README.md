# Screenshot Example

Small `backendjs` example app that queues website capture jobs, takes full-page screenshots with Puppeteer, and stores both image and HTML output.

## What It Does

- Accepts URL submissions from a web UI.
- Creates async jobs in the `scraper` table.
- Worker opens the page in Puppeteer, auto-scrolls, and captures:
  - `*.png` full-page screenshot
  - `*.html` rendered page source
- Pushes status updates over WebSocket (`pending` -> `done`/`error`).

## Stack

- Backend: Node.js + `backendjs`
- Browser automation: Puppeteer
- UI: Alpine.js + Bootstrap
- Default DB: SQLite (`var/scraper`)
- Queue: Redis (`queue-default=redis://`)
- File storage: local `var/`

## Project Layout

```text
modules/scraper.js   # API routes + job handler + Puppeteer logic
web/index.html       # Main page shell
web/list.html        # Screenshot list UI
web/index.js         # Frontend component logic
bkjs.conf            # Runtime, queue, db, files config
```

## Run Locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create DB tables:

   ```bash
   npm run initdb
   ```

3. Start server + worker:

   ```bash
   npm run start
   ```

4. Open:

   - App: `http://localhost:8000/app`
   - API list endpoint: `http://localhost:8000/api/list`

## API Endpoints

- `GET /api/list` - list submitted jobs
- `POST /api/submit` - submit `{ "url": "https://example.com" }`
- `PUT /api/resubmit/:id` - requeue a job
- `DELETE /api/del/:id` - delete job and stored files
- `GET /api/png/:id` - download screenshot
- `GET /api/html/:id` - download saved HTML

## Notes

- This example currently exposes `/api/*` as public in `bkjs.conf`.
- `node_modules` is symlinked from a parent directory in this workspace.
