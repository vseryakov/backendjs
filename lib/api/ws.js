/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const http = require('node:http');
const app = require(__dirname + '/../app');
const lib = require(__dirname + '/../lib');
const ipc = require(__dirname + '/../ipc');
const queue = require(__dirname + '/../queue');
const logger = require(__dirname + '/../logger');
const api = require(__dirname + '/../api');
const RequestContext = api.RequestContext = require(__dirname + '/context');

/**
 * Wrap http.IncomingMessage to handle body from the web socket
 * @param {object} ws - WebSocket connection
 * @param {string} data - WebSocket message payload
 * @extends http.IncomingMessage
 */
class WebSocketRequest extends http.IncomingMessage {

    constructor(ws, data) {
        super();
        data = lib.isString(data);
        this.method = "GET";
        this.httpVersion = "WS/1.0";
        this.url = data[0] === "/" ? data : ws.context.url;
        Object.assign(this.headers, ws.context.req.headers);

        if (data[0] === "{" || data[0] === "[") {
            this.method = "POST";
            this.headers["content-type"] = "application/json";
            Object.defineProperty(this, "_data", { value: data });
        }
    }

    /**
     * Provide message data for body middleware
     */
    read(_size) {
        if (this._data) {
            this.push(this._data);
            delete this._data;
        }
        this.push(null);
    }
}

/**
 * Wrap ServerResponse to send responses via web socket
 * @param {object} ws - WebSocket connection
 * @extends http.ServerResponse
 */
class WebSocketResponse extends http.ServerResponse {

    constructor(ws) {
        super(ws.context.req);
        this.ws = ws;
        this.on("close", () => { delete this.ws });
    }

    /**
     * Override end to send via web socket
     * @param {string|Buffer|Uint8Array} chunk
     * @param {string} [encoding]
     */
    end(chunk, _encoding) {
        const ws = this.ws;

        if (chunk?.length && this.ws) {
            try {
                this.ws.send(chunk.toString());
            } catch (e) {
                logger.error("end:", this.ws.wsid, this.ws.url, e)
            }
        }
        delete this.ws;
        this.emit("finish");

        if (this.statusCode === 401) {
            ws.terminate();
        }
    }
}


/**
 * @module api/ws
 *
 */

const mod =

/**
 * # WebSockets requests as routes
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
 * There are two ways to send messages via WebSockets to the server from a browser:
 *
 * ### 1. as Urls
 *
 * ```js
 * ws.send('/project/update?id=1&name=Test2')
 * ```
 *
 * In this case the url will be parsed and checked for access and authorization before letting it pass via routes. This method allows to
 * share the same route handlers between HTTP and WebSockets requests, the handlers will use the same code and all responses will be sent back,
 * only in the WebSockets case the response will arrived in the message listener (see an example below)
 *
 * ### 2. as JSON objects, format can be any
 *
 * ```js
 * ws.send({ op: "/project/update", project: { id: 1, name: "Test2" } })```
 * ```
 * In this case the server still have to check for access so it treats all JSON messages as coming from the path which was used during the connect,
 * i.e. the one used in the above __/ws__. The router handler for this path will receive all messages from WebSocket clients,
 * the response will be received in the event listener the same way as for the first use case.
 *
 * ```js
 * // Notify all clients who is using the project being updated
 * api.app.all("/ws", (context) => {
 *    switch (context.query.op) {
 *    case "/project/update":
 *       //  some code ....
 *       api.ws.notify({ query: { id: context.query.project.id } }, { op: "/project/update", project: context.query.project });
 *       break;
 *    }
 *    context.send(200);
 * });
 *```
 *
 * In any case all WebSocket messages sent from the server will arrive in the event handler and must be formatted properly in order to distinguish what is what, this is the application logic. If the server needs to send a message to all or some specific clients for example due to some updates in the DB, it must use the
 * {@link module:api/ws.notify} function.
 *
 * ```js
 * // Received a new message for a user from external API service, notify all WebSocket clients by user id
 * api.app.post("/api/message", (context) => {
 *    ....
 *    ... processing logic
 *    ....
 *    api.ws.notify({ user: { id: context.user.id } }, { op: "/message/new", msg: context.query.msg });
 * });
 * ```
 */
