
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, db, lib, logger } = require("../");
const { ainit } = require("./utils");

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
        key1: {},
        key2: { type: "int" },
        ctime: { type: "now", readonly: true },
        mtime: { type: "now" },
        name: { check: { max: 32 } },
        email: { type: "email" },
        json: { type: "json" },
        bignum: {
            type: "bigint",
            index: 2
        },
        realnum: { type: "real" },
        count: {
            type: "counter",
            value: 0,
        },
        notempty: {
            check: { not_empty: true }
        },
        dflt: { dflt: "1" },
        obj: { type: "obj" },
        list: { type: "array" },
        tags: { type: "list" },
        weights: {
            type: "set",
            datatype: "int"
        },
        nospecial: {
            check: { max: 32, trunc: 1 },
            convert: { strip: lib.rxSpecial }
        },
    },
};

var id1 = lib.uuid(), id2 = lib.uuid();
var key1 = lib.uuid(), key2 = lib.randomNum(1, 1000);
var name = "test name";
var email = "test@email.com";
var bignum = lib.randomNum(1, 1000);
var next_token = null;
var configOptions;

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

        configOptions = db.getPool(db.pool).configOptions;

    });

    after(async () => {
        await app.astop();
    });

    await it("drop tables", async() => {

        db.skip = { drop: /./ };

        const { err: dropped } = await db.adrop("bk_test1", { pool: db.pool });
        assert.strictEqual(dropped.code, "SkipDrop");

        db.skip.drop = null;

        for (const table in tables) {
            const { err } = await db.adrop(table, { pool: db.pool });
            assert.ok(!err);
        }

    });

    await it("create tables", async() => {

        const { err, created } = await db.acreateTables({ pools: [db.pool] });
        assert.ok(!err);
        assert.deepStrictEqual(created, Object.keys(tables));
    });

    await it("db checks", async() => {
        const row = { id: id1, name, email }

        let rc = await db.aadd("bk_test1", row)
        assert.match(rc?.err?.message, /not be empty/);

        row.notempty = 1
        row.key_$none = null

        rc = await db.aadd("bk_test1", row);
        // assert.match(rc?.err?.message, /NULL/);

        delete row.key_$none;

        // rc = await db.aadd("bk_test1", row);
        // assert.strictEqual(rc?.err, null);

        // rc = await db.aadd("bk_test1", row);
        // assert.ok(rc?.err);
    });

    await it("other", { skip: 1 }, async() => {
        lib.series([
            function(next) {
                db.get("test1", { id: id }, function(err, row) {
                    assert(err || !row || row.id != id || row.num != 1 || row.num3 != row.id+"|"+row.num || row.anum != "1" || row.jnum, "err1:", row);
                    if (db.pool != "elasticsearch") {
                        expect(!row.skipcol && !row.skipjoin && row.nojoin, "expect no skipcol, no skipjoin and nojoin", row)
                    }
                    next();
                });
            },
            function(next) {
                db.get("test1", { id: id2 }, function(err, row) {
                    assert(err || !row || row.num4 != "4" || row.jnum || !row.mnum || row.mnum.match(/\|$/), "err1-1:", row);
                    if (db.pool != "elasticsearch") {
                        expect(!row.skipcol && !row.skipjoin && row.nojoin, "expect no skipcol, no skipjoin and nojoin", row)
                    }
                    next();
                });
            },
            function(next) {
                db.get("test3", { id: id }, function(err, row) {
                    assert(err || !row || row.id != id, "err1-2:", row);
                    next();
                });
            },
            function(next) {
                // Type conversion for strictTypes
                db.get("test1", { id: id, num: '1' }, function(err, row) {
                    assert(err || !row || row.id != id || row.num!=1, "err2:", row);
                    next();
                });
            },
            function(next) {
                db.list("test1", String([id,id2,""]), {}, function(err, rows) {
                    var isok = rows.every(function(x) { return x.id==id || x.id==id2});
                    assert(err || rows.length!=2 || !isok, "err3:", rows.length, isok, rows);
                    next();
                });
            },
            function(next) {
                db.select("test3", { id: id }, function(err, rows) {
                    assert(err || rows.length!=1 || rows[0].id != id || rows[0].type!="like" || rows[0].fake || rows[0].dflt != "1", "err4:", rows);
                    next();
                });
            },
            function(next) {
                db.delAll("test1", { id: id, fake: 1 }, { join_skip: ["num3"] }, next);
            },
            function(next) {
                db.get("test1", { id: id }, function(err, row) {
                    assert(err || row, "err4-1:", row);
                    next();
                });
            },
            function(next) {
                db.select("test2", { id: id2 }, { filterrows: function(req, rows, o) { return rows.filter((x) => (x.id2 == '1')) } }, function(err, rows) {
                    assert(err || rows.length!=1 || rows[0].id2 != '1' || rows[0].num2 != num2 , "err5:", num2, rows);
                    next();
                });
            },
            function(next) {
                db.select("test2", { id: id2, id2: ["2"] }, { ops: { id2: "in" } }, function(err, rows) {
                    assert(err || rows.length!=1 || rows[0].id2!='2', "err5-1:", rows.length, rows);
                    next();
                });
            },
            function(next) {
                db.select("test2", { id: id2, id2: "" }, { ops: { id2: "in" }, select: ["id","name"] }, function(err, rows) {
                    assert(err || rows.length!=2, "err5-2:", rows.length, rows);
                    next();
                });
            },
            function(next) {
                db.list("test3", String([id,id2]), function(err, rows) {
                    assert(err || rows.length!=2, "err6:", rows);
                    next();
                });
            },
            function(next) {
                db.incr("test3", { id: id, num: 3 }, { mtime: 1 }, function(err) {
                    if (err) return next(err);
                    db.incr("test3", { id: id, num: 1 }, function(err) {
                        if (err) return next(err);
                        db.incr("test3", { id: id, num: -2 }, next);
                    });
                });
            },
            function(next) {
                db.select("test2", { id: id2, id2: '1' }, { ops: { id2: 'gt' }, select: 'id,id2,num2,mtime' }, function(err, rows) {
                    assert(err || rows.length!=1 || rows[0].email || rows[0].id2 != '2' || rows[0].num2 != num2, "err8:", rows);
                    next();
                });
            },
            function(next) {
                db.select("test2", { id: id2, id2: '1' }, { ops: { id2: 'begins_with' }, select: 'id,id2,num2,mtime' }, function(err, rows) {
                    assert(err || rows.length!=1 || rows[0].email || rows[0].id2 != '1' || rows[0].num2 != num2, "err8-1:", rows);
                    next();
                });
            },
            function(next) {
                db.select("test2", { id: id2, id2: "1,2" }, { ops: { id2: 'between' } }, function(err, rows) {
                    assert(err || rows.length!=2, "err8-2:", rows);
                    next();
                });
            },
            function(next) {
                db.select("test2", { id: id2, num: "1,2" }, { ops: { num: 'between' } }, function(err, rows) {
                    assert(err || rows.length!=2, "err8-3:", rows);
                    next();
                });
            },
            function(next) {
                db.update("test2", { id: id, id2: '1', email: id + "@test", num: 9, num2: 9, json: { a: 1, b: 2 }, mtime: now }, next);
            },
            function(next) {
                db.get("test2", { id: id, id2: '1' }, { consistent: true }, function(err, row) {
                    assert(err || !row || row.id != id || row.email != id+"@test" || row.num != 9, "err9-2:", row);
                    next();
                });
            },
            function(next) {
                db.del("test2", { id: id2, id2: '1', fake: 1 }, next);
            },
            function(next) {
                db.get("test2", { id: id2, id2: '1' }, { consistent: true }, function(err, row) {
                    assert(err || row, "del:", row);
                    next();
                });
            },
            function(next) {
                lib.forEachSeries([1,2,3,4,5,6,7,8,9], function(i, next2) {
                    db.put("test2", { id: id2, id2: String(i), email: id, name: id, birthday: id, num: i, num2: i, mtime: now }, next2);
                }, next);
            },
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
                db.add("test2", { id: id, id2: '2', email: id, name: id, birthday: id, num: 2, num2: 1, mtime: now }, next);
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
                // Scan the whole table with custom filter and sorting
                db.select("test2", { id: id2, num: 1 }, { ops: { num: 'gt' }, sort: "num" }, function(err, rows, info) {
                    var isok = rows.every(function(x) { return x.num > 1 });
                    assert(err || rows.length==0 || !isok , "err16:", isok, rows, info);
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
            async function(next) {
                var key = lib.random();
                await db.aput("test2", { id: key, key1: id, key2: 1 });
                await db.aput("test2", { id: key, key1: id, key2: 2 });
                await db.aput("test2", { id: key, key1: id, key2: 3 });

                var rows = await db.aselect("test2", { id: key });
                assert(rows?.length!=3 , "must be 3 records", rows);

                rows = await db.aselect("test2", { id: key, id2: id }, { select: ["id","id2","key1","key2"] });
                assert(rows?.length!=3 , "must be 3 records by matching beginning of secondary keys:", rows);

                var ids = rows.map((x) => { delete x.id2; return x });
                rows = await db.alist("test2", ids);
                assert(rows?.length!=3 , "expcted 3 rows by exact joined secondary key:", rows, ids);


                rows = await db.aselect("test2", { id: key, or$: { key2: 2, kkey2: 3 } }, { aliases: { kkey2: "key2" } });
                assert(rows?.length!=2 , "must be 2 records by OR condition with aliases", rows);

                rows = await db.aselect("test2", { id: key, or$: { key2: 2, $key2: 3 } } );
                assert(rows?.length!=2 , "must be 2 records by OR condition with $ as alias", rows);

                next();
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
                db.put("test3", { id: id, type: "1", notempty: "" }, { quiet: 1 }, function(err, rc, info) {
                    assert(err, "err30:", info);
                    next();
                });
            },
            function(next) {
                db.put("test3", { id: id, type: "2", notempty: "notempty" }, function(err, rc, info) {
                    assert(err, "err31:", info);
                    next();
                });
            },
            function(next) {
                db.update("test3", { id: id, type: "3", notempty: null, text: "" }, function(err, rc, info) {
                    assert(err || !info.affected_rows, "err32:", info);
                    next();
                });
            },
            function(next) {
                db.get("test3", { id: id }, {}, function(err, row) {
                    assert(err || !row || row.notempty != "notempty", "err33:", row);
                    if (configOptions.noNulls) {
                        expect(typeof row?.text == "undefined", "expect text undefined", row)
                    } else {
                        expect(row?.text === null, "expect text null", row)
                    }
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
                db.list("test3", [id + " "], {}, function(err, rows) {
                    assert(err || rows.length != 1, "must return 1 row:", rows, db.customColumn);
                    expect(configOptions.noListOps || rows[0].tags == "3,4,5,6,7", "tags must have 5 items", rows, configOptions)
                    next();
                });
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

});

