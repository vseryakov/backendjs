'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const { app, lib, stats } = require('../');

function metrics(otlp)
{
    return otlp.resourceMetrics[0].scopeMetrics[0].metrics;
}

function attrs(list)
{
    return Object.fromEntries((list || []).map((x) => ([x.key, Object.values(x.value)[0]])));
}

describe('stats', () => {
    const otlpMap = stats.otlpMap;
    const filter = stats.filter;

    after(() => {
        stats.otlpMap = otlpMap;
        stats.filter = filter;
    });

    it('collects basic stats with dimensions', (t, done) => {
        stats.collect((err, s) => {
            assert.ifError(err);
            assert.equal(s.pid, process.pid);
            assert.equal(s.role, app.role);
            assert.equal(s.arch, app.arch);
            assert.ok(s.timestamp > 0);
            assert.ok(s.proc_mem_rss > 0);
            done();
        });
    });

    it('converts stats into OTLP', () => {
        stats._otlpstart = '1000000000';
        const m = stats.toOTLP({ timestamp: 2000, role: "web", proc_mem_rss: 10.6, api_res_time: 2.5, api_200_count: 5 });

        const res = attrs(m.resourceMetrics[0].resource.attributes);
        assert.equal(res["service.name"], app.id);
        assert.equal(res["process.pid"], app.env.pid);
        assert.equal(res.role, "web");

        const [rss, time, count] = metrics(m);
        assert.equal(rss.name, "proc.mem.rss");
        assert.equal(rss.description, stats.columns.proc_mem_rss.label);
        assert.deepEqual(rss.gauge.dataPoints, [{ timeUnixNano: "2000000000", asInt: "11" }]);

        assert.equal(time.name, "api.res.time");
        assert.deepEqual(time.gauge.dataPoints, [{ timeUnixNano: "2000000000", asDouble: 2.5 }]);

        assert.equal(count.name, "api.200.count");
        assert.equal(count.sum.aggregationTemporality, 2);
        assert.equal(count.sum.isMonotonic, true);
        assert.deepEqual(count.sum.dataPoints, [{ timeUnixNano: "2000000000", startTimeUnixNano: "1000000000", asDouble: 5 }]);

        assert.equal(stats._otlpstart, '1000000000');
    });

    it('maps stats with default regexps into attributes', () => {
        const m = metrics(stats.toOTLP({
            timestamp: 1,
            db_dynamodb_res_time: 1,
            db_dynamodb_users_read_count: 2,
            db_dynamodb_bk_config_write_count: 3,
            cache_default_req_rate: 4,
            queue_redis_req_rate: 5,
        }));
        const byName = Object.fromEntries(m.map((x) => ([x.name, x])));

        const pool = byName["db.pool.time"].gauge.dataPoints;
        assert.equal(pool.length, 1);
        assert.deepEqual(attrs(pool[0].attributes), { pool: "dynamodb", op: "res" });

        const db = byName["db.table.count"].sum.dataPoints;
        assert.equal(db.length, 2);
        assert.deepEqual(attrs(db[0].attributes), { pool: "dynamodb", table: "users", op: "read" });
        assert.deepEqual(attrs(db[1].attributes), { pool: "dynamodb", table: "bk_config", op: "write" });

        const cache = byName["cache.rate"].gauge.dataPoints;
        assert.deepEqual(attrs(cache[0].attributes), { cache: "default", op: "req" });

        const queue = byName["queue.rate"].gauge.dataPoints;
        assert.deepEqual(attrs(queue[0].attributes), { queue: "redis", op: "req" });

    });

    it('filters stats and sends to a file', (t, done) => {
        const file = path.join(os.tmpdir(), "bkjs-stats-" + process.pid + ".json");
        fs.rmSync(file, { force: true });

        stats.filter = { db: /dynamodb/ };
        stats.send({ file }, { role: "web", empty: "", neg: -1, zero: 0, db_dynamodb_req_count: 1, db_pg_req_count: 1 }, (err) => {
            assert.ifError(err);
            const data = lib.jsonParse(fs.readFileSync(file, "utf8"));
            assert.deepEqual(data, { role: "web", db_dynamodb_req_count: 1 });
            fs.rmSync(file, { force: true });
            stats.filter = filter;
            done();
        });
    });

    describe('otlp target', () => {
        let server, req;

        before((t, done) => {
            server = http.createServer((r, res) => {
                let body = "";
                r.on("data", (d) => { body += d });
                r.on("end", () => {
                    req = { url: r.url, headers: r.headers, body: lib.jsonParse(body) };
                    res.writeHead(200, { "content-type": "application/json" });
                    res.end("{}");
                });
            });
            server.listen(0, "127.0.0.1", done);
        });

        after((t, done) => {
            server.close(done);
        });

        it('posts OTLP JSON', (t, done) => {
            const otlp = `http://127.0.0.1:${server.address().port}/v1/metrics`;
            stats.send({ otlp, headers: { authorization: "Bearer test" } }, { timestamp: 1, role: "web", api_200_count: 5 }, (err) => {
                assert.ifError(err);
                assert.equal(req.url, "/v1/metrics");
                assert.match(req.headers["content-type"], /application\/json/);
                assert.equal(req.headers.authorization, "Bearer test");
                assert.equal(attrs(req.body.resourceMetrics[0].resource.attributes).role, "web");
                assert.equal(metrics(req.body)[0].name, "api.200.count");
                done();
            });
        });
    });
});
