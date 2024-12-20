/*!
 *  backend.js client
 *  Vlad Seryakov vseryakov@gmail.com 2018
 */

// Websockets
bkjs.wsconf = {
    host: null,
    port: 0,
    path: "/",
    query: null,
    retry_timeout: 500,
    retry_factor: 2,
    max_timeout: 30000,
    max_retries: Infinity,
    max_pending: 10,
    ping_interval: 300000,
    _retries: 0,
    _pending: [],
};

// Open a new websocket connection, updates the wsconf from the options
bkjs.wsConnect = function(options)
{
    var conf = bkjs.wsconf;
    if (conf._timer) {
        clearTimeout(conf._timer);
        delete conf._timer;
    }
    if (conf.disabled) return;

    for (const p in options) conf[p] = options[p];
    var host = conf.host || window.location.hostname;

    if (navigator.onLine === false && !/^(localhost|127.0.0.1)$/.test(host)) {
        return bkjs.wsTimer(0);
    }

    if (!conf.query) conf.query = {};
    for (const p in conf.headers) if (conf.query[p] === undefined) conf.query[p] = conf.headers[p];

    var port = conf.port || window.location.port;
    var proto = conf.protocol || window.location.protocol.replace("http", "ws");
    var url = `${proto}//${host}:${port}${conf.path}?${bkjs.toQueryString(conf.query)}`;

    bkjs.ws = new WebSocket(url);
    bkjs.ws.onopen = () => {
        if (conf.debug) bkjs.log("ws.open:", url);
        bkjs.emit("ws:open", url);
        conf._ctime = Date.now();
        conf._timeout = conf.retry_timeout;
        conf._retries = 0;
        while (conf._pending.length) {
            bkjs.wsSend(conf.pending.shift());
        }
        bkjs.wsPing();
    }
    bkjs.ws.onclose = () => {
        if (conf.debug) bkjs.log("ws.closed:", url, conf._timeout, conf._retries);
        bkjs.ws = null;
        bkjs.emit("ws:close", url);
        if (++conf._retries < conf.max_retries) bkjs.wsTimer();
    }
    bkjs.ws.onmessage = (msg) => {
        var data = msg.data;
        if (data === "bye") return bkjs.wsClose(1);
        if (typeof data == "string" && (data[0] == "{" || data[0] == "[")) data = JSON.parse(data);
        if (conf.debug) bkjs.log('ws.message:', data);
        bkjs.emit("ws:message", data);
    }
    bkjs.ws.onerror = (err) => {
        if (conf.debug) bkjs.log('ws.error:', url, err);
    }
}

// Restart websocket reconnect timer, increase conf.timeout according to reconnect policy conf.(retry_factor, max_timeout)
bkjs.wsTimer = function(timeout)
{
    var conf = bkjs.wsconf;
    clearTimeout(conf._timer);
    if (conf.disabled) return;
    if (typeof timeout == "number") conf._timeout = timeout;
    conf._timer = setTimeout(bkjs.wsConnect.bind(this), conf._timeout);
    conf._timeout *= conf._timeout == conf.max_timeout ? 0 : conf.retry_factor;
    conf._timeout = bkjs.toClamp(conf._timeout, conf.retry_timeout, conf.max_timeout);
}

// Send a ping and shcedule next one
bkjs.wsPing = function()
{
    var conf = bkjs.wsconf;
    clearTimeout(conf._ping);
    if (conf.disabled || !conf.ping_interval) return;
    if (bkjs.ws?.readyState === WebSocket.OPEN) {
        bkjs.ws.send(conf.ping_path || "/ping");
    }
    conf._ping = setTimeout(bkjs.wsPing.bind(this), conf.ping_interval);
}

// Closes and possibly disables WS connection, to reconnect again must delete .disabled property from wsconf
bkjs.wsClose = function(disable)
{
    bkjs.wsconf.disabled = disable;
    if (bkjs.ws) {
        bkjs.ws.close();
        delete bkjs.ws;
    }
}

// Send a string data or an object in jQuery ajax format { url:.., data:.. } or as an object to be stringified
bkjs.wsSend = function(data)
{
    var conf = bkjs.wsconf;
    if (bkjs.ws?.readyState != WebSocket.OPEN) {
        if (!conf.max_pending || conf._pending.length < conf.max_pending) {
            conf._pending.push(data);
        }
        return;
    }
    if (typeof data == "object" && data) {
        if (data.url && data.url[0] == "/") {
            data = data.url + (data.data ? "?" + bkjs.toQueryString(data.data) : "");
        } else {
            data = JSON.stringified(data);
        }
    }
    bkjs.ws.send(data);
}

// Check the status of websocket connection, reconnect if needed
bkjs.wsOnline = function()
{
    if (bkjs.wsconf.debug) bkjs.log('ws.online:', navigator.onLine, bkjs.ws?.readyState, bkjs.wsconf.path, bkjs.wsconf._ctime);
    if (bkjs.ws?.readyState !== WebSocket.OPEN && bkjs.wsconf._ctime) {
        bkjs.wsConnect();
    }
}

bkjs.ready(() => {
    bkjs.$on(window, "online", bkjs.wsOnline.bind(bkjs));
});

