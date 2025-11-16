/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
const http = require('http');
const qs = require("qs");
const modules = require(__dirname + '/../modules');
const app = require(__dirname + '/../app');
const lib = require(__dirname + '/../lib');
const ipc = require(__dirname + '/../ipc');
const queue = require(__dirname + '/../queue');
const logger = require(__dirname + '/../logger');
const api = require(__dirname + '/../api');

/**
 * @module ws
 *
 */

const mod = {
    name: "api.ws",
    args: [
        { name: "port", type: "number", min: 0, descr: "Port to listen for WebSocket server, it can be the same as HTTP/S ports to co-exist on existing web servers" },
        { name: "bind", descr: "Bind to this address only for WebSocket, if not specified listen on all interfaces, only when the port is different from existing web ports" },
        { name: "ping", type: "number", min: 0, descr: "How often to ping Websocket connections" },
        { name: "path", type: "regexp", descr: "Websockets will be accepted only if request matches this pattern" },
        { name: "origin", type: "regexp", descr: "Websockets will be accepted only if request Origin: header maches the pattern" },
        { name: "queue", descr: "A queue where to publish messages for websockets, API process will listen for messages and proxy it to all macthing connected websockets " },
    ],
    port: process.env.BKJS_WSPORT || 0,
    bind: "0.0.0.0",
    ping: 30000,
};
module.exports = mod;

mod.configureWeb = function(options, callback)
{
    if (!this.path) return callback();

    api.app.all(this.path, (req, res, next) => {
        var options = api.getOptions(req);

        app.runMethods("configureWebsocketRequest", { wsid: req.wsid, user: req.user, query: req.query, body: req.body, options }, () => {
            var key = req.options.apath.at(-1);
            mod.set(key, req, req[key]);
            res.send("");
        });
    });

    callback();
}

mod.configureServer = function(options, callback)
{
    if (!mod.port) return callback();

    var server = mod.port == app.port ? api.server : mod.port == app.ssl.port ? api.sslServer : null;
    if (!server) {
        var opts = { name: "ws", ssl: mod.ssl ? app.ssl : null, port: mod.port, bind: mod.bind, restart: api.restart };
        server = app.createServer(opts, (req, res) => { res.status(200).send("OK") });
    }
    if (server) {
        server.on("upgrade", mod.handleWebSocketUpgrade);

        mod.ws = require("ws");
        mod.server = new mod.ws.Server({ noServer: true, clientTracking: true });
        mod.server.serverName = "ws";
        mod.server.serverPort = mod.port;
        mod.server.connections = {};
        mod.server.on('connection', mod.handleWebSocketConnect);
        mod.server.on("error", (err) => { logger.error("ws:", err) });
        mod.server.on("close", () => {
            mod.server.connections = {};
            clearInterval(mod.server.pingInterval);
            for (const ws of mod.server.clients) ws.terminate();
        });
        mod.server.pingInterval = setInterval(() => {
            mod.server.clients.forEach((ws) => {
                if (ws.alive === false) return ws.terminate();
                ws.alive = false;
                ws.ping(lib.noop);
            });
        }, mod.ping);

        if (mod.queue) {
            queue.subscribe("ws:queue", { queueName: mod.queue }, (msg) => {
                if (typeof msg == "string") msg = lib.jsonParse(msg, { logger: "info" });
                mod.broadcast(msg.q, msg.m);
            });
        }
    }
    logger.log("configureServer:", mod.name, app.role, "created", server?.name);

    callback();
}

mod.shutdownServer = function(options, callback)
{
    var err;
    try { mod.server?.close() } catch (e) { err = e }
    logger.log("shutdownServer:", mod.name, app.role, "closed", err);
    callback();
}