module.exports = {
    name: "api.ws",
    args: [
        { name: "port", type: "number", min: 0, descr: "Port to listen for WebSocket server, it can be the same as HTTP/S ports to co-exist on existing web servers" },
        { name: "bind", descr: "Bind to this address only for WebSocket, if not specified listen on all interfaces, only when the port is different from existing web ports" },
        { name: "ping", type: "number", min: 0, descr: "How often to ping WebSocket connections" },
        { name: "path", type: "regexp", descr: "WebSockets will be accepted only if request matches this pattern" },
        { name: "origin", type: "regexp", descr: "WebSockets will be accepted only if request Origin: header maches the pattern" },
        { name: "queue", descr: "A queue where to publish messages for WebSockets, API process will listen for messages and proxy it to all macthing connected WebSockets " },
    ],

    /** @var {int} - port to listen for messsages, can be the same as the main HTTP port */
    port: process.env.BKJS_WSPORT || 0,
    bind: "0.0.0.0",
    ping: 30000,
};

mod.configureServer = function(_options, callback)
{
    // Relay broadcasts to all web workers
    ipc.on("ws:queue", (msg) => {
        lib.notifyWorkers(msg, { worker_type: "web" });
    });

    callback();
}

mod.configureMiddleware = function(_options, callback)
{
    if (!this.path) return callback();

    api.app.all(this.path, (context, _next) => {
        app.runMethods("configureWebSocketRequest", { wsid: context.wsid, context }, () => {
            context.send(200, "");
        });
    });

    callback();
}

mod.configureWebServer = function(_options, callback)
{
    if (!mod.port) return callback();

    mod.ws = lib.tryRequire(__dirname + "/../../dist/ws");
    if (!mod.ws) return callback();

    var server = mod.port === api.port ? api.server : mod.port === app.ssl.port ? api.sslServer : null;
    if (!server) {
        const opts = {
            name: "ws",
            ssl: mod.ssl ? app.ssl : null,
            port: mod.port,
            bind: mod.bind,
            restart: api.restart,
            reusePort: api.reusePort,
        };
        server = api.createWebServer(opts, (_req, res) => { res.status(200).send("OK") });
    }
    if (server) {
        server.on("upgrade", mod.handleUpgrade);

        const wsserver = new mod.ws.Server({ noServer: true, clientTracking: true });
        wsserver.serverName = "ws";
        wsserver.serverPort = mod.port;
        wsserver.connections = {};

        wsserver.on("error", (err) => { logger.error("ws:", err) });

        wsserver.on("close", () => {
            logger.debug("close:", mod.name, app.role, wsserver?.serverName);
            wsserver.connections = {};
            clearInterval(wsserver._pingInterval);
            for (const ws of wsserver.clients) ws.terminate();
        });

        wsserver._pingInterval = setInterval(() => {
            wsserver.clients.forEach((ws) => {
                if (ws.alive === false) {
                    ws.terminate();
                } else {
                    ws.alive = false;
                    ws.ping(lib.noop);
                }
            });
        }, mod.ping);

        ipc.on("ws:queue", (msg) => {
            mod.broadcast(msg.q, msg.m);
        });

        if (mod.queue) {
            queue.subscribe("ws:queue", { queueName: mod.queue }, (msg) => {
                if (typeof msg === "string") msg = lib.jsonParse(msg, { logger: "info" });
                mod.broadcast(msg.q, msg.m);
            });
        }
        mod.server = wsserver;
        logger.log("configureWebServer:", mod.name, app.role, "created", server.serverName);
    }

    callback();
}

