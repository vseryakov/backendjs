/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

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
    #data = null

    constructor(ws, data) {
        super();
        data = lib.isString(data);
        this.method = "GET";
        this.httpVersion = "WS/1.0";
        this.url = data[0] === "/" ? data : ws.context.url;

        Object.assign(this.headers, ws.context.req.headers);

        if (data[0] === "{" || data[0] === "[") {
            this.#data = data;
            this.method = "POST";
            this.headers["content-type"] = "application/json";
            this.setEncoding('utf8');
        }
    }

    /**
     * Provide message data for body middleware
     */
    _read() {
        const d = this.#data;
        this.#data = null;
        this.push(d);
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
    }

    /**
     * Override end to send via web socket
     * @param {string|Buffer|Uint8Array} chunk
     * @param {string} [encoding]
     */
    end(chunk, _encoding) {
        const ws = this.ws;

        if (chunk?.length) {
            try {
                ws.send(chunk.toString());
            } catch (e) {
                logger.error("end:", ws.wsid, ws.context, e)
            }
        }

        // Store the last authenticated user in the parent context
        if (this.context?.userId && !ws.context.userId) {
            ws.context.user = this.context.user;
        }

        this.ws = undefined;
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
 * The simplest way is to configure __api-ws-port__ to the same value as the HTTP port, eg `api-ws-port = 8000`
 *
 * This will run WebSockets server along the regular Web server.
 *
 * ## In the browser
 *
 * Open a socket first
 *
 * ```js
 * var ws = new WebSocket("http://localhost:8000/ws?id=123");
 * ws.onmessage = (msg) => { console.log(msg) }
 * ```
 *
 * There are two ways to send messages via WebSockets to the server from a browser:
 *
 * ### 1. as URLs
 *
 * ```js
 * ws.send('/project/update?id=1&name=Test2')
 * ```
 *
 * This is a GET request, if users middleware is enabled and matches it will be checked for access and authorization
 * before letting it pass via routes. This method allows to share the same route handlers between HTTP and WebSockets requests,
 * the handlers will use the same code and all responses will be sent back,
 * only in the WebSockets case the response will arrive in the message listener `onmessage` (see above)
 *
 * If not authorized the connection will be dropped.
 *
 * ### 2. as JSON objects, message format can be any
 *
 * ```js
 * ws.send({ op: "/project/update", project: { id: 1, name: "Test2" } })```
 * ```
 * This is a POST request, such requests use the original the path which was used during the connect,
 * i.e. the one used in the above is __/ws__. The router handler for this path will receive all POST messages from WebSocket clients,
 * parse the JSON and place it in the body if the middleware is enabled, same router routes as with regular HTTP requests.
 *
 * ## In the server
 *
 * All WebSocket messages sent from the server will arrive in the event handler and must be
 * formatted properly in order to distinguish what is what, this is up to the application logic.
 *
 * If the server needs to send a message to all or some specific clients for example due to some updates in the DB, it must use the
 * {@link module:api/ws.notify} function.
 *
 * ```js
 * // Notify all clients who is using the project being updated, the JSON format is for demo purposes
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
        { name: "queue", descr: "A queue where to publish messages for WebSockets, API process will listen for messages and proxy it to all matching connected WebSockets " },
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

mod.configureWebServer = function(_options, callback)
{
    if (!mod.port) return callback();

    mod.ws = lib.tryRequire(__dirname + "/../../dist/ws");
    if (!mod.ws) return callback();

    let server = mod.port === api.port ? api.server : mod.port === app.ssl.port ? api.sslServer : null;
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
        wsserver.connections = new Map();

        wsserver.on("error", (err) => { logger.error("ws:", err) });

        wsserver.on("close", () => {
            logger.debug("close:", mod.name, app.role, wsserver.serverName);
            wsserver.connections.clear();
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
        try {
            server.close();
        } catch (e) {
            err = e
        }
        mod.server = undefined;
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
        const msg = lib.stringify(err);
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

        ws.on("error", (err) => {
            logger.error("handleConnect:", mod.name, err, ws.context)
        });

        ws.on('pong', () => {
            ws.alive = true;
        });

        ws.on("close", () => {
            logger.debug("handleConnect:", mod.name, "closed:", ws.context);
            ws.removeAllListeners("message");
            ws.removeAllListeners("error");
            ws.removeAllListeners("pong");
            ws.context.destroy();
            ws.context = undefined;
            mod.server?.connections?.delete(ws.wsid);
        });

        mod.server.connections.set(ws.wsid, ws);

        mod.handleMessage(ws);
    });
}

// Wrap WebSocket into HTTP request to be proceses by the router
mod.handleMessage = function(ws, data)
{
    if (Buffer.isBuffer(data)) data = data.toString();

    const req = new WebSocketRequest(ws, data);
    const res = new WebSocketResponse(ws);

    logger.debug("handleMessage:", mod.name, ws.context, req.method, req.url, data);

    api.handleRequest(req, res);
}

// Send to a WebSocket inside an api server directly
mod.send = function(wsid, msg)
{
    const ws = mod.server?.connections?.get(wsid);
    if (!ws) return;
    if (typeof msg !== "string") msg = lib.stringify(msg);
    try { ws.send(msg) } catch (e) { logger.error("send:", mod.name, ws.wsid, ws.path, ws.user.id, e, msg) }
}

/**
 * Broadcast a message to all matching connected clients
 * - in local mode it sends only to the clients inside a single process
 * - if `api-ws-queue`` is defined then all api processes listening on that queue will notify matching clients
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
 * @param {RegExp} [options.path] - a regexp to match initial WebSocket connection path
 * @param {object} [options.user] - an object to be used for condition against WebSocket's authenticated user,
 * {@link module:lib.isMatched} is used for comparison
 * @param {object} [options.query] - an object to be used for condition against WebSocket's initial query,
 * {@link module:lib.isMatched} is used for comparison
 * @param {function} [options.preprocess] - a function(ws, options, msg) to be called before sending in order to possibly modify the message for this
 *    particular user, i.e. for permissions checks, if it needs to be modified return a copy otherwise the original will be used, returning
 *    null will skip this socket
 * @param {object|string} msg
 * @memberof module:api/ws
 * @method broadcast
 */
mod.broadcast = function(options, msg)
{
    if (!mod.server?.connections) return;
    if (!options || !msg) return;

    const data = typeof msg === "string" ? msg : lib.stringify(msg);
    const preprocess = lib.isFunc(options.preprocess);

    for (const [, ws] of mod.server.connections) {
        logger.dev("broadcast:", mod.name, "check:", options, "CTX:", ws.context, ws.context.query, ws.context.user);

        if ((!options.wsid || options.wsid === ws.wsid || lib.includes(options.wsid, ws.wsid)) &&
            (!options.path || lib.testRegexp(ws.context.path, options.path)) &&
            (!options.user || lib.isMatched(ws.context.user, options.user)) &&
            (!options.query || lib.isMatched(ws.context.query, options.query))) {
            let d = data;
            if (preprocess) {
                d = preprocess(ws, options, msg);
                if (d === null) continue;
                d = !d ? data : typeof d === "string" ? d : lib.stringify(d);
            }
            logger.debug("broadcast:", mod.name, "send:", options, "CTX:", ws.context, "DATA:", d);
            try { ws.send(d) } catch (e) { logger.error("wsBroadcast:", ws.wsid, ws.path, ws.user, e) }
        }
    }
}

