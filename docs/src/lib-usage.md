# Using the Library Module

The `lib` module is the Swiss-army knife of backendjs — a rich collection of utilities you can use directly, without adding a single external npm dependency. Need to parse JSON, format strings, generate UUIDs, make HTTP requests, validate input, or manage a connection pool? It's already there.

> **Why it matters:** Instead of pulling in `lodash`, `moment`, `uuid`, `crypto-js`, `axios`, etc., backendjs gives you all of that in one import. Every method you need lives under `lib`.

---

```js
const { lib } = require("backendjs");
```

---

## Quick categories

| Category | Where it lives | What it does |
|----------|---------------|--------------|
| 🔍 Type checking | `is.js` | `isObject`, `isNumber`, `isArray`, `isFunc`, … |
| ✅ Validation | `validate.js` | Schema-based validation and type coercion |
| 🌊 Flow control | `flow.js` | `forEach`, `forEachLimit`, `parallel`, `series` |
| 🔤 Strings | `str.js`, `conv.js` | regex, trim, split, sprintf, compress, word find |
| 🔄 Conversions | `conv.js` | `toNumber`, `toBool`, `toTitle`, `toCamel`, `toBase64`, … |
| 🗂️ Objects & arrays | `obj.js` | `clone`, `flatten`, `extend`, `arrayUnique` |
| 📅 Date & time | `time.js` | `strftime`, `localEpoch`, timezone parsing, DST |
| 📁 Files & paths | `file.js` | `readFile`, `moveFile`, `findByGlob`, `watchFiles` |
| 🌐 HTTP / fetch | `fetch.js` | `fetch`, `afetch` — get/post JSON or files |
| 🖥️ Process exec | `proc.js` | `execProcess`, `spawnProcess`, `spawnSeries` |
| 🖥️ OS info | `system.js` | `cpuStats`, `memoryStats`, `networkInterfaces` |
| 🔐 Crypto | `crypto.js` | AES encrypt/decrypt, sign, TOTP, random gen |
| #️⃣ Hashing | `hash.js`, `hashids.js` | MD5/SHA256/… and short human-readable ids |
| 🆔 UUID / Snowflake | `uuid.js` | UUID v4, v5, and snowflake IDs |
| 🍪 JWT | `jwt.js` | Full JWT sign/verify with multiple algorithms |
| 🧠 Memory cache | `lru.js` | `LRUCache` with TTL and max size |
| 🔁 Resource pool | `pool.js` | Managed pools for DB connections, etc. |
| 🍱 i18n | `lib.js` (top) | `lib.__()` for translation |
| ⏱️ Respawn throttle | `respawn.js` | Avoid crash-loops on service restarts |
| 📋 MIME types | `mime.js` | `getMimeType`, `getExtension` |

---

## 1 🔍 Type checking

Most `is*` helpers are **value-returning, not boolean**: they return the validated value itself (or a `dflt` fallback) when the check passes, and `undefined`/the default otherwise. This lets you check and use the value in a single call. Only the pure predicates (`isPositive`, `isNumeric`, `isEmpty`, `isPrefixed`, `isTrue`, `isMatched`, `includes`) return a strict `true`/`false`.

Value-returning (`returns value, or dflt / undefined`):
```js
lib.isObject({ a: 1 })     // { a: 1 }
lib.isObject("x")           // undefined

lib.isNumber(42)            // 42
lib.isNumber("x")           // NaN
lib.isString(val, "")       // the string, or "" if not a string
lib.isArray(val, [])        // the array, or [] if not a non-empty array
lib.isFunc(cb, lib.noop)    // the function, or lib.noop if not a function
lib.isDate(d)               // the Date, or undefined if invalid
lib.isRegExp(r)             // the RegExp, or undefined
lib.isUuid(str, "uuid")     // the uuid string, or undefined
lib.isUnicode(str)          // the string if it contains Unicode chars, else undefined
```

