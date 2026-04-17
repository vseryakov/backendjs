
const cluster = require("node:cluster");
const { app, lib, jobs, queue } = require("../");
const { ainit, astop, testJob } = require("./utils");

const roles = process.env.BKJS_ROLES || "redis";
const queueName = lib.split(roles)[0];

jobs.testJob = testJob;

if (cluster.isWorker) {
    return app.start({ worker: 1, roles, config: __dirname + "/bkjs.conf" }, () => {
        process.exit();
    });
}

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

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
        const file = "/tmp/job3.test";
        lib.unlinkSync(file);

        await jobs.asubmitJob({ job: { "jobs.testJob": { file, data: "local" } } }, { queueName: "local" });
        await lib.sleep(100)

        var data = lib.readFileSync(file);
        assert.match(data, /local/);

    });

    it("run worker job", async() => {
        var file = "/tmp/job4.test";
        lib.unlinkSync(file);

        await jobs.asubmitJob({ job: { "jobs.testJob": { file, data: "worker" } } }, { queueName: "worker" });
        await lib.sleep(500)

        var data = lib.readFileSync(file);
        assert.match(data, /worker/);
    });

    await it("run simple job", async () => {
        var file = "/tmp/job1.test";
        lib.unlinkSync(file);

        const opts = { queueName };

        await jobs.asubmitJob({ job: { "jobs.testJob": { file, data: "job" } } }, opts);
        await lib.sleep(500)

        var data = lib.readFileSync(file);
        assert.match(data, /job/);
    });

    await it("run cancel job", async () => {
        const file = "/tmp/job2.test";
        lib.unlinkSync(file);

        const opts = { queueName };

        await jobs.asubmitJob({ job: { "jobs.testJob": { file, cancel: "job2", timeout: 5000 } } }, opts);
        await lib.sleep(500)

        jobs.cancelJob("job2");
        await lib.sleep(500);

        var data = lib.readFileSync(file);
        assert.match(data, /cancelled/);
    });

    it("serialize with uniqueKey", async () => {
        const file = "/tmp/job5.test";
        lib.unlinkSync(file);

        const opts = { queueName, visibilityTimeout: 1000, uniqueKey: "testTtl" }

        jobs.submitJob({ job: { "jobs.testJob": { file, timeout: 1000, data: "ttl1" } } }, opts);
        jobs.submitJob({ job: { "jobs.testJob": { file, timeout: 1000, data: "ttl2" } } }, opts);

        await lib.sleep(4000)

        var data = lib.readFileSync(file).split("\n");
        assert.match(data[0], /ttl/);
        assert.match(data[1], /ttl/);
        assert.ok(lib.toNumber(data[1]) - lib.toNumber(data[0]) >= 1000, data)

    });

    it("retry after visibilityTimeout", async () => {
        const file = "/tmp/job6.test";
        lib.unlinkSync(file);

        const opts = { queueName, visibilityTimeout: 1000, uniqueKey: "testRetry" }

        jobs.submitJob({ job: { "jobs.testJob": { file, err: { status: 600 }, err_expires: Date.now() + 300, data: "retry" } } }, opts);
        await lib.sleep(1000)

        var data = lib.readFileSync(file);
        assert.match(data, /retry/);

        await lib.sleep(2000)

        data = lib.readFileSync(file).split("\n");
        assert.match(data[0], /retry/);
        assert.match(data[1], /retry/);
        assert.ok(lib.toNumber(data[1]) - lib.toNumber(data[0]) >= 1000, data)

    });


});


