# Using the Job Queue

The `jobs` module turns backendjs into a task queue system. You submit work as plain objects, and worker processes pick it up and run it. Jobs can execute in-process (local), in a forked worker on the same host, or in a worker on a remote host — all through the same API.

Every job function looks the same regardless of backend:

```js
function myJob(options, callback) {
    // do work with `options`
    callback();                       // success
    callback(new Error("oops"));      // failure — queued for retry
}
```

---

## Anatomy of a job

A job is an object with a `job` property. The property maps a `"module.method"` string to its arguments:

```json
{ "job": { "mymod.sendEmail": { to: "a@b.com", subject: "Hi" } } }
```

A job can contain **multiple** tasks, and they'll run one by one:

```json
{
    "job": {
        "mymod.sendEmail": { to: "a@b.com" },
        "mymod.logResult": { result: "done" }
    }
}
```

For convenience, a **string** shorthand is accepted and normalized automatically:

```js
// All three are equivalent:
"mymod.sendEmail"
{ job: "mymod.sendEmail" }
{ job: { "mymod.sendEmail": {} } }
```

The `module.method` name must match `^[a-z0-9_.]+\.[a-z0-9_]+$` — dot-separated, alphanumeric + dots/underscores.

---

## A complete module with a job

You need two pieces: a route to **submit** the job and a method to **process** it.

**modules/email.js**

```js
const { app, api, modules, jobs, db, logger } = require("backendjs");

module.exports = {

    name: "email",

    // ── API route: submit and return immediately ──────────────────────────
    configureMiddleware(options, callback) {
        api.app.post("/emails", (context) => {
            jobs.submit(
                { job: { "email.send": { to: context.body.to, subject: context.body.subject } } },
                { queueName: "emails" },    // which worker queue to use
                (err) => context.reply(err)   // reply once the job is enqueued
            );
        });
        callback();
    },

    // ── Worker method: the actual job logic ───────────────────────────────
    sendEmail(options, callback) {
        logger.info("emails:", "sending to", options.to, options.subject);
        // ... send email, write to db, etc.
        callback();
    }
};

app.start({ server: true });
```

**bkjs.conf**

```
queue-emails = sqs://my-emails
queue-emails-visibility-timeout = 60000
```

Start the server (spawns 2 workers by default):

```shell
node index.js -jobs-workers 2 -jobs-worker-queue emails
```

Now `POST /emails` returns immediately. A worker on the same or a different host picks up the message.

### Calling from another module

Any module can submit a job without importing `jobs` if it calls through the module system:

```js
modules.myjob.runJob({ "queueName": "emails" }, (err) => { ... });
```

Or directly:

```js
const { jobs } = require("backendjs");
jobs.submit({ job: { "email.send": { to: "x@y.com" } } }, { queueName: "emails" });
```

---

## Queues

Two queues exist by default:

| Queue | Behavior |
|-------|----------|
| `local` | Runs in the **current** process — no worker fork. Fast for short tasks. |
| `worker` | Runs in a **forked worker** process — survives restarts of the web server. |

You can create as many named queues as you like by defining them in `bkjs.conf` or `-queue-*` params, then workers subscribe to them via `-jobs-worker-queue`.

Each queue maps to a **queue driver** — SQS, Redis, RabbitMQ, NATS, or an in-memory `local` queue. The driver is selected by the URI scheme in `-queue-<name>`:

```
queue-letters = sqs://letters
queue-emails  = redis://localhost:6379/0
queue-events  = nats://localhost:4222/events
```

A queue can be a **list** of driver names — the job is submitted to the **next** one in round-robin, useful for load balancing:

```
queue-events = nats://host1 nats://host2
```

To **stop** subscribing to a queue on workers, prefix the name with `-` or `!`:

```shell
node index.js -jobs-worker-queue "-worker emails"   # unsubscribe worker, subscribe emails
```

### Default queue override

Set `-jobs-global-queue myqueue` to force all submissions to one queue (ignores the per-call `queueName`). The `local` and `worker` queues are always ignored by the global override.

---

## Submitting jobs

### API

```js
// Callback
jobs.submit(jobspec, options, callback);

// Async (prefixed with 'a')
const { err, data } = await jobs.asubmit(jobspec, options);
```

### Running directly (skip the queue)

```js
// Callback
jobs.run(jobspec, { queueName: "local" }, callback);

// Async
const { err, data } = await jobs.arun(jobspec, { queueName: "local" });
```