// Check if the request is allowed to upgrade to Websocket
mod.handleWebSocketUpgrade = function(req, socket, head)
{
    logger.debug("handleWebSocketUpgrade:", req.socket.remoteAddress, req.url, req.headers);

    if ((mod.path && !mod.path.test(req.url)) ||
        (mod.origin && !mod.origin.test(req.headers.origin))) {
        socket.write('HTTP/1.0 401 Unauthorized\r\nConnection: close\r\n\r\n');
        return socket.destroy();
    }

    if (!lib.isEmpty(api.proxy) && api.checkProxy("ws", req, socket, head)) return;

    // Prepare request/response for signature verification, have to similate Express middleware flow
    Object.setPrototypeOf(req, api.app.request);
    var q = req.url.indexOf("?");
    req.body = req.query = qs.parse(q > 0 ? req.url.substr(q + 1) : "", api.qsOptions);
    req.cookies = lib.parseCookies(req.headers.cookie);

    api.prepareRequest(req);
    lib.series([
        function(next) {
            api.access.allow(req, (status) => {
                if (status?.status) {
                    return next(status.status != 200 ? status : null);
                }

                var err = api.checkCsrfToken(req, { force: 1 });
                if (err) return next(err);

                api.access.authenticate(req, (err) => {
                    if (err && err.status != 200) return next(err);

                    api.access.authorize(req, (err) => {
                        next(err?.status != 200 ? err : null);
                    });
                });
            });
        },

        function(next) {
            app.runMethods("configureWebsocketUpgrade", req, { stopOnError: 1, direct: 1 }, (err) => {
                if (err) return next(err);
                mod.server.handleUpgrade(req, socket, head, (ws) => {
                    mod.server.emit('connection', ws, req);
                });
            });
        },
    ], (err) => {
        logger.debug("handleWebSocketUpgrade:", err, req.options);
        var msg = lib.stringify(err);
        socket.write(`HTTP/1.0 ${err.status} ${http.STATUS_CODES[err.status]}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`);
        socket.destroy();
    }, true);
}

// Wrap external WebSocket connection into the Express routing, respond on backend command
mod.handleWebSocketConnect = function(ws, req)
{
    logger.debug("handleWebSocketConnect:", req.socket.remoteAddress, req.path, req.query, req.user?.id);

    ws.wsid = lib.uuid();
    ws.path = req.path;
    ws.remoteAddress = req.ip;
    ws.signature = lib.objClone(req.signature);
    ws.user = Object.assign({}, req.user);
    ws.query = lib.objClone(req.query);
    ws.alive = true;
    ws.secure = req.secure;
    ws.hostname = req.hostname;

    ws.on('pong', () => { ws.alive = true });

    ws.on("error", (err) => {
        logger.error("handleWebSocketConnect:", ws.wsid, err);
    });

    ws.on("close", () => {
        ipc.emit("ws:close", { wsid: ws.wsid, path: ws.path, query: ws.query, user: ws.user });
        delete mod.server.connections[ws.wsid];
    });

    ws.on("message", mod.handleWebSocketRequest.bind(mod, ws));

    mod.server.connections[ws.wsid] = ws;
    ipc.emit("ws:open", { wsid: ws.wsid, path: ws.path, query: ws.query, user: ws.user });
}

// Wrap WebSocket into HTTP request to be proceses by the Express routes
mod.handleWebSocketRequest = function(ws, data)
{
    if (Buffer.isBuffer(data)) data = data.toString();
    logger.debug("handleWebSocketRequest:", ws.wsid, ws.path, ws.query, ws.user.id, data);

    var req = new http.IncomingMessage();
    req.user = Object.assign({}, ws.user);
    req.signature = lib.objClone(ws.signature);
    req.connection = { remoteAddress: ws.remoteAddress };
    req.httpVersionMajor = req.httpVersionMinor = 1;
    req.httpProtocol = "WS";
    req.method = "GET";
    req.url = ws.path;
    req.wsid = ws.wsid;
    req.hostname = ws.hostname;
    req.secure = ws.secure;
    req._body = true;

    if (data[0] == "/") {
        req.url = data;
        var q = data.indexOf("?");
        req.body = req.query = qs.parse(q > 0 ? data.substr(q + 1) : "", api.qsOptions);
    } else
    if (data[0] == "{" || data[0] == "[") {
        req.body = req.query = lib.jsonParse(data, { datatype: "obj", logger: "error" });
    } else {
        req.body = req.query = { data: data };
    }

    var res = new http.ServerResponse(req);
    res.end = function(chunk, encoding) {
        if (chunk && chunk.length) {
            try { ws.send(chunk.toString()) } catch (e) { logger.error("handleWebSocketRequest:", ws.wsid, ws.path, ws.user.id, e) }
        }
        res.emit("finish");
    }
    mod.handleServerRequest(req, res);
}

/**
 * Update a Websocket connection properties, it is used with the `path` config and must end with `/query` or `/user` to reset the connection
 * object. This is useful in case when the user is updated with new properties and WS connection need to use it for matching in `broadcast`.
 *
 * - query - set query with a new object, this is used in the broadcasts to match who can receive messages. Initially it is set to the
 *    query from the first connection.
 * - user - update the current socket user object with new properties
 */
