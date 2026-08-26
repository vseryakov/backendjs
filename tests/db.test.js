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
const { db, lib } = require("../");
const { ainit, astop } = require("./utils");

const roles = process.env.BKJS_ROLES || "sqlite";

const tables = {
    bk_test1: {
        id: {
            type: "uuid",
            primary: 1,
            index: 1,
            _$dynamodb: { projection: ["counter"] }
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
            read_only: true,
            index: 2,
            convert: { clock: true },
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
        dflt: { value: "dflt" },
        obj: { type: "obj" },
        list: { type: "set" },
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

var id1 = "10000000000000000000000000000000"
var id2 = "20000000000000000000000000000000"
var id3 = "30000000000000000000000000000000";
var id4 = "40000000000000000000000000000000";
var key1 = "abc", key2 = 999, key = key1 + "|" + key2;
var tags = ["tag1", "tag2", "tag3"];
var list = ["a", "b", "c"];
var bignum = 1000000000;
var name = "test name";
var row = {
    id: id1,
    name,
    email: "test@email.com",
    json: '{ "a": 1, "b": "b" }',
    realnum: 1.12345,
    obj: { a: 1, b: "b" },
    list: list.slice(0),
    tags: tags.slice(0),
    weights: [1,2,"3",4,"5"],
    nospecial: "[plain, text!]###########################",
    bignum,
}
var pool, config;

describe("DB tests", async () => {

    before(async () => {
        await ainit({ cache: true, roles })

        db.tables = {};
        db.describeTables(tables);

        db.setProcessRow("post", "bk_test1", (op, row) => {
            row.computed = `${row.id} ${row.mtime}`;
            return row;
        });

        db.customColumn.bk_test1 = { "count[0-9]+": "counter" };

        pool = db.getPool(db.pool);
        config = pool.config;

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

        row.tags.push(...row.tags.map(x => x + 1));
        rc = await db.aadd("bk_test1", row);
        assert.match(rc?.err?.message, /too large/);

    });

    await it("db add", async() => {

        row.key1 = key1;
        row.key2 = key2;
        row.name = name;
        row.notempty = 1;
        row.tags = tags.slice(0);

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

        rc = await db.aadd("bk_test1", row, { result_query: true, first: true });
        assert.strictEqual(rc?.err, null);
        assert.strictEqual(rc?.data?.key, key);

        row.id = id2;
        rc = await db.aadd("bk_test1", row, { info_query: true });
        assert.strictEqual(rc?.err, null);
        assert.strictEqual(rc?.info?.query?.key, key);
    });

    await it("db bulk", async() => {

        const bulk = [
            {
                table: "bk_test1",
                op: "add",
                query: Object.assign({}, row, { id: id4 }),
            },
            {
                table: "bk_test1",
                op: "add",
                query: Object.assign({}, row, { id: id4, key2: key1 }),
            },
        ]
        let rc = await db.abulk(bulk);
        assert.ok(!rc?.err);
        assert.strictEqual(rc?.data?.length, 0);

        await lib.sleep(1000)

        rc = await db.aget("bk_test1", { id: id4, key1, key2 });
        assert.strictEqual(rc?.err, null);
        assert.strictEqual(rc?.data?.key, key);
    });

    await it("db transaction", async() => {

        const bulk = [
            {
                table: "bk_test1",
                op: "add",
                query: Object.assign({}, row, { id: id3 }),
            },
            {
                table: "bk_test1",
                op: "add",
                query: Object.assign({}, row, { id: id3, key1, key2: key1, tags: tags.slice(1, 2), dflt: null }),
            },
            {
                table: "bk_test1",
                op: "add",
                query: Object.assign({}, row, { id: id3, key1: key2, key2, tags: tags.slice(0, 1), dflt: null, counter: 0 }),
            },
        ]
        const rc = await db.atransaction(bulk);
        assert.ok(!rc?.err);
        assert.strictEqual(rc?.data?.length, 0);

        await lib.sleep(1000)
    });

    await it("db update", async() => {

        let rc = await db.aincr("bk_test1", { id: id1, key1, key2, counter: 3, dflt_$not_exists: 1 });
        assert.strictEqual(rc?.err, null);

        rc = await db.aincr("bk_test1", { id: id2, key1, key2, counter: 1 });
        assert.strictEqual(rc?.err, null);

        rc = await db.aincr("bk_test1", { id: id3, key1, key2, counter: 2 });
        assert.strictEqual(rc?.err, null);

        rc = await db.aincr("bk_test1", { id: id3, key1, key2: key1, counter: -2 });
        assert.strictEqual(rc?.err, null);

        rc = await db.aupdate("bk_test1", { id: id1, key1, key2, tags_$add: ["tag5","tag6"] }, { returning: "*", first: true });
        assert.strictEqual(rc?.err, null);
        assert.deepStrictEqual(rc?.data?.tags, [...tags, "tag5", "tag6"]);

        rc = await db.aupdate("bk_test1", { id: id1, key1, key2, tags_$del: ["tag6"] });
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
        assert.deepStrictEqual(rc?.data?.list, list)
        assert.deepStrictEqual(rc?.data?.tags, [...tags, "tag5"]);
        assert.deepStrictEqual(rc?.data?.weights, row.weights.map(x => parseInt(x)));
        assert.strictEqual(rc?.data?.nospecial, row.nospecial.replace(lib.rxSpecial, ""));
        assert.strictEqual(rc?.data?.bignum, row.bignum);
        assert.strictEqual(rc?.data?.dflt, "dflt");

        rc = await db.aget("bk_test1", { id: id2, key1, key2 });
        assert.strictEqual(rc?.data?.id, id2);
        assert.deepStrictEqual(rc?.data?.counter, 1)

        rc = await db.aget("bk_test1", { id: id3, key1, key2 });
        assert.strictEqual(rc?.data?.id, id3);
        assert.deepStrictEqual(rc?.data?.counter, 2)

        db.aliases.t = "bk_test1";
        rc = await db.aget("t", { id: id1, key1, key2 });
        assert.strictEqual(rc?.data?.id, id1);

    });

    await it("db list", async() => {

        let rc = await db.alist("bk_test1", [id1, id2, id3, 1].map(id => ({ id, key1, key2 })));
        assert.strictEqual(rc?.data?.length, 3);

        rc = await db.alist("bk_test1", rc.data);
        assert.strictEqual(rc?.data?.length, 3);
    });

    await it("db select", async() => {

        let rc = await db.aselect("bk_test1", { id: id1, fake: 1 }, { no_columns: true });
        assert.deepStrictEqual(rc?.data, []);

        rc = await db.aselect("bk_test1", { id: id1, fake: 1 });
        assert.strictEqual(rc?.data?.[0]?.id, id1);

        rc = await db.aselect("bk_test1", { id: id1 });
        assert.strictEqual(rc?.data?.[0]?.id, id1);

        rc = await db.aselect("bk_test1", { id: id3 }, { sort: "ctime", desc: true });
        assert.strictEqual(rc?.data?.[0]?.counter, 0);

        if (config.sql) {
            rc = await db.asql("SELECT * FROM bk_test1 WHERE id=$1 and key=$2", [id1, key]);
            assert.strictEqual(rc?.data?.[0]?.id, id1);
        }

    });

    await it("db scan", async() => {
        const list = [];

        await db.ascan("bk_test1", { id: id3 }, { count: 1, sync: true }, rows => { list.push(...rows) });
        assert.strictEqual(list.length, 3);

        await db.ascan("bk_test1", { id: id1 }, { }, (row, next) => {
            list.push(row);
            next();
        });
        assert.strictEqual(list.length, 4);
    });

    await it("db expr in", async() => {

        let rc = await db.aselect("bk_test1", { id: id3, $or: { key1, key1_$: String(key2) } });
        assert.strictEqual(rc?.data?.length, 3);

        rc = await db.aselect("bk_test1", { id: id3, key1_$in: [key1, String(key2), "null"] });
        assert.strictEqual(rc?.data?.length, 3);

        rc = await db.aselect("bk_test1", { id: id3, key1: [key1, String(key2)] }, { ops: { key1: "in" } });
        assert.strictEqual(rc?.data?.length, 3);

        rc = await db.aselect("bk_test1", { id: id3, key1_$not_in: [key1] });
        assert.strictEqual(rc?.data?.length, 1);

        rc = await db.aselect("bk_test1", { id: id3, key1_$not_in: [key1] });
        assert.strictEqual(rc?.data?.length, 1);

    });

    await it("db expr contains in list", async() => {

        let rc = await db.aselect("bk_test1", { id: id3, tags_$contains: tags.slice(0, 1) });
        assert.strictEqual(rc?.data?.length, 2);

        rc = await db.aselect("bk_test1", { id: id3, tags_$not_contains: [tags[0]] });
        assert.strictEqual(rc?.data?.length, 1);

        rc = await db.aselect("bk_test1", { id: id3, tags_$all_in: [tags[0], tags[1]] });
        assert.strictEqual(rc?.data?.length, 1);

    });

    await it("db expr numeric", async() => {

        let rc = await db.aselect("bk_test1", { id: id3, counter_$gt: 0 }, { select: 'id,counter' });
        assert.strictEqual(rc?.data?.length, 1);
        assert.strictEqual(rc?.data[0].key1, undefined);
        assert.strictEqual(rc?.data[0].counter, 2);

        rc = await db.aselect("bk_test1", { id: id3, counter: 0 }, { ops: { counter: 'lt' } })
        assert.strictEqual(rc?.data?.length, 1);

        rc = await db.aselect("bk_test1", { id: id3, counter: [0,2] }, { ops: { counter: 'between' } })
        assert.strictEqual(rc?.data?.length, 2);

        rc = await db.aselect("bk_test1", { id: id3, counter_$not_between: [-1,1] })
        assert.strictEqual(rc?.data?.length, 2);
    });

    await it("db expr pattern", async() => {

        let rc = await db.aselect("bk_test1", { id: id3, key_$begins_with: key1 });
        assert.strictEqual(rc?.data?.length, 2);

        rc = await db.aselect("bk_test1", { id: id3, "key_$like%": key1 });
        assert.strictEqual(rc?.data?.length, 2);

        rc = await db.aselect("bk_test1", { id: id3, key1_$includes: "a" });
        assert.strictEqual(rc?.data?.length, 2);

        rc = await db.aselect("bk_test1", { id: id3, key1: "a" }, { ops: { key1: "%like%" } });
        assert.strictEqual(rc?.data?.length, 2);

        rc = await db.aselect("bk_test1", { id: id3, dflt: null });
        assert.strictEqual(rc?.data?.length, 2);

        rc = await db.aselect("bk_test1", { id: id3, dflt_$not_null: "" });
        assert.strictEqual(rc?.data?.length, 1);

    });

    await it("db pagination", async() => {

        let rc = await db.aselect("bk_test1", { id: id3 }, { sort: "ctime", count: 1 });
        assert.strictEqual(rc?.data?.length, 1);
        assert.ok(rc?.info?.next_token);

        const ctime = rc.data[0].ctime;

        rc = await db.aselect("bk_test1", { id: id3 }, { sort: "ctime", start: rc.info.next_token, count: 1 })
        assert.strictEqual(rc?.data?.length, 1);
        assert.ok(rc?.info?.next_token);
        assert.ok(rc.data[0].ctime > ctime);
    });

    await it("db cache", async() => {

        db.cache.tables.push("bk_test1");
        db.cache.ttl.bk_test1 = 30000;
        db.cache.name.bk_test1 = "local";

        let rc = await db.aget("bk_test1", { id: id1, key1, key2 });
        assert.strictEqual(rc?.data?.id, id1);
        assert.strictEqual(rc?.info?.cached, 0)

        db.cache2.bk_test1 = 30000;

        rc = await db.aget("bk_test1", { id: id1, key1, key2 });
        assert.strictEqual(rc?.info?.cached, 1)

        rc = await db.aget("bk_test1", { id: id1, key1, key2 });
        assert.strictEqual(rc?.info?.cached, 2)
    });

    it("db cleanup", () => {

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