### Submit to a specific queue

```js
jobs.submit(jobspec, { queueName: "orders" });
```

### Multiple jobs at once

Pass an array of job specs — it submits each one and waits for all to complete:

```js
jobs.submit([
    { job: { "email.send": { to: "a@b.com" } } },
    { job: { "email.send": { to: "c@d.com" } } },
], { queueName: "emails" }, (err) => {
    // all enqueued
});
```

---

## Job options

All options are part of the `options` object passed to `submit` or on the jobspec itself. They can also be set **per-queue** in `bkjs.conf`, in which case they apply to every job submitted to that queue.

**Dedup and uniqueness**

| Option | Description |
|--------|-------------|
| `uniqueTtl` | Number of milliseconds. Creates a cache lock on the job. If a second job with the same key arrives while the lock is held, it waits (or is dropped). |
| `uniqueKey` | Custom key for the lock. Useful to serialize jobs by a business key: `uniqueKey: "ORDER:" + orderId` |
| `uniqueDrop` | `true` — instead of queuing a duplicate job, drop it silently. |
| `uniqueKeep` | `true` — keep the lock after the job finishes, preventing all future duplicates. |
| `uniqueOnce` | `true` — stop extending the visibility timeout while the job is running. |
| `dedupTtl` | Number of milliseconds to remember recently-seen messages. Prevent the same job being processed twice. |

```js
// Serialize orders for the same account — 5 min gap between two executions
jobs.submit(job, {
    queueName: "orders",
    uniqueKey: `ORDER:${accountId}`,
    uniqueTtl: 300000,
});

// Drop duplicate submissions while a job for this account is running
jobs.submit(job, {
    queueName: "orders",
    uniqueKey: `ORDER:${accountId}`,
    uniqueDrop: true,
    uniqueTtl: 60000,
});
```

**Visibility and retry**

| Option | Description |
|--------|-------------|
| `visibilityTimeout` | Ms the job is invisible to other workers while processing. Prevents double execution. |
| `noVisibilityTimeout` | `true` — disable auto-extending the timeout during the job. |
| `noRetryVisibilityTimeout` | `true` — ignore 600 errors, delete the job after processing. |
| `retryVisibilityTimeout` | Map of error status → timeout in ms. Controls retry delays per error code. |

```js
// 5-minute visibility window, 600+ errors cause a 30-second retry
jobs.submit(job, {
    queueName: "orders",
    visibilityTimeout: 300000,
    retryVisibilityTimeout: { 600: 30000, 500: 10000 },
});
```

**Timing**

| Option | Description |
|--------|-------------|
| `delay` | ms to wait before the job becomes visible (SQS only). |
| `startTime` | Unix ms — job will not start before this time. |
| `endTime` | Unix ms — job is dropped if not started by this time. |
| `noWait` | `true`/`1` — delete the job from the queue immediately after processing. A number gives a delay before deletion. |

```js
// Run an hour from now; delete the message immediately after it finishes
jobs.submit(job, {
    queueName: "reports",
    startTime: Date.now() + 3600000,
    noWait: 1,
});
```

**Error handling**

| Option | Description |
|--------|-------------|
| `stopOnError` | `true` — stop at the first task error. Without it, all tasks run and each error is logged. |
| `logger` | Log level string used when the job finishes. Default: `"debug"`. |

```js
// Fail fast on first error
jobs.submit(job, { queueName: "orders", stopOnError: true });

// Log job completion at "warn" level
jobs.submit(job, { queueName: "orders", logger: "warn" });
```

**Task ignore**

A regex in `-jobs-task-ignore` silently skips any task whose name matches. Useful in development to block a slow task:

```
jobs-task-ignore = mymod.expensiveTask
```

---

## Cancellation

To interrupt running jobs, broadcast a cancel key via IPC. Each job function should poll and respect it:

```js
// From server or client
const { jobs, ipc } = require("backendjs");
jobs.cancel("order:123");
```

Inside the job method:

```js
processOrder(options, callback) {
    // Poll for cancellation
    if (jobs.isCancelled("order:" + options.id)) {
        return callback(lib.newError("Cancelled", 600, "JobCancelled"));
    }
    // ...
}
```

---

## Cron / scheduled jobs

Define recurring jobs with cron expressions. Cron expression format (note the optional leading **second** field):