Boolean-returning (strict `true`/`false`):
```js
lib.isPositive(n)           // true if n > 0
lib.isNumeric(s)            // true if s is a number or a string that looks like one
lib.isEmpty(val)            // true if null / undefined / empty
lib.isPrefixed(str, "sk-")  // true if str starts with the prefix
lib.isTrue(v, cond, op, type)  // true if v matches: "5", 10, "<=", "number"
```

**Safe, generic call** (returns the function result, or `undefined`):
```js
// call(obj, method, ...): if obj is a function, call it; else call a method on the object
lib.call(func, arg1)         // → func(arg1)
lib.call(obj, fn, arg1)      // → fn.call(obj, arg1)
lib.call(ctx, "method", a)   // → ctx.method(a)
```

**Type-aware helpers** (return a detected type/name):
```js
lib.typeName(null)                   // "null"
lib.typeName(Buffer.from("x"))       // "buffer"
lib.typeName(new Error("o"))         // "error"

lib.autoType("42")                   // "number"
lib.autoType("true")                 // "bool"
lib.includes([1, 2, 3], 2)           // true (boolean)
lib.isSimilar("test", "tset")        // ~0.97 similarity score in 0..1
lib.isMatched(user, { role: "admin" })  // true (deep match)
```

---

## 2 ✅ Validation & type coercion

The **two-pass** pattern in backendjs is: coerce first, then validate. Use `lib.validate()` to feed a raw query through a schema — types, required fields, lengths, regex patterns — and get back either a clean `data` object or an `err`. `validate()` returns `{ err, data }`: `err` is `{ status, message, name, code }` (or `null`), `data` is the cleaned, typed object with defaults filled in.

```js
const schema = {
    name: {
        type: "string",
        required: true,
        label: "Name",
        not_empty: true,
    },
    age: {
        type: "int",
        min_num: 0,
        max_num: 150,
    },
    role: {
        type: "string",
        values: ["admin", "user", "mod"],
    },
    tags: {
        type: "list",
        separator: "|",
        min_list: 0,
        max_list: 10,
        no: /^[a-z0-9_-]+$/i,
    },
    email: {
        type: "email",
        required: true,
    },
    active: {
        type: "bool",
        dflt: true,   // assign default when missing
    },
};

const { err, data } = lib.validate(query, schema);
// err    — { status, message, name, code } | null
// data   — cleaned, typed object (defaults filled in)
```

For single values just use the helpers:
```js
lib.validNumber("x", 0)      // 0  — first valid number from args
lib.validBool(1, false)      // true
lib.validFunc(cb, noop)
lib.validVersion("1.2.3", ">=1.0.0")  // true
```

---

## 3 🌊 Flow control

Drop-in replacements for `async`/`lodash` iteration — every variant returns results through a callback:

```js
// Parallel iteration
lib.forEach(items, (item, next) => {
    processAsync(item, err => next(err));
}, lib.log);

// Limited concurrency
lib.forEachLimit(items, 10, (item, next) => { ... next(); }, callback);

// Series
lib.forEachSeries(items, (item, next) => { ... next(); }, callback);

// Parallel & Series tasks
lib.parallel([
    async (cb) => { cb(null, 1); },
    async (cb) => { cb(null, 2); },
], lib.log);

// While / do-while
lib.whilst(test, iterator, cb);
lib.doWhilst(iterator, test, cb);

// With an accumulator
lib.forEachItem({ accum: [] }, (list, next) => {
    this.accum.push(...list);
}, (err) => { ... });
```

---

## 4 🔤 Strings & conversions

### String utilities
```js
lib.trim(str, " \n")
lib.split("a,b|c", /[,|]/)
lib.wrap(text, { length: 80 })
lib.sprintf("%s has %d items", "alice", 3)
lib.replaceRegexp(str, /foo/g, "bar")
lib.testRegexp(str, /foo/)
lib.matchRegexp(str, /foo-(\d+)/, 1)
lib.matchAllRegexp(str, /\w+/g)
lib.testRegexpObj(obj, rx)
lib.lzCompress(data)            // Lempel–Ziv
lib.lzDecompress(data)
lib.findWords(["foo", "bar"], text)
lib.AhoCorasick(["needle"])     // multi-pattern search
lib.phraseSplit("foo bar baz")  // respects quoted strings
lib.zeropad(7, 4)               // "0007"
```

