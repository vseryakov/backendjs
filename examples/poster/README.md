# Poster Composer (Backend.js Example)

Small Backend.js sample that renders social poster images server-side with `sharp`, plus a browser UI to compose layers and send them to the API.

**What’s here**

- `modules/poster.js`: API endpoint that composes images and text overlays.
- `web/index.html` + `web/index.js`: UI for adding layers and rendering via `/api/render`.
- `web/vibe-poster.html`: standalone, browser-only poster creator (no backend).

**Run**

1. Install dependencies:
   - `npm install`

2. Start the server:
   - `npm run start`

3. Open in a browser:
   - `http://localhost:8000`

**API**

- `POST /api/render` accepts multipart form data.
- Each form field contains JSON options for a layer; file fields are matched by the same key.
- The first uploaded image becomes the background; subsequent layers (text or images) are composited on top.

**Notes**

- Backend.js is pulled from GitHub (`backendjs`).
- The UI uses Bootstrap and Alpine;
- The standalone `web/vibe-poster.html` uses CDN assets and is not related, just a vibe coded page for fun.

**License**
BSD-3-Clause
