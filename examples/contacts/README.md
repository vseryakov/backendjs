
# Contacts Example (BackendJS)

Small CRUD contacts app built on BackendJS with a simple Alpine/Bootstrap UI and a REST API. Uses SQLite by default and can be switched to other backends via `bkjs.conf`.

## Requirements

- Node.js `>= 24`
- BackendJS (installed via `npm install`)

## Quick start

```bash
npm install
npm run initdb
npm run start
```

Open `http://localhost:8000`.

## What’s inside

- API module: `modules/contacts.js`
- UI: `web/index.html`, `web/list.html`, `web/index.js`
- Seed script: `tools/seed.js`
- Config: `bkjs.conf`

## API endpoints

- `GET /api/contacts` (query: `q`, `start`, `count`)
- `POST /api/contacts`
- `GET /api/contact/:id`
- `PUT /api/contact/:id`
- `DELETE /api/contact/:id`

## Data model

Contacts are stored in the `contacts` table with:
`first_name`, `last_name`, `email`, `phone`, `logo`, `descr`, `ctime`, `mtime`.

## Database

SQLite is the default pool (`contacts.db`). Switch DB backends by setting the role in `bkjs.conf` (Postgres, DynamoDB, Elasticsearch, rqlite).

## License
BSD-3-Clause
