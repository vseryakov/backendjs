# Using the Database Layer

This guide shows how to use the `db` module of backendjs. It is written for application
developers, not for people modifying the library. The examples are lifted straight from
[`tests/db.test.js`](../../tests/db.test.js) — the same tests that run against every
supported backend, so the code below works the same whether your pool is SQLite,
PostgreSQL, DynamoDB, Elasticsearch or Rqlite.

Pick your backend by setting an environment variable before running your app or the
tests:

```bash
BKJS_ROLES=postgres   node --test tests/db.test.js
BKJS_ROLES=dynamodb   node --test tests/db.test.js
BKJS_ROLES=sqlite     node --test tests/db.test.js   # (default)
```

You write one set of `db.*` calls; the driver mapping is handled for you.

---

## Table of contents

- [Tables: define, create and migrate](#tables-define-create-and-migrate)
- [Writing data: add, put, update, incr](#writing-data-add-put-update-incr)
- [Reading data: get, select, list](#reading-data-get-select-list)
- [Operators: how conditions work](#operators-how-conditions-work)
- [Validation and defaults](#validation-and-defaults)
- [Lists, sets and objects](#lists-sets-and-objects)
- [Pagination and scan](#pagination-and-scan)
- [Caching reads](#caching-reads)
- [Aliases](#aliases)
- [The `db.*` method list](#the-db-method-list)
- [Config table and cleanup rules](#config-table-and-cleanup-rules)

---

## Tables: define, create and migrate

You describe your tables as plain objects. A table is a map of `column name → definition`.
Common column options: `type`, `primary`, `index`, `not_null`, `value` (default), and
`validate` / `convert` for constraints.

```js
const tables = {
    bk_test1: {
        id:   { type: "uuid",  primary: 1, index: 1 },
        key1: { type: "text" },
        key2: { type: "int" },
        name: { validate: { max: 32 } },
        email:{ type: "email" },
        json: { type: "json" },
        realnum:{ type: "real" },
        counter:{ type: "counter", value: 0 },
        notempty:{ validate: { not_empty: true } },
        dflt: { value: "dflt" },
        obj:  { type: "obj" },
        list: { type: "array" },
        tags: { type: "list",  validate: { max_list: 3 } },
        weights:{ type: "set", split: { data_type: "int" } },
        nospecial:{ validate: { max: 32, trunc: 1 }, convert: { strip: lib.rxSpecial } },
    },
};

// Register the definitions, then create/migrate them in the pool(s)
db.describeTables(tables);
const { err, created } = await db.acreateTables({ pools: [db.pool] });
// created === ["bk_test1"]
```

- **`db.describeTables(defs)`** – register table definitions in memory.
- **`db.acreateTables({ pools })`** – create missing tables and **migrate existing** ones,
  creating new columns and indexes. It is idempotent: call it on every startup. A freshly
  added column (e.g. a new `bigint` with `index1: 1`) is picked up on the next call and the
  returned `upgraded` list tells you which tables changed.
- `db.acacheColumns(pool)` refreshes the in-memory view of the table columns.

Table names can start with `bk_`, but that is just a convention.

---

## Writing data: add, put, update, incr

All verbs have an async (`a`-prefixed) form that returns `{ err, data, info }` and a
callback form. The examples below use the async form.

### Add / insert (`db.aadd`)

```js
const { err, data, info } = await db.aadd("bk_test1", row, { returning: "*", first: true });
// data.id is the generated/normalized primary key
```

- A primary key may be **composite** and/or **joined** — see below. If you do not supply the
  required key columns, the driver fills them in (for example a `uuid` type is generated).
- `returning: "*"` returns the stored row; `first: true` is a convenience for single-row ops.
- **Adding a duplicate primary key fails** — this is how `upsert` is avoided; to replace,
  delete then add, or use `db.aput`.

### Put / upsert (`db.aput`)

Creates the row if it does not exist, otherwise updates it.

```js
await db.aput("bk_test1", { id, email: id, num: 1 }, { info_obj: 1 });
```

### Update (`db.aupdate`)

`update(table, newFields, options)` applies `newFields` to the rows matched by the options
`query`, and can apply operators per column instead of plain assignment:

```js
// increment num only where email matches
await db.aupdate("test1",
    { id, email: "test", num: 1 },
    { query: { id, email }, updateOps: { num: "incr" }, skip_columns: ["mtime"] }
);

// return the updated rows
const { info } = await db.aupdate("test1",
    { id, email: "test", num: 100 },
    { query: { id, email }, returning: "*" });
```

Useful update options: `query` (extra WHERE condition in addition to the key),
`updateOps` / `ops` (per-column operator such as `incr`, `add`, `del`), `skip_columns`
(do not touch these columns), `returning` (return affected rows).

### Incr — bump counters / upsert a counter row (`db.aincr`)

```js
await db.aincr("bk_test1", { id: id1, key1, key2, counter: 3 });
await db.aincr("bk_test1", { id: id3, key1, key2: key1, counter: -2 }); // negative ok
```

`counter` is a special column type; `incr` adds the given amount and creates the row if it
does not exist.

---

## Reading data: get, select, list

### Get one row by key (`db.aget`)

`get` takes the **primary key(s)** of the table — a composite key means you pass all its
parts. Non-key columns are not used for lookup, only for read/return control:

```js
const { err, data } = await db.aget("bk_test1", { id: id1, key1, key2 });
if (data === null) { /* not found */ }

data.name;    // string
data.json;    // already parsed into a JS object (json type, not a string)
data.list;    // ["a","b","c"] (array/column type)
data.tags;    // ["tag1","tag2","tag3"] (list type, split back into an array)
data.weights; // [1,2,3,4,5] (set type, split + coerced to int)
data.counter; // number
```

Values are **converted back** to the types you declared when reading: `json`/`obj`/`array`
become objects, `list`/`set` become arrays, numbers come back as numbers. Default values are
applied for any column that stored `null`.

### Select many by a condition (`db.aselect`)

`select` takes a **condition** object plus **options**:

```js
// equality + a prefix condition, limit columns and columns that don't exist are ignored
const { data } = await db.aselect("bk_test1", { id: id3 }, { sort: "ctime", desc: true });
data[0].counter; // 0  (most recent first)

// columns not in the table/definition are ignored by default:
const { data } = await db.aselect("bk_test1", { id: id1, fake: 1 });
// data === []  because matching on a real (nonexistent) key with no columns selected → none
```

Options you can pass: `select` (comma-separated list of columns to return), `sort`
(ordering; prefix a column name with `!` for descending), `desc`, `count` / `page` /
`start` (paging), `first` / `last` (return a single record), `no_columns` (do not filter out
unknown columns — only meaningful for NoSQL backends that store any field).

### List / batch get (`db.alist`)

Fetch several rows by their keys in one call. It accepts an array of key objects and just
returns the ones that exist (missing keys are skipped):

```js
const { data } = await db.alist("bk_test1",
    [id1, id2, id3, 1].map(id => ({ id, key1, key2 })));
data.length; // 3  — the bogus key `1` is simply not present
```

---

## Operators: how conditions work

By default a condition is an equality test: `{ id: id3, name: "John" }`. You can replace the
operator in two equivalent ways:

1. **Inline in the column name** as `name_$op` — the most common form.
2. **Via the `ops` option**: `{ col: val }` with `{ ops: { col: op } }`.

The inline operator wins if both are given. The following are all the same query:

```js
// prefix match on a joined/composite key
await db.aselect("bk_test1", { id: id3, key_$begins_with: "abc" });
// substring match
await db.aselect("bk_test1", { id: id3, key1_$contains: "a" });
// null tests
await db.aselect("bk_test1", { id: id3, dflt: null });            // dflt IS NULL
await db.aselect("bk_test1", { id: id3, dflt_$not_null: "" });    // dflt IS NOT NULL
// membership
await db.aselect("bk_test1", { id: id3, key1_$in:     ["abc", "999", "null"] });
await db.aselect("bk_test1", { id: id3, key1_$not_in: ["abc"] });
await db.aselect("bk_test1", { id: id3, key1: ["abc", "999"] }, { ops: { key1: "in" } });
// comparisons and ranges
await db.aselect("bk_test1", { id: id3, counter_$gt: 0 }, { select: "id,counter" });
await db.aselect("bk_test1", { id: id3, counter: 0 },          { ops: { counter: "lt" } });
await db.aselect("bk_test1", { id: id3, counter: [0, 2] },     { ops: { counter: "between" } });
// list / array containment (one syntax, mapped to the right native op per backend)
await db.aselect("bk_test1", { id: id3, "tags_$contains": ["tag1"] });
```

### Built-in operators

| Family | Operators | Example |
| ------ | --------- | ------- |
| Equality/comparison | `=`, `!=`/`<>` (`ne`), `>`, `lt`, `>=`, `ge`, `<=`, `le` | `{ counter_$gt: 0 }`, `{ num: 0 }, ops:{ num: "lt" }` |
| Ranges | `between`, `not between` | `{ counter: [0, 2] }, ops: { counter: "between" }` |
| Text | `begins_with`, `not_begins_with`, `ends_with`, `not_ends_with`, `contains`, `not_contains`, `like`, `like%`, `ilike` | `{ key1_$contains: "a" }` |
| Membership | `in`, `not_in`, `all_in` | `{ key1_$in: ["abc","999"] }` |
| Null | `null` (pass a `null` value), `not_null` | `{ dflt: null }`, `{ dflt_$not_null: "" }` |
| Full text (Postgres) | `@@` (tsvector/tsquery) | `{"fulltext_$@@": "cats"}` |
| Regex / similar (Postgres) | `~`, `~*`, `!~`, `!~*`, `regexp`, `iregexp`, `similar to` | — |

### Composite and joined keys

A primary key can be composite (ordered `primary: 1, 2, ...`) and one column can be a
**join** of the key columns:

```js
key: { type: "keyword", primary: 2, join: ["key1", "key2"] }
```

`key` is a virtual column equal to `key1` and `key2` combined. You still fetch and update
by the parts (`{ id, key1, key2 }`), but you can *query* on the combined value, e.g.
`{ id: id3, key_$begins_with: "abc" }`. On NoSQL backends the same idea maps to a composite
primary key.

### Logical combinations: `$or`, `$and`, `$not`

You can nest conditions with special keys. Multiple levels use extra `$` signs:

```js
// id = id3 AND ( key1 = key1 OR key1 = "999" )
await db.aselect("bk_test1", { id: id3, $or: { key1, key1_$: "999" } });

// multiple alternatives: id IN (...) OR name = 'a'
await db.aselect("bk_test1", { $$or: { id_$in: [4,5,6], name: "a" } });

// negation
await db.aselect("bk_test1", { $not: { name: "a" } });
```

---

## Validation and defaults

Validation happens on the way **in** (`add`/`put`/`update`), and is defined per column.
Failing validation returns a non-`null` `err` with a descriptive message.

```js
// not_empty: value must be present
await db.aadd("bk_test1", row);                       // err: "...must not be empty"
row.notempty = 1;

// not_null: required columns must be supplied
await db.aadd("bk_test1", row);                        // err: "NULL|not-null|required keys"
row.key1 = "abc";
// still fails until the whole required composite key is present

// max length (text) and max_list (list)
row.name = "x".repeat(200);
await db.aadd("bk_test1", row);                        // err: "too large"
row.name = "short";
row.tags = ["a","b","c","a1","b1","c1"];               // exceeds max_list: 3 → "too large"
```

- `validate.max` — max string length. `validate.trunc` truncates instead of erroring.
- `validate.max_list` — max array size.
- `validate.not_empty` — value must not be empty.
- `not_null: true` — the column is required (only enforced on backends that support it).
- `convert.strip` — a regular expression stripped from the value on write (e.g. `lib.rxSpecial` removes punctuation).
- `value: "dflt"` — a default applied when the stored value is `null`, on read.

---

## Lists, sets and objects

- **`list` / `set`** types are stored as delimited strings by SQL backends and returned as
  arrays. They support element operations so you do not have to rewrite the whole value:

  ```js
  await db.aupdate("test3", { tags: "4" },     { updateOps: { tags: "add" } }); // append
  await db.aupdate("test3", { tags: "6" },     { updateOps: { tags: "del" } }); // remove
  await db.aupdate("test3", { tags: [6,7] },   { updateOps: { tags: "add" } });
  const { data } = await db.aget("test3", { id });
  data.tags; // ["3","4","5","7"]
  ```
  On backends that support native array ops (e.g. Postgres) the equivalent operators
  (`&&`, `@>`, `<@`, `add`, `del`) are used automatically.

- **`obj` / `array` / `json`** types are stored as JSON and passed to/from you already
  decoded.
- `set` with `split: { data_type: "int" }` splits on the delimiter and coerces each element
  to a number on read, so `[1,2,"3",4,"5"]` comes back as `[1,2,3,4,5]`.

---

## Pagination and scan

### Paged select

For large result sets, page through with `count` and the `next_token` returned in `info`.
`next_token` becomes `null` when you reach the end, which is the natural loop-stopping
condition.

```js
let token = null, pages = [];
do {
    const { data, info } = await db.aselect("test2", { id: id2 },
        { sort: "id2", start: token, count: 2, select: "id,id2" });
    pages.push(...data);
    token = info.next_token;
} while (token);
```

You can condition the paging on a range key:

```js
await db.aselect("test2", { id: id2, id2: "0" },
    { sort: "id2", ops: { id2: "gt" }, start: token, count: 3, select: "id,id2" });
// returns the next 3 rows after id2 > "0"
```

### Stream / scan

`db.scan(table, query, options, rowCallback, doneCallback)` streams rows one at a time so
you do not load the whole result into memory. `count` controls the batch size.

```js
const rows = [];
await db.ascan("test2", {}, { count: 2 }, row => { rows.push(row); });
```

---

## Caching reads

Reads of a table can be result-cached. Register the tables and (optionally) a per-table TTL,
then read with the `cached` option. `info.cached` tells you where the row came from
(`0` = DB, `1`/`2` = cache levels). You can also read the cache directly with
`db.getCache`.

```js
db.cache.tables.push("test1", "test3");
db.cache2.test3 = 30000;                     // 30s TTL for test3

const { info } = await db.aget("test1", { id }, { cached: 1 });
info.cached; // 0 first miss, then 1 on a cache hit
```

`nocache: true` bypasses caching for a single call even when it is otherwise enabled.

---

## Aliases

Give a table a short name and use it everywhere, handy when table names change:

```js
db.aliases.t = "test3";
const { data } = await db.aget("t", { id });   // reads test3 via the alias
```

---

## The `db.*` method list

Every operation has a callback form and an async (`a`-prefixed) form that resolves to
**`{ err, data, info }`** (or `{ err, ...named }` for a few DDL verbs).

| Operation | Methods | Purpose |
| --------- | ------- | ------- |
| DDL       | `acreateTables`, `adrop`, `acacheColumns` | create/migrate & drop tables, refresh the column view |
| Write     | `aadd`, `aput`, `aupdate`, `aincr`, `adel`, `adelAll`, `abulk` | insert / upsert / update / increment / delete / batch |
| Read      | `aget`, `aselect`, `alist`, `ascan`, `agetConfig`, `db.getCached`, `db.getCache` | get by key, query, batch, stream, load config, cached read |
| Config    | `initConfigTable`, `agetConfig`, `configTypes` | load the dynamic config |
| Access    | `describeTables`, `cleanupResult`, `aliases.{name}` | table defs, per-field visibility, short names |

`info` commonly carries `affected_rows`, `next_token`, `inserted_oid`, `cached`, and
`consumed_capacity` (DynamoDB). Pass `{ info_obj: true }` to also get the stored/normalized
record back as `info.obj`.

---

## Config table and cleanup rules

### Dynamic configuration

`db.agetConfig()` loads parameters from a `bk_config` table. **Config types are derived from
your running context** (`configMap`), so the *same row can apply to different deployments*:

```js
db.config = db.pool;
db.initConfigTable();
db.configMap = { top: "roles", main: "role, tag", other: "role, region" };

// With app.roles="test,dev", role="shell", tag="qa", region="us-east-1", v="1.0.0":
//  - params gated by status="hidden" stay hidden       → not loaded
//  - params gated by version >1.0.0 stay hidden at 1.0.0 → appear at 1.1.0
//  - params gated by stime/etime appear only in range
const { data } = await db.agetConfig();
// [{ name: "param1" }, { name: "param3", value: "etime" }]
```

This is the mechanism to ship environment-, version- and time-gated configuration without
redeploying: bump `app.version` or let time advance and the same rows resolve differently.

### Column / field cleanup (access control on output)

Table columns can be marked for **automatic removal before a row is returned**, so
unauthorized data never leaves the service. `cleanup` on a column defines the rule;
`db.cleanupResult` resolves it:

```js
db.describeTables({
    cleanup: {
        pub:         { cleanup: false },      // always keep
        priv:        { cleanup: true },       // always remove
        billing:     { cleanup: { roles: ["billing"] } },   // keep for billing users
        nobilling:   { cleanup: { no_roles: ["billing"] } }, // remove for billing users
        billing_staff:{ cleanup: { roles: ["billing","staff"] } },
        notpub: {},                          // default removal, unless whitelisted
        extra: {}, extra2: {},
    },
});

const user = { roles: ["billing"] };
const res = db.cleanupResult("cleanup", row, { user });
res.pub;        // true  — always public
res.priv;       // false — always stripped
res.billing;    // true  — visible to billing users
res.nobilling;  // false — hidden from billing users
```

Summary of the rules you can write:

| Column value | Effect |
| ------------ | ------ |
| `cleanup: false` | never removed |
| `cleanup: true`  | always removed from results |
| `cleanup: { roles: [...] }` | kept **only** when the user has one of these roles |
| `cleanup: { no_roles: [...] }` | removed when the user has one of these roles |
| `(no cleanup) on a non-public column` | removed by default (e.g. `notpub`) unless whitelisted |
| per-call `cleanup: { col: false }` | override the table rule for that call |
| global `db.cleanup = { col: false }` | override the table rule for all rows of that table |

---

*See also:* the driver-specific behaviour in
[`lib/db/sqlite.js`](../../lib/db/sqlite.js), [`lib/db/postgres.js`](../../lib/db/postgres.js),
[`lib/db/dynamodb.js`](../../lib/db/dynamodb.js), [`lib/db/elasticsearch.js`](../../lib/db/elasticsearch.js),
and the full API docs for each `db.*` method in [`lib/db.js`](../../lib/db.js).