```
┌─ second (0-59, optional)
│ ┌─ minute (0-59)
│ │ ┌─ hour (0-23)
│ │ │ ┌─ day of month (1-31)
│ │ │ │ ┌─ month (1-12)
│ │ │ │ │ ┌─ day of week (0-6, 0 and 7 are Sunday)
│ │ │ │ │ │
* * * * * *
```

### From a JSON file

Create a file `crontab.json`:

```js
[
    { "cron": "0 0 * * *", "job": "email.dailyDigest", "queueName": "reports" },
    {
        "cron": "0 3 * * 1,3,5",
        "job": { "reports.weekly": { type: "finance" } },
        "queueName": "reports",
        "uniqueTtl": 600000
    },
    { "cron": "* * * * *", "job": "healthbeat.ping", "disabled": true }
]
```

Start with:

```shell
node index.js -jobs-workers 1 -jobs-cron-file crontab.json
```

The file is watched for changes — update it while the server runs and jobs are re-scheduled.

### From `-jobs-cron` config or `scheduleCronjobs`

```js
// In bkjs.conf:
// jobs-cron = [{"cron":"0 12 * * *","job":"reports.summary"}]

const { jobs } = require("backendjs");

// Programmatic:
jobs.scheduleCronjob({
    cron: "0 0 * * * *",
    job: "reports.nightlySummary",
    queueName: "reports",
});

// Schedule a batch, replacing previous jobs of the same type:
jobs.scheduleCronjobs("config", [
    { cron: "*/5 * * * * *", job: "healthbeat.ping" },
    { cron: "0 0 * * *",     job: "reports.sum", queueName: "reports" },
]);
```

### From the config DB

The `-jobs-cron` param can also be set from the database config. When the config DB updates, `scheduleCronjobs("config", newJobs)` is called automatically — no restart needed.

---

## Module hooks (lifecycle)

Job lifecycle emits hooks you can implement on custom modules:

```js
module.exports = {
    name: "myhook",

    // Called before each job runs. Return an error to skip the job.
    configureJob(options, callback) {
        // options = { queue, message }
        if (options.message?.job && !isAllowed(options.message.job)) {
            return callback(new Error("Not allowed"));
        }
        callback();
    },

    // Called after a job finishes (err or success)
    finishJob(options, callback) {
        // options = { queue, message, error, elapsed }
        console.log("Job finished in", options.elapsed, "ms");
        callback();
    },
}
```

`configureJob` runs **before** job execution and can abort it by returning an error. `finishJob` is parallel and direct — it will not slow down queue processing.

You can also listen for job events via IPC messages without implementing a module method:

```js
const { ipc } = require("backendjs");

ipc.on("jobs:started", ({ job, queueName }) => console.log("started:", job, queueName));
ipc.on("jobs:stopped", ({ job, err, queueName }) => console.log("stopped:", err ? "error" : "ok", queueName));
ipc.on("jobs:task:started", ({ name, job }) => console.log("task started:", name));
ipc.on("jobs:task:stopped", ({ name, job, err }) => console.log("task stopped:", name, err));
ipc.on("jobs:nolock", ({ job, err, queueName }) => logger.warn("job blocked by lock:", job, err));
ipc.on("jobs:dropped", ({ job, queueName }) => logger.info("job dropped:", job, queueName));
```

---

## Worker configuration

| Config | Default | Description |
|--------|---------|-------------|
| `jobs-workers` | `0` (auto = `cpuCount * workerCpuFactor`) | Number of processes to fork. `-1` disables workers. `0` = auto. |
| `jobs-worker-cpu-factor` | `2` | Multiplier for auto worker count (`cpuCount × 2` by default). |
| `jobs-worker-queue` | `worker` | Queue name(s) workers subscribe to. List = subscribe to all. |
| `jobs-worker-delay` | `50` | ms to delay worker subscription start — prevents race on simultaneous starts. |
| `jobs-worker-settings` | — | Passed to `cluster.setupMaster()`. |
| `jobs-worker-env` | — | Environment passed to forked workers. |
| `jobs-max-runtime` | `900000` | Max ms per job. Exceeding kills the worker. |
| `jobs-max-lifetime` | `12 h` | Max ms a worker lives. Exits after current job, new worker spawned. |
| `jobs-worker-options-<queue>` | — | Per-queue options passed to `queue.subscribeQueue`. |
| `jobs-shutdown-timeout` | `50` | ms to wait during graceful worker shutdown. |

### Graceful worker lifecycle

When a worker is idle for longer than `max-lifetime`, it stops accepting new jobs, finishes in-flight work, and exits. The server process then forks a fresh one. The `shutdownWorker` hook fires before exit — use it to close connections or flush buffers:

