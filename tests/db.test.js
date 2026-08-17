/**
 * To test different databases:
 *
 * BKJS_ROLES=postgres node --test tests/db.test.js
 *
 * BKJS_ROLES=dynamodb node --test tests/db.test.js
 *
 * BKJS_ROLES=elasticsearch node --test tests/db.test.js
 *
 * BKJS_ROLES=rqlite node --test tests/db.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, db, lib, logger } = require("../");
const { ainit, astop } = require("./utils");

const roles = process.env.BKJS_ROLES || "sqlite";

const tables = {
    bk_test1: {
        id: {
            type: "uuid",
            primary: 1,
            index: 1,
            _$dynamodb: { projections: ["email"] }
        },
        key: {
            type: "keyword",
            primary: 2,
            not_null: true,
            join: ["key1","key2"],
        },
        key1: { type: "text" },
        key2: { type: "int" },
        ctime: {
            type: "now",
            readonly: true,
            index: 2,
        },
        mtime: { type: "now" },
        name: { validate: { max: 32 } },
        email: { type: "email" },
        json: { type: "json" },
        realnum: { type: "real" },
        counter: {
            type: "counter",
            value: 0,
        },
        notempty: {
            validate: { not_empty: true }
        },
        dflt: { dflt: "1" },
        obj: { type: "obj" },
        list: { type: "array" },
        tags: {
            type: "list",
            validate: { max_list: 3 }
        },
        weights: {
            type: "set",
            split: {
                data_type: "int"
            }
        },
        nospecial: {
            validate: { max: 32, trunc: 1 },
            convert: { strip: lib.rxSpecial }
        },
    },
};

var id1 = lib.uuid(), id2 = lib.uuid(), id3 = lib.uuid();
var key1 = lib.uuid(), key2 = lib.randomInt(1, 1000);
var row = {
    id: id1,
    name: "test name",
    email: "test@email.com",
    json: '{ "a": 1, "b": "b" }',
    realnum: 1.12345,
    obj: { a: 1, b: "b" },
    list: ["a", "b", "c"],
    tags: ["tag1", "tag2", "tag3"],
    weights: [1,2,"3",4,"5"],
    nospecial: "[plain, text!]###########################",
    bignum: lib.randomInt(10000000, 1000000000),
}
var next_token = null;
var config;

describe("DB tests", async () => {

    before(async () => {
        await ainit({ roles })

        db.tables = {};
        db.describeTables(tables);

        db.setProcessRow("post", "bk_test1", (op, row) => {
            row.computed = `${row.id} ${row.mtime}`;
            return row;
        });

        db.customColumn.bk_test1 = { "count[0-9]+": "counter" };

        config = db.getPool(db.pool).config;

    });

    after(async () => {
        await astop();
    });

    await it("db drop", async() => {

        db.skip = { drop: /./ };

        const { err: dropped } = await db.adrop("bk_test1", { pool: db.pool });
        assert.strictEqual(dropped.code, "SkipDrop");

        db.skip.drop = null;

        await db.acacheColumns(db.pool);

        const pool = db.getPool(db.pool);

        for (const table in tables) {
            if (!pool.dbcolumns[table]) continue;
            const { err } = await db.adrop(table, { pool: db.pool });
            assert.ok(!err);
        }

    });

    await it("db create", async() => {

        const { err, created } = await db.acreateTables({ pools: [db.pool] });
        assert.ok(!err);
        assert.deepStrictEqual(created, Object.keys(tables));
    });

    await it("db migrate", async() => {

        db.tables.bk_test1.bignum = {
            type: "bigint",
            index1: 1,
        };

        const { err, upgraded } = await db.acreateTables({ pools: [db.pool] });
        assert.ok(!err);
        assert.deepStrictEqual(upgraded, Object.keys(tables));

        const pool = db.getPool(db.pool);

        await db.acacheColumns(db.pool);

        assert.ok(Object.keys(pool.dbindexes).find(x => x.includes("bignum")), JSON.stringify(pool.dbindexes))

    });

    await it("db not empty", async() => {

        const rc = await db.aadd("bk_test1", row)
        assert.match(rc?.err?.message, /not be empty/);

        row.notempty = 1
    });

    await it("db not null", async() => {

        if (!config.features.not_null) return;

        let rc = await db.aadd("bk_test1", row);
        assert.match(rc?.err?.message, /NULL|not-null|required keys/);

        row.key1 = key1;
        rc = await db.aadd("bk_test1", row);
        assert.match(rc?.err?.message, /NULL|not-null|required keys/);

    });

    await it("db too large", async() => {

        row.key1 = key1;
        row.key2 = key2;

        row.name += "1".repeat(100);
        let rc = await db.aadd("bk_test1", row);
        assert.match(rc?.err?.message, /too large/);

        row.name = row.name.replaceAll("1", "");


        row.tags.push(...row.tags.map(x => x + 1));
        rc = await db.aadd("bk_test1", row);
        assert.match(rc?.err?.message, /too large/);

        row.tags = row.tags.slice(0, 2);

    });

    await it("db add", async() => {

        let rc = await db.aadd("bk_test1", row, { returning: "*", first: true });
        assert.strictEqual(rc?.err, null);
        assert.ok(rc?.data?.id);

        rc = await db.aadd("bk_test1", row);
        assert.ok(rc?.err);

        rc = await db.adel("bk_test1", { id: id1, key1, key2 });
        assert.strictEqual(rc?.err, null);

        rc = await db.aget("bk_test1", { id: id1, key1, key2 });
        assert.strictEqual(rc?.err, null);
        assert.strictEqual(rc?.data, null);

        rc = await db.aadd("bk_test1", row);
        assert.strictEqual(rc?.err, null);


        row.id = id2;
        rc = await db.aadd("bk_test1", row);
        assert.strictEqual(rc?.err, null);


        row.id = id3;
        rc = await db.aadd("bk_test1", row);
        assert.strictEqual(rc?.err, null);

        row.key1 = key1;
        row.key2 = key1;
        rc = await db.aadd("bk_test1", row);
        assert.strictEqual(rc?.err, null);

        row.key1 = key2;
        row.key2 = key2;
        rc = await db.aadd("bk_test1", row);
        assert.strictEqual(rc?.err, null);

    });

    await it("db incr", async() => {

        let rc = await db.aincr("bk_test1", { id: id1, key1, key2, counter: 3 });
        assert.strictEqual(rc?.err, null);

        rc = await db.aincr("bk_test1", { id: id2, key1, key2, counter: 1 });
        assert.strictEqual(rc?.err, null);

        rc = await db.aincr("bk_test1", { id: id3, key1, key2, counter: 2 });
        assert.strictEqual(rc?.err, null);

        rc = await db.aincr("bk_test1", { id: id3, key1, key2: key1, counter: -2 });
        assert.strictEqual(rc?.err, null);
    });

    await it("db get", async() => {

        let rc = await db.aget("bk_test1", { id: id1, key1, key2 });
        assert.strictEqual(rc?.data?.id, id1);

        assert.strictEqual(rc?.data?.name, row.name);
        assert.strictEqual(rc?.data?.email, row.email);
        assert.deepStrictEqual(rc?.data?.json, row.obj);
        assert.strictEqual(rc?.data?.realnum, row.realnum);
        assert.deepStrictEqual(rc?.data?.counter, 3)
        assert.deepStrictEqual(rc?.data?.obj, row.obj);
        assert.deepStrictEqual(rc?.data?.list, row.list)
        assert.deepStrictEqual(rc?.data?.tags, row.tags);
        assert.deepStrictEqual(rc?.data?.weights, row.weights.map(x => parseInt(x)));
        assert.strictEqual(rc?.data?.nospecial, row.nospecial.replace(lib.rxSpecial, ""));
        assert.strictEqual(rc?.data?.bignum, row.bignum);

        rc = await db.aget("bk_test1", { id: id2, key1, key2 });
        assert.strictEqual(rc?.data?.id, id2);
        assert.deepStrictEqual(rc?.data?.counter, 1)

        rc = await db.aget("bk_test1", { id: id3, key1, key2 });
        assert.strictEqual(rc?.data?.id, id3);
        assert.deepStrictEqual(rc?.data?.counter, 2)

    });

    await it("db list", async() => {

        let rc = await db.alist("bk_test1", [id1, id2, id3, 1].map(id => ({ id, key1, key2 })));
        assert.strictEqual(rc?.data?.length, 3);

        rc = await db.alist("bk_test1", rc.data);
        assert.strictEqual(rc?.data?.length, 3);
    });

    await it("db select", async() => {

        let rc = await db.aselect("bk_test1", { id: id1 });
        assert.strictEqual(rc?.data?.[0]?.id, id1);

        rc = await db.aselect("bk_test1", { id: id3, $or: { key1, key1_$: String(key2) } });
        assert.strictEqual(rc?.data?.length, 3);

        rc = await db.aselect("bk_test1", { id: id3, key1_$in: [key1, String(key2)] });
        assert.strictEqual(rc?.data?.length, 3);

        rc = await db.aselect("bk_test1", { id: id3, key1: [key1, String(key2)] }, { ops: { key1: "in" } });
        assert.strictEqual(rc?.data?.length, 3);

        rc = await db.aselect("bk_test1", { id: id3, counter_$gt: 0 }, { select: 'id,counter' });
        assert.strictEqual(rc?.data?.length, 1);
        assert.strictEqual(rc?.data[0].key1, undefined);
        assert.strictEqual(rc?.data[0].counter, 2);

        rc = await db.aselect("bk_test1", { id: id3, counter: 0 }, { ops: { counter: 'lt' } })
        assert.strictEqual(rc?.data?.length, 1);

        rc = await db.aselect("bk_test1", { id: id3, counter: [0,2] }, { ops: { counter: 'between' } })
        assert.strictEqual(rc?.data?.length, 2);

        rc = await db.aselect("bk_test1", { id: id3, key_$begins_with: key1 });
        assert.strictEqual(rc?.data?.length, 2);

    });

    await it("other", { skip: 1 }, async() => {
        lib.series([
            function(next) {
                // Check pagination
                next_token = null;
                var rc = [];
                lib.forEachSeries([2, 3], function(n, next2) {
                    db.select("test2", { id: id2 }, { sort: "id2", start: next_token, count: n, select: 'id,id2' }, function(err, rows, info) {
                        next_token = info.next_token;
                        rc.push.apply(rc, rows);
                        next2(err);
                    });
                }, function(err) {
                    // Redis cannot sort due to hash implementation, known bug
                    var isok = db.pool == "redis" ? rc.length>=5 : rc.length==5 && (rc[0].id2 == 1 && rc[rc.length-1].id2 == 5);
                    assert(err || !isok, "err10:", rc.length, isok, rc, next_token);
                    next();
                })
            },
            function(next) {
                // Check pagination with small page size with condition on the range key
                next_token = null;
                lib.forEachSeries([2, 3], function(n, next2) {
                    db.select("test2", { id: id2, id2: '0' }, { sort: "id2", ops: { id2: 'gt' }, start: next_token, count: n, select: 'id,id2' }, function(err, rows, info) {
                        next_token = info.next_token;
                        var isok = db.pool == "redis" ? rows.length>=n : rows.length==n;
                        assert(err || !isok || !info.next_token, "err11:", rows.length, n, info, rows);
                        next2();
                    });
                },
                function(err) {
                    if (err) return next(err);
                    db.select("test2", { id: id2, id2: '0' }, { ops: { id2: 'gt' }, sort: "id2", start: next_token, count: 5, select: 'id,id2' }, function(err, rows, info) {
                        next_token = info.next_token;
                        var isnum = db.pool == "redis" ? rows.length>=3 : rows.length==4;
                        var isok = rows.every(function(x) { return x.id2 > '0' });
                        assert(err || !isnum || !isok, "err12:", isok, rows.length, rows, info);
                        next();
                    });
                });
            },
            function(next) {
                assert(null, next_token, "err13: next_token must be null", next_token);
                next();
            },
            function(next) {
                // Select by primary key and other filter
                db.select("test2", { id: id, num: 9, num2: 9 }, { ops: { num: 'ge', num2: 'ge' } }, function(err, rows, info) {
                    assert(err || rows.length==0 || rows[0].num!=9 || rows[0].num2!=9, "err13:", rows, info);
                    next();
                });
            },
            function(next) {
                // Wrong query property and non-existent value
                db.select("test2", { id: id, num: 9, num2: 9, email: 'fake' }, { sort: "id_num", ops: { num: 'ge' } }, function(err, rows, info) {
                    assert(err || rows.length!=0, "err14:", rows, info);
                    next();
                });
            },
            function(next) {
                // Scan the whole table with custom filter
                db.select("test2", { num: 9 }, { ops: { num: 'ge' } }, function(err, rows, info) {
                    var isok = rows.every(function(x) { return x.num >= 9 });
                    assert(err || rows.length==0 || !isok, "err15:", isok, rows, info);
                    next();
                });
            },
            function(next) {
                // Query with sorting with composite key
                db.select("test2", { id: id2 }, { desc: true, sort: "id2" }, function(err, rows, info) {
                    assert(err || rows.length==0 || rows[0].id2!='9' , "err17:", rows, info);
                    next();
                });
            },
            function(next) {
                // Query with sorting by another column/index
                db.select("test2", { id: id2 }, { desc: true, sort: "num" }, function(err, rows, info) {
                    assert(err || rows.length==0 || rows[0].num!=9 , "err18:", rows, info);
                    next();
                });
            },
            function(next) {
                // Scan all records
                var rows = [];
                db.scan("test2", {}, { count: 2 }, function(row, next2) {
                    rows.push(row);
                    next2();
                }, function(err) {
                    assert(err || rows.length!=11, "err19:", rows.length);
                    next();
                });
            },
            function(next) {
                db.put("test1", { id: id, email: id, num: 1 }, { info_obj: 1 }, function(err, rows, info) {
                    rec = info.obj;
                    assert(err || 0, "err24:");
                    next();
                });
            },
            function(next) {
                db.update("test1", { id: id, email: "test", num: 1 }, { query: { id: id, email: id }, skip_columns: ["mtime"], updateOps: { num: "incr" } }, function(err, rc, info) {
                    assert(err || info.affected_rows!=1, "err25:", info);
                    next();
                });
            },
            function(next) {
                db.get("test1", { id: id }, {}, function(err, row) {
                    assert(err || !row || row.mtime != rec.mtime, "err25-1:", row, rec);
                    next();
                });
            },
            function(next) {
                db.update("test1", { id: id, email: "test", num: 1 }, { query: { id: id, email: "test" }, updateOps: { num: "incr" } }, function(err, rc, info) {
                    assert(err || info.affected_rows!=1, "err26:", info);
                    next();
                });
            },
            function(next) {
                db.update("test1", { id: id, email: "test", num: 100 }, { query: { id: id, email: id }, returning: "*" }, function(err, rc, info) {
                    assert(err || info.affected_rows, "err27:", info, rc);
                    next();
                });
            },
            function(next) {
                db.update("test1", { id: id, email: "test", num: 2 }, { query: { id: id, num: 1 }, ops: { num: "gt" } }, function(err, rc, info) {
                    assert(err || !info.affected_rows, "err28:", info);
                    next();
                });
            },
            function(next) {
                db.get("test1", { id: id }, {}, function(err, row) {
                    assert(err || !row || row.num != 2, "err29:", row);
                    next();
                });
            },
            function(next) {
                db.put("test3", { id: id, num: 1, obj: { n: 1, v: 2 }, list: [{ n: 1 },{ n: 2 }], tags: "1,2,3", text: "123", mapped: "1", notempty: "1" }, { info_obj: 1 }, function(err, rc, info) {
                    rec = info.obj;
                    assert(err, "err34:", info);
                    next();
                });
            },
            function(next) {
                var q = { id: id, num: 2, mtime: rec.mtime, obj: "1", action1: 1 };
                if (!configOptions.noListOps) q.tags = "4";
                db.update("test3", q, { updateOps: { tags: "add" } }, function(err, rc, info) {
                    assert(err || !info.affected_rows, "must update 1 row:", info);
                    next();
                });
            },
            function(next) {
                db.get("test3", { id: id + " " }, {}, function(err, row) {
                    assert(err || row?.num != 2 || row.obj?.n != 1, "num must be 2 and obj.n must be 1", row)
                    assert(!row.list || !row.list[0] || row.list[0].n != 1, "list must have 0 item n.1", row);
                    if (!configOptions.noListOps) {
                        expect(row.tags?.length == 4 && row.tags == "1,2,3,4", "tags must be 1,2,3,4", row);
                    }
                    expect(row.text && !row.mapped, "text must be not null but mapped must be null", row);
                    next();
                });
            },
            function(next) {
                db.incr("test3", { id: id + " ", action1: 2, mapped: "2", tags: [3,4,5] }, function(err, rc, info) {
                    assert(err || !info.affected_rows, "err37:", info);
                    next();
                });
            },
            function(next) {
                db.get("test3", { id: id }, {}, function(err, row) {
                    assert(err || !row || (!configOptions.noCustomColumns && row.action1 != 3), "action1 must be 3", row, db.customColumn);
                    expect(row.mapped == "none", "mapped must be none", row)
                    expect(row.tags?.length === 3 && row.tags == "3,4,5", "tags must be a list", row)
                    next();
                });
            },
            function(next) {
                db.update("test3", { id: id, tags: [6,7] }, { updateOps: { tags: "add" } }, next);
            },
            function(next) {
                db.update("test3", { id: id, tags: "6" }, { updateOps: { tags: "del" } }, next);
            },
            function(next) {
                db.update("test3", { id: id, tags: [] }, { updateOps: { tags: "add" } }, next);
            },
            function(next) {
                db.get("test3", { id: id }, function(err, row) {
                    expect(configOptions.noListOps || row?.tags == "3,4,5,7", "tags must have 4 items", row, configOptions)
                    next();
                });
            },
            function(next) {
                configOptions.maxSize = configOptions.maxList = 50;
                var str = "", list = [];
                for (let i = 0; i < 128; i++) list.push((str += i));
                    var q = {
                        id: id, obj: { test: str }, tags: list, list: list, text: str,
                        sen1: "a b, c!",
                        sen2: "<tag>test",
                        spec: "$t<e>st@/.!",
                    };
                    db.update("test3", q, function(err, rc, info) {
                        expect(!err && info.affected_rows, "update failed:", info);
                        next();
                    });
                },
                function(next) {
                    db.get("test3", { id: id }, {}, function(err, row) {
                        assert(err ||
                           row?.text != "123" ||
                           row?.tags?.length > 5 ||
                           row?.list?.length != 2 ||
                           row?.obj?.n != 1, "max size limits failed:", row);
                        expect(row.spec == "$test@/.", "spec regexp failed", row.spec)
                        expect(row.sen1 == "a b, c!", "sen1 regexp failed", row.sen1)
                        expect(!row.sen2, "sen2 regexp failed", row.sen2)
                        next();
                    });
                },
                function(next) {
                    db.aliases.t = "test3";
                    db.get("t", { id: id }, {}, function(err, row) {
                        expect(row.id == id, "must get row by alias", row)
                        next();
                    });
                },
                function(next) {
                    db.cache.tables.push("test1","test3");
                    db.cache2.test3 = 30000;
                    db.get("test3", { id: id }, { cached: 1 }, (err, row, info) => {
                        assert(err || row?.id != id || row?.num != 2, "err7:", row);
                        expect(info.cached === 0, "expect test3 cached = 0", row, info)

                        db.get("test1", { id: id }, (err, row, info) => {
                            expect(info.cached === 0, "expect test1 cached = 0", row, info)
                            setTimeout(next, 100);
                        });
                    });
                },
                function(next) {
                    db.getCache("test3", { id: id }, {}, (data, cached) => {
                        var row = lib.jsonParse(data);
                        assert(!data || cached != 2 || row?.num != 2, "err7-lru-cache:", row, cached);
                        next();
                    });
                },
                function(next) {
                    db.get("test1", { id: id }, (err, row, info) => {
                        expect(info.cached === 1, "expect test1 cached = 1", row, info)
                        next();
                    });
                },
                function(next) {
                    db.get("test3", { id: id }, (err, row, info) => {
                        expect(info.cached === 2, "expect test3 cached = 2", row, info)
                        next();
                    });
                }
            ], callback);
    });

    await it("check config logic", async () => {
        db.config = db.pool;
        db.initConfigTable();

        const { err } = await db.acreateTables({ pools: [db.pool] });
        assert.ok(!err);

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

        let types = db.configTypes();

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

        const type1 = app.roles + "-" + app.role;
        const type2 = app.roles + "-" + app.tag;
        const type3 = type1 + "-" + app.role;

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

        let rc = await db.agetConfig();
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

    it("check cleanup rules", () => {

        var tables = {
            cleanup: {
                pub: { cleanup: false },
                priv: { cleanup: true },
                billing: { cleanup: { roles: ["billing"] } },
                nobilling: { cleanup: { no_roles: ["billing"] } },
                billing_staff: { cleanup: { roles: ["billing", "staff"] } },
                notpub: {},
                extra: {},
                extra2: {},
            },
        };
        var row = {
            pub: "pub",
            priv: "priv",
            notpub: "notpub",
            billing: "billing",
            nobilling: "nobilling",
            billing_staff: "billing_staff",
            extra: "extra",
            extra2: "extra2"
        }

        db.describeTables(tables);

        let res = db.cleanupResult("cleanup", Object.assign({}, row))
        assert.ok(res.pub && !res.priv && !res.extra && !res.notpub, lib.newError({ message: "pub and no private", res }));

        res = db.cleanupResult("cleanup", Object.assign({}, row), { user: { roles: ["billing"] } })
        assert.ok(res.billing && !res.priv, lib.newError({ message: "should keep billing", res }));

        res = db.cleanupResult("cleanup", Object.assign({}, row), { user: { roles: ["billing"] } })
        assert.ok(!res.nobilling && !res.priv, lib.newError({ message: "should remove nobilling", res }));

        res = db.cleanupResult("cleanup", Object.assign({}, row), { user: { roles: ["staff"] } })
        assert.ok(res.billing_staff && !res.priv, lib.newError({ message: "should keep billing_staff", res }));

        res = db.cleanupResult("cleanup", Object.assign({}, row), { cleanup: { extra: false } })
        assert.ok(res.extra && !res.extra2, lib.newError({ message: "should keep extra but not extra2", res }));

        db.cleanup = { cleanup: { extra2: false } };

        res = db.cleanupResult("cleanup", Object.assign({}, row))
        assert.ok(!res.extra && res.extra2, lib.newError({ message: "should keep extra2 but not extra via table rule", res }));

        db.tables = {};

    });

});


