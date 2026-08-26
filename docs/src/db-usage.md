# Using the Database Layer

The `db` module works the same way across SQLite, PostgreSQL, DynamoDB, Elasticsearch, and Rqlite. Pick your backend with an environment variable:

```bash
BKJS_ROLES=sqlite       # default
BKJS_ROLES=postgres
BKJS_ROLES=dynamodb
```

Every method has two forms — use whichever you prefer:

```js
// callback
db.get("users", { id: 123 }, (err, data, info) => { ... });

// async (add 'a' prefix)
const { err, data, info } = await db.aget("users", { id: 123 });
```

This guide uses the async form.

---

## Define your table

Describe tables as plain objects. Each key is a column name:

```js
const tables = {
    users: {
        id:       { type: "uuid", primary: 1 },
        email:    { type: "email" },
        name:     { validate: { max: 100 } },
        role:     { value: "user" },              // default value
        counter:  { type: "counter", value: 0 },
        tags:     { type: "list" },
        profile:  { type: "json" },
        ctime:    { type: "now", read_only: true },
    },
};

db.describeTables(tables);
```

**Common column types:**
- `uuid` — auto-generated unique ID
- `text`, `int`, `real`, `bigint` — basic types
- `json`, `obj` — stored as JSON, returned as objects
- `list`, `set` — arrays (set = no duplicates)
- `counter` — a number you increment
- `now` — timestamp, auto-set on create
- `email` — validated email format

**Useful options:**
- `primary: 1` — part of the primary key (use 1, 2, 3 for composite keys)
- `index: 1` — create an index
- `value: "default"` — default when reading null
- `validate: { max: 100, not_empty: true }` — input validation
- `read_only: true` — can't be changed after creation

---

## Create and update tables

Call this on startup — it creates missing tables and adds new columns to existing ones:

```js
const { created, upgraded } = await db.acreateTables();

// created = ["users"]     — tables that were created
// upgraded = []           — tables that got new columns
```

To add a column later, just add it to your definition and call `acreateTables` again:

```js
db.tables.users.phone = { type: "text" };
await db.acreateTables();
// The phone column now exists
```

---

## Insert records

```js
// Simple insert
await db.aadd("users", { 
    email: "alice@example.com", 
    name: "Alice",
    tags: ["admin", "active"]
});

// Get the inserted record back
const { data: user } = await db.aadd("users", {
    email: "bob@example.com",
    name: "Bob"
}, { returning: "*", first: true });

console.log(user.id);    // auto-generated UUID
console.log(user.ctime); // auto-set timestamp
console.log(user.role);  // "user" (the default)
```

Inserting the same primary key twice returns an error:

```js
const { err } = await db.aadd("users", { id: user.id, email: "dupe@example.com" });
if (err) console.log("Already exists!");
```

---

## Read records

**Get one by primary key:**

```js
const { data: user } = await db.aget("users", { id: "abc123" });

if (!user) {
    console.log("Not found");
} else {
    console.log(user.name);
    console.log(user.profile);  // JSON is already parsed
    console.log(user.tags);     // List is already an array
}
```

**Get multiple by keys:**

```js
const { data: users } = await db.alist("users", [
    { id: "abc123" },
    { id: "def456" },
    { id: "xyz789" }
]);
// Returns only the ones that exist
```

---

## Query records

Use `aselect` to find records matching conditions:

```js
// Simple equality
const { data } = await db.aselect("users", { role: "admin" });

// Pick specific columns
const { data } = await db.aselect("users", { role: "admin" }, { 
    select: "id,name,email" 
});

// Sort results
const { data } = await db.aselect("users", {}, { 
    sort: "ctime", 
    desc: true 
});
```

---

## Operators

By default, conditions use equality. Add operators with `_$op` in the column name:

