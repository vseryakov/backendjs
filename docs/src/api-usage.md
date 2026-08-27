# Using the API Module

The API module is the HTTP layer of backendjs. A request flows through a small trie **router** (`api.app`) that dispatches to a chain of **middleware** handlers. Every built-in feature — body parsing, uploads, CORS, CSRF, rate limiting, validation, static files, redirects — is just a middleware you can mount explicitly in code or enable from config.

| Piece | Role |
|-------|------|
| `api.Router` / `api.app` | Trie-based router that matches `method + path` and runs matching handlers in priority order. |
| `middleware.body` | Parse JSON / form-urlencoded request bodies into `context.body`. |
| `middleware.multipart` | Parse `multipart/form-data` uploads into `context.files` + `context.body`. |
| `middleware.cors` | Set CORS headers and answer preflight `OPTIONS`. |
| `middleware.csrf` | Enforce `Origin` / `Sec-Fetch-Site` checks on unsafe methods. |
| `middleware.limiter` | Rate limit by IP, path, session or user. |
| `middleware.validate` | Validate query/body/path params (and optionally rate limit by a param value). |
| `middleware.routing` | Config-driven URL rewrites and redirects. |
| `middleware.static` | Serve static files from the configured web folders. |

```js
const { api, middleware } = require("backendjs");
const { body, cors, csrf, limiter, validate, routing, static: statik } = middleware;

app.start({ api: true });
```

Every middleware is a `(context, next)` function, or an object with a `handle(context, next)` method. Call `next()` to pass control on, `next(err)` to stop with an error, or send a response directly (`context.send`, `context.reply`, `context.sendFile`).

---

## The router

`api.app` is an instance of `api.Router`, a simple prefix-tree (trie) router. You register routes with `use` or the method shortcuts `get`/`post`/`put`/`patch`/`delete`/`all`:

```js
api.app.get("/users/:id", handler);          // named param -> context.params.id
api.app.get("/api/:type/*", handler);        // wildcard -> context.params['0']
api.app.post("/data", body, handler);        // chain multiple handlers
api.app.all("/health", handler);             // any method
```

Matching notes:

- `:name` captures a path segment into `context.params.name`; `*` captures the rest into indexed params (`'0'`, `'1'`, …).
- When several routes match, **all** matching handlers run, ordered by an auto-assigned priority number.
- Set an explicit priority with `#NUM` in the method to control order regardless of registration order — e.g. `api.app.use("GET#0", "/*", guard)` runs first. This is how global middleware inserts itself ahead of app handlers.
- A handler can call `next("restart")` after `context.setUrl(...)` to re-run routing against the new path (used by `routing`).

Most middleware supports two modes:

- **Programmatic** — mount it yourself on specific paths in code.
- **Global config** — set `middleware-<name>-enable = true` and let `configureMiddleware` wire the routes on startup. Some also support `enable = fixed`, which registers only what's in the config at start (no dynamic per-request lookups) while still allowing existing rules to be updated.

---

## Body parser

Parses JSON and `x-www-form-urlencoded` request bodies into `context.body`. Default max size is 64k; reads are guarded by a timeout to defend against slow-body attacks.

```js
// Programmatic
api.app.post("/api/data", body, (context) => {
    if (context.body?.id) { ... }
});
```

```
# Global — parse bodies for all POST/PUT/PATCH automatically
middleware-body-enable = true
middleware-body-max-size = 128000
middleware-body-content-type = text/xml, image/png   # extra content types
```

---

## Multipart uploads

Parses `multipart/form-data` using `formidable`. Files land in `context.files`, other fields in `context.body`. Temp files are cleaned up automatically when the request context is destroyed.

```js
api.app.post("/upload", (context) => {
    if (context.files.file) console.log(context.files.file.path, context.files.file.name);
});
```

```
middleware-multipart-enable = true
middleware-multipart-max-size = 25000000
middleware-multipart-max-files = 10
```

---

## CORS

Sets the `access-control-*` headers and short-circuits preflight `OPTIONS` requests with `204`. Defaults allow all origins with credentials and the common methods.

```js
api.app.use("/api/*", { origin: "*", headers: ["bk-sid"], handle: cors.handle });
```

```
middleware-cors-origin = https://app.host.com
middleware-cors-headers = bk-sid
middleware-cors-max-age = 86400
```

---

## CSRF protection

Guards unsafe methods (everything except GET/HEAD) by requiring and checking the `Origin` and `Sec-Fetch-Site` headers. Protection is **explicit** — only paths you configure are checked. Any matched path requires both headers to be present.

```
middleware-csrf-enable = true

# Only allow specific origins for /account
middleware-csrf-origin-/account/* = https://host.com, http://localhost

# Only allow same-origin for the whole API
middleware-csrf-sec-fetch-site-/api/* = same-origin
```

```js
api.app.post("/account", { origin: ["host1.com"], secFetchSite: "same-origin", handle: csrf.handle });
```

---

## Rate limiter

