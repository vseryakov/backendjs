//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//
const http = require('http');
const cookie = require("cookie");
const qs = require("qs");
const core = require(__dirname + '/../core');
const lib = require(__dirname + '/../lib');
const ipc = require(__dirname + '/../ipc');
const queue = require(__dirname + '/../queue');
const logger = require(__dirname + '/../logger');
var api = require(__dirname + '/../api');

api.createWebsocketServer = function()
{
    var server = core.ws.port == core.port ? api.server : core.ws.port == core.ssl.port ? api.sslServer : null;
    if (!server) {
        var opts = { name: "ws", ssl: core.ws.ssl ? core.ssl : null, port: core.ws.port, bind: core.ws.bind, restart: api.restart };
        server = core.createServer(opts, (req, res) => { res.status(200).send("OK") });
    }
    if (server) {
        server.on("upgrade", api.handleWebSocketUpgrade.bind(api));

        api.ws = require("ws");
        api.wsServer = new api.ws.Server({ noServer: true, clientTracking: true });
        api.wsServer.serverName = "ws";
        api.wsServer.serverPort = core.ws.port;
        api.wsServer.connections = {};
        api.wsServer.on('connection', api.handleWebSocketConnect.bind(api));
        api.wsServer.on("error", (err) => { logger.error("ws:", err) });
        api.wsServer.on("close", () => {
            api.wsServer.connections = {};
            clearInterval(api.wsServer.pingInterval);
            for (const ws of api.wsServer.clients) ws.terminate();
        });
        api.wsServer.pingInterval = setInterval(() => {
            api.wsServer.clients.forEach((ws) => {
                if (ws.alive === false) return ws.terminate();
                ws.alive = false;
                ws.ping(lib.noop);
            });
        }, core.ws.ping);
        if (core.ws.queue) {
            queue.subscribe("ws:queue", { queueName: core.ws.queue }, (msg) => {
                if (typeof msg == "string") msg = lib.jsonParse(msg, { logger: "info" });
                api.wsBroadcast(msg.q, msg.m);
            });
        }
    }
}

// Check if the request is allowed to upgrade to Websocket
api.handleWebSocketUpgrade = function(req, socket, head)
{
    logger.debug("handleWebSocketUpgrade:", req.socket.remoteAddress, req.url, req.headers);

    if ((core.ws.path && !core.ws.path.test(req.url)) ||
        (core.ws.origin && !core.ws.origin.test(req.headers.origin))) {
        socket.write('HTTP/1.0 401 Unauthorized\r\nConnection: close\r\n\r\n');
        return socket.destroy();
    }

    // Prepare request/response for signature verification, have to similate Express middleware flow
    Object.setPrototypeOf(req, this.app.request);
    var q = req.url.indexOf("?");
    req.body = req.query = qs.parse(q > 0 ? req.url.substr(q + 1) : "", api.qsOptions);
    req.cookies = cookie.parse(req.headers.cookie || "");

    api.prepareRequest(req);
    lib.series([
        function(next) {
            api.checkAccess(req, (status) => {
                if (status?.status) {
                    return next(status.status != 200 ? status : null);
                }

                var err = api.checkCsrfToken(req, { force: 1 });
                if (err) return next(err);

                api.checkAuthentication(req, (err) => {
                    if (err && err.status != 200) return next(err);

                    api.checkAuthorization(req, (err) => {
                        next(err?.status != 200 ? err : null);
                    });
                });
            });
        },

        function(next) {
            core.runMethods("configureWebsocket", req, { direct: 1 }, () => {
                api.wsServer.handleUpgrade(req, socket, head, (ws) => {
                    api.wsServer.emit('connection', ws, req);
                });
            });
        },
    ], (err) => {
        var msg = lib.stringify(err);
        socket.write(`HTTP/1.0 ${err.status} ${http.STATUS_CODES[err.status]}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`);
        socket.destroy();
    }, true);
}

// Wrap external WebSocket connection into the Express routing, respond on backend command
api.handleWebSocketConnect = function(ws, req)
{
    logger.debug("handleWebSocketConnect:", req.socket.remoteAddress, req.path, req.query, req.account.id);

    ws.wsid = lib.uuid();
    ws.path = req.path;
    ws.remoteAddress = req.ip;
    ws.signature = lib.objClone(req.signature);
    ws.account = lib.objClone(req.account);
    ws.query = lib.objClone(req.query);
    ws.alive = true;
    ws.secure = req.secure;
    ws.hostname = req.hostname;

    ws.on('pong', () => { ws.alive = true });

    ws.on("error", (err) => {
        logger.error("handleWebSocketConnect:", ws.wsid, err);
    });

    ws.on("close", () => {
        ipc.emit("ws:close", { wsid: ws.wsid, path: ws.path, query: ws.query, account: ws.account });
        delete api.wsServer.connections[ws.wsid];
    });

    ws.on("message", this.handleWebSocketRequest.bind(this, ws));

    this.wsServer.connections[ws.wsid] = ws;
    ipc.emit("ws:open", { wsid: ws.wsid, path: ws.path, query: ws.query, account: ws.account });
}

