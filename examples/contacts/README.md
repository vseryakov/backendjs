
# Contacts Example (BackendJS)

Small CRUD contacts app built on BackendJS with a simple Alpine/Bootstrap UI and a REST API. Uses SQLite by default and can be switched to other backends via `bkjs.conf`.

## Requirements

- Node.js `>= 24`
- BackendJS (installed via `npm install`)

### First Time Setup

1. This is an example inside the backendjs repository, so first you need to clone backendjs
   it if it does not exist yet, skip to the next item if you have it

  ```
  git clone --depth 1 https://github.com/vseryakov/backendjs.git
  ```

2. Navigate to the example:

  ```
  cd backendjs/examples/contacts
  ```

3.. Prepare and start the example

  ```
  npm run setup
  npm run start
  ```

4. Visit [http://localhost:8000](http://localhost:8000)


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

### To use DynamoDB

```bash
npm run initdb -- -app-roles dynamodb
npm run start -- -app-roles dynamodb
```

### To use PostgreSQL

```bash
npm run initdb -- -app-roles pg
npm run start -- -app-roles pg
```

## License
BSD-3-Clause
