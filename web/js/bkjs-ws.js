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
    var conf = this.wsconf;
    if (conf._timer) {
        clearTimeout(conf._timer);
        delete conf._timer;
    }
    if (conf.disabled) return;
    if (navigator.onLine === false) {
        return this.wsTimer(0);
    }

    for (const p in options) conf[p] = options[p];
    if (!conf.query) conf.query = {};
    for (const p in conf.headers) if (this.isU(conf.query[p])) conf.query[p] = conf.headers[p];
    var url = (conf.protocol || window.location.protocol.replace("http", "ws")) + "//" +
              (conf.host || (conf.hostname ? conf.hostname + "." + this.domainName(window.location.hostname) : "") || window.location.hostname) + ":" +
              (conf.port || window.location.port) +
              conf.path + "?" + this.toQuery(conf.query);

    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
        if (conf.debug) this.log("ws.open:", url);
        this.event("bkjs.ws.open", url);
        conf._ctime = Date.now();
        conf._timeout = conf.retry_timeout;
        conf._retries = 0;
        while (conf._pending.length) {
            this.wsSend(conf.pending.shift());
        }
        this.wsPing();
    }
    this.ws.onclose = () => {
        if (conf.debug) this.log("ws.closed:", url, conf._timeout, conf._retries);
        this.ws = null;
        this.event("bkjs.ws.close", url);
        if (++conf._retries < conf.max_retries) this.wsTimer();
    }
    this.ws.onmessage = (msg) => {
        var data = msg.data;
        if (data === "bye") return this.wsClose(1);
        if (this.isS(data) && (data[0] == "{" || data[0] == "[")) data = JSON.parse(data);
        if (conf.debug) this.log('ws.message:', data);
        this.event("bkjs.ws.message", data);
    }
    this.ws.onerror = (err) => {
        if (conf.debug) this.log('ws.error:', url, err);
    }
}

// Restart websocket reconnect timer, increase conf.timeout according to reconnect policy conf.(retry_factor, max_timeout)
bkjs.wsTimer = function(timeout)
{
    var conf = this.wsconf;
    clearTimeout(conf._timer);
    if (conf.disabled) return;
    if (this.isN(timeout)) conf._timeout = timeout;
    conf._timer = setTimeout(this.wsConnect.bind(this), conf._timeout);
    conf._timeout *= conf._timeout == conf.max_timeout ? 0 : conf.retry_factor;
    conf._timeout = this.toClamp(conf._timeout, conf.retry_timeout, conf.max_timeout);
}

// Send a ping and shcedule next one
bkjs.wsPing = function()
{
    var conf = this.wsconf;
    clearTimeout(conf._ping);
    if (conf.disabled || !conf.ping_interval) return;
    if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(conf.ping_path || "/ping");
    }
    conf._ping = setTimeout(this.wsPing.bind(this), conf.ping_interval);
}

// Closes and possibly disables WS connection, to reconnect again must delete .disabled property from wsconf
bkjs.wsClose = function(disable)
{
    this.wsconf.disabled = disable;
    if (this.ws) {
        this.ws.close();
    }
}

// Send a string data or an object in jQuery ajax format { url:.., data:.. } or as an object to be stringified
bkjs.wsSend = function(data)
{
    var conf = this.wsconf;
    if (this.ws?.readyState != WebSocket.OPEN) {
        if (!conf.max_pending || conf._pending.length < conf.max_pending) {
            conf._pending.push(data);
        }
        return;
    }
    if (this.isO(data) && data) {
        if (data.url && data.url[0] == "/") {
            data = data.url + (data.data ? "?" + this.toQuery(data.data) : "");
        } else {
            data = JSON.stringified(data);
        }
    }
    this.ws.send(data);
}

// Check the status of websocket connection, reconnect if needed
bkjs.wsOnline = function()
{
    if (this.wsconf.debug) this.log('ws.online:', navigator.onLine, this.ws?.readyState, this.wsconf.path, this.wsconf._ctime);
    if (this.ws?.readyState !== WebSocket.OPEN) {
        this.wsConnect();
    }
}

$(function() {
    window.addEventListener("online", bkjs.wsOnline.bind(bkjs));
});