// Wrap WebSocket into HTTP request to be proceses by the Express routes
api.handleWebSocketRequest = function(ws, data)
{
    if (Buffer.isBuffer(data)) data = data.toString();
    logger.debug("handleWebSocketRequest:", ws.wsid, ws.path, ws.query, ws.account.id, data);

    var req = new http.IncomingMessage();
    req.account = lib.objClone(ws.account);
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
            try { ws.send(chunk.toString()) } catch (e) { logger.error("handleWebSocketRequest:", ws.wsid, ws.path, ws.account.id, e) }
        }
        res.emit("finish");
    }
    this.handleServerRequest(req, res);
}

// Update a Websocket connection properties:
// - query - set query with a new object, this is used in the wsNotify broadcasts to match who can receive messages. Initially it is set to the
//    query from the first connection.
// - account - update the current socket account object with new properties
api.wsSet = function(type, req, value)
{
    if (!req || !this.wsServer) return;
    var ws = this.wsServer.connections[req.wsid];
    logger.debug("wsSet:", req.wsid, type, value);
    if (!ws) return;
    switch (type) {
    case "query":
    case "account":
        if (lib.isObject(value) && !lib.isEmpty(value)) ws[type] = lib.objClone(value);
        break;
    }
}

// Send to a websocket inside an api server directly
api.wsSend = function(wsid, msg)
{
    if (!this.wsServer) return;
    var ws = this.wsServer.connections[wsid];
    if (!ws) return;
    if (typeof msg != "string") msg = lib.stringify(msg);
    try { ws.send(msg) } catch (e) { logger.error("wsSend:", ws.wsid, ws.path, ws.account.id, e, msg) }
}

// Broadcast a message according to the options, if no websocket queue is defined send directly using `wsBroadcast`
api.wsNotify = function(options, msg, callback)
{
    if (!core.ws.queue) return this.wsBroadcast(options, msg);
    ipc.broadcast("ws:queue", { q: options, m: msg }, { queueName: core.ws.queue }, callback);
}

// Send a message to all websockets inside an api process that match the criteria from the options:
// - path - a regexp to match initial Websocket connection url
// - account_id - send to websockets belonginh to the account, can be a list as well to notify multiple accounts
// - account - an object to  be used for condition against Websocket's accounts, `lib.isMatched` is used for comparison
// - wsid - send to the specific websocket(s), can be a list
// - query - an object to be used for condition against Websocket's query, `lib.isMatched` is used for comparison
// - cleanup - a table name to be used for message cleanup using `api.cleanupResult`, if it is an array then
//   the first item is a table and the second item is the property name inside the `msg` to be cleanup only, eg. cleanup: ["bk_user","user"].
//   All properties starting with `is`` or `cleanup_`` will be passed to the cleanupResult.
// - preprocess - a function(ws, options, msg) to be called before sending in order to possibly modify the message for this
//    particular account, i.e. for permissions checks, if it needs to be modified return a copy otherwise the original will be used, returning
//    null will skip this socket
// - method - a string in the format `module.method` to run the same way as the `preprocess` function, this is a more
//    reliable way to be use preprocess with `wsNotify`
api.wsBroadcast = function(options, msg)
{
    if (!this.wsServer || !this.wsServer.clients) return;
    if (!options || !msg) return;
    logger.debug("wsBroadcast:", core.role, options, "msg:", msg);
    var d, data = typeof msg == "string" ? msg : lib.stringify(msg);
    var opts, optsRx = /^is[A-Z]|^cleanup_/;
    var preprocess = typeof options.preprocess == "function" && options.preprocess;
    if (!preprocess && options.method) {
        var method = options.method.split('.');
        preprocess = core.modules[method[0]] && typeof core.modules[method[0]][method[1]] == "function" && core.modules[method[0]][method[1]];
    }

    for (const ws of this.wsServer.clients) {
        if ((!options.wsid || options.wsid == ws.wsid || lib.isFlag(options.wsid, ws.wsid)) &&
            (!options.account_id || options.account_id == ws.account.id || lib.isFlag(options.account_id, ws.account.id)) &&
            (!options.path || lib.testRegexp(ws.path, options.path)) &&
            (lib.isMatched(ws.account, options.account) && lib.isMatched(ws.query, options.query))) {
            d = data;
            if (preprocess) {
                d = preprocess(ws, options, msg);
                if (d === null) continue;
                d = !d ? data : typeof d == "string" ? d : lib.stringify(d);
            }
            if (options.cleanup) {
                opts = {};
                for (const p in ws.account) if (p[0] == "i" && p[1] == "s" && p[2] >= 'A' && p[2] <= 'Z') opts[p] = ws.account[p];
                for (const p in options) if (optsRx.test(p)) opts[p] = options[p];
                opts.account = ws.account;
                opts.cleanup_copy = 1;

                if (Array.isArray(options.cleanup)) {
                    const o = msg[options.cleanup[1]];
                    const m = api.cleanupResult(options.cleanup[0], o, opts);
                    if (m != o) {
                        d = { [options.cleanup[1]]: m };
                        for (const p in msg) if (typeof d[p] == "undefined") d[p] = msg[p];
                        d = lib.stringify(d);
                    }
                } else {
                    const m = api.cleanupResult(options.cleanup, msg, opts);
                    if (m != msg) d = lib.stringify(m);
                }
            }
            logger.debug("wsBroadcast:", "send:", ws.wsid, ws.path, ws.account.id, d);
            try { ws.send(d) } catch (e) { logger.error("wsBroadcast:", ws.wsid, ws.path, ws.account.id, e) }
        }
    }
}

