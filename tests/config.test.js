
const util = require("util");
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, logger, db, lib, cache, logwatcher, api } = require("../");

describe("Config tests", async () => {

it("test sections", async () => {

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
    assert.deepStrictEqual(args, ["-line1", "line1", "-line2", "line2"])

    args = lib.configParse(data, { tag: "test1" });
    assert.deepStrictEqual(args, ["-line1", "line1", "-line3", "line3", "-line2", "line2"])

    args = lib.configParse(data, { tag: "test", runMode: "test2" });
    assert.deepStrictEqual(args, ['-line1', 'line1','-line4', 'line4','-line5', 'line5','-line2', 'line2' ])

    app.instance.tag = "tag";
    app.instance.roles = ["dev", "staging", "prod"];
    args = lib.configParse(data, app);
    assert.deepStrictEqual(args, ['-line1', 'line1', '-line6', 'line6', '-line9', 'line9', '-line11', 'line11', '-line2', 'line2' ])
})

it("test parameters", async () => {

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

    assert.ok(!(!app.workerId && !db._createTables));

    assert.strictEqual(db.aliases.t, "test6");

    assert.strictEqual(db._config.sqlite?.max, 10);

    assert.partialDeepStrictEqual(db._config.sqlite.configOptions, { arg1: 1, arg2: 2 });

    assert.partialDeepStrictEqual(db._config.sqlite1, { url: "a", max: 10, configOptions: { test: "test" } })

    assert.partialDeepStrictEqual(db._config.sqlite, { configOptions: { discoveryInterval: 30000, 'map.test': "test" } });

    logger.debug("config:", cache._config);
    assert.partialDeepStrictEqual(cache._config.q, { count: 10, interval: 100, visibilityTimeout: 1000 })

    cache.shutdown();
    cache.initClients();
    var q = cache.getClient("");
    assert.strictEqual(q.options.count, 2)

    app.parseArgs(["-cache-default-options-visibilityTimeout", "99", "-cache-default", "local://default?bk-count=10"]);

    assert.partialDeepStrictEqual(q.options, { visibilityTimeout: 99, count: 10 });

    app.parseArgs(["-cache-fake-options-visibilityTimeout", "11"]);

    assert.partialDeepStrictEqual(q.options, { visibilityTimeout: 99 })

    q = cache.getClient("q");
    assert.partialDeepStrictEqual(q.options, { test: 10 })

    app.parseArgs(["-cache-q-options-visibilityTimeout", "99", "-cache-q-options", "count:99"]);
    assert.partialDeepStrictEqual(q.options, { visibilityTimeout: 99, count: 99 })

    assert.strictEqual(logwatcher.send.error, "a")
    assert.partialDeepStrictEqual(logwatcher.matches.error, ["a"]);
    assert.partialDeepStrictEqual(logwatcher.files, [{ file: "a", type: "error" }]);
    assert.partialDeepStrictEqual(logwatcher.files, [{ file: "b" }]);

    assert.partialDeepStrictEqual(api.cleanupRules.aaa, { one: 1, two: 2, three: 3 })

    assert.partialDeepStrictEqual(app.logInspect, { length: 222, b: true, s: ["s :"], ignore: /test/ })
})

after(async () => {
    await app.astop();
})

});
