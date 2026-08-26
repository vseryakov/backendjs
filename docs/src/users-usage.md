# Using the Users Module

User management is split across three small modules that work together:

| Module | Role |
|--------|------|
| `api.users` | Data layer — the user table wrapper plus `get`/`add`/`update`/`del`, password hashing, and authentication logic (session, token, MFA/TOTP). |
| `middleware.users` | HTTP layer — the ready-to-mount handlers for `/login`, `/logout`, `/profile`, and the guard middleware that verifies + authorizes every request. |
| `api.acl` | Authorization — named regex lists grouped by role that decide which paths a given role may access. |

Supporting pieces:

- `api.session` — cookie session create / parse / verify, signed (and optionally encrypted) with the user's secret.
- `api.token` — API bearer-token create / parse, reusing the same users table.

Everything has two forms — callback and async (add the `a` prefix). This guide uses the async form.

```js
const { api, lib, db, logger } = require("backendjs");
const { middleware } = require("backendjs");
const { users, body } = middleware;

app.start({ api: true });
```

---

## Enabling the module in config

The module does nothing until you give it a table name. Add it to `bkjs.conf` and the users table is created for you on startup:

```
api-users-table = bk_user
```

`configure` turns the default `schema` (see below) into a `db.tables` entry, expanding the `1`-sized `length`/`max` placeholders to the configured `max-length`.

### Module config parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `api-users-table` | string | — | Name of the user table. Required to enable anything. |
| `api-users-max-length` | int (≥10) | `140` | Max length for `login`/`name` columns. |
| `api-users-mfa-age` | int (≥30000) | `600000` | Age of a MFA code in ms (10 min default). |
| `api-users-err-<case>` | string | — | Override any error message (e.g. `api-users-err-invalid-login = ...`). |

### Schema

The default schema is exposed as `api.users.schema` — customize it before `configure` runs by overriding columns. Each value is a `DbTableColumn`:

| Column | Type | Notes |
|--------|------|-------|
| `login` | string, primary | Email, username or any unique identifier used to log in. Case-sensitive. |
| `id` | uuid, unique index | Auto-generated UUIDv4, the stable user id. |
| `name` | string | Full name (required on `add`). |
| `roles` | set | List of role names used by ACL authorization (lowercased on write). |
| `flags` | set | Free-form tags / feature flags. |
| `secret` | string | Hashed password, produced by `lib.prepareSecret` (`scrypt` `salt:key`). |
| `totp_secret` | text | Base32 TOTP secret. Its mere presence enforces a TOTP code on every login. |
| `mfa_code` | text | One-time verification. Stored as `code,expires,method`. Presence enforces an MFA code. |
| `pushkey` | text | Push tokens, format `[service://]token[@app]`. |
| `passkey` | text | WebAuthn passkey material. |
| `sessions` | set<int> | Live cookie sessions as a list of expiration times in ms. |
| `create_time` | now, read_only | Auto-set at creation. |
| `update_time` | now | Auto-updated on every write. |
| `access_time` | bigint | Last request time while authenticated. |
| `login_time` | bigint | Last successful login. |
| `expire_time` | bigint | If set and in the past, access is denied. Use to disable accounts. |

---

## CRUD operations