### Conversions — all `lib.to…`
```js
lib.toNumber("42.5",    { float: true })
lib.toBool("yes",       { dflt: false })
lib.toDate("2024-01-01")
lib.toMtime("7d")
lib.toTitle("hello world")   // "Hello World"
lib.toCamel("foo_bar-baz")   // "fooBarBaz"
lib.toUncamel("fooBarBaz", "_")  // "foo_bar_baz"
lib.toVersion("1.2.3")
lib.toDigits("a1b2c3")       // "123"
lib.toBase64url("hello")
lib.fromBase64url(str, true) // binary
lib.toUrl("hello world")
lib.toPrice(1234.5)
lib.toEmail("  foo@example.com  ")
lib.toSize(1048576)          // "1M"
lib.toSkip32("inc", 12345, 1)
lib.toRFC3339(date)
lib.toCookie("sid", "abc", { httpOnly: true })

// JSON helpers
lib.stringify(obj, null, 2)
lib.inspect(obj, { errstack: true })
lib.unicode2Ascii("résumé")
lib.escapeUnicode(str)
lib.unescape(str)
lib.textToXml(str)
lib.textToEntity(str)
lib.entityToText(str)

// Templates
lib.toTemplate("Hello @name@!", { name: "Alice" })
lib.toMap("a:1,b:2:c:3")     // -> { a: 1, b: 2, c: 3 }

// Duration & time format
lib.toDuration(3600, "seconds")
lib.toMilliseconds("5m")
```

---

## 5 🗂️ Objects & arrays

```js
lib.clone(obj)
lib.flatten(obj, { separator: "." })   // -> { "a.b": 1, ... }
lib.extend({}, defaults, overrides)
lib.shuffle(list)
lib.arrayLength(list)
lib.arrayRemove(list, item)
lib.arrayUnique(list, "id")
lib.arrayEqual(a, b)
lib.arrayFlatten(list)
lib.arrayUpdate(cmd, list, "id")
lib.objGet(obj, "a.b.c")              // dotted path
lib.objSet(obj, "a.b", 1)
lib.objIncr(obj, "count", 1)
lib.objMult(obj, "count", 2)
lib.objKeys(obj)
lib.objSize(obj)
```

---

## 6 📅 Date & time

```js
lib.now()                         // seconds since epoch
lib.localEpoch("s")               // seconds since _epoch (2026-01-01)
lib.localEpoch("m")               // microseconds
lib.clock()                       // microseconds since 1970
lib.daysInMonth(2025, 2)          // 28
lib.weekOfYear(date)              // 9
lib.weekDate(2025, 9)             // -> [2025-02-24, Wed]
lib.isDST(date)
lib.tzName("PDT")                 // "Pacific Daylight Time"
lib.parseTime("14:30")
lib.isTimeRange(t1, t2)
lib.strftime(new Date(), "%Y-%m-%d %H:%M:%S %Z")
```

---

## 7 📁 File system

Every operation has a sync and an async:

```js
const { err, data, info } = await lib.areadFile("users.csv");
// info — { path, size, mtime, ... }

// Stream line-by-line from a file (or stdin):
lib.readLines(process.stdin, { type: "text" }, (line) => {
    console.log(line);
}, lib.log);

// or iterate sync:
lib.forEachLineSync("data.csv", { separator: "," }, (row) => { ... });

// Write
lib.writeLines("out.txt", ["a", "b", "c"]);

// Move / copy / remove
lib.moveFile("old", "new", true);
lib.copyFile("src", "dst", false);
lib.unlink("file.txt");
lib.unlinkPath("/tmp/cache");  // remove a directory tree

// Find files by glob
const found = lib.findFileSync("/app", { include: ["*.{js,ts}"] });
const filtered = lib.findFileSync("/app", {
    include: ["*.{js,ts}"],
    filter: (file, stat) => stat.size > 100
});
lib.findFile("/app", { include: ["*.md"] }, (err, files) => {});

// Watch for changes
lib.watchFiles({ dir: "/watched", include: "*.js" }, (file, stat) => {
    console.log("changed:", file);
});

// Path helpers (sanitizes, validates)
lib.sanitizePath("/../../../etc/passwd")   // "../etc/passwd"
lib.validatePath("/foo/bar")               // absolute path
lib.makePath("/new/dir")                   // mkdir -p
```

