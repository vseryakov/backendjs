//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const core = require(__dirname + '/../core');
const db = require(__dirname + '/../db');
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');

// Load configuration from the config database, must be configured with `db-config` pointing to the database pool where bk_config table contains
// configuration parameters.
//
// The priority of the parameters goes from the most broad to the most specific, most specific always wins, this allows
// for very flexible configuration policies defined by the app or place where instances running and separated by the run mode.
// See `db.getConfigTypes`` for more details.
//
// The options takes the following properties:
//  - force - if true then force to refresh and reopen all db pools
//  - table - a table where to read the config parameters, default is bk_config
//
// Do not create/upgrade tables and indexes when reloading the config, this is to
// avoid situations when maintenance is being done and any process reloading the config may
// create indexes/columns which are not missing but being provisioned or changed.

db.initConfig = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    // Refresh from time to time with new or modified parameters, randomize a little to spread across all servers.
    var interval = db.configMap.interval > 0 ? db.configMap.interval * 60000 + lib.randomShort() : 0;
    lib.deferInterval(this, interval, "config", this.initConfig.bind(this, interval ? options : null));

    if (this.none) return lib.tryCall(callback);

    this.getConfig(options, (err, rows) => {
        if (err) return lib.tryCall(callback, err, []);

        this._configTime = Date.now();

        var argv = rows.reduce((l, x) => {
            l.push('-' + x.name);
            if (x.value) l.push(x.value);
            return l;
        }, []);

        core.parseArgs(argv, 0, "db");

        // Create or reconfigure db pools if needed
        db.init(options, callback);
    });
}

// Return all config records for the given instance, the result will be sorted most relevant at the top
db.getConfig = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    var now = Date.now();
    var query = {
        status: "ok",
        type: this.configTypes(options),
        $or: { $stime: null, stime: now },
        $or1: { $etime: null, etime: now },
        mtime: options.mtime,
        name: options.name,
    };
    var opts = {
        ops: {
            type: "in",
            mtime: "gt",
            stime: "ge",
            etime: "le",
        },
        pool: options?.pool || this.config,
        count: this.configMap.count,
    };
    var table = options?.table || "bk_config";

    this.select(table, query, opts, (err, rows, info) => {
        // Sort inside to be persistent across the databases
        if (!err) {
            var ver = lib.toVersion(core.appVersion);
            rows = rows.filter((x) => (lib.validVersion(ver, x.version) && (!x.stime || x.stime >= now) && (!x.etime || x.etime <= now))).
                        sort((a,b) => (query.type.indexOf(a.type) - query.type.indexOf(b.type) ||
                             lib.toNumber(a.sort) - lib.toNumber(b.sort) ||
                             a.ctime - b.ctime));
        }
        logger.debug("getConfig:", core.role, query, rows?.length, "rows", info.elapsed, "ms");
        lib.tryCall(callback, err, rows);
    });
}

// Build a list of all config types we want to retrieve, based on the `db-config-map` parameters that defines which fields to use for config types.
//
// - for each `top` item it create a mix of all main items below
// - for each `main` item it creates a mix of all `other`` items
//
//  top... -> each of top-main... -> each of top-main-other...
//
// Most common config parameters: runMode, appName, role, roles, tag, region
//
// Example: top is runMode(prod), main is role(shell),tag(local), other is region(none)
//  - prod
//  - prod-shell
//  - prod-shell-none
//  - prod-local
//  - prod-local-none
//
db.configTypes = function(options)
{
    var types = new Set();

    var top = lib.strSplitUnique(this.configMap.top).flatMap((x) => (core[x] || core.instance[x])).filter(x => x);
    var main = lib.strSplitUnique(this.configMap.main).flatMap((x) => (core[x] || core.instance[x])).filter(x => x);
    var other = lib.strSplitUnique(this.configMap.other).flatMap((x) => (core[x] || core.instance[x])).filter(x => x);

    logger.debug("configTypes:", core.role, "T:", top, "M:", main, "O:", other);

    for (const t of top) {
        const field = [t];
        types.add(t);

        for (const m of main) {
            field.push(m);
            types.add(field.join("-"));
            for (const o of other) {
                types.add([...field, o].join("-"));
            }
            field.pop();
        }
    }
    return Array.from(types);
}

