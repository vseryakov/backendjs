
const util = require("util");
const fs = require("fs");
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { app, logger, db, lib, cache, logwatcher, api, aws } = require("../");

describe("Config sections tests", () => {

    var data = `
line1=line1
[tag=test1]
line3=line3
[runMode=test2]
line4=line4
[tag=test]
line5=line5
[instance.tag=tag]
line6=line6
[roles=dev,staging]
line7=line7
[aws.key=]
line8=line8
[instance.tag!=]
line9=line9
[none.test=1]
line10=line10
[instance.tag!=aaa]
line11=line11
[roles=dev]
line12=line12
[roles=beta]
line13=line13
[global]
line2=line2
`;

    var args = lib.configParse(data);
    assert.ok(args.includes("-line1"), "expects line1:" + args)
    assert.ok(args.includes("-line2"), "expects line2:" + args)
    assert.ok(!args.includes("-line3"), "not expects line3:" + args)
    assert.ok(!args.includes("-line4"), "not expects line4:" + args)

    args = lib.configParse(data, { tag: "test1" });
    assert.ok(args.includes("-line1"), "tag: expects line1:" + args)
    assert.ok(args.includes("-line2"), "tag: expects line2:" + args)
    assert.ok(args.includes("-line3"), "tag: expects line3:" + args)
    assert.ok(!args.includes("-line4"), "tag: not expects line4:" + args)
    assert.ok(!args.includes("-line5"), "tag: not expects line5:" + args)

    args = lib.configParse(data, { tag: "test", runMode: "test2" });
    assert.ok(args.includes("-line1"), "runMode: expects line1:" + args)
    assert.ok(args.includes("-line2"), "runMode: expects line2:" + args)
    assert.ok(!args.includes("-line3"), "runMode: expects line3:" + args)
    assert.ok(args.includes("-line4"), "runMode: expects line4:" + args)
    assert.ok(args.includes("-line5"), "runMode: expects line5:" + args)

    app.instance.tag = "tag";
    app.roles = ["dev", "staging", "prod"];
    args = lib.configParse(data, app);
    assert.ok(args.includes("-line6"), util.format("instance tag: expects line6: %o, %o", args, app.instance))
    assert.ok(!args.includes("-line8"), util.format("no aws key: not expects line8: %o, %o", args, aws.key))
    assert.ok(args.includes("-line9"), util.format("instance tag not empty: expects line9: %o, %o", args, app.instance))
    assert.ok(!args.includes("-line10"), "bad module: not expects line10:" + args)
    assert.ok(args.includes("-line11"), "instance tags != aaa: not expects line11:" + args)
    assert.ok(args.includes("-line12"), "config roles = dev: expects line12:" + args)
    assert.ok(!args.includes("-line13"), "config roles != beta: not expects line13:" + args)

})

describe("Config tests", () => {

    var argv = [
        "-api-redirect-url", '{ "^a/$": "a", "^b": "b" }',
        "-logwatcher-send-error", "a",
        "-logwatcher-files-error", "a",
        "-logwatcher-files", "b",
        "-logwatcher-matches-error", "a",
        "-db-create-tables",
        "-db-sqlite-pool-max", "10",
        "-db-sqlite1-pool", "a",
        "-db-sqlite1-pool-max", "10",
        "-db-sqlite1-pool-options-test", "test",
        "-db-sqlite-pool-options-discovery-interval", "30000",
        "-db-sqlite-pool-options-map.test", "test",
        "-db-sqlite-pool-options", "arg1:1,arg2:2",
        "-db-aliases-Test6", "t",
        "-cache-default", "local://default?bk-count=2",
        "-cache-q", "local://queue?bk-test=10",
        "-cache-q-options", "count:10,interval:100",
        "-cache-q-options-visibilityTimeout", "1000",
        "-api-cleanup-rules-aaa", "one:1,two:2",
        "-api-cleanup-rules-aaa", "three:3",
        "-app-log-inspect-map", "length:222,b:true,s:s%20%3a%2c,ignore:^/test/$",
    ];

    cache._config = {};
    db._config = {};

    app.parseArgs(argv);
    logger.debug("config:", db._config);

    assert.ok(!(!app.workerId && !db._createTables), "invalid db-create-tables");

    assert.ok(db.aliases.t == "test6", "db alias must be lowercase", db.aliases);

    assert.ok(!(db._config.sqlite?.max != 10), "invalid sqlite max", db._config.sqlite);

    assert.ok(!(db._config.sqlite.configOptions.arg1 != 1 || db._config.sqlite.configOptions.arg2 != 2), "invalid sqlite map with args", db._config.sqlite);

    assert.ok(!(db._config.sqlite1?.url != "a"), "invalid sqlite1 url", db._config.sqlite1);
    assert.ok(!(db._config.sqlite1.max != 10), "invalid sqlite1 max", db._config.sqlite1);
    assert.ok(!(db._config.sqlite.configOptions.discoveryInterval != 30000), "invalid sqlite interval", db._config.sqlite);
    assert.ok(!(db._config.sqlite.configOptions['map.test'] != "test"), "invalid sqlite map", db._config.sqlite);
    assert.ok(!(db._config.sqlite1.configOptions.test != "test"), "invalid sqlite1 map", db._config.sqlite1);

    logger.debug("config:", cache._config);
    assert.ok(!(cache._config.q?.count != 10 || cache._config.q?.interval != 100), "invalid queue q options", cache._config.q);
    assert.ok(!(cache._config.q?.visibilityTimeout != 1000), "invalid queue visibility timeout", cache._config.q);

    cache.closeClients();
    cache.initClients();
    var q = cache.getClient("");
    assert.ok(!(q.options.count != 2), "invalid default queue count", q, cache._config)

    app.parseArgs(["-cache-default-options-visibilityTimeout", "99", "-cache-default", "local://default?bk-count=10"]);
    assert.ok(!(q.options.visibilityTimeout != 99 || q.options.count != 10), "invalid default queue options", q.options, cache._config)

    app.parseArgs(["-cache-fake-options-visibilityTimeout", "11"]);
    assert.ok(!(q.options.visibilityTimeout == 11), "fake queue should be ignored", q.options, cache._config)

    q = cache.getClient("q");
    assert.ok(!(q.options.test != 10), util.format("invalid queue url options: %o, %o", q.options, cache._config))
    app.parseArgs(["-cache-q-options-visibilityTimeout", "99", "-cache-q-options", "count:99"]);
    assert.ok(!(q.options.visibilityTimeout != 99 || q.options.count != 99), "invalid q queue options", q.options, cache._config)

    assert.ok(!(logwatcher.send.error != "a"), "invalid logwatcher email", logwatcher.send);
    assert.ok(!(logwatcher.matches.error.indexOf("a") == -1), "invalid logwatcher match", logwatcher.matches);
    assert.ok(!(!logwatcher.files.some(function(x) { return x.file == "a" && x.type == "error"})), "invalid logwatcher file", logwatcher.files);
    assert.ok(!(!logwatcher.files.some(function(x) { return x.file == "b"})), "invalid logwatcher file", logwatcher.files);

    assert.ok(!(api.cleanupRules.aaa?.one != 1 || api.cleanupRules.aaa?.two != 2 || api.cleanupRules.aaa?.three != 3), "invalid api cleanup rules", api.cleanupRules);

    assert.ok(app.logInspect.length === 222)
    assert.ok(app.logInspect.b === true)
    assert.ok(app.logInspect.s === "s :,")
    assert.ok(String(app.logInspect.ignore) === "/test/")
})