---

## 8 🌐 HTTP fetch

Full `fetch()` replacement built on Node http/https:

```js
lib.fetch("https://api.example.com/user/123", {
    headers: { "Authorization": "Bearer " + jwt },
    retryCount: 3,
    retryTimeout: 500,
    timeout: 5000,
    type: "json",             // auto-JSON
    // or type: "file", download to /tmp/x.jpg
}, (err, req) => {
    console.log(req.status);
    console.log(req.obj);     // parsed JSON
});

// Async variant
const { status, obj } = await lib.afetch(url, options);
```

---

## 9 🖥️ Process execution

```js
lib.execProcess("git status", (err, out, code) => {
    console.log(out);
});

lib.spawnProcess("node", ["server.js"], { env: {...}, timeout: 30000 }, (err, code) => {});

// Run commands in series (one after another):
await lib.aspawnSeries(["git pull", "npm install", "npm build"]);
```

---

## 10 🖥️ System info

```js
lib.networkInterfaces()
{ ifaces: [{ name, description, addrs }] }

lib.networkStats("eth0")

// CPU / memory / heap
const { cpu } = lib.cpuStats()
const { memory } = lib.memoryStats()
const { heap } = lib.heapStats()

lib.dropPrivileges(uid, gid)       // become nobody
lib.ip2int("192.168.1.1")
lib.int2ip(3232235777)
lib.inCidr("192.168.1.5", "192.168.1.0/24")
lib.cidrRange("192.168.1.0/24")
lib.domain("www.example.co.uk")
```

---

## 11 🔐 Crypto & secrets

```js
lib.random(16);            // 16 random bytes (Buffer)
lib.randomBytes(32, "base64");
lib.randomUShort();
lib.randomShort();
lib.randomUInt();
lib.randomFloat();
lib.randomInt(1, 100);
lib.randomNum(1, 10, 2);  // 2-decimal float

lib.encrypt(key, data, { iv, salt });
lib.decrypt(key, data, { iv, salt });
lib.sign(data, "secret", "sha256", "hex");
lib.timingSafeEqual(a, b);

// TOTP (2FA):
lib.totp("JBSWY3DPEHPK3PXP", { digits: 6, period: 30 });

// Secret verification (bcrypt-like):
const { hash, err } = await lib.aprepareSecret("password");
const { ok, err } = await lib.acheckSecret(hash, "password");
```

---

## 12 #️⃣ Hashing

```js
// Algorithms: md5, sha1, sha256, sha512, ripemd160
const digest = lib.hash("hello", "sha256", "hex");

// MurmurHash3 (fast string hash)
const h = lib.murmurHash3("myKey");
```

**Hashids** — short human-readable IDs (encode numbers → obfuscated strings):

```js
// First time: create with salt
const hashids = lib.getHashid({ salt: "my-app" });
const encoded = hashids.encode(12345);   // "3278413"

// From a config with minLen
const hashids2 = lib.getHashid({ min: 8 });
const id = hashids2.encode(1);           // 8-char padded

const num = hashids.decode(id);           // [1]
```

*(Cached per salt — same salt gives the same instance.)*

---

## 13 🆔 UUID & Snowflake

