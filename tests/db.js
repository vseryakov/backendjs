/* global core lib db aws logger sleep */

//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//
// Unit tests
// To run a test execute for example: bksh -test-db ....
//

tests.test_db = function(callback)
{
    var tables = {
        test1: {
            id: { primary: 1, pub: 1 },
            num: { type: "int" },
            num2: {},
            num3: { join: ["id","num"] },
            email: {},
            anum: { join: ["anum","num"], unjoin: ["anum","num"] },
            jnum: { join: ["num2","num4"], unjoin: ["num2","num4"], join_strict: 1 },
            num4: { hidden: 1 },
            mnum: { join: ["num","mtime"] },
            mtime: { type: "now" },
            skipcol: { pub: 1, allow_pools: ["elasticsearch"] },
            skipjoin: { pub: 1, join: ["id","num"], join_pools: ["elasticsearch"] },
            nojoin: { pub: 1, join: ["id","num"], join_nopools: ["elasticsearch"] },
        },
        test2: {
            id: { primary: 1, pub: 1, index: 1 },
            id2: { primary: 1, join: ["key1","key2"], ops: { select: "begins_with" }, keyword: 1 },
            key1: {},
            key2: { pub: 1 },
            email: { projections: 1 },
            name: { pub: 1 },
            birthday: { semipub: 1 },
            group: {},
            json: { type: "json" },
            num: { type: "bigint", index: 2, projections: 1 },
            num2: { type: "real" },
            mtime: { type: "bigint" }
        },
        test3: {
            id: { primary: 1, pub: 1, trim: 1 },
            num: { type: "counter", value: 0, pub: 1 },
            type: { pub: 1 },
            notempty: { notempty: 1 },
            ddd: { dflt: "1" },
            mtime: { type: "now", pub: 1 },
            obj: { type: "obj" },
            list: { type: "array" },
            tags: { type: "list", datatype: "int" },
            text: {},
            sen1: { regexp: lib.rxSentence },
            sen2: { regexp: lib.rxSentence },
            spec: { strip: lib.rxSpecial },
            mapped: { values_map: ["1", null, "2", "none"] },
        },
    };
    var now = Date.now();
    var id = lib.uuid();
    var id2 = lib.uuid(128);
    var num2 = lib.randomNum(1, 1000);
    var next_token = null, rec;
    var configOptions = db.getPool(db.pool).configOptions;

    db.setProcessRow("post", "test3", function(op, row) {
        var type = (row.type || "").split(":");
        row.type = type[0];
        row.mtime = type[1];
        return row;
    });

    db.customColumn.test3 = { "action[0-9]+": "counter" };

    var old = db.tables;
    db.tables = {};
    db.describeTables(tables);

    lib.series([
        function(next) {
            db.dropTables(tables, db.pool, () => {
                db.createTables(db.pool, next);
            });
        },
        function(next) {
            db.add("test1", { id: id, email: id, num: '1', num2: null, num3: 1, num4: 1, anum: 1, skipcol: "skip" }, function(err) {
                if (err) return next(err);
                db.put("test1", { id: id2, email: id2, num: '2', num2: "2", num3: 1, num4: "4", anum: 1, skipcol: "skip" }, function(err) {
                    if (err) return next(err);
                    db.put("test3", { id: id, num: 0, email: id, anum: 1, notempty: "1" }, next);
                });
            });
        },
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
            // Type conversion for strictTypes
            db.join("test1", [{ id: id }, { id: id2 }, { id: "" }], { existing: 1 }, function(err, rows) {
                assert(err || rows.length != 2 || rows[0].id != id || rows[1].id != id2, "err2-1:", rows);
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
            db.add("test2", { id: id, id2: '1', email: id, name: id, birthday: id, num: 0, num2: num2, mtime: now }, next);
        },
        function(next) {
            db.add("test2", { id: id2, id2: '2', email: id, name: id, birthday: id, group: id, num: 2, num2: num2, mtime: now }, next);
        },
        function(next) {
            db.put("test2", { id: id2, id2: '1', email: id2, name: id2, birthday: id2, group: id2, num: 1, num2: num2, mtime: now }, next);
        },
        function(next) {
            db.put("test3", { id: id2, num: 2, emai: id2, notempty: "1" }, next);
        },
        function(next) {
            db.put("test3", { id: id, type: "like:" + Date.now(), fake: 1, notempty: "1" }, next);
        },
        function(next) {
            db.select("test3", { id: id }, function(err, rows) {
                assert(err || rows.length!=1 || rows[0].id != id || rows[0].type!="like" || rows[0].fake || rows[0].ddd != "1", "err4:", rows);
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
            db.update("test1", { id: id, email: "test", num: 1 }, { expected: { id: id, email: id }, skip_columns: ["mtime"], updateOps: { num: "incr" } }, function(err, rc, info) {
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
            db.update("test1", { id: id, email: "test", num: 1 }, { expected: { id: id, email: "test" }, updateOps: { num: "incr" } }, function(err, rc, info) {
                assert(err || info.affected_rows!=1, "err26:", info);
                next();
            });
        },
        function(next) {
            db.update("test1", { id: id, email: "test", num: 100 }, { expected: { id: id, email: id }, returning: "*" }, function(err, rc, info) {
                assert(err || info.affected_rows, "err27:", info, rc);
                next();
            });
        },
        function(next) {
            db.update("test1", { id: id, email: "test", num: 2 }, { expected: { id: id, num: 1 }, ops: { num: "gt" } }, function(err, rc, info) {
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
            db.cacheTables.push("test1","test3");
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
    ], (err) => {
        db.tables = old;
        callback(err);
    });
}

tests.test_dynamodb = function(callback)
{
    var a = { a: 1, b: 2, c: "3", d: { 1: 1, 2: 2 }, e: [1,2], f: [{ 1: 1 }, { 2: 2 }], g: true, h: null, i: ["a","b"] };
    var b = aws.toDynamoDB(a);
    var c = aws.fromDynamoDB(b);
    logger.debug("dynamodb: from", a)
    logger.debug("dynamodb: to", b)
    logger.debug("dynamodb: to", c)
    expect(JSON.stringify(a) == JSON.stringify(c), "Invalid convertion from", JSON.stringify(c), "to", JSON.stringify(a));
    callback();
}

tests.test_dbconfig = async function(callback)
{
    app.appName = "app";
    app.appVersion = "1.0.0";
    app.runMode = "test";
    app.role = "shell";
    app.tag = "qa";
    app.region = "us-east-1";

    db.configMap = {
        top: "runMode",
        main: "role, tag",
        other: "role, region",
    }

    var types = db.configTypes();

    expect(types.includes(app.runMode), "expect runMode", types);
    expect(types.includes(app.runMode+"-"+app.role), "expect runMode-role", types);
    expect(types.includes(app.runMode+"-"+app.role+"-"+app.role), "expect runMode-role-role", types);
    expect(types.includes(app.runMode+"-"+app.role+"-"+app.region), "expect runMode-role-region", types);
    expect(types.includes(app.runMode+"-"+app.tag), "expect runMode-tag", types);
    expect(types.includes(app.runMode+"-"+app.tag+"-"+app.role), "expect runMode-tag-role", types);
    expect(types.includes(app.runMode+"-"+app.tag+"-"+app.region), "expect runMode-tag-region", types);

    db.configMap.top = "runMode,appName";
    types = db.configTypes();

    expect(types.includes(app.appName), "expect appName", types);
    expect(types.includes(app.appName+"-"+app.role+"-"+app.region), "expect appName-role-region", types);
    expect(types.includes(app.appName+"-"+app.tag+"-"+app.region), "expect appName-tag-region", types);

    const getConfig = promisify(db.getConfig.bind(db));

    var type1 = app.runMode+"-"+app.role;
    var type2 = app.runMode+"-"+app.tag;
    var type3 = type1+"-"+app.role;

    await db.adelAll("bk_config", { type: [type1, type2, type3] }, { ops: { type: "in" } });

    await db.put("bk_config", { type: type1, name: "param1", value: "ok" })
    await db.put("bk_config", { type: type1, name: "param2", value: "hidden", status: "hidden" })
    await sleep(100);
    await db.put("bk_config", { type: type2, name: "param2", value: "version", version: ">1.0.0" })
    await db.put("bk_config", { type: type1, name: "param3", value: "stime", stime: Date.now()+2000 })
    await sleep(100);
    await db.put("bk_config", { type: type2, name: "param3", value: "etime", etime: Date.now()+2000 })

    var rows = await getConfig();
    expect(rows?.length == 2 && rows[0].name == "param1" && rows[1].name == "param3" && rows[1].value == "etime", "expect 2 rows, param1, param3", rows);

    app.appVersion = "1.1.0";
    rows = await getConfig();
    expect(rows?.length == 3 && rows[0].name == "param1" && rows[1].name == "param2", "expect 3 rows, param1 and param2, param3/etime", rows);

    await sleep(2000);

    app.appVersion = "1.0.0";
    rows = await getConfig();
    expect(rows?.length == 2 && rows[0].name == "param1" && rows[1].name == "param3" && rows[1].value == "stime", "expect 2 rows, param1, param3/stime", rows);

    await db.put("bk_config", { type: type3, name: "param1", value: "zero", stime: 0, etime: 0 })
    await sleep(100);

    rows = await getConfig();
    expect(rows?.length == 3 && rows[0].name == "param1" && rows[2].value == "zero", "expect 3 rows, param1/ok, param1/zero, param3/stime", rows);

    callback();

}

