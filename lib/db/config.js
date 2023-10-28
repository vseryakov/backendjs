//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const core = require(__dirname + '/../core');
const db = require(__dirname + '/../db');
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const cluster = require('cluster');

// Initialize all database pools. the options may containt the following properties:
//  - createTables - if true then create new tables or upgrade tables with new columns
//  - localTables - if true only enable local, default and config pools
db.init = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = lib.empty;

    // Important parameters that can persist until cleared
    if (typeof options.createTables != "undefined") this._createTables = options.createTables;

    this.initTables();

    logger.debug("dbinit:", "start", core.role, options, Object.keys(this.poolParams), Object.keys(this.pools));

    // Periodic columns refresh
    var interval = !this.noCacheColumns && this.cacheColumnsInterval > 0 ? this.cacheColumnsInterval * 60000 + lib.randomShort() : 0;
    lib.deferInterval(this, interval, "columns", this.refreshColumns.bind(this));

    // Configured pools for supported databases
    lib.forEachLimit(Object.keys(this.poolParams), options.concurrency || core.concurrency, (name, next) => {
        if ((options.localTables || db._localTables) && name != db.pool && name != db.local && name != db.config) return next();

        var params = db.poolParams[name];
        params.pool = name;
        params.type = name.replace(/[0-9]/, "");
        logger.debug("dbinit:", "check", core.role, options, params);

        if (params.disabled) return next();
        // Do not re-create the pool if not forced, just update the properties
        if (db.pools[name] && !options.force && (!params.url || params.url == db.pools[name].url)) {
            db.pools[name].configure(params);
            return next();
        }

        // Create a new pool for the given database driver
        var mod = db.modules.filter((x) => (x.name == params.type)).pop();
        if (!mod) {
            logger.error("dbinit:", core.role, name, "invalid pool type");
            return next();
        }
        var old = db.pools[name];
        try {
            var pool = mod.createPool(params);
        } catch (e) {
            logger.error("dbinit:", core.role, params, e.stack);
            return next();
        }
        db.pools[name] = pool;
        if (old) old.shutdown();

        logger.debug("dbinit:", "done", core.role, options, params);

        if (options.noCacheColumns || db.noCacheColumns) return next();

        if (cluster.isMaster && (db._createTables || pool.configOptions.createTables) && lib.isFlag(db.createTablesRoles, core.role)) {
            return setTimeout(db.createTables.bind(db, name, next), 1000);
        }
        if (!options.noCacheColumns && pool.configOptions.cacheColumns) {
            return db.cacheColumns(name, next);
        }
        next();
    }, callback, true);
}

// Load configuration from the config database, must be configured with `db-config-type` pointing to the database pool where bk_config table contains
// configuration parameters.
//
// The priority of the paramaters is fixed and goes from the most broad to the most specific, most specific always wins, this allows
// for very flexible configuration policies defined by the app or place where instances running and separated by the run mode.
//
// The following list of properties will be queried from the config database and the sorting order is very important, the last values
// will override values received for the earlier properties, for example, if two properties defined in the `bk_config` table with the
// types `myapp` and `prod-myapp`, then the last value will be used only.
//
// The major elements are the following:
//  - the run mode specified in the command line `-run-mode: production`
//  - the application name from the package.json: `myapp`
//  - the process role: `-worker`
//  - the instance tag, AWS name tag or other name: `-nat`
//
// The modifiers which are appended to each major attributes:
//  - the network where the instance is running, first 2 octets from the current IP address: `-192.168`
//  - the region where the instance is running, AWS region or other: `us-east-1`
//
// The top level list is the following:
// - runMode
// - appName
// - runMode-appName
// - runMode-role
// - runMode-tag
// - runMode-tag-role
// - runMode-appName-role
// - runMode-appName-tag
//
// All modifiers are appended for every item in the list like `runMode-network`, `runMode-appName-tag-region`,...
//
// The options takes the following properties:
//  - force - if true then force to refresh and reopen all db pools
//  - delta - if true then pull only records updated since the last config pull using the max mtime from received records.
//  - table - a table where to read the config parameters, default is bk_config
//
// **NOTE: The config parameters from the DB always take precedence even over config.local.**
//
// On return, the callback second argument will receive all parameters received form the database as a list: -name value ...
db.initConfig = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    // Refresh from time to time with new or modified parameters, randomize a little to spread across all servers.
    // Do not create/upgrade tables and indexes when reloading the config, this is to
    // avoid situations when maintenance is being done and any process reloading the config may
    // create indexes/columns which are not missing but being provisioned or changed.
    var interval = db.configInterval > 0 ? db.configInterval * 60000 + lib.randomShort() : 0;
    lib.deferInterval(this, interval, "config", this.initConfig.bind(this, interval ? options : null));
    lib.deferInterval(this, 60000, "refresh", this.refreshConfig.bind(this, options));

    this.getConfig(options, (err, rows) => {
        if (err) return lib.tryCall(callback, err, []);

        // Only keep the latest value, it is sorted in ascended order most specific at the end
        var argv = [];
        rows.forEach((x) => {
            db._configMtime = Math.max(db._configMtime || 0, x.mtime);
            argv.push('-' + x.name);
            if (x.value) argv.push(x.value);
            if (x.ttl > 0) {
                db.configRefresh[x.type+"|"+x.name] = x.ttl*1000 + Date.now();
            } else {
                delete db.configRefresh[x.type+"|"+x.name];
            }
        });
        core.parseArgs(argv, 0, "db");

        // Create or reconfigure db pools if needed
        db.init(options, (err) => {
            lib.tryCall(callback, err, argv);
        });
    });
}

