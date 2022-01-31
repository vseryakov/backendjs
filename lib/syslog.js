//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2022
//

const dgram = require("dgram");
const net = require("net");
const os = require("os");

function Syslog(options)
{
    for (const p in options) this[p] = options[p];

    // facilities
    this.LOG_KERN = 0
    this.LOG_USER = 1
    this.LOG_MAIL = 2
    this.LOG_DAEMON = 3
    this.LOG_AUTH = 4
    this.LOG_SYSLOG = 5
    this.LOG_LPR = 6
    this.LOG_NEWS = 7
    this.LOG_UUCP = 8
    this.LOG_CRON = 9
    this.LOG_AUTHPRIV = 10
    this.LOG_FTP = 11
    this.LOG_LOCAL0 = 16
    this.LOG_LOCAL1 = 17
    this.LOG_LOCAL2 = 18
    this.LOG_LOCAL3 = 19
    this.LOG_LOCAL4 = 20
    this.LOG_LOCAL5 = 21
    this.LOG_LOCAL6 = 22
    this.LOG_LOCAL7 = 23

    // priorities
    this.LOG_EMERG = 0
    this.LOG_ALERT = 1
    this.LOG_CRIT = 2
    this.LOG_ERROR = 3
    this.LOG_WARN = 4
    this.LOG_WARNING = 4
    this.LOG_NOTICE = 5
    this.LOG_INFO = 6
    this.LOG_DEBUG = 7

    this.facility = this.facility || this.LOG_LOCAL0;
    this.hostname = this.hostname || os.hostname().split(".")[0];
    this.tag = this.tag || process.title.split(/[^a-z0-9_-]/i)[0];
}
module.exports = Syslog;

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
    if (this.rfc3164) {
        var now = new Date().toString().split(" ");
        if (now[2][0] == "0") now[2] = " " + now[2][1];
        msg = `<${this.facility*8+priority}>${now[1] + " " + now[2] + " " + now[4]} ${this.hostname} ${msg}\n`;
    } else {
        msg = `<${this.facility*8+priority}>1 ${new Date().toISOString()} ${this.hostname} ${this.tag} ${process.pid} - - ${msg}\n`;
    }
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
        console.error("syslog:", err, this.udp && "udp", this.host, this.port, this.path);
        this.close();
    }
}