Throttles requests by **IP**, **path**, **session**, or **user**. Like CSRF, there are no defaults — only configured paths are limited. `rate` (requests per interval) is required; add `interval`, `ttl`, etc. as needed.

- `ip` — per client IP.
- `path` — a single global bucket for the path.
- `session` — session id parsed from cookie/header (no verification).
- `user` — verified authenticated user (mount after the users guard).

Path wildcards matter: `/api/*` rates all sub-paths together, while `/api/:id/*` rates each `:id` value separately.

```
middleware-limiter-enable = true

# 100 req/s per IP for the API
middleware-limiter-ip-*-/api/* = rate:100, ttl:900000

# 1 login/s per IP
middleware-limiter-ip-post-/login = rate:1
```

```js
api.app.post("/account", { ip: { rate: 100 }, path: { rate: 200 }, handle: limiter.handle });
```

---

## Validate

Validates `query`, `body`, or path `params` before your handler runs, returning an error immediately on bad input. Validated/coerced values are written back so later handlers reuse them. It can **also** rate limit by a parameter's value — handy for multi-tenant limits keyed by `accountId`, `clientId`, etc.

```
middleware-validate-enable = true

# Require a numeric accountId in the path, allow 100 req/s per account
middleware-validate-params-get,post-accountId-/account/:accountId/* = type:int,required:true,min:100000,rate:100

# Validate login email on POST /login
middleware-validate-body-post-login-/login = type:email,max:128,required:true
```

Rate options use a `rate_` prefix (`rate_interval`, `rate_ttl`, `rate_user`, `rate_session`, …). Because the router only extracts path params without checking them, this is also the way to enforce a type/format on `:params`.

```js
api.app.post("/account", {
    body: {
        accountId: { type: "int", required: true, rate: 100 },
        amount: { type: "number", max: 1000 },
    },
    handle: validate.handle,
});
```

---

## Routing (rewrite & redirect)

Config-driven URL rewriting and redirects. Prefix the target with a `30X` code to redirect; otherwise the URL is rewritten and routing restarts. Values support `@PATH@`, `@SEARCH@` and similar placeholders.

```
middleware-routing-enable = true

# Rewrite: serve the SPA entry for all /app paths
middleware-routing-/app/* = /index.html

# Redirect anonymous users to the login page
middleware-routing-/login/* = 302/login.html?path=@PATH@
```

To rewrite from code:

```js
api.app.get("/old/path", (context, next) => {
    context.setUrl("/new/path");
    next("restart");
});
```

---

## Static files

Serves static assets from the configured web folders (`app.path.web`, which includes imported packages), plus the built-in backendjs `web` folder for the bundled Alpine/Bootstrap assets. Supports caching headers, ETag, `Last-Modified`, and pre-compressed (gzip/br/zstd) files.

```
middleware-static-enable = true
middleware-static-max-age = 86400000
middleware-static-etag = true
middleware-static-precompressed = \.js$|\.css$
app-path-web = /path/to/public/files
```

```js
api.app.get("/blog/*", { root: "dist/", precompressed: /\.js$/, handle: statik.handle });
api.app.get("/public/*", { root: "web", noCache: true, handle: statik.handle });
```

Static routing uses a high priority number (`9999`) so it runs after your application handlers, acting as a fallback.

---

## Putting it together

A typical global config chains the middleware in priority order so cross-cutting concerns run before your handlers:

```
# Parse bodies and uploads
middleware-body-enable = true
middleware-multipart-enable = true

# Security
middleware-csrf-enable = true
middleware-csrf-sec-fetch-site-/api/* = same-origin

# Throttling + validation
middleware-limiter-enable = true
middleware-limiter-ip-post-/login = rate:1
middleware-validate-enable = true
middleware-validate-body-post-login-/login = type:email,max:128,required:true

# Static assets last
middleware-static-enable = true
```

Or wire it explicitly in code for full control over the chain:

```js
const { api, middleware } = require("backendjs");
const { body, cors, csrf, limiter, validate } = middleware;

api.app.use("/api/*", cors, csrf, limiter);
api.app.post("/api/data", body, validate, (context) => {
    context.reply(null, { ok: true });
});
```

---

## Quick reference

**Router (`api.app`)**
- `get/post/put/patch/delete(path, ...handlers)` — register per method
- `all(path, ...handlers)` — any method
- `use([method[#priority]], path, ...handlers)` — general registration
- `context.params` — captured `:name` and `*` values
- `next()` / `next(err)` / `next("restart")` — continue, fail, or re-route

**Middleware (`middleware.*`)** — each has a `handle(context, next)` and a `<name>-enable` config
- `body` — JSON / form bodies → `context.body`
- `multipart` — uploads → `context.files`
- `cors` — CORS headers + preflight
- `csrf` — Origin / Sec-Fetch-Site checks
- `limiter` — rate limit by ip/path/session/user
- `validate` — param validation (+ optional rate limit)
- `routing` — rewrite / redirect
- `static` — serve static files
