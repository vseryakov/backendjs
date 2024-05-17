//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');
const os = require('os');

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