```js
// Greater than
const { data } = await db.aselect("users", { counter_$gt: 10 });

// In a list
const { data } = await db.aselect("users", { role_$in: ["admin", "moderator"] });

// Starts with
const { data } = await db.aselect("users", { name_$begins_with: "A" });

// Contains substring
const { data } = await db.aselect("users", { email_$includes: "@gmail.com" });

// Is null / not null
const { data } = await db.aselect("users", { phone: null });
const { data } = await db.aselect("users", { phone_$not_null: "" });

// Range
const { data } = await db.aselect("users", { counter: [5, 10] }, { 
    ops: { counter: "between" } 
});
```

**All operators:**

| What | Inline | Example |
|------|--------|---------|
| equals | `col: val` | `{ name: "Alice" }` |
| not equals | `col_$ne` | `{ role_$ne: "guest" }` |
| greater than | `col_$gt` | `{ age_$gt: 18 }` |
| less than | `col_$lt` | `{ price_$lt: 100 }` |
| greater or equal | `col_$ge` | `{ score_$ge: 50 }` |
| less or equal | `col_$le` | `{ score_$le: 100 }` |
| in list | `col_$in` | `{ status_$in: ["active", "pending"] }` |
| not in list | `col_$not_in` | `{ status_$not_in: ["deleted"] }` |
| between | `col: [a,b]` + ops | `{ age: [18, 65] }, { ops: { age: "between" } }` |
| starts with | `col_$begins_with` | `{ name_$begins_with: "A" }` |
| contains | `col_$includes` | `{ bio_$includes: "developer" }` |
| ends with | `col_$ends_with` | `{ email_$ends_with: ".edu" }` |
| is null | `col: null` | `{ deleted_at: null }` |
| is not null | `col_$not_null` | `{ verified_$not_null: "" }` |

---

## List/array operators

For `list` and `set` columns:

```js
// Has this value
const { data } = await db.aselect("users", { tags_$contains: ["admin"] });

// Doesn't have this value  
const { data } = await db.aselect("users", { tags_$not_contains: ["banned"] });

// Has ALL of these values
const { data } = await db.aselect("users", { tags_$all_in: ["admin", "verified"] });
```

---

## Combine conditions

Use `$or` for alternatives:

```js
// name is "Alice" OR role is "admin"
const { data } = await db.aselect("users", { 
    $or: { name: "Alice", role: "admin" } 
});

// Multiple values for same column: id is 1 OR 2 OR 3
const { data } = await db.aselect("users", { 
    $or: { id: 1, id_$: 2, id_$$: 3 }  // use _$ _$$ for duplicates
});
```

---

## Update records

**Replace values:**

```js
await db.aupdate("users", { 
    id: "abc123",
    name: "Alice Smith",
    email: "alice.smith@example.com"
});
```

**Increment counters:**

```js
// Add 1 to counter
await db.aincr("users", { id: "abc123", counter: 1 });

// Subtract
await db.aincr("users", { id: "abc123", counter: -5 });
```

**Modify lists:**

```js
// Add to list
await db.aupdate("users", { id: "abc123", tags_$add: ["premium"] });

// Remove from list
await db.aupdate("users", { id: "abc123", tags_$del: ["trial"] });
```

**Set only if empty:**

```js
// Only sets role if it's currently null
await db.aupdate("users", { id: "abc123", role_$not_exists: "member" });
```

**Get the updated record back:**

```js
const { data: user } = await db.aupdate("users", {
    id: "abc123",
    name: "New Name"
}, { returning: "*", first: true });

console.log(user.name); // "New Name"
```

---

## Delete records

```js
await db.adel("users", { id: "abc123" });
```

---

## Pagination

Use `count` to limit results and `next_token` to get the next page:

```js
// First page
let { data, info } = await db.aselect("users", {}, { 
    sort: "ctime",
    count: 10 
});

console.log(data);              // first 10 users
console.log(info.next_token);   // token for next page

// Next page
if (info.next_token) {
    const page2 = await db.aselect("users", {}, {
        sort: "ctime",
        count: 10,
        start: info.next_token
    });
}
```

Loop through all pages:

