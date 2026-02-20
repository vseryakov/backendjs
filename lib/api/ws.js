/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
const http = require('http');
const qs = require("qs");
const app = require(__dirname + '/../app');
const lib = require(__dirname + '/../lib');
const ipc = require(__dirname + '/../ipc');
const queue = require(__dirname + '/../queue');
const logger = require(__dirname + '/../logger');
const api = require(__dirname + '/../api');

/**
 * @module api/ws
 *
 */

const mod =

/**
 * # Websockets requests as Express routes
 *
 * The simplest way is to configure __api-ws-port__ to the same value as the HTTP port.
 * This will run WebSockets server along the regular Web server.
 *
 * ## Usage
 *
 * ```js
 * var ws = new WebSocket("http://localhost:8000/ws");
 * ws.onmessage = (msg) => { console.log(msg) }
 * ```
 *
 * There are two ways to send messages via Websockets to the server from a browser:
 *
 * ### 1. as Urls
 *
 * ```js
 * ws.send('/project/update?id=1&name=Test2')
 * ```
 *
 * In this case the url will be parsed and checked for access and authorization before letting it pass via Express routes. This method allows to
 * share the same route handlers between HTTP and Websockets requests, the handlers will use the same code and all responses will be sent back,
 * only in the Websockets case the response will arrived in the message listener (see an example below)
 *
 * ### 2. as JSON objects, format can be any
 *
 * ```js
 * ws.send({ op: "/project/update", project: { id: 1, name: "Test2" } })```
 * ```
 * In this case the server still have to check for access so it treats all JSON messages as coming from the path which was used during the connect,
 * i.e. the one used in the above __/ws__. The Express route handler for this path will receive all messages from Websocket clients,
 * the response will be received in the event listener the same way as for the first use case.
 *
 * ```js
 * // Notify all clients who is using the project being updated
 * api.app.all("/ws", (req, res) => {
 *    switch (req.query.op) {
 *    case "/project/update":
 *       //  some code ....
 *       api.ws.notify({ query: { id: req.query.project.id } }, { op: "/project/update", project: req.query.project });
 *       break;
 *    }
 *    res.send("");
 * });
 *```
 *
 * In any case all Websocket messages sent from the server will arrive in the event handler and must be formatted properly in order to distinguish what is what, this is the application logic. If the server needs to send a message to all or some specific clients for example due to some updates in the DB, it must use the
 * {@link module:api/ws.notify} function.
 *
 * ```js
 * // Received a new message for a user from external API service, notify all websocket clients by user id
 * api.app.post("/api/message", (req, res) => {
 *    ....
 *    ... processing logic
 *    ....
 *    api.ws.notify({ user_id: req.query.uid }, { op: "/message/new", msg: req.query.msg });
 * });
 * ```
 */
module.exports = {
    name: "api.ws",
    args: [
        { name: "port", type: "number", min: 0, descr: "Port to listen for WebSocket server, it can be the same as HTTP/S ports to co-exist on existing web servers" },
        { name: "bind", descr: "Bind to this address only for WebSocket, if not specified listen on all interfaces, only when the port is different from existing web ports" },
        { name: "ping", type: "number", min: 0, descr: "How often to ping Websocket connections" },
        { name: "path", type: "regexp", descr: "Websockets will be accepted only if request matches this pattern" },
        { name: "origin", type: "regexp", descr: "Websockets will be accepted only if request Origin: header maches the pattern" },
        { name: "queue", descr: "A queue where to publish messages for websockets, API process will listen for messages and proxy it to all macthing connected websockets " },
    ],

    /** @var {int} - port to listen for messsages, can be the same as the main HTTP port */
    port: process.env.BKJS_WSPORT || 0,
    bind: "0.0.0.0",
    ping: 30000,
};

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