mod.set = function(type, req, value)
{
    if (!req || !mod.server) return;
    var ws = mod.server.connections[req.wsid];
    logger.debug("wsSet:", req.wsid, type, value);
    if (!ws) return;
    switch (type) {
    case "query":
    case "user":
        if (lib.isObject(value) && !lib.isEmpty(value)) ws[type] = lib.objClone(value);
        break;
    }
}

// Send to a websocket inside an api server directly
mod.send = function(wsid, msg)
{
    if (!mod.server) return;
    var ws = mod.server.connections[wsid];
    if (!ws) return;
    if (typeof msg != "string") msg = lib.stringify(msg);
    try { ws.send(msg) } catch (e) { logger.error("wsSend:", ws.wsid, ws.path, ws.user.id, e, msg) }
}

// Broadcast a message according to the options, if no websocket queue is defined send directly using `broadcast`
mod.notify = function(options, msg, callback)
{
    if (!mod.queue) return mod.wsBroadcast(options, msg);
    ipc.broadcast("ws:queue", { q: options, m: msg }, { queueName: mod.queue }, callback);
}

/**
 * Send a message to all websockets inside an api process that match the criteria from the options:
 * - path - a regexp to match initial Websocket connection url
 * - user_id - send to websockets belonging to the user, can be a list as well to notify multiple user
 * - user - an object to  be used for condition against Websocket's user, `lib.isMatched` is used for comparison
 * - wsid - send to the specific websocket(s), can be a list
 * - query - an object to be used for condition against Websocket's query, `lib.isMatched` is used for comparison
 * - cleanup - a table name to be used for message cleanup using `api.cleanupResult`, if it is an array then
 *   the first item is a table and the second item is the property name inside the `msg` to be cleanup only, eg. cleanup: ["bk_user","user"].
 *   All properties starting with `is`` or `cleanup_`` will be passed to the cleanupResult.
 * - preprocess - a function(ws, options, msg) to be called before sending in order to possibly modify the message for this
 *    particular user, i.e. for permissions checks, if it needs to be modified return a copy otherwise the original will be used, returning
 *    null will skip this socket
 * - method - a string in the format `module.method` to run the same way as the `preprocess` function, this is a more
 *    reliable way to be use preprocess with `notify`
 */
mod.broadcast = function(options, msg)
{
    if (!mod.server?.clients) return;
    if (!options || !msg) return;
    logger.debug("wsBroadcast:", app.role, options, "msg:", msg);
    var d, data = typeof msg == "string" ? msg : lib.stringify(msg);
    var optsRx = /^is[A-Z]|^cleanup_/;
    var preprocess = typeof options.preprocess == "function" && options.preprocess;
    if (!preprocess && options.method) {
        var method = options.method.split('.');
        preprocess = modules[method[0]] && typeof modules[method[0]][method[1]] == "function" && modules[method[0]][method[1]];
    }

    for (const ws of mod.server.clients) {
        if ((!options.wsid || options.wsid == ws.wsid || lib.isFlag(options.wsid, ws.wsid)) &&
            (!options.user_id || options.user_id == ws.user.id || lib.isFlag(options.user_id, ws.user.id)) &&
            (!options.path || lib.testRegexp(ws.path, options.path)) &&
            (lib.isMatched(ws.user, options.user) && lib.isMatched(ws.query, options.query))) {
            d = data;
            if (preprocess) {
                d = preprocess(ws, options, msg);
                if (d === null) continue;
                d = !d ? data : typeof d == "string" ? d : lib.stringify(d);
            }
            if (options.cleanup) {
                const req = { user: ws.user, options: { cleanup_copy: 1 } };
                for (const p in ws.user) if (p[0] == "i" && p[1] == "s" && p[2] >= 'A' && p[2] <= 'Z') req.options[p] = ws.user[p];
                for (const p in options) if (optsRx.test(p)) req.options[p] = options[p];

                if (Array.isArray(options.cleanup)) {
                    const o = msg[options.cleanup[1]];
                    const m = api.cleanupResult(req, options.cleanup[0], o);
                    if (m != o) {
                        d = { [options.cleanup[1]]: m };
                        for (const p in msg) if (typeof d[p] == "undefined") d[p] = msg[p];
                        d = lib.stringify(d);
                    }
                } else {
                    const m = api.cleanupResult(req, options.cleanup, msg);
                    if (m != msg) d = lib.stringify(m);
                }
            }
            logger.debug("wsBroadcast:", "send:", ws.wsid, ws.path, ws.user.id, d);
            try { ws.send(d) } catch (e) { logger.error("wsBroadcast:", ws.wsid, ws.path, ws.user.id, e) }
        }
    }
}