```js
let token = null;
let allUsers = [];

do {
    const { data, info } = await db.aselect("users", { role: "admin" }, {
        count: 100,
        start: token
    });
    allUsers.push(...data);
    token = info.next_token;
} while (token);
```

---

## Streaming large datasets

For big tables, use `ascan` to process rows without loading everything:

```js
// Process one at a time
await db.ascan("users", { role: "admin" }, { count: 100 }, (user, next) => {
    console.log(user.email);
    next();  // call next() to continue
});

// Process in batches
await db.ascan("users", {}, { count: 100, sync: true }, (batch) => {
    console.log(`Got ${batch.length} users`);
});
```

---

## Batch operations

Run multiple operations at once:

```js
const ops = [
    { table: "users", op: "add", query: { email: "one@test.com", name: "One" } },
    { table: "users", op: "add", query: { email: "two@test.com", name: "Two" } },
    { table: "users", op: "update", query: { id: "abc", counter: 1 } },
];

await db.abulk(ops);
```

For all-or-nothing (rollback on any failure):

```js
await db.atransaction(ops);
```

---

## Caching

Cache reads to reduce database load:

```js
// Enable caching for a table
db.cache.tables.push("users");
db.cache.ttl.users = 60000;  // 60 seconds

// First read hits the database
const { data, info } = await db.aget("users", { id: "abc123" });
console.log(info.cached);  // 0 = from database

// Second read comes from cache
const { data, info } = await db.aget("users", { id: "abc123" });
console.log(info.cached);  // 1 = from cache
```

---

## Table aliases

Use short names for tables:

```js
db.aliases.u = "users";

// These are the same:
await db.aget("users", { id: "abc" });
await db.aget("u", { id: "abc" });
```

---

## Field visibility (cleanup)

Control which fields are returned based on user roles:

```js
db.describeTables({
    users: {
        id:       { type: "uuid", primary: 1 },
        email:    { cleanup: false },              // always visible
        password: { cleanup: true },               // never visible
        ssn:      { cleanup: { roles: ["admin"] } }, // only for admins
        salary:   { cleanup: { roles: ["hr", "admin"] } },
    }
});

// Strip sensitive fields before sending to client
const safeUser = db.cleanupResult("users", user, { 
    user: { roles: ["member"] }  // current user's roles
});
// safeUser has email, but not password, ssn, or salary
```

---

## Raw SQL

When you need it (SQL backends only):

```js
const { data } = await db.asql(
    "SELECT * FROM users WHERE email LIKE $1 AND created_at > $2",
    ["%@gmail.com", "2024-01-01"]
);
```

---

## Validation errors

Validation failures return a descriptive error:

```js
// Name too long (max: 100)
const { err } = await db.aadd("users", { name: "A".repeat(200) });
if (err) console.log(err.message);  // "...too large..."

// Required field missing
const { err } = await db.aadd("users", { name: "" });  // not_empty validation
if (err) console.log(err.message);  // "...not be empty..."
```

---

## Quick reference

**Read:**
- `db.aget(table, { key })` — one record by primary key
- `db.alist(table, [{ key }, ...])` — multiple by keys
- `db.aselect(table, { conditions }, options)` — query with conditions
- `db.ascan(table, { conditions }, options, callback)` — stream large results

**Write:**
- `db.aadd(table, record)` — insert (fails if exists)
- `db.aput(table, record)` — insert or replace
- `db.aupdate(table, { key, ...changes })` — update fields
- `db.aincr(table, { key, counter: N })` — increment counter
- `db.adel(table, { key })` — delete

**Batch:**
- `db.abulk([{ table, op, query }, ...])` — run multiple ops
- `db.atransaction([...])` — all-or-nothing batch

**Options:**
- `{ returning: "*", first: true }` — return the affected record
- `{ select: "id,name" }` — only these columns
- `{ sort: "ctime", desc: true }` — order results
- `{ count: 10, start: token }` — pagination
- `{ ops: { col: "gt" } }` — set operator via options instead of `_$`
