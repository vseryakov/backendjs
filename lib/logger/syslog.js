//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2022
//

const dgram = require("dgram");
const net = require("net");
const os = require("os");

const mod = {
    // facilities
    LOG_KERN: 0,
    LOG_USER: 1,
    LOG_MAIL: 2,
    LOG_DAEMON: 3,
    LOG_AUTH: 4,
    LOG_SYSLOG: 5,
    LOG_LPR: 6,
    LOG_NEWS: 7,
    LOG_UUCP: 8,
    LOG_CRON: 9,
    LOG_AUTHPRIV: 10,
    LOG_FTP: 11,
    LOG_LOCAL0: 16,
    LOG_LOCAL1: 17,
    LOG_LOCAL2: 18,
    LOG_LOCAL3: 19,
    LOG_LOCAL4: 20,
    LOG_LOCAL5: 21,
    LOG_LOCAL6: 22,
    LOG_LOCAL7: 23,

    // priorities
    LOG_EMERG: 0,
    LOG_ALERT: 1,
    LOG_CRIT: 2,
    LOG_ERROR: 3,
    LOG_WARN: 4,
    LOG_WARNING: 4,
    LOG_NOTICE: 5,
    LOG_INFO: 6,
    LOG_DEBUG: 7,

    Syslog: Syslog,
};
module.exports = mod;

const facilities = Object.keys(mod).filter((x) => (x.startsWith("LOG_"))).reduce((a, b) => { a[b.substr(4).toLowerCase()] = mod[b]; return a }, {});
const months = [ 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec' ];
function zeropad(n) { return n > 9 ? n : '0' + n }
function spacepad(n) { return n > 9 ? n : ' ' + n }
function bsddate(d) { return `${months[d.getMonth()]} ${spacepad(d.getDate())} ${zeropad(d.getHours())}:${zeropad(d.getMinutes())}:${zeropad(d.getSeconds())}` }

function Syslog(options)
{
    this.retryCount = 3
    this.retryMax = 1000
    this.retryBatch = 100
    this.retryInterval = 3000

    this.setOptions(options);

    this._retryQueue = [];
    this._retryInterval = setInterval(this.onRetry.bind(this), this.retryInterval);
}

Syslog.prototype.setOptions = function(options)
{
    for (const p in options) {
        if (p[0] == "_") continue;
        switch (typeof this[p]) {
        case "undefined":
        case "number":
        case "string":
            this[p] = options[p];
        }
    }

    if (!this.hostname) {
        this.hostname = (os.hostname() || "").split(".")[0];
    }

    if (!this.tag) {
        this.tag = process.title.split(/[^a-z0-9_-]/i)[0];
    }

    if (typeof this.facility == "string") {
        this.facility = facilities[this.facility.toLowerCase()] || 0;
    }
    if (!this.facility) {
        this.facility = mod.LOG_LOCAL0;
    }
}

Syslog.prototype.label = function()
{
    return [this.hostname, this.tag, this.udp && "udp", this.host, this.port, this.path, this._connecting].filter((x) => x).join(", ");
}

Syslog.prototype.close = function()
{
    clearInterval(this._retryInterval);
    if (this._sock) {
        if (this._sock.destroy) this._sock.destroy(); else this._sock.close();
    }
    delete this._sock;
}

Syslog.prototype.format = function(priority, msg)
{
    const now = new Date();
    if (!priority) priority = this.facility * 8 + mod.LOG_NOTICE;

    if (this.rfc5424) {
        msg = `<${priority}>1 ${now.toISOString()} ${this.hostname} ${this.tag} ${process.pid} - - ${msg}\n`;
    } else
    if (this.rfc3164) {
        msg = `<${priority}>${bsddate(now)} ${this.hostname} ${this.tag}[${process.pid}]: ${msg}\n`;
    } else {
        const d = this.bsd ? bsddate(now) : now.toISOString();
        msg = `<${priority}>${d} ${this.tag}[${process.pid}]: ${msg}\n`;
    }
    return msg;
}

Syslog.prototype.log = function(priority, msg)
{
    if (!this._sock || this._sock.pending) return;

    this.write(this.format(priority, msg));
}

Syslog.prototype.write = function(msg, retry)
{
    try {
        if (this.udp) {
            if (this.path) {
                const buf = Buffer.from(msg);
                this._sock.send(buf, 0, buf.length, this.path, (err) => {
                    this.onError(err, msg, retry);
                });
            } else {
                this._sock.send(msg, this.port || 514, this.host || "127.0.0.1", (err) => {
                    this.onError(err, msg, retry);
                });
            }
        } else {
            this._sock.write(msg, (err) => {
                this.onError(err, msg, retry);
            });
        }
    } catch (err) {
        this.onError(err, msg, retry);
    }
}

Syslog.prototype.onError = function(err, msg, retry)
{
    if (!err) return;
    retry = parseInt(retry) || 0;
    if (retry < this.retryCount || this._retryQueue.length <= this.retryMax) {
        this._retryQueue.push([msg, retry + 1]);
    } else {
        console.error("syslog:", this.label(), err, retry, this._retryQueue.length, msg);
    }
}

Syslog.prototype.onRetry = function()
{
    for (let i = 0; i < this.retryBatch; i++) {
        const m = this._retryQueue.shift();
        if (!m) break;
        this.write(m[0], m[1]);
    }
}

Syslog.prototype.open = function()
{
    try {
        this._sock = this._connecting = 0;
        if (this.udp && this.path) {
            this._sock = require("unix-dgram").createSocket("unix_dgram");
        } else
        if (this.udp) {
            this._sock = dgram.createSocket("udp4");
            this._sock.unref();
        } else {
            this._sock = net.createConnection(this);
            this._sock.unref();
            this._sock.setKeepAlive(true);
            this._sock.setNoDelay(true);
            this._sock.on('close', () => {
                if (!this._sock) return;
                if (this._connecting > 10) this._connecting = -1;
                setTimeout(() => { if (this._sock) this._sock.connect(this) }, Math.pow(2, this._connecting++) * 1000);
            });
            this._sock.on('timeout', () => {
                if (!this._sock) return;
                if (this._sock.destroy) this._sock.destroy(); else this._sock.close();
            });
            this._sock.on("connect", () => {
                this._connecting = 0;
            })
        }
        this._sock.on("error", (err) => {
            if (this._connecting) return;
            console.error("syslog:", this.label(), err);
        });
    } catch (err) {
        console.error("syslog:", this.label(), err);
        this.close();
    }
}