```js
lib.uuid()                    // "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
lib.uuid("short")             // short dash-less
lib.uuidv5("example.com")     // deterministic v5
lib.uuidv5({ ns: "url", text: "..." })

// Snowflake IDs (globally unique, time-ordered)
const sf = lib.sfuuid();     // "18234760"
lib.sfuuid({ id: "my-service" });

// Parse a snowflake back
const { created, id } = lib.sfuuidParse(sf);
```

---

## 14 🍪 JSON / Config / Cookie parsing

```js
// JSON
const obj = lib.jsonParse('{"a": 1}');
lib.stringify(obj, null, 2);

// XML (minimal)
lib.xmlParse("<root><item>1</item></root>");

// Config-like: key=value files
lib.configParse("name=Alice\nage=30");

// Cookie header
lib.parseCookies("sid=abc; user=joe");
```

---

## 15 🍔 i18n

```js
lib.locale = "en";

// Load a JSON dictionary
lib.loadLocale("./locales/en.json");
lib.loadLocale("./locales/pt.json");

// Translate
lib.__("Hello");                  // "Hola" (from pt) — falls back to English key
lib.__("Hello %s!", "World");     // "Hola World!" — with sprintf
lib.__({ phrase: "Hello %s", locale: "pt" });  // switch language
```

---

## 16 🧠 Caching & pools

### LRUCache — in-memory key/value with TTL

```js
const lru = new lib.LRUCache(1000);  // max 1000 items

lru.put("k1", { a: 1 }, 60e3);      // TTL 60 sec
console.log(lru.get("k1"));          // { a: 1 }
lru.del("k1");                       // remove
console.log(lru.size);               // 0
console.log(lru.max);                // 1000
```

### Pool — manage finite resources (DB conns, worker slots)

```js
const pool = new lib.Pool({
    min: 1,
    max: 5,
    max_queue: 50,
    timeout: 5000,
    idle: 300000,
    create: (p, cb) => { openConn(cb); },
    destroy: (item) => { item.close(); },
    reset: (item) => { /* reset connection state */ },
    validate: (item) => { return !item.stale },
});
await pool.init();

// Use
let item;
try {
    item = await pool.ause();        // or await pool.use(cb)
    await item.doWork();
} finally {
    pool.release(item);
}
await pool.shutdown();
```

---

## 16 🔁 Respawn / crash-loop throttler

For background services that restart:

```js
function restart() {
    lib.respawn.check(() => {
        startWorker();   // throttled — won't restart faster than interval
        // After N rapid respawns, delays until delay threshold
    });
}
```

---

## 17 🆕 Safe error creation

```js
// HTTP-style errors with status / code
lib.newError("not found", 404)
lib.newError("not found", 404, "NOTFOUND")
lib.newError("bad input", { status: 422, path: "/users", code: "BADINPUT" })
// → Error { message: "bad input", status: 422, path: "/users", code: "BADINPUT" }
```

---

## 18 🔧 Misc helpers

```js
lib.noop()                              // empty function — no-arg callback default
lib.log(...args)                        // pretty-print for debugging
lib.traceError(err)                     // formatted error line
lib.tryCall(fn, args)                   // safe callback (warns if not a function)
lib.tryLater(fn, ms, args)              // defer callback by N ms
lib.tryCatch(() => { riskyCode() })     // returns err, logs it, safe
lib.tryRequire("optional-dep")          // load w/o throwing
lib.getArg("--port")                    // CLI argument reader
lib.getArgInt("-n", 10)
lib.isArg("--verbose")
lib.sprintf("%.2f", 3.14)              // string formatting
lib.toFormat("csv", [{ id: 42, name: "...." }])  // CSV file
lib.sleep(1000)                        // async sleep
lib.sortByVersion(list, "name")        // version-aware sort
lib.matchAllRegexp(str, rx)            // global match
```

---

## Quick reference table

Use `lib.` + name + `(...)` for callback style; prepend `a` for async/await on async methods.

