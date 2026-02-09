/*
 *  alpinejs-app client
 *  Vlad Seryakov vseryakov@gmail.com 2018
 */

 /* global window navigator WebSocket */

import { $on, emit, isObject, toNumber, trace } from "./app.mjs"

export class WS {
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

    constructor(options)
    {
        $on(window, "online", this.online.bind(this));
    }

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
        for (const p in this.headers) {
            if (this.query[p] === undefined) this.query[p] = this.headers[p];
        }

        var port = this.port || window.location.port;
        var proto = this.protocol || window.location.protocol.replace("http", "ws");
        var url = `${proto}//${host}:${port}${this.path}?${this.query ? new URLSearchParams(this.query).toString() : ""}`;

        var ws = this.ws = new WebSocket(url);
        ws.onopen = () => {
            trace("ws.open:", url);
            emit("ws:open", url);
            this._ctime = Date.now();
            this._timeout = toNumber(this.retry_timeout);
            this._retries = 0;
            while (this._pending.length) {
                this.send(this.pending.shift());
            }
            this.ping();
        }
        ws.onclose = () => {
            trace("ws.closed:", url, this._timeout, this._retries);
            this.ws = null;
            emit("ws:close", url);
            if (++this._retries < this.max_retries) this.timer();
        }
        ws.onmessage = (msg) => {
            var data = msg.data;
            if (data === "bye") return this.close(1);
            if (typeof data == "string" && (data[0] == "{" || data[0] == "[")) data = JSON.parse(data);
            trace('ws.message:', data);
            emit("ws:message", data);
        }
        ws.onerror = (err) => {
            trace('ws.error:', url, err);
        }
    }

    // Restart websocket reconnect timer, increase timeout according to reconnect policy (retry_factor, max_timeout)
    timer(timeout)
    {
        clearTimeout(this._timer);
        if (this.disabled) return;
        if (typeof timeout == "number") this._timeout = timeout;
        this._timer = setTimeout(this.connect.bind(this), this._timeout);
        this._timeout *= this._timeout == this.max_timeout ? 0 : parseInt(this.retry_factor);
        this._timeout = toNumber(this._timeout, { min: this.retry_timeout, max: this.max_timeout });
    }

    // Send a ping and shcedule next one
    ping()
    {
        clearTimeout(this._ping);
        if (this.disabled || !this.ping_interval) return;
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(this.ping_path || "/ping");
        }
        this._ping = setTimeout(this.ping.bind(this), this.ping_interval);
    }

    // Closes and possibly disables WS connection, to reconnect again must delete .disabled property
    close(disable)
    {
        this.disabled = disable;
        if (!this.ws) return;
        this.ws.close();
        delete this.ws;
    }

    // Send a string data or an object
    send(data)
    {
        if (this.ws?.readyState != WebSocket.OPEN) {
            if (!this.max_pending || this._pending.length < this.max_pending) {
                this._pending.push(data);
            }
            return;
        }
        if (isObject(data)) {
            if (data.url && data.url[0] == "/") {
                data = data.url;
                if (isObject(data.data)) {
                    data += "?" + new URLSearchParams(data.data).toString();
                }
            } else {
                data = JSON.stringified(data);
            }
        }
        this.ws.send(data);
    }

    // Check the status of websocket connection, reconnect if needed
    online()
    {
        trace('ws.online:', navigator.onLine, this.ws?.readyState, this.path, this._ctime);
        if (this.ws?.readyState !== WebSocket.OPEN && this._ctime) {
            this.connect();
        }
    }
}