// Return all config records for the given instance, the result will be sorted most relevant at the top
db.getConfig = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    // The order of the types here defines the priority of the parameters, most specific at the end always wins
    var types = [], _types = {};

    // All other entries in order of priority with all common prefixes
    var attrs = [ core.runMode, core.appName, core.runMode + "-" + core.appName ];
    var tags = lib.strSplitUnique(options?.tag || core.instance.tag);
    var roles = [options?.role || core.role].concat(this.configRoles);
    for (const tag of tags) {
        attrs.push(core.runMode + "-" + tag, core.runMode + "-" + core.appName + "-" + tag);
    }
    for (const role of roles) {
        attrs.push(core.runMode + "-" + role, core.runMode + "-" + core.appName + "-" + role);
        for (const tag of tags) attrs.push(core.runMode + "-" + tag + "-" + role);
    }
    var mods = [ options?.network || core.network, options?.region || core.instance.region];

    // Make sure we have only unique items in the list, skip empty or incomplete items
    for (let a of attrs) {
        if (!a) continue;
        a = String(a).trim();
        if (!a || a.endsWith("-") || _types[a]) continue;
        types.push(a);
        _types[a] = 1;
        for (let mod of mods) {
            if (!mod) continue;
            mod = a + "-" + mod;
            if (_types[mod]) continue;
            types.push(mod);
            _types[mod] = 1;
        }
    }

    var query = { type: types, status: "ok" };
    if (options?.name) query.name = options.name;
    if (options?.delta) query.mtime = this._configMtime;
    var opts = { ops: { type: "in", mtime: "gt" }, pool: options?.pool || this.config, count: this.configCount };
    var table = options?.table || "bk_config";

    logger.debug("getConfig:", query);
    this.select(table, query, opts, (err, rows) => {
        // Sort inside to be persistent across the databases
        if (!err) {
            var ver = lib.toVersion(core.appVersion);
            rows = rows.filter((x) => (lib.validVersion(ver, x.version))).
                        sort((a,b) => (types.indexOf(a.type) - types.indexOf(b.type) ||
                                       lib.toNumber(a.sort) - lib.toNumber(b.sort) ||
                                       a.ctime - b.ctime));
        }
        lib.tryCall(callback, err, rows);
    });
}

// Refresh parameters which are configured with a TTL
db.refreshConfig = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    var now = Date.now();
    var list = Object.keys(this.configRefresh).reduce((l, x) => {
        if (db.configRefresh[x] > 0 && db.configRefresh[x] <= now) {
            x = x.split("|");
            l.push({ type: x[0], name: x[1] });
        }
        return l;
    }, []);
    // Cleanup the LRU cache from time to time
    this.lru.clean();
    if (!list.length) return lib.tryCall(callback);

    var table = options?.table || "bk_config";
    var pool = options?.pool || this.config;
    this.list(table, list, { pool: pool }, (err, rows) => {
        var argv = rows.reduce((l, x) => {
            l.push('-' + x.name);
            if (x.value) l.push(x.value);
            if (x.ttl > 0) {
                db.configRefresh[x.type+"|"+x.name] = x.ttl*1000 + now;
            } else {
                delete db.configRefresh[x.type+"|"+x.name];
            }
            return l;
        }, []);
        core.parseArgs(argv, 0, "db");
        lib.tryCall(callback, err, argv);
    });
}
