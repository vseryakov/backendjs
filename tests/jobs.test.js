
/**
 * To test different queues:
 *
 * Redis: `node --test tests/jobs.test.js`
 *
 * Redis with worker locking: `BKJS_ROLES=redis,worker-uniq,redis-jobs --test tests/jobs.test.js`
 *
 * Redis with worker queue: `BKJS_ROLES=worker-sys,worker-uniq,redis-jobs --test tests/jobs.test.js`
 *
 * NATS: `BKJS_ROLES=redis,nats-jobs --test tests/jobs.test.js`
 *
 * SQS: `BKJS_ROLES=redis,sqs-jobs --test tests/jobs.test.js`
 *
 * DB Sqlite: `BKJS_ROLES=redis,sqlite,db-jobs node --test tests/jobs.test.js`
 *
 * DB Postgres: `BKJS_ROLES=redis,postgres,db-jobs node --test tests/jobs.test.js`
 *
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const cluster = require("node:cluster");
const { app, lib, jobs, queue } = require("../");
const { ainit, astop, testJob } = require("./utils");

const roles = process.env.BKJS_ROLES || "redis,redis-jobs";

const queueName = lib.split(roles).at(-1).replace("-jobs", "");

jobs.testJob = testJob;

if (cluster.isWorker) {
    return app.start({ worker: 1, roles, config: __dirname + "/bkjs.conf" }, () => {
        process.exit();
    });
}

describe("Jobs tests", async () => {

    before(async () => {
        await ainit({ jobs: 1, roles })

        const purge = lib.getArgInt("-purge");
        if (purge > 0) {
            await queue.apurge(queueName);
            await lib.sleep(purge)
        }

    });

    after(async () => {
        await astop();
    });

    it("run local job", async () => {
        const file = app.tmpDir + "/job3.test";
        lib.unlinkSync(file);

        await jobs.asubmitJob({ job: { "jobs.testJob": { file, data: "local" } } }, { queueName: "local" });
        await lib.sleep(100)

        var data = lib.readFileSync(file);
        assert.match(data, /local/);

    });

    it("run worker job", async() => {
        var file = app.tmpDir + "/job4.test";
        lib.unlinkSync(file);

        await jobs.asubmitJob({ job: { "jobs.testJob": { file, data: "worker" } } }, { queueName: "worker" });
        await lib.sleep(500)

        var data = lib.readFileSync(file);
        assert.match(data, /worker/);
    });

    await it("run simple job", async () => {
        var file = app.tmpDir + "/job1.test";
        lib.unlinkSync(file);

        const opts = { queueName };

        await jobs.asubmitJob({ job: { "jobs.testJob": { file, data: "job" } } }, opts);
        await lib.sleep(500)

        var data = lib.readFileSync(file);
        assert.match(data, /job/);
    });

    await it("run cancel job", async () => {
        const file = app.tmpDir + "/job2.test";
        lib.unlinkSync(file);

        const opts = { queueName };

        await jobs.asubmitJob({ job: { "jobs.testJob": { file, cancel: "job2", timeout: 5000 } } }, opts);
        await lib.sleep(500)

        jobs.cancelJob("job2");
        await lib.sleep(500);

        var data = lib.readFileSync(file);
        assert.match(data, /cancelled/);
    });

    await it("serialize with uniqueKey", async () => {
        const file = app.tmpDir + "/job5.test";
        lib.unlinkSync(file);

        const opts = { queueName, visibilityTimeout: 1000, uniqueKey: "testTtl" }

        jobs.submitJob({ job: { "jobs.testJob": { file, timeout: 1000, data: "ttl1" } } }, opts);
        jobs.submitJob({ job: { "jobs.testJob": { file, timeout: 1000, data: "ttl2" } } }, opts);

        await lib.sleep(4000)

        var data = lib.readFileSync(file, { list: "\n" });
        assert.match(data[0], /ttl/);
        assert.match(data[1], /ttl/);
        const diff = lib.toNumber(data.at(-1)) - lib.toNumber(data[0])

        assert.ok(diff >= 1000, `${diff}, ${data}`)

    });

    await it("retry after visibilityTimeout", async () => {
        const file = app.tmpDir + "/job6.test";
        lib.unlinkSync(file);

        const opts = { queueName, visibilityTimeout: 1000, uniqueKey: "testRetry" }

        jobs.submitJob({ job: { "jobs.testJob": { file, err: { status: 600 }, err_expires: Date.now() + 1000, data: "retry" } } }, opts);
        await lib.sleep(1000)

        var data = lib.readFileSync(file);
        assert.match(data, /retry/);

        await lib.sleep(2000)

        data = lib.readFileSync(file, { list: "\n" });
        assert.match(data[0], /retry/);
        assert.match(data[1], /retry/);

        const diff = lib.toNumber(data.at(-1)) - lib.toNumber(data[0])

        assert.ok(diff >= 1000, `${diff}, ${data}`)

    });

    await it("check noWait", async () => {
        var file = app.tmpDir + "/job7.test";
        lib.unlinkSync(file);

        const opts = { queueName, noWait: 1 };

        await jobs.asubmitJob({ job: { "jobs.testJob": { file, err: { status: 600 }, err_expires: Date.now() + 300, data: "noWait" } } }, opts);
        await lib.sleep(2000)

        var data = lib.readFileSync(file).split("\n");
        assert.match(data[0], /noWait/);
        assert.match(data[1], /^$/);
    });

    await it("check endTime", async () => {
        var file = app.tmpDir + "/job8.test";
        lib.unlinkSync(file);

        const opts = { queueName, endTime: Date.now() - 100 };

        await jobs.asubmitJob({ job: { "jobs.testJob": { file, data: "endTime" } } }, opts);
        await lib.sleep(500)

        const data = lib.readFileSync(file);
        assert.strictEqual(data, "");

    });

    await it("check startTime", async () => {
        var file = app.tmpDir + "/job9.test";
        lib.unlinkSync(file);

        const now = Date.now();
        const opts = { queueName, startTime: now + 1500 };

        await jobs.asubmitJob({ job: { "jobs.testJob": { file, data: "startTime" } } }, opts);
        await lib.sleep(2500)

        const data = lib.readFileSync(file);
        assert.match(data, /startTime/);

        const diff = lib.toNumber(data) - now;

        assert.ok(diff >= 1500, `${diff}, ${data}`)

    });

});


