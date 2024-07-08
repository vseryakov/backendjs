//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const os = require('os');
const perf_hooks = require("perf_hooks");

lib.getuid = function()
{
    return typeof process.getuid == "function" ? process.getuid() : -1;
}

// Return a list of local interfaces, default is all active IPv4 unless `IPv6`` property is set
lib.networkInterfaces = function(options)
{
    var intf = os.networkInterfaces(), rc = [];
    Object.keys(intf).forEach((x) => {
        intf[x].forEach((y) => {
            if (!y.address || y.internal) return;
            if (y.family != 'IPv4' && !options?.IPv6) return;
            rc.push(y);
        });
    });
    return rc;
}

// Drop root privileges and switch to a regular user
lib.dropPrivileges = function(uid, gid)
{
    logger.debug('dropPrivileges:', uid, gid);
    if (lib.getuid() == 0) {
        if (gid) {
            if (lib.isNumeric(gid)) gid = lib.toNumber(gid);
            try { process.setgid(gid); } catch (e) { logger.error('setgid:', gid, e); }
        }
        if (uid) {
            if (lib.isNumeric(uid)) uid = lib.toNumber(uid);
            try { process.setuid(uid); } catch (e) { logger.error('setuid:', uid, e); }
        }
    }
}

// Convert an IP address into integer
lib.ip2int = function(ip)
{
    return ip.split('.').reduce((int, oct) => (int << 8) + parseInt(oct, 10), 0) >>> 0;
}

// Convert an integer into IP address
lib.int2ip = function(int)
{
    return [(int >>> 24) & 0xFF, (int >>> 16) & 0xFF, (int >>> 8) & 0xFF, int & 0xFF].join('.');
}

// Return true if the given IP address is within the given CIDR block
lib.inCidr = function(ip, cidr)
{
    const [range, bits = 32] = cidr.split('/');
    const mask = ~(Math.pow(2, (32 - bits)) - 1);
    return (this.ip2int(ip) & mask) === (this.ip2int(range) & mask);
};

// Return first and last IP addresses for the CIDR block
lib.cidrRange = function(cidr)
{
    const [range, bits = 32] = cidr.split('/');
    const mask = ~(Math.pow(2, (32 - bits)) - 1);
    return [this.int2ip(this.ip2int(range) & mask), this.int2ip(this.ip2int(range) | ~mask)];
}

// Extract domain from the host name, takes all host parts except the first one, if toplevel is true return 2 levels only
lib.domainName = function(host, toplevel)
{
    if (typeof host != "string" || !host) return "";
    var name = this.strSplit(host, '.');
    return (toplevel ? name.slice(-2).join(".") : name.length > 2 ? name.slice(1).join('.') : host).toLowerCase();
}

lib._elu = perf_hooks.performance.eventLoopUtilization();
lib._pcpu = { usage: process.cpuUsage(), time: process.uptime() * 1000 };
lib._cpu = { cpus: os.cpus(), time: Date.now() };

// Return CPU/mem process stats in an object
lib.processStats = function()
{
    var now = Date.now();

    var elu = perf_hooks.performance.eventLoopUtilization(this._elu);
    this._elu = perf_hooks.performance.eventLoopUtilization();

    var usage = process.cpuUsage(this._pcpu.usage);
    var pcpu = (usage.system/1000 + usage.user/1000) / (now - this._pcpu.time) * 100;
    this._pcpu.usage = process.cpuUsage();
    this._pcpu.time = now;

    var cpus = os.cpus(), sys = 0, user = 0;
    for (let i = 0; i < cpus.length; i++) {
        sys += cpus[i].times.sys - this._cpu.cpus[i].times.sys;
        user + cpus[i].times.user - this._cpu.cpus[i].times.user;
    }
    var cpu = (sys + user) / cpus.length / (now - this._cpu.time) * 100;
    this._cpu.cpus = cpus;
    this._cpu.time = now;

    return {
        ctime: now,
        pid: process.pid,
        elu: lib.toNumber(elu.utilization*100, { digits: 2 }),
        pcpu: lib.toNumber(pcpu, { digits: 2 }),
        pmem_p: lib.toNumber(process.memoryUsage.rss() / os.totalmem() * 100, { digits: 2 }),
        pmem: process.memoryUsage.rss()/1024,
        cpu: lib.toNumber(cpu, { digits: 2 }),
        mem: (os.totalmem() - os.freemem())/1024,
        mem_p: lib.toNumber((os.totalmem() - os.freemem())/os.totalmem()*100, { digits: 2 }),
    };
}

// Return network stats for the instance
lib.networkStats = function(callback)
{
    var stats = {};

    if (os.type() == "Linux") {
        // Inter-|   Receive                                                |  Transmit
        // face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed

        function _parse(data) {
            var eth0 = data.map((x) => (lib.strSplit(x," "))).filter((x) => (x[0] == "eth0:")).pop();
            if (!eth0) return;
            var now = eth0.now = Date.now();
            stats.rx = lib.toNumber(eth0[1])/1024;
            stats.rx_packets = lib.toNumber(eth0[2]);
            stats.rx_errors = lib.toNumber(eth0[3]);
            stats.rx_dropped = lib.toNumber(eth0[4]);
            stats.tx = lib.toNumber(eth0[9])/1024;
            stats.tx_packets = lib.toNumber(eth0[10]);
            stats.tx_errors = lib.toNumber(eth0[11]);
            stats.tx_dropped = lib.toNumber(eth0[12]);
            if (lib._eth0) {
                var t = (now - lib._eth0.now)/1000;
                stats.rx_r = lib.toNumber((stats.rx - lib.toNumber(lib._eth0[1])/1024) / t, { digits: 2 });
                stats.tx_r = lib.toNumber((stats.tx - lib.toNumber(lib._eth0[9])/1024) / t, { digits: 2 });
            }
            lib._eth0 = eth0;
        }

        if (typeof callback == "function") {
            return this.readFile("/proc/net/dev", { list: "\n" }, (err, data) => {
                _parse(data);
                callback(err, stats);
            });
        }

        _parse(this.readFileSync("/proc/net/dev", { list: "\n" }));

    } else {
        if (typeof callback == "function") {
            return callback(null, stats);
        }
    }

    return stats;
}