mod.shutdownServer = function(_options, callback)
{
    var err, server = mod.server;

    if (server) {
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

// Check if the request is allowed to upgrade to WebSocket
mod.handleUpgrade = function(req, socket, head)
{
    logger.debug("handleWebSocketUpgrade:", req.socket.remoteAddress, req.url, req.headers.origin);

    if ((mod.path && !mod.path.test(req.url)) ||
        (mod.origin && !mod.origin.test(req.headers.origin))) {
        socket.write('HTTP/1.0 401 Unauthorized\r\nConnection: close\r\n\r\n');
        return socket.destroy();
    }

    app.runMethods("configureWebSocketUpgrade", req, { stopOnError: 1, direct: 1 }, (err) => {
        if (!err) {
            return mod.handleConnect(req, socket, head);
        }

        logger.debug("handleWebSocketUpgrade:", err, req.context);
        var msg = lib.stringify(err);
        socket.write(`HTTP/1.0 ${err.status} ${http.STATUS_CODES[err.status]}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`);
        socket.destroy();
    });
}

// Wrap external WebSocket connection into the router handler, respond on backend command
mod.handleConnect = function(req, socket, head)
{
    mod.server.handleUpgrade(req, socket, head, (ws) => {

        ws.context = new RequestContext(req, null, { trustProxy: api.trustProxy });

        ws.wsid = ws.context.wsid = lib.uuid();

        logger.debug("handleConnect:", mod.name, "start:", ws.context);

        ws.on("message", mod.handleMessage.bind(mod, ws));
        ws.on("error", (err) => { logger.error("handleConnect:", mod.name, err, ws.context) });
        ws.on('pong', () => { ws.alive = true });

        ws.on("close", () => {
            logger.debug("handleConnect:", mod.name, "closed:", ws.context);
            ws.removeAllListeners("message");
            ws.removeAllListeners("error");
            ws.removeAllListeners("pong");
            ws.context.destroy();
            delete ws.context;
            delete mod.server.connections[ws.wsid];
        });

        mod.server.connections[ws.wsid] = ws;

        mod.handleMessage(ws);
    });
}

// Wrap WebSocket into HTTP request to be proceses by the router
mod.handleMessage = function(ws, data)
{
    if (Buffer.isBuffer(data)) data = data.toString();

    logger.debug("handleMessage:", mod.name, ws.context, data);

    const req = new WebSocketRequest(ws, data);
    const res = new WebSocketResponse(ws);

    api.handleRequest(req, res);
}

// Send to a WebSocket inside an api server directly
mod.send = function(wsid, msg)
{
    if (!mod.server) return;
    var ws = mod.server.connections[wsid];
    if (!ws) return;
    if (typeof msg !== "string") msg = lib.stringify(msg);
    try { ws.send(msg) } catch (e) { logger.error("send:", mod.name, ws.wsid, ws.path, ws.user.id, e, msg) }
}

/**
 * Broadcast a message according to the options, if no WebSocket queue is defined send
 * directly using {@link module:api/ws.broadcast}
 * @param {object} options
 * @param {object|string} msg
 * @param {function} [callback]
 * @returns {boolean} - false if not sent
 * @memberof module:api/ws
 * @method notify
 */
mod.notify = function(options, msg, callback)
{
    if (mod.queue) {
        return ipc.broadcast("ws:queue", { q: options, m: msg }, { queueName: mod.queue }, callback);
    }

    if (mod.server?.clients) {
        return mod.broadcast(options, msg);
    }

    if (app.isWorker) {
        return ipc.sendMsg("ws:queue", { q: options, m: msg });
    }
    return false;
}

/**
 * Send a message to all WebSockets inside an api process that match the criteria from the options
 * @param {object} options
 * @param {string|string[]} [options.wsid] - send to the specific WebSocket(s), can be a list
 * @param {RegExp} [options.path] - a regexp to match initial WebSocket connection url
 * @param {object} [options.user] - an object to be used for condition against WebSocket's user, {@link module:lib.isMatched} is used for comparison
 * @param {object} [options.query] - an object to be used for condition against WebSocket's query, {@link module:lib.isMatched} is used for comparison
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

    logger.debug("broadcast:", mod.name, app.role, options, "msg:", msg);
    var d, data = typeof msg === "string" ? msg : lib.stringify(msg);
    const preprocess = lib.isFunc(options.preprocess);

    for (const ws of mod.server.clients) {
        if ((!options.wsid || options.wsid === ws.wsid || lib.isFlag(options.wsid, ws.wsid)) &&
            (!options.path || lib.testRegexp(ws.path, options.path)) &&
            (!options.user || lib.isMatched(ws.user, options.user)) &&
            (!options.query || lib.isMatched(ws.query, options.query))) {
            d = data;
            if (preprocess) {
                d = preprocess(ws, options, msg);
                if (d === null) continue;
                d = !d ? data : typeof d === "string" ? d : lib.stringify(d);
            }
            logger.debug("broadcast:", mod.name, "send:", ws.wsid, ws.path, ws.user, d);
            try { ws.send(d) } catch (e) { logger.error("wsBroadcast:", ws.wsid, ws.path, ws.user, e) }
        }
    }
}

