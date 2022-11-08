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

const months = [ 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec' ];
function zeropad(n) { return n > 9 ? n : '0' + n }
function spacepad(n) { return n > 9 ? n : ' ' + n }

function Syslog(options)
{
    this.retryQueue = []
    this.retryCount = 3
    this.retryMax = 1000
    this.retryBatch = 100
    this.retryInterval = 3000

    for (const p in options) this[p] = options[p];
    this.hostname = this.hostname || os.hostname();
    this.tag = this.tag || process.title.split(/[^a-z0-9_-]/i)[0];

    this._retryInterval = setInterval(this.onRetry.bind(this), this.retryInterval);
}

Syslog.prototype.label = function()
{
    return [this.hostname, this.tag, this.udp && "udp", this.host, this.port, this.path, this.connecting].filter((x) => x).join(", ");
}

Syslog.prototype.close = function()
{
    clearInterval(this._retryInterval);
    if (this.sock) {
        if (this.sock.destroy) this.sock.destroy(); else this.sock.close();
    }
    delete this.sock;
}

Syslog.prototype.log = function(priority, msg)
{
    if (!this.sock || this.sock.pending) return;
    const now = new Date();
    if (!priority) priority = mod.LOG_LOCAL0 * 8 + mod.LOG_NOTICE;

    if (this.rfc5424) {
        msg = `<${priority}>1 ${now.toISOString().replace("Z", "+00:00")} ${this.hostname} ${this.tag} ${process.pid} - - ${msg}\n`;
    } else
    if (this.rfc3164) {
        const d = `${months[now.getMonth()]} ${spacepad(now.getDate())} ${zeropad(now.getHours())}:${zeropad(now.getMinutes())}:${zeropad(now.getSeconds())}`
        msg = `<${priority}>${d} ${this.hostname} ${this.tag}[${process.pid}]: ${msg}\n`;
    } else {
        msg = `<${priority}>${now.toISOString().replace("Z", "+00:00")} ${this.tag}[${process.pid}]: ${msg}\n`;
    }
    this.write(msg);
}

Syslog.prototype.write = function(msg, retry)
{
    try {
        if (this.udp) {
            if (this.path) {
                const buf = Buffer.from(msg);
                this.sock.send(buf, 0, buf.length, this.path, (err) => {
                    this.onError(err, msg, retry);
                });
            } else {
                this.sock.send(msg, this.port || 514, this.host || "127.0.0.1", (err) => {
                    this.onError(err, msg, retry);
                });
            }
        } else {
            this.sock.write(msg, (err) => {
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
    if (retry < this.retryCount || this.retryQueue.length <= this.retryMax) {
        this.retryQueue.push([msg, retry + 1]);
    } else {
        console.error("syslog:", this.label(), err, retry, this.retryQueue.length, msg);
    }
}

Syslog.prototype.onRetry = function()
{
    for (let i = 0; i < this.retryBatch; i++) {
        const m = this.retryQueue.shift();
        if (!m) break;
        this.write(m[0], m[1]);
    }
}

Syslog.prototype.open = function()
{
    try {
        this.sock = this.connecting = 0;
        if (this.udp && this.path) {
            this.sock = require("unix-dgram").createSocket("unix_dgram");
        } else
        if (this.udp) {
            this.sock = dgram.createSocket("udp4");
            this.sock.unref();
        } else {
            this.sock = net.createConnection(this);
            this.sock.unref();
            this.sock.setKeepAlive(true);
            this.sock.setNoDelay(true);
            this.sock.on('close', () => {
                if (!this.sock) return;
                if (this.connecting > 10) this.connecting = -1;
                setTimeout(() => { if (this.sock) this.sock.connect(this) }, Math.pow(2, this.connecting++) * 1000);
            });
            this.sock.on('timeout', () => {
                if (!this.sock) return;
                if (this.sock.destroy) this.sock.destroy(); else this.sock.close();
            });
            this.sock.on("connect", () => {
                this.connecting = 0;
            })
        }
        this.sock.on("error", (err) => {
            if (this.connecting) return;
            console.error("syslog:", this.label(), err);
        });
    } catch (err) {
        console.error("syslog:", this.label(), err);
        this.close();
    }
}