| Category | Key methods |
|----------|-------------|
| **Type** | `isObject`, `isNumber`, `isString`, `isDate`, `isArray`, `isFunc`, `isUuid`, `isEmpty`, `isPositive`, `isNumeric` |
| **Validate** | `validate(schema)`, `validNumber`, `validBool`, `validFunc`, `validVersion` |
| **Flow** | `forEach`, `forEachLimit`, `forEachSeries`, `parallel`, `series`, `while`, `doWhile`, `forEachItem` |
| **String** | `sprintf`, `trim`, `split`, `wrap`, `replaceRegexp`, `matchRegexp`, `toMatch`, `lzCompress`, `lzDecompress`, `findWords`, `AhoCorasick` |
| **Conv** | `toNumber`, `toBool`, `toTitle`, `toCamel`, `toUrl`, `toBase64url`, `toSize`, `toDuration`, `toMilliseconds`, `jsonToBase64`, `toRFC3339`, `toCookie`, `toFormat`, `toTemplate` |
| **Obj/Array** | `clone`, `flatten`, `extend`, `shuffle`, `arrayRemove`, `arrayUnique`, `arrayEqual`, `objGet`, `objSet`, `objIncr`, `objMult`, `objKeys`, `objSize` |
| **Time** | `now`, `localEpoch`, `clock`, `strftime`, `daysInMonth`, `weekOfYear`, `weekDate`, `isDST`, `parseTime` |
| **File** | `readFile`, `moveFile`, `copyFile`, `writeLines`, `watchFiles`, `findFile`, `sanitizePath`, `validatePath`, `makePath`, `unlink`, `forEachLine`, `readLines` |
| **HTTP** | `fetch` / `afetch` |
| **Process** | `execProcess`, `spawnProcess`, `spawnSeries` |
| **System** | `networkInterfaces`, `cpuStats`, `memoryStats`, `heapStats`, `ip2int`, `int2ip`, `inCidr`, `cidrRange` |
| **Crypto** | `random`, `randomBytes`, `encrypt`, `decrypt`, `sign`, `timingSafeEqual`, `totp`, `prepareSecret` |
| **Hash** | `hash`, `murmurHash3`, `getHashid` (encode/decode) |
| **UUID** | `uuid`, `uuidv5`, `sfuuid`, `sfuuidParse` |
| **Parse** | `jsonParse`, `xmlParse`, `configParse`, `parseCookies` |
| **JWT** | `JWT.sign`, `JWT.verify`, `JWT.exportJwk` |
| **Cache** | `lib.LRUCache(n)` |
| **Pool** | `lib.Pool({min, max, create, destroy})` |
| **i18n** | `lib.__("key")`, `lib.loadLocale(file)` |
| **General** | `newError`, `sprintf`, `tryCall`, `tryCatch`, `tryRequire`, `tryLater`, `log`, `noop`, `sleep`, `getArg`, `isArg` |

---

## Tips

- **No external deps needed** — the library gives you formatting (`sprintf`), type coercion (`to*`), validation (`validate`), crypto (`encrypt/decrypt`), HTTP (`fetch`), UUIDs, hashing, pools, and i18n all in one. Drop `lodash`, `moment`, `uuid`, and similar from your `package.json`.
- **Type coercion is built-in** — `validate()` doesn't just check types… it converts them. Pass `"42"` and get a real number; pass `"true"` and get a boolean, all based on the schema's `type`.
- **Async forms use the `a` prefix** — `a` stands for "async". Every async callback method has an identical `a…` async form returning `{ err, data, info }`.
- **i18n is just JSON** — put translation dictionaries in `locales/*.json` and call `loadLocale()`. Use `lib.__()` everywhere.
- **Hashids caches per salt** — pass the same salt and you get the same instance, encoded values stay deterministic within an app, but encode differently between apps (salted).
- **LRU has TTL** — each entry can have a per-item TTL in milliseconds. Pass `0` for no expiration.
- **Pool resets resources** — the `reset` callback runs on every checkout. Use it to clean up a DB connection before reuse.
- **Errors carry `status`** — `lib.newError("msg", 404, "NOTFOUND")` returns an `Error` with `.status` and `.code` so you can short-circuit middleware without extra logic.
