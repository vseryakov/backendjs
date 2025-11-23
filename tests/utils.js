
const { api, app, ipc, jobs, lib, cache, queue, logger, modules, httpGet } = require("../");
const assert = require('node:assert/strict');
const util = require("util");
const fs = require("fs");

exports.init = function(options, callback)
{
    options = Object.assign({}, options, { config: __dirname + "/bkjs.conf" });

    api.accessTokenSecret = lib.random();

    app.ainit(options, () => {

        if (options.cache) {
            cache.initClients();
        }

        if (options.queue) {
            queue.initClients();
        }

        if (options.ipc) {
            if (app.isPrimary) {
                ipc.initServer();
            } else {
                ipc.initWorker();
            }
        }

        if (options.api) {
            api.init();
        }

        if (options.jobs) {
            if (app.isPrimary) {
                jobs.initServer();
            } else {
                jobs.initWorker();
            }
        }
        if (typeof callback != "function") return;

        setTimeout(callback, options.delay || 250);
    });
}

exports.ainit = async function(options)
{
    return new Promise((resolve, reject) => {
        exports.init(options, resolve);
    })
}

// Generic access checker to be used in tests, accepts an array in .config with urls to check
// The following properties can be used:
// - url - URL to be checked with POST
// - get - URL to be check with GET
// - method - explicit method for url
// - data - query data for GET or postdata for POST
// - form - formdata for requests that need urlformencoded data
// - headers/cookies - extra headers and cookies to send
// - user - a user record with login and secret, a signature is send
// - status - status to expect, 200 is default
// - match - an object to checked against the response, uses lib.isMatched OR it is a function to be called
//    as match(rc, conf), must return true to pass
// - nocsrf/nosig - do not use CSRF or signature in request
// - preprocess - function(conf, cb) to be called before making request
// - postprocess - function(conf, rc, cb) to be called after the request, rc is the response object from the request
// - delay - wait before making next request
exports.checkAccess = function(options, callback)
{
    var tmp = options.tmp = options.tmp || {};

    lib.forEachSeries(options.config, (conf, next) => {
        var q = {
            url: conf.get || conf.url || "/",
            method: conf.get ? "GET" : conf.method || "POST",
            query: conf.get && conf.data,
            postdata: !conf.get && conf.data,
            formdata: conf.form,
            headers: conf.headers || {},
            cookies: conf.cookies || {},
            login: conf.user?.login,
            secret: conf.user?.secret,
            _rc: conf.status || 200,
        };
        if (q.url[0] == "/") q.url = "http://127.0.0.1:" + api.port + q.url;
        if (conf.noscrf) tmp.h_csrf = tmp.c_csrf = null;
        if (conf.nosig) tmp.sig = null;
        if (tmp.h_csrf) {
            q.headers[api.csrf.header] = tmp.h_csrf;
        }
        if (tmp.c_csrf) {
            q.cookies[api.csrf.header] = tmp.c_csrf;
        }
        if (!conf.user && tmp.sig) {
            q.cookies[api.signature.header] = tmp.sig;
        }
        lib.everySeries([
            function(next2) {
                if (typeof conf.preprocess != "function") return next2();
                conf.preprocess(conf, next2);
            },
            function(next2) {
                httpGet(q, (err, rc) => {
                    assert.ok(rc.status == q._rc, util.inspect({ err: `${conf.user?.login || "pub"}: ${q.url}: expect ${q._rc} but got ${rc.status}`, data: rc.data, conf, tmp }, { depth: null }));

                    if (rc.resheaders[api.csrf.header]) {
                        tmp.h_csrf = rc.resheaders[api.csrf.header];
                    }
                    if (rc.rescookies[api.csrf.header]) {
                        tmp.c_csrf = rc.rescookies[api.csrf.header].value;
                    }
                    if (rc.rescookies[api.signature.header]) {
                        tmp.sig = rc.rescookies[api.signature.header].value;
                    }
                    if (typeof conf.match == "function") {
                        assert.ok(conf.match(rc, conf), util.inspect({ err: "match failed", obj: rc.obj, conf, tmp }, { depth: null }));
                    } else
                    if (conf.match) {
                        assert.ok(lib.isMatched(rc.obj, conf.match), util.inspect({ err: "match failed", objk: rc.obj, conf, tmp }, { depth: null }));
                    }
                    if (conf.delay) {
                        return setTimeout(next2, conf.delay, null, rc);
                    }
                    next2(null, rc);
                });
            },
            function(next2, err, rc) {
                if (typeof conf.postprocess != "function") return next2();
                conf.postprocess(conf, rc, next2);
            }
        ], next, true);

    }, callback, true);
}

exports.testJob = function(options, callback)
{
    logger.logger(options.logger || "info", "testJob:", options);
    if (options.dead) return;

    var timer, interval, done;
    if (options.timeout_rand) {
        timer = setTimeout(() => { done = 1; callback() }, lib.randomInt(0, options.timeout_rand), options.err);
    } else
    if (options.timeout) {
        timer = setTimeout(() => { done = 1; callback() }, options.timeout, options.err);
    }
    if (options.cancel) {
        interval = setInterval(() => {
            if (done) {
                clearInterval(interval);
            } else
            if (modules.jobs.isCancelled(options.cancel)) {
                clearTimeout(timer);
                clearInterval(interval);
                if (options.file) {
                    fs.writeFileSync(options.file, `${options.data} cancelled`);
                }
                return callback("cancelled");
            }
            logger.debug("testJob:", options);
        }, 250);
    }
    if (options.file) {
        fs.writeFileSync(options.file, `${options.data}`);
    }
    if (!timer) {
        done = 1;
        callback(options.err);
    }
}

