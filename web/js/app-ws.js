/*!
 *  alpinejs-app client
 *  Vlad Seryakov vseryakov@gmail.com 2018
 */

(() => {
var app = window.app;

class WS {
    path = "/"
    query = null
    retry_timeout = 500
    retry_factor = 2
    max_timeout = 30000
    max_retries = Infinity
    max_pending = 10
    ping_interval = 300000
    _retries = 0
    _pending = []

    // Open a new websocket connection
    connect(options)
    {
        if (this._timer) {
            clearTimeout(this._timer);
            delete this._timer;
        }
        if (this.disabled) return;

        for (const p in options) this[p] = options[p];
        var host = this.host || window.location.hostname;

        if (navigator.onLine === false && !/^(localhost|127.0.0.1)$/.test(host)) {
            return this.timer(0);
        }

        if (!this.query) this.query = {};
        for (const p in this.headers) if (this.query[p] === undefined) this.query[p] = this.headers[p];

        var port = this.port || window.location.port;
        var proto = this.protocol || window.location.protocol.replace("http", "ws");
        var url = `${proto}//${host}:${port}${this.path}?${this.query ? new URLSearchParams(this.query).toString() : ""}`;

        var ws = this.ws = new WebSocket(url);
        ws.onopen = () => {
            if (this.debug) app.log("ws.open:", url);
            app.emit("ws:open", url);
            this._ctime = Date.now();
            this._timeout = this.retry_timeout;
            this._retries = 0;
            while (this._pending.length) {
                this.send(this.pending.shift());
            }
            this.ping();
        }
        ws.onclose = () => {
            if (this.debug) app.log("ws.closed:", url, this._timeout, this._retries);
            this.ws = null;
            app.emit("ws:close", url);
            if (++this._retries < this.max_retries) this.timer();
        }
        ws.onmessage = (msg) => {
            var data = msg.data;
            if (data === "bye") return this.close(1);
            if (typeof data == "string" && (data[0] == "{" || data[0] == "[")) data = JSON.parse(data);
            if (this.debug) app.log('ws.message:', data);
            app.emit("ws:message", data);
        }
        ws.onerror = (err) => {
            if (this.debug) app.log('ws.error:', url, err);
        }
    }

    // Restart websocket reconnect timer, increase timeout according to reconnect policy (retry_factor, max_timeout)
    timer(timeout)
    {
        clearTimeout(this._timer);
        if (this.disabled) return;
        if (typeof timeout == "number") this._timeout = timeout;
        this._timer = setTimeout(this.connect.bind(this), this._timeout);
        this._timeout *= this._timeout == this.max_timeout ? 0 : this.retry_factor;
        this._timeout = app.util.toClamp(this._timeout, this.retry_timeout, this.max_timeout);
    }

    // Send a ping and shcedule next one
    ping()
    {
        clearTimeout(this._ping);
        if (this.disabled || !this.ping_interval) return;
        if (app.ws?.readyState === WebSocket.OPEN) {
            app.ws.send(this.ping_path || "/ping");
        }
        this._ping = setTimeout(this.ping.bind(this), this.ping_interval);
    }

    // Closes and possibly disables WS connection, to reconnect again must delete .disabled property
    close(disable)
    {
        this.disabled = disable;
        if (this.ws) {
            this.ws.close();
            delete this.ws;
        }
    }

    // Send a string data or an object in jQuery ajax format { url:.., data:.. } or as an object to be stringified
    send(data)
    {
        if (this.ws?.readyState != WebSocket.OPEN) {
            if (!this.max_pending || this._pending.length < this.max_pending) {
                this._pending.push(data);
            }
            return;
        }
        if (app.isO(data)) {
            if (data.url && data.url[0] == "/") {
                data = data.url;
                if (app.isO(data.data)) {
                    data += "?" + new URLSearchParams(data.data).toString();
                }
            } else {
                data = JSON.stringified(data);
            }
        }
        this.send(data);
    }

    // Check the status of websocket connection, reconnect if needed
    online()
    {
        if (this.debug) app.log('ws.online:', navigator.onLine, this.ws?.readyState, this.path, this._ctime);
        if (this.ws?.readyState !== WebSocket.OPEN && this._ctime) {
            this.connect();
        }
    }
}

app.ws = new WS();

app.$ready(() => {
    app.$on(window, "online", app.ws.online.bind(app.ws));
});


})();


