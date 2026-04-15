
const cluster = require("node:cluster");
const { app, lib, events, queue } = require("../");
const { ainit, astop, testEvent } = require("./utils");

events.testEvent = testEvent;

if (cluster.isWorker) {
    return app.start({ events: 1, roles: process.env.BKJS_ROLES || "redisevent", config: __dirname + "/bkjs.conf" }, () => {
        process.exit();
    });
}

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe("Events tests", async () => {

    var opts = {
        queueName: (lib.split(process.env.BKJS_ROLES)[0] || "redisevent").replace("event", "")
    };

    before(async () => {
        await ainit({ events: 1, roles: process.env.BKJS_ROLES || "redisevent" })
        await queue.apurge(opts);
    });

    after(async () => {
        await astop();
    });


    await it("put events", async () => {
        var file = "/tmp/event1.test";
        lib.unlinkSync(file);

        await events.aputEvent("TEST", { file, data: "test" });
        await events.aputEvent("SUBJECT1", { file, data: "subject1" });
        await lib.sleep(500)

        var data = lib.readFileSync(file).split("\n");
        assert.equal(data.filter(x => /# test$|subject1#.+subject1$/.test(x)).length, 2);
    });

    await it("group events", async () => {
        if (opts.queueName != "nats") return;

        var file = "/tmp/event2.test";
        lib.unlinkSync(file);

        await events.aputEvent("SUBJECT1", { file, data: "subject1" });
        await events.aputEvent("SUBJECT2", { file, data: "subject2" });
        await events.aputEvent("SUBJECT1", { file, data: "subject12" });
        await lib.sleep(500)

        var data = lib.readFileSync(file).split("\n");
        assert.equal(data.filter(x => /subject2#group2/.test(x)).length, 1);
        assert.equal(data.filter(x => /subject1#group1/.test(x)).length, 2);
    });


});