All find/update/delete operations locate a user by `login` or `id`. A plain string is accepted and coerced to `{ login }` or `{ id }` depending on whether it looks like a UUID (`lib.isUuid`, with the table's optional id prefix).

### Get a user

```js
// by login
const { err, data: user } = await api.users.aget("john@mail.com");

// by id
const { err, data: user } = await api.users.aget("00000000-0000-0000-0000-000000000001");

// explicit
const { err, data } = await api.users.aget({ login: "john@mail.com" });
```

Looking up by `id` goes through `db.select` with a `cacheKeyName: "id"`, so cached lookups are cheap (see *Caching* below).

### Add a user

`login` and `name` are required. Never store a plaintext password — hash it first:

```js
// Hash a plaintext password -> "secret:salt"
const { err, secret } = await lib.aprepareSecret("sup3rSecret!");
if (err) throw err;

const { data: user } = await api.users.aadd({
     login: "john@mail.com",
     name:  "John Doe",
     roles: ["user"],
     flags: ["premium"],
     secret,
}, { returning: "*", first: 1 });

console.log(user.id);   // auto-generated UUID
```

Note: `api.users.add` normalizes a non-UUID `id` away so the DB always generates a fresh UUID.

### Update a user

Updates by `login` (required). Any other field is applied; `name`/`id` that don't parse are dropped.

```js
const { err, data } = await api.users.aupdate({
     login: "john@mail.com",
     name: "John Q. Doe",
     roles: ["admin"],
     expire_time: Date.now() + 30 * 86400000,   // disable after 30 days
});
```

### Delete a user

```js
await api.users.adel("john@mail.com");
await api.users.adel({ id: "..." });
```

Deletion by `id` resolves the `login` first (the `login` column is the primary key), so the record that comes back in `returning: "old"` is complete.

### Field cleanup for API responses

Never return internal fields (`secret`, `sessions`, `totp_secret`, …) to a client. `cleanup` strips everything marked for privacy via the schema and `db.cleanupResult`:

```js
api.users.cleanup(user);   // safe to send to the browser
```

---

## Shell commands

Users and tokens can be created from the CLI with no application code. Each command exits with the new `id` (or token) on stdout.

```sh
# Create a session user, auto-hashes the secret
bksh -user-add login admin secret XXXXX name "Admin" roles admin
# => '136ea1b9fb1778bd2d37096d'

# Create an API token (bearer), the token string is returned on stdout
bksh -user-add-token name "API client" flags api -prefix api_

# Look up users
bksh -user-get id-or-login ...

# Change a password (re-hashes), update fields
bksh -user-update login john@mail.com name "John"

# Delete users
bksh -user-del id-or-login ...

# Hash a single password to paste into config / DB
bksh -user-secret 'plaintext'

# Trigger an MFA email code to one or more users
bksh -user-send-mfa [-subject S] [-text T] login-or-id ...
```

---

## Password hashing

Passwords are never stored in the clear. `secret` holds a salted `scrypt` hash formatted `key:salt`.

```js
// Store (used by -user-add and the user-add flows)
const { err, secret } = await lib.aprepareSecret("plaintext"); // => "base64key:base64salt"
await api.users.aadd({ login, name, secret });

// Verify
const { err, ok } = await lib.acheckSecret(user.secret, "plaintext");
// ok === true when the password matches; timing-safe compared
```

`api.users.checkSecret` / `acheckSecret` wrap a lookup + hash compare and return the matching user on success, `{ status: 401 }` otherwise:

```js
const { err, user } = await api.users.acheckSecret({ login: "john@mail.com", secret: "plaintext" });
```

---

## Cookie session authentication

This is the browser-facing flow. A session is a cookie signed by the user's secret (encrypted when `api.session.secret` is configured). Live sessions are tracked in `user.sessions` as a list of expiration timestamps.

`verifySession` (used inside the middleware) does, in order:

1. Parse the session cookie with `api.session.parse`. No cookie → `401 errInvalidSession`.
2. If already attached (`context.user.id === session.id`) reuse it.
3. Look up the user by `session.id`. Not found → `401`.
4. If `expire_time` is set and in the past → `401` (account disabled/expired).
5. Require the `session.exp` to be present in `user.sessions` **and** the cookie signature to verify against `user.secret` (`api.session.verify`). Either failing → `401`.
6. Attach `context.user = user`.

A failed lookup or an expired session leaves the client unauthenticated; the guard middleware then either replies `401` or redirects to `login-redirect` (see config).

---

## API token authentication

For server-to-server / API access, tokens reuse the same users table — a token *is* a user where `login` holds the public token prefix and `secret` holds the hashed token secret. See `api.token.create` / `api.token.parse`.

A bearer token is sent as:

```
Authorization: Bearer <prefix><uuid><uuid>
Authorization: Basic base64(<prefix><uuid><uuid>)
```

`token.parse` splits at `lastIndexOf("_") + 33` to separate id (public) from secret (private, never exposed). `verifyToken` then:

1. Parses the token. Missing → `401`.
2. Looks up the user by the public `login` part. Not found → `401`.
3. Checks `expire_time`.
4. Compares the stored `secret` (a SHA-256 hash) against `lib.hash(token.secret)` in a timing-safe way.
5. Attaches `context.user`.

Create a token programmatically:

```js
const context = new (require("backendjs").api.RequestContext)();
const session = require("backendjs").api.token.create(context, { prefix: "api_" });
// session = { type, id: "api_<uuid>", secret: hash(uuid), token: "api_<uuid><uuid>" }

await api.users.aadd({
     login:  session.id,
     name:   "API client",
     roles:  ["api"],
     secret: session.secret,
}, { returning: "*", first: 1 });

// Hand `session.token` to the client; it sends it in the Authorization header
```

---

## MFA / TOTP

Two mechanisms, both opt-in by having a value stored on the user. When `login` runs and either is set, a `code` must accompany the credentials, otherwise the callback receives an error with `code: "MFA"` so the UI can prompt for the second factor.

### TOTP (authenticator apps)

`totp_secret` present ⇒ TOTP required every login.

```js
// Enable TOTP for a user
const user = await api.users.aget("john@mail.com");
api.users.prepareTOTP(user);                       // sets user.totp_secret (base32)
await api.users.aupdate({ login: user.login, totp_secret: user.totp_secret });

// ... client adds the secret to a TOTP app, then logs in with:
await api.users.alogin({
     body: { login: "john@mail.com", secret: "plaintext", totp_code: "123456" },
});
```

`totp_code` is checked against `lib.totp(user.totp_secret, ...)` (RFC-ish HOTP: 30s interval, 6 digits).

### Email / one-time code MFA

`mfa_code` present ⇒ a one-time code required. `prepareMFA` mints a 6-digit code and stores it as `code,expires,method`.

```js
const user = await api.users.aget("john@mail.com");
const code = api.users.prepareMFA(user, { method: "email" }); // sets user.mfa_code
await api.users.aupdate({ login: user.login, mfa_code: user.mfa_code });

const { sendmail } = require("backendjs");
await sendmail.asend({
     to:      user.login,
     subject: "Your verification code",
     text:    `Your verification code is ${code}`,
});

// Client logs in with the code; it is cleared on success
await api.users.alogin({
     body: { login: "john@mail.com", secret: "plaintext", mfa_code: String(code) },
});
```

### The login flow, step by step

`api.users.login(context, callback)` (and `alogin`) is the heart of the module:

1. Validate `context.body` for `login` + `secret` (both required); `totp_code`/`mfa_code` optional. Validation errors are returned via `api.validate` with the size limits applied automatically.
2. `checkSecret` — lookup by login/id and verify the password.
3. Reject if `expire_time` is in the past.
4. If `totp_secret` is set, require a matching `totp_code`. If `mfa_code` is set, require a matching, still-valid `mfa_code`. A *failed or missing* required code returns `401` with `code: "MFA"` **and the partially-verified user** in the data position, so you can send the code back:

```js
api.app.post("/login", body, (context) => {
     api.users.login(context, async (err, user) => {
         if (err?.code === "MFA" && user.mfa_code) {
             const code = api.users.prepareMFA(user);
             await api.users.aupdate({ login: user.login, mfa_code: user.mfa_code });
             await sendmail.asend({ to: user.login, subject: "Verification code", text: `Code: ${code}` });
             return context.reply(err);        // 401, MFA requested
         }
         context.reply(err, api.users.cleanup(user));
     });
});
```

5. On success: `prepareSession` mints a new cookie session, prunes expired sessions, pushes the new `exp`, and `update` persists `login_time`, `access_time`, and `sessions` (clearing `mfa_code`).

> Note: the session write is intentionally *not* atomic — simultaneous logins from many places overwriting `sessions` are not supported.

---

## Middleware handlers

`middleware.users` exposes ready-to-mount `(context, [next])` handlers. Import via `const { users } = require("backendjs").middleware;` or `require("backendjs").middleware.users`.

### Guard middleware

The guard runs `verifySession` (cookie) or `verifyToken` (bearer) and then `authorize`. On auth failure the cookie guard either **redirects** to `login-redirect` (302) or **replies** with the 401 — configured per deployment.

```js
// Cookie-guarded routes (redirect to login when unauthenticated)
const { users } = require("backendjs").middleware;
api.app.use("/portal/*", users);                 // -> users.handle

// Bearer-token-guarded API routes (always 401 on failure)
api.app.use("/api/*", { handle: users.handleToken });
```

### Login

```js
// Must be public. Body must contain { login, secret }.
api.app.post("/login", body, users.login);
```

`users.login` calls `api.users.login` and replies with the cleaned user or the error.

### Logout

```js
api.app.post("/logout", users.logout);
```

Requires a valid session. Clears the current session cookie and removes expired sessions. Passing `?force=1` in the query clears **all** of the user's sessions.

### Profile

```js
api.app.get("/profile", users.profile);
```

Requires a valid session and returns the cleaned current user as JSON — handy as a "is my session still alive?" probe.

---

## Authorization (ACL)

After a user is authenticated, `middleware.users.authorize` decides whether this role may reach this path. Rules come from `api.acl`, configured via `api-acl-*`. At least one allow must match and zero denies may match, else the request is blocked.

`authorize` returns `undefined` on success, or one of these errors:

| Result | HTTP | `code` | When |
|--------|------|--------|------|
| denied | `403` | `DENY` | A deny rule matched one of the user's roles. |
| no match | `403` | `NOMATCH` | No allow rule matched, and no public `*` ACL matched. |
| allowed | — | — | An allow rule matched, or the path matched a `*` ACL. |

The error messages come from configured `middleware-users-err-deny` / `middleware-users-err-nomatch` (via the `err-(.+)` config pattern).

Define ACLs as groups of regexes named and assigned to roles:

```
# A named ACL is a list of path regexes
api-acl-add-admin  = ^/admin
api-acl-add-api    = ^/api
api-acl-add-public = ^/profile
api-acl-add-public = ^/app

# Assign ACLs to a role. A leading "-" means deny that ACL for the role.
api-acl-allow-admin  = admin, -public
api-acl-allow-user   = user, public, -admin
```

ACL matching (`api.acl.isMatched`) returns the first matched ACL name, or the negative match when an entry starts with `-`. `isAllowed` / `isDenied` iterate the roles on `context.user.roles`.

### Global / programmatic mounting modes

The guard can be wired two ways.

**Programmatic (full control)** — mount handlers yourself:

```js
const { api, middleware } = require("backendjs");
const { users, body } = middleware;

api.app.post("/login",  body, users.login);
api.app.post("/logout", users.logout).get("/profile", users.profile);

api.app.use("/api/*",  users);                       // cookie guard
api.app.all("/api/*",  body, { handle: users.handleToken });  // token guard
```

**Global config** — let `configureMiddleware` wire the routes from config. The `#priority` prefix orders the guard before your application handlers:

| Parameter | Description |
|-----------|-------------|
| `middleware-users-enable` | Comma-list of paths guarded by the **cookie** session guard (e.g. `/app/*, /admin/*`). |
| `middleware-users-enable-token` | Comma-list of paths guarded by the **token** guard (e.g. `/api/*`). |
| `middleware-users-login-path` | Path for the login handler (`POST`). |
| `middleware-users-logout-path` | Path for the logout handler (`POST`). |
| `middleware-users-profile-path` | Path for the profile handler (`GET`). |
| `middleware-users-login-redirect` | Location to `302` to when the cookie guard blocks (e.g. `/login.html`). |
| `middleware-users-priority` | Sort priority (`#NUM`) for the guard routes. |
| `middleware-users-err-<case>` | Override any error message, e.g. `middleware-users-err-deny`. |

`enable`/`enable-token` paths are mounted under the same priority as the login/logout/profile routes so the guard always runs first.

---

## Rate limiting

Authentication endpoints should always be rate-limited. The `middleware.limiter` module keys rules by IP, path, user, or session. Example config: 1 login/second per IP, 10/second globally, and a user may logout at most once per 10 seconds:

```
middleware-limiter-enable = true
middleware-limiter-ip-post-/login     = rate:1
middleware-limiter-path-post-/login   = rate:10
middleware-limiter-user-post-/logout  = rate:1, interval:10
```

Pair login with `middleware-validate` to enforce that credentials are well-formed and to add brute-force backoff.

---

## A complete configuration

This matches the `users` role in `tests/bkjs.conf` — a working example with cookie and token guards plus ACLs.

```
api-users-table = bk_user

middleware-body-enable = true

# Cookie-guarded areas
middleware-users-enable         = /app/*, /admin/*, /staff/*
middleware-users-login-path     = /login
middleware-users-logout-path    = /logout
middleware-users-profile-path   = /profile
middleware-users-login-redirect = /login.html

# Public endpoints
api-acl-add-* = ^/(app|profile|logout)

# Role-gated endpoints
api-acl-add-admin = ^/admin
api-acl-allow-admin = admin

api-acl-add-staff = ^/staff
api-acl-allow-staff = staff

# Token-guarded API area: only the "api" role may use bearer tokens
middleware-users-enable-token = /api/*
api-acl-add-api = ^/api
api-acl-allow-api = api
```

Result: `/app/*`, `/admin/*`, `/staff/*` require a logged-in session; `/admin/*` additionally needs the `admin` role and `/staff/*` needs `staff`. `/api/*` requires a valid bearer token held by a user with the `api` role. Unauthenticated cookie requests to a guarded path are redirected to `/login.html`.

---

## Caching

Caching user lookups avoids DB hits on the hot authentication path. This is configuration only:

```
db-cache-tables = bk_user
db-cache-ttl-bk_user = 3600000
db-cache-name-bk_user = redis
```

Lookups by `id` already request `cacheKeyName: "id"`, so id-based session verification serves from cache when enabled.

---

## How the module fits the test suite

`tests/users.test.js` exercises the whole stack against a real server. The relevant flow:

- A `before` hook seeds a token user: it reads a UUID user, sets its `secret` to `lib.hash(token)`, and builds `authorization = "Bearer " + login + token`.
- **token access** — `/api/*` fails with `401` until the `Authorization` header is sent, then succeeds.
- **user access** — `/` serves content, guarded paths (`/app/*`, `/api/*`, `/profile`) redirect to `/login.html` for anonymous clients; `POST /login` with the wrong secret gives `401`, the right one `200` and sets a session cookie; afterward `/app/1` works but `/admin/1` is `403` (no role).
- **admin access** — same, logged in as the `admin` user, so `/admin/1` returns `200` but `/staff/1` is `403`.
- **TOTP access** / **MFA access** — after enabling `totp_secret`/`mfa_code`, login first returns `401` with `code: "MFA"`, then succeeds when the correct `totp_code`/`mfa_code` is supplied.

---

## Quick reference

**Data (`api.users`)**
- `aget(query|id|login)` → user by `login` or `id`
- `aadd(record, opts)` → create (`login`, `name` required)
- `aupdate({ login, ... })` → update by login
- `adel(query|id|login)` → delete
- `acheckSecret({ login|id, secret })` → `{ err, user }`
- `verifySession(context, cb)` / `verifyToken(context, cb)` → attach `context.user`
- `cleanup(user)` → strip private fields for API responses

**Passwords / tokens (`lib`, `api.token`)**
- `lib.aprepareSecret(text)` / `lib.acheckSecret(hash, text)`
- `api.token.create(context, { prefix })` → token session; store `id`/`secret` in the user
- `api.token.parse(context)` → parse `Authorization` header

**MFA / TOTP (`api.users`)**
- `prepareTOTP(user)` → set `totp_secret`
- `prepareMFA(user, { method })` → set `mfa_code` + returns the code
- `login(context, cb)` / `alogin(context)` → full auth, enforces MFA, returns `{ err, user }`

**Middleware (`middleware.users`)**
- `handle(context, next)` — cookie session guard (redirect or 401)
- `handleToken(context, next)` — bearer token guard (401)
- `login` / `logout` / `profile` — ready-to-mount route handlers

**Shell**
- `bksh -user-add login L secret S [name N] [roles R]`
- `bksh -user-add-token [name N] flags FLAGS [-prefix P]`
- `bksh -user-update / -user-del / -user-get / -user-secret / -user-send-mfa`