```js
const { modules } = require("backendjs");

module.exports = {
    name: "cleanup",

    shutdownWorker(options, callback) {
        // options.shutdownReason = "maxLifetime" | "maxRuntime" | "restart"
        // Close pending DB connections, flush buffers, etc.
        callback();
    }
};
```

---

## Running locally vs. remote

| Mode | Config / param | Where the job runs |
|------|----------------|--------------------|
| Local submit | `queueName: "local"` or default | Current process, no fork |
| Worker | `queueName: "worker"` or a custom queue with workers | Forked child process on the same host |
| Remote | `queueName` pointing to SQS/Redis/etc. | Any host connected to the same queue |

The same API (`jobs.submit`) is used for all three — only the queue driver changes.

---

## Job format validation

`jobs.isJob(jobspec)` validates and normalizes any job input. It accepts:

- string: `"mymod.method"` — must match `^[a-z0-9_.]+\.[a-z0-9_]+$`
- object: `{ job: "mymod.method" }` or `{ job: { "mymod.method": { … } } }`

It returns an `Error` with status `400` for anything else. All `submit`/`run` calls pass through this validation.

---

## Complete example: background order processing

```js
// modules/order.js
const { api, modules, jobs, db, logger, lib } = require("backendjs");

module.exports = {

    name: "order",

    tables: {
        bk_order: {
            id:       { type: "uuid", primary: 1, read_only: true },
            product:  { type: "text" },
            status:   { type: "text", value: "pending" },
            ctime:    { type: "now",  read_only: true }
        }
    },

    // ── API ───────────────────────────────────────────────────────────────
    configureMiddleware(options, callback) {

        // Public: create an order and kick off processing
        api.app.post("/orders", async (context) => {
            const order = await modules.order.createOrder(context.body);
            context.json(order);
        });

        callback();
    },

    // ── Job entry point ───────────────────────────────────────────────────
    configureServer(options, callback) {
        // Start cron: process pending orders every minute
        jobs.scheduleCronjob({
            cron: "0 * * * * *",       // every minute
            job: "order.processBatch",
            queueName: "orders",
            uniqueTtl: 60000,         // don't overlap runs
        });
        callback();
    },

    // ── API method to create an order ─────────────────────────────────────
    async createOrder(body) {
        const { err, data: order } = await db.aadd("bk_order", {
            product: body.product
        }, { returning: "*", first: 1 });
        if (err) throw err;

        // Async-variant helper
        const { err: submitErr } = await jobs.asubmit(
            { job: { "order.process": { orderId: order.id } } },
            {
                queueName: "orders",
                uniqueKey: "ORDER:" + order.id,
                uniqueTtl: 120000,
                visibilityTimeout: 60000,
            }
        );
        if (submitErr) throw submitErr;

        return order;
    },

    // ── Job: called in a worker ───────────────────────────────────────────
    process(options, callback) {
        logger.info("orders:", "processing", options.orderId);

        db.get("bk_order", { id: options.orderId }, (err, order) => {
            if (err) return callback(err);
            if (!order) return callback(lib.newError("Order not found", 404));

            // Do the work…
            db.update("bk_order", {
                id: order.id,
                status: "completed"
            }, (err2) => {
                if (err2) return callback(err2);
                logger.info("orders:", "done", order.id);
                callback();
            });
        });
    }
};
```

**bkjs.conf**

```
queue-orders = sqs://orders
queue-orders-visibility-timeout = 60000
queue-orders-options-retry-visibility-timeout = {"500":30000,"600":120000}
jobs-workers = 2
```

```shell
node index.js -jobs-worker-queue orders
```

---

## Quick reference

**Submit:** `jobs.submit(jobspec, options, cb)` / `await jobs.asubmit(...)`
**Run locally:** `jobs.run(jobspec, { queueName: "local" }, cb)` / `await jobs.arun(...)`
**Validate:** `jobs.isJob(jobspec)` → normalized obj or Error
**Schedule:** `jobs.scheduleCronjob({ cron, job, queueName })`
**Batch schedule:** `jobs.scheduleCronjobs("config", [ …jobs ])`
**Cancel:** `jobs.cancel("key")` → broadcasts to all workers
**Check cancel:** `jobs.isCancelled("key")`
**Stats:** `jobs.metrics.running`, `jobs.metrics.err_count` (via `configureCollectStats`)
