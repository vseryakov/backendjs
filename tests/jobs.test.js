
const cluster = require("node:cluster");
const { app, lib, jobs, queue } = require("../");
const { ainit, astop, testJob } = require("./utils");

jobs.testJob = testJob;

if (cluster.isWorker) {
    return app.start({ worker: 1, roles: process.env.BKJS_ROLES || "redis", config: __dirname + "/bkjs.conf" }, () => {
        process.exit();
    });
}

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe("Jobs tests", async () => {

    var queueName = lib.split(process.env.BKJS_ROLES)[0] || "redis";
    var opts = {
        queueName,
    };

    before(async () => {
        await ainit({ jobs: 1, roles: process.env.BKJS_ROLES || "redis" })
        await queue.apurge(opts);
    });

    after(async () => {
        await astop();
    });


    await it("run simple job", async () => {
        var file = "/tmp/job1.test";
        lib.unlinkSync(file);

        await jobs.asubmitJob({ job: { "jobs.testJob": { file, data: "job" } } }, opts);
        await lib.sleep(500)

        var data = lib.readFileSync(file);
        assert.match(data, /job/);
    });

    await it("run cancel job", async () => {
        const file = "/tmp/job2.test";
        lib.unlinkSync(file);

        await jobs.asubmitJob({ job: { "jobs.testJob": { file, cancel: "job2", timeout: 5000 } } }, opts);
        await lib.sleep(100)

        jobs.cancelJob("job2");
        await lib.sleep(100);

        var data = lib.readFileSync(file);
        assert.match(data, /cancelled/);
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

    it("serialize with uniqueKey", async () => {
        const file = "/tmp/job5.test";
        lib.unlinkSync(file);

        const uopts = { ...opts, visibilityTimeout: 200, uniqueKey: "testTtl" }

        jobs.submitJob({ job: { "jobs.testJob": { file, timeout: 200, data: "ttl1" } } }, uopts);
        jobs.submitJob({ job: { "jobs.testJob": { file, timeout: 200, data: "ttl2" } } }, uopts);

        await lib.sleep(1500)

        var data = lib.readFileSync(file).split("\n");
        assert.match(data[0], /ttl/);
        assert.match(data[1], /ttl/);
        assert.ok(lib.toNumber(data[1]) - lib.toNumber(data[0]) >= 200, data)

    });

    it("retry after visibilityTimeout", async () => {
        const file = "/tmp/job6.test";
        lib.unlinkSync(file);

        const uopts = { ...opts, visibilityTimeout: 500, uniqueKey: "testRetry" }

        jobs.submitJob({ job: { "jobs.testJob": { file, err: { status: 600 }, err_expires: Date.now() + 300, data: "retry" } } }, uopts);
        await lib.sleep(200)

        var data = lib.readFileSync(file);
        assert.match(data, /retry/);

        await lib.sleep(1000)

        data = lib.readFileSync(file).split("\n");
        assert.match(data[0], /retry/);
        assert.match(data[1], /retry/);
        assert.ok(lib.toNumber(data[1]) - lib.toNumber(data[0]) >= 500, data)

    });


});


