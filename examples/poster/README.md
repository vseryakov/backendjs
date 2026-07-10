# Poster Composer (Backend.js Example)

Small Backend.js sample that renders social poster images server-side with `sharp`, plus a browser UI to compose layers and send them to the API.

![Screenshot](screenshot.jpg)

**What’s here**

- `modules/api.js`: API endpoint that composes images and text overlays.
- `web/index.html`: UI main page
- `web/poster.html` + `web/poster.js`: Alpine component for listing
- `web/render.html` + `web/render.js`: UI Alpine component for rendering images via `/api/render`.

**Run**

### First Time Setup

1. This is an example inside the backendjs repository, so first you need to clone backendjs
   it if it does not exist yet, skip to the next item if you have it

  ```
  git clone --depth 1 https://github.com/vseryakov/backendjs.git
  ```

2. Navigate to the example:

  ```
  cd backendjs/examples/poster
  ```

3.. Prepare and start the example

  ```
  npm install -g sharp
  npm run setup
  npm run start
  ```

4. Visit [http://localhost:8000](http://localhost:8000)


**API**

- `POST /api/render` accepts multipart form data.
- Each form field contains JSON options for a layer; file fields are matched by the same key.
- The first uploaded image becomes the background; subsequent layers (text or images) are composited on top.

**Notes**

- Backend.js is pulled from GitHub (`backendjs`).
- The UI uses Bootstrap and Alpine;
- for testing images from the web folder can be used, just specify in the file path:
  - web/woman.jpg
  - web/man.jpg
  - web/bg.jpg
  - web/bg2.jpg
  - web/bg3.jpg
