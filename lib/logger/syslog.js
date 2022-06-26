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
    for (const p in options) this[p] = options[p];
    this.hostname = this.hostname || os.hostname();
    this.tag = this.tag || process.title.split(/[^a-z0-9_-]/i)[0];
}

Syslog.prototype.close = function()
{
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


Syslog.prototype.write = function(msg)
{
    try {
        if (this.udp) {
            if (this.path) {
                msg = Buffer.from(msg);
                this.sock.send(msg, 0, msg.length, this.path);
            } else {
                this.sock.send(msg, this.port || 514, this.host || "127.0.0.1");
            }
        } else {
            this.sock.write(msg);
        }
    } catch (err) {
        console.error("syslog:", this.hostname, this.udp && "udp", this.host, this.port, this.path, msg, err);
    }
}

Syslog.prototype.open = function()
{
    try {
        this.sock = this.retries = 0;
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
                if (this.retries > 5) this.retries = -1;
                setTimeout(() => { if (this.sock) this.sock.connect(this) }, Math.pow(2, this.retries++) * 1000);
            });
            this.sock.on('timeout', () => {
                if (!this.sock) return;
                if (this.sock.destroy) this.sock.destroy(); else this.sock.close();
            });
        }
        this.sock.on("error", (err) => {
            if (this.retries) return;
            console.error("syslog:", err, this.retries, this.udp && "udp", this.host, this.port, this.path);
        });
    } catch (err) {
        console.error("syslog:", this.hostname, this.udp && "udp", this.host, this.port, this.path, err);
        this.close();
    }
}
