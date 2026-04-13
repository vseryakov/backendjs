# Events scraper and poster generation

![Screenshot1](shreenshot.jpg)
![Screenshot2](shreenshot2.jpg)

## What It Does

- Accepts URL submissions from a web UI.
- Creates async jobs in the `scraper` table.
- Worker opens the page in Puppeteer, auto-scrolls, and captures:
  - `full.png` full-page screenshot
  - `page.png` first-page screenshot
  - `page.html` rendered page source
  - `page.txt` text only content
  - `ld.json` - LD+JSON file
  - `ld.ical` - iCal file
  - `bg-[1...5].jpg` Gemeni generated backgrounds
- Pushes status updates over WebSocket (`pending` -> `done`/`error`).
- Generate background images from AI produced descriptions
- Generate poster examples for different profiles/layouts

## Stack

- Backend: Node.js + `backendjs`
- Browser automation: Puppeteer
- UI: Alpine.js + Bootstrap
- Default DB: SQLite (`var/scraper`)
- File storage: local `var/`

## Project Layout

```text
modules/api.js       # API routes + job handler + Puppeteer logic
modules/gemeni.js    # Gemeni API helper
web/index.html       # Main page shell
web/scraper.html     # Scraper UI
web/scraper.js       # Frontend component logic
web/render.html      # Alpine template for rendering posters
web/render.js        # Alpine component logic for rendering images via `/api/render`.
bkjs.conf            # Runtime, queue, db, files config
```

## Run Locally

1. Install dependencies:

   ```bash
   npm install
   puppeteer browsers install chrome
   ```

2. Create DB tables:

   ```bash
   npm run initdb
   ```

3. Create a config file $HOME/.bkjs.conf with Gemeni key

   gemeni-apikey=A........

3. Start server + worker:

   ```bash
   npm run start
   ```

4. Open:

   - App: `http://localhost:8000/`

## API Endpoints

- `GET /api/list` - list submitted jobs
- `POST /api/submit` - submit `{ "url": "https://example.com" }`
- `PUT /api/resubmit/:id` - requeue a job
- `DELETE /api/del/:id` - delete job and stored files
- `GET /api/asset/:id/page.png` - download screenshot
- `GET /api/asset/:id/page.html` - download saved HTML
- `PUT /api/render/:id` - render a poster with different parameters

## Notes

- This example currently exposes `/api/*` as public in `bkjs.conf`.

## Author
  Vlad Seryakov

