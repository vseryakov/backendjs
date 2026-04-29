
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, logger, db, lib, cache, logwatcher, api } = require("../");

describe("Config tests", async () => {

    it("test sections", async () => {

        var data = `
line1=line1
[tag=test1]
line3=line3
[roles=test2]
line4=line4
[tag=test]
line5=line5
[env.tag=tag]
line6=line6
[roles=dev,staging]
line7=line7
[aws.key=]
line8=line8
[env.tag!=]
line9=line9
[none.test=1]
line10=line10
[env.tag!=aaa]
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

        args = lib.configParse(data, { context: { tag: "test1" } });
        assert.deepStrictEqual(args, ["-line1", "line1", "-line3", "line3", "-line2", "line2"])

        args = lib.configParse(data, { context: { tag: "test", roles: "test2" } });
        assert.deepStrictEqual(args, ['-line1', 'line1','-line4', 'line4','-line5', 'line5','-line2', 'line2' ])

        app.env.tag = "tag";
        app.env.roles = ["dev", "staging", "prod"];
        args = lib.configParse(data, { context: app });
        assert.deepStrictEqual(args, ['-line1', 'line1', '-line6', 'line6', '-line9', 'line9', '-line11', 'line11', '-line2', 'line2' ])
    })

    it("test parameters", async () => {

        var argv = [
            "-api-redirect-url", '{ "^a/$": "a", "^b": "b" }',
            "-logwatcher-send-error", "a",
            "-logwatcher-files-error", "a",
            "-logwatcher-files", "b",
            "-logwatcher-matches-error", "a",
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

        assert.partialDeepStrictEqual(api.cleanup.rules.aaa, { one: 1, two: 2, three: 3 })

        assert.partialDeepStrictEqual(app.logInspect, { length: 222, b: true, s: ["s :"], ignore: /test/ })
    })

    it("db config tests", async () => {
        app.appName = "app";
        app.appVersion = "1.0.0";
        app.roles = "test,dev";
        app.role = "shell";
        app.tag = "qa";
        app.region = "us-east-1";

        db.configMap = {
            top: "roles",
            main: "role, tag",
            other: "role, region",
        }

        var types = db.configTypes();

        assert.partialDeepStrictEqual(types, [app.roles]);
        assert.partialDeepStrictEqual(types, [app.roles+"-"+app.role]);
        assert.partialDeepStrictEqual(types, [app.roles+"-"+app.role+"-"+app.role]);
        assert.partialDeepStrictEqual(types, [app.roles+"-"+app.role+"-"+app.region]);
        assert.partialDeepStrictEqual(types, [app.roles+"-"+app.tag]);
        assert.partialDeepStrictEqual(types, [app.roles+"-"+app.tag+"-"+app.role]);
        assert.partialDeepStrictEqual(types, [app.roles+"-"+app.tag+"-"+app.region]);

        db.configMap.top = "roles,appName";
        types = db.configTypes();

        assert.partialDeepStrictEqual(types, [app.appName]);
        assert.partialDeepStrictEqual(types, [app.appName+"-"+app.role+"-"+app.region]);
        assert.partialDeepStrictEqual(types, [app.appName+"-"+app.tag+"-"+app.region]);

        async function getConfig () {
            return new Promise((resolve) => db.getConfig(resolve))
        }

        var type1 = app.roles + "-" + app.role;
        var type2 = app.roles + "-" + app.tag;
        var type3 = type1 + "-" + app.role;

        await db.adelAll("bk_config", { type: [type1, type2, type3] });

        await db.aput("bk_config", { type: type1, name: "param1", value: "ok" })
        await lib.sleep(50);
        await db.aput("bk_config", { type: type1, name: "param2", value: "hidden", status: "hidden" })
        await lib.sleep(50);
        await db.aput("bk_config", { type: type2, name: "param2", value: "version", version: ">1.0.0" })
        await lib.sleep(50);
        await db.aput("bk_config", { type: type1, name: "param3", value: "stime", stime: Date.now()+200 })
        await lib.sleep(50);
        await db.aput("bk_config", { type: type2, name: "param3", value: "etime", etime: Date.now()+500 })
        await lib.sleep(100);

        var rows = await getConfig();
        assert.partialDeepStrictEqual(rows, [ { name: "param1" }, { name: "param3", value: "etime" } ]);

        app.appVersion = "1.1.0";
        rows = await getConfig();
        assert.partialDeepStrictEqual(rows, [{ name: "param1" }, { name: "param2" }, { name: "param3" }]);

        await lib.sleep(200);

        app.appVersion = "1.0.0";
        rows = await getConfig();
        assert.partialDeepStrictEqual(rows, [ { name: "param1" }, { name: "param3", value: "stime" } ]);

        await db.aput("bk_config", { type: type3, name: "param1", value: "zero", stime: 0, etime: 0 })
        await lib.sleep(250);

        rows = await getConfig();
        assert.partialDeepStrictEqual(rows, [ { name: "param1", value: "ok" }, { name: "param3", value: "stime" }, { name: "param1", value: "zero" }]);

    });

    after(async () => {
        await app.astop();
    })

});