mod.configureWebServer = function(options, callback)
{
    if (!mod.port) return callback();

    mod.ws = lib.tryRequire("ws");
    if (!mod.ws) return callback();

    var server = mod.port == api.port ? api.server : mod.port == app.ssl.port ? api.sslServer : null;
    if (!server) {
        var opts = {
            name: "ws",
            ssl: mod.ssl ? app.ssl : null,
            port: mod.port,
            bind: mod.bind,
            restart: api.restart,
            reusePort: api.reusePort,
        };
        server = api.createWebServer(opts, (req, res) => { res.status(200).send("OK") });
    }
    if (server) {
        server.on("upgrade", mod.handleWebSocketUpgrade);

        var wsserver = new mod.ws.Server({ noServer: true, clientTracking: true });
        wsserver.serverName = "ws";
        wsserver.serverPort = mod.port;
        wsserver.connections = {};
        wsserver.on('connection', mod.handleWebSocketConnect);
        wsserver.on("error", (err) => { logger.error("ws:", err) });
        wsserver.on("close", () => {
            logger.debug("close:", mod.name, app.role, wsserver?.serverName);
            wsserver.connections = {};
            clearInterval(wsserver._pingInterval);
            for (const ws of wsserver.clients) ws.terminate();
        });
        wsserver._pingInterval = setInterval(() => {
            wsserver.clients.forEach((ws) => {
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
        mod.server = wsserver;
        logger.log("configureWebServer:", mod.name, app.role, "created", server.serverName);
    }

    callback();
}

mod.shutdownServer = function(options, callback)
{
    if (mod.server) {
        var err, server = mod.server;
        delete mod.server;
        try {
            server.close();
        } catch (e) {
            err = e
        }
        logger.log("shutdownServer:", mod.name, app.role, "closed", err);
    }
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
    ws.wsid = lib.uuid();
    ws.path = req.path;
    ws.remoteAddress = req.ip;
    ws.signature = lib.clone(req.signature);
    ws.user = Object.assign({}, req.user);
    ws.query = lib.clone(req.query);
    ws.alive = true;
    ws.secure = req.secure;
    ws.hostname = req.hostname;

    logger.debug("handleWebSocketConnect:", req.socket.remoteAddress, ws.path, req.query, req.user?.id);

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
    req.signature = lib.clone(ws.signature);
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
        req.body = req.query = { data };
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
        if (lib.isObject(value) && !lib.isEmpty(value)) ws[type] = lib.clone(value);
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

/**
 * Broadcast a message according to the options, if no websocket queue is defined send
 * directly using {@link module:api/ws.broadcast}
 * @param {object} options
 * @param {object|string} msg
 * @param {function} [callback]
 * @memberof module:api/ws
 * @method notify
 */
mod.notify = function(options, msg, callback)
{
    if (!mod.queue) return mod.broadcast(options, msg);
    ipc.broadcast("ws:queue", { q: options, m: msg }, { queueName: mod.queue }, callback);
}

/**
 * Send a message to all websockets inside an api process that match the criteria from the options
 * @param {object} options
 * @param {string} [options.path] - a regexp to match initial Websocket connection url
 * @param {string|string[]} [options.user_id] - send to websockets belonging to the user, can be a list as well to notify multiple user
 * @param {object} [options.user] - an object to be used for condition against Websocket's user, {@link module:lib.isMatched} is used for comparison
 * @param {string|string[]} [options.wsid] - send to the specific websocket(s), can be a list
 * @param {object} [options.query] - an object to be used for condition against Websocket's query, {@link module:lib.isMatched} is used for comparison
 * @param {string|string[]} [options.cleanup] - a table name to be used for message cleanup using {@link module:api.cleanupResult}, if it is an array then
 *   the first item is a table and the second item is the property name inside the __msg__ to be cleanup only, eg. cleanup: ["bk_user","user"].
 *   All properties starting with __is__ or __cleanup_ __ will be passed to the api.cleanupResult.
 * @param {function} [options.preprocess] - a function(ws, options, msg) to be called before sending in order to possibly modify the message for this
 *    particular user, i.e. for permissions checks, if it needs to be modified return a copy otherwise the original will be used, returning
 *    null will skip this socket
 * @param {object|string} msg
 * @memberof module:api/ws
 * @method broadcast
 */
mod.broadcast = function(options, msg)
{
    if (!mod.server?.clients) return;
    if (!options || !msg) return;

    logger.debug("wsBroadcast:", app.role, options, "msg:", msg);
    var d, data = typeof msg == "string" ? msg : lib.stringify(msg);
    var optsRx = /^is[A-Z]|^cleanup_/;
    var preprocess = typeof options.preprocess == "function" && options.preprocess;

    for (const ws of mod.server.clients) {
        if ((!options.wsid || options.wsid === ws.wsid || lib.isFlag(options.wsid, ws.wsid)) &&
            (!options.user_id || options.user_id === ws.user.id || lib.isFlag(options.user_id, ws.user.id)) &&
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

