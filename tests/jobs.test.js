
const cluster = require("node:cluster");
const { app, lib, jobs, cache } = require("../");
const { ainit, astop, testJob } = require("./utils");

jobs.testJob = testJob;

if (cluster.isWorker) {
    return app.start({ worker: 1, roles: process.env.BKJS_ROLES || "redis", config: __dirname + "/bkjs.conf" }, () => {
        process.exit();
    });
}

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { promisify } = require("util");

const submitJob = promisify(jobs.submitJob.bind(jobs));

describe("Jobs tests", async () => {

    var opts = {
        queueName: process.env.BKJS_ROLES || "redis",
    };

    before(async () => {
        await ainit({ jobs: 1, roles: process.env.BKJS_ROLES || "redis" })
        await cache.adel(opts.queueName);
        await cache.adel("#" + opts.queueName);
    });

    after(async () => {
        await astop();
    });


    await it("run simple job", async () => {
        var file = "/tmp/job1.test";
        lib.unlinkSync(file);

        await jobs.submitJob({ job: { "jobs.testJob": { file, data: "job" } } }, opts);
        await lib.sleep(200)

        var data = lib.readFileSync(file);
        assert.match(data, /job/);
    });

    await it("run cancel job", async () => {
        const file = "/tmp/job2.test";
        lib.unlinkSync(file);

        await submitJob({ job: { "jobs.testJob": { file, cancel: "job2", timeout: 5000 } } }, opts);
        await lib.sleep(500)

        jobs.cancelJob("job2");
        await lib.sleep(500);

        var data = lib.readFileSync(file);
        assert.match(data, /cancelled/);
    });

    it("run local job", async () => {
        const file = "/tmp/job3.test";
        lib.unlinkSync(file);

        await submitJob({ job: { "jobs.testJob": { file, data: "local" } } }, { queueName: "local" });
        await lib.sleep(100)

        var data = lib.readFileSync(file);
        assert.match(data, /local/);

    });

    it("run worker job", async() => {
        var file = "/tmp/job4.test";
        lib.unlinkSync(file);

        await submitJob({ job: { "jobs.testJob": { file, data: "worker" } } }, { queueName: "worker" });
        await lib.sleep(500)

        var data = lib.readFileSync(file);
        assert.match(data, /worker/);
    });
});


