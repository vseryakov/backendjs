/*!
 *  backend.js client
 *  Vlad Seryakov vseryakov@gmail.com 2018
 */

(() => {
var app = window.app;

// Websockets
app.wsconf = {
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
app.wsConnect = function(options)
{
    var conf = app.wsconf;
    if (conf._timer) {
        clearTimeout(conf._timer);
        delete conf._timer;
    }
    if (conf.disabled) return;

    for (const p in options) conf[p] = options[p];
    var host = conf.host || window.location.hostname;

    if (navigator.onLine === false && !/^(localhost|127.0.0.1)$/.test(host)) {
        return app.wsTimer(0);
    }

    if (!conf.query) conf.query = {};
    for (const p in conf.headers) if (conf.query[p] === undefined) conf.query[p] = conf.headers[p];

    var port = conf.port || window.location.port;
    var proto = conf.protocol || window.location.protocol.replace("http", "ws");
    var url = `${proto}//${host}:${port}${conf.path}?${app.toQueryString(conf.query)}`;

    app.ws = new WebSocket(url);
    app.ws.onopen = () => {
        if (conf.debug) app.log("ws.open:", url);
        app.emit("ws:open", url);
        conf._ctime = Date.now();
        conf._timeout = conf.retry_timeout;
        conf._retries = 0;
        while (conf._pending.length) {
            app.wsSend(conf.pending.shift());
        }
        app.wsPing();
    }
    app.ws.onclose = () => {
        if (conf.debug) app.log("ws.closed:", url, conf._timeout, conf._retries);
        app.ws = null;
        app.emit("ws:close", url);
        if (++conf._retries < conf.max_retries) app.wsTimer();
    }
    app.ws.onmessage = (msg) => {
        var data = msg.data;
        if (data === "bye") return app.wsClose(1);
        if (typeof data == "string" && (data[0] == "{" || data[0] == "[")) data = JSON.parse(data);
        if (conf.debug) app.log('ws.message:', data);
        app.emit("ws:message", data);
    }
    app.ws.onerror = (err) => {
        if (conf.debug) app.log('ws.error:', url, err);
    }
}

// Restart websocket reconnect timer, increase conf.timeout according to reconnect policy conf.(retry_factor, max_timeout)
app.wsTimer = function(timeout)
{
    var conf = app.wsconf;
    clearTimeout(conf._timer);
    if (conf.disabled) return;
    if (typeof timeout == "number") conf._timeout = timeout;
    conf._timer = setTimeout(app.wsConnect.bind(this), conf._timeout);
    conf._timeout *= conf._timeout == conf.max_timeout ? 0 : conf.retry_factor;
    conf._timeout = app.toClamp(conf._timeout, conf.retry_timeout, conf.max_timeout);
}

// Send a ping and shcedule next one
app.wsPing = function()
{
    var conf = app.wsconf;
    clearTimeout(conf._ping);
    if (conf.disabled || !conf.ping_interval) return;
    if (app.ws?.readyState === WebSocket.OPEN) {
        app.ws.send(conf.ping_path || "/ping");
    }
    conf._ping = setTimeout(app.wsPing.bind(this), conf.ping_interval);
}

// Closes and possibly disables WS connection, to reconnect again must delete .disabled property from wsconf
app.wsClose = function(disable)
{
    app.wsconf.disabled = disable;
    if (app.ws) {
        app.ws.close();
        delete app.ws;
    }
}

// Send a string data or an object in jQuery ajax format { url:.., data:.. } or as an object to be stringified
app.wsSend = function(data)
{
    var conf = app.wsconf;
    if (app.ws?.readyState != WebSocket.OPEN) {
        if (!conf.max_pending || conf._pending.length < conf.max_pending) {
            conf._pending.push(data);
        }
        return;
    }
    if (typeof data == "object" && data) {
        if (data.url && data.url[0] == "/") {
            data = data.url;
            if (typeof data.data == "object" && data.data) {
                data += "?" + new URLSearchParams(data.data).toString();
            }
        } else {
            data = JSON.stringified(data);
        }
    }
    app.ws.send(data);
}

// Check the status of websocket connection, reconnect if needed
app.wsOnline = function()
{
    if (app.wsconf.debug) app.log('ws.online:', navigator.onLine, app.ws?.readyState, app.wsconf.path, app.wsconf._ctime);
    if (app.ws?.readyState !== WebSocket.OPEN && app.wsconf._ctime) {
        app.wsConnect();
    }
}

app.$ready(() => {
    app.$on(window, "online", app.wsOnline);
});

})();
