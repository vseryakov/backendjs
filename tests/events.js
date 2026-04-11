
const cluster = require("node:cluster");
const { app, lib, jobs, queue } = require("../");
const { ainit, astop, testJob } = require("./utils");

jobs.testJob = testJob;

if (cluster.isWorker) {
    return app.start({ worker: 1, roles: process.env.BKJS_ROLES || "redisevent", config: __dirname + "/bkjs.conf" }, () => {
        process.exit();
    });
}

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe("Events tests", async () => {

    var queueName = lib.split(process.env.BKJS_ROLES)[0] || "redisevent";
    var opts = {
        queueName,
        cacheName: queueName
    };

    before(async () => {
        await ainit({ jobs: 1, roles: process.env.BKJS_ROLES || "redisevent" })
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


});

