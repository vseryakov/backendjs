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

// Return a list of local interfaces, default is all active IPv4 unless `IPv6`` property is set.
// Skips 169.254 unless `all` is set.
lib.networkInterfaces = function(options)
{
    var intf = os.networkInterfaces(), rc = [];
    Object.keys(intf).forEach((x) => {
        intf[x].forEach((y) => {
            if (!y.address || y.internal) return;
            if (y.family != 'IPv4' && !options?.IPv6) return;
            if (y.address.startsWith("169.254") && !options?.all) return;
            y.dev = x;
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
lib._proc_cpu = { usage: process.cpuUsage(), time: process.uptime() * 1000 };
lib._host_cpu = cpuStats();

function cpuStats()
{
    const cpus = os.cpus();
    var idle = 0, total = 0;
    for (const cpu of cpus) {
        idle += cpu.times.idle;
        for (const p in cpu.times) total += cpu.times[p];
    }
    return [idle/cpus.length, total/cpus.length];
}

// Return CPU/mem process stats in an object
lib.processStats = function()
{
    var now = Date.now();

    var elu = perf_hooks.performance.eventLoopUtilization(this._elu);
    this._elu = perf_hooks.performance.eventLoopUtilization();

    var usage = process.cpuUsage(this._proc_cpu.usage);
    var pcpu = (usage.system/1000 + usage.user/1000) / (now - this._proc_cpu.time) * 100;
    this._proc_cpu.usage = process.cpuUsage();
    this._proc_cpu.time = now;

    var stats = cpuStats();
    var cpu = lib.toClamp(100 - (stats[0] - this._host_cpu[0]) / (stats[1] - this._host_cpu[1]) * 100, 0, 100);
    this._host_cpu = stats;

    return {
        timestamp: now,
        pid: process.pid,
        eventloop_util: lib.toNumber(elu.utilization*100, { digits: 2 }),
        proc_cpu_util: lib.toNumber(pcpu, { digits: 2 }),
        proc_mem_util: lib.toNumber(process.memoryUsage.rss() / os.totalmem() * 100, { digits: 2 }),
        proc_mem_rss: process.memoryUsage.rss(),
        host_cpu_util: lib.toNumber(cpu, { digits: 2 }),
        host_mem_used: os.totalmem() - os.freemem(),
        host_mem_util: lib.toNumber((os.totalmem() - os.freemem())/os.totalmem()*100, { digits: 2 }),
    };
}

// Return network stats for the instance, if not netdev is given it uses eth0 (Linux)
lib.networkStats = function(netdev, callback)
{
    var stats = {};

    if (os.type() == "Linux") {
        // Inter-|   Receive                                                |  Transmit
        // face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed

        function _parse(data) {
            var eth = data.map((x) => (lib.strSplit(x," "))).filter((x) => (x[0] == netdev + ":")).pop();
            if (!eth) return;
            var now = eth.now = Date.now();
            stats.net_rx_bytes = lib.toNumber(eth[1]);
            stats.net_rx_packets = lib.toNumber(eth[2]);
            stats.net_rx_errors = lib.toNumber(eth[3]);
            stats.net_rx_dropped = lib.toNumber(eth[4]);
            stats.net_tx_bytes = lib.toNumber(eth[9]);
            stats.net_tx_packets = lib.toNumber(eth[10]);
            stats.net_tx_errors = lib.toNumber(eth[11]);
            stats.net_tx_dropped = lib.toNumber(eth[12]);
            if (lib._eth) {
                var t = (now - lib._eth.now)/1000;
                stats.net_rx_rate = lib.toNumber((stats.net_rx_bytes - lib.toNumber(lib._eth[1])) / t, { digits: 2 });
                stats.net_tx_rate = lib.toNumber((stats.next_tx_bytes - lib.toNumber(lib._eth[9])) / t, { digits: 2 });
            }
            lib._eth = eth;
        }

        netdev = netdev || "eth0";

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

