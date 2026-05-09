
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, lib, db } = require("../");
const { ainit } = require("./utils");

const roles = process.env.BKJS_ROLES || "sqlite";

describe("DB Config tests", async () => {

    before(async () => {
        await ainit({ roles })
    });

    after(async () => {
        await app.astop();
    });

    it("db config tests", async () => {
        db.config = db.pool;
        db.initConfigTable();


        app.appName = "app";
        app.version = "bkjs/1.0.0";
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

        var rc = await db.agetConfig();
        assert.partialDeepStrictEqual(rc.data, [ { name: "param1" }, { name: "param3", value: "etime" } ]);

        app.version = "bkjs/1.1.0";
        rc = await db.agetConfig();
        assert.partialDeepStrictEqual(rc.data, [{ name: "param1" }, { name: "param2" }, { name: "param3" }]);

        await lib.sleep(200);

        app.version = "bkjs/1.0.0";
        rc = await db.agetConfig();
        assert.partialDeepStrictEqual(rc.data, [ { name: "param1" }, { name: "param3", value: "stime" } ]);

        await db.aput("bk_config", { type: type3, name: "param1", value: "zero", stime: 0, etime: 0 })
        await lib.sleep(250);

        rc = await db.agetConfig();
        assert.partialDeepStrictEqual(rc.data, [ { name: "param1", value: "ok" }, { name: "param3", value: "stime" }, { name: "param1", value: "zero" }]);

    });


});

