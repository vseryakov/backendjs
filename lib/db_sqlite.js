//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var path = require('path');
var core = require(__dirname + '/../core');
var lib = require(__dirname + '/../lib');
var db = require(__dirname + '/../db');
var logger = require(__dirname + '/../logger');
var bksqlite = require("bkjs-sqlite");

var pool = {
    name: "sqlite",
    settings: {
        typesMap: { bool: "int", },
        noLengths: 1,
        noMultiSQL: 1,
        temp_store: 0,
        busy_timeout: -1,
        read_uncommitted: true
    },
    createPool: function(options) { return new Pool(options); }
};
module.exports = pool;

db.modules.push(pool);

function Pool(options)
{
    options.settings = lib.mergeObj(pool.settings, options.settings);
    options.type = pool.name;
    db.SqlPool.call(this, options);
}
util.inherits(Pool, db.SqlPool);

Pool.prototype.open = function(callback)
{
    var self = this;
    var file = path.join(this.settings.path || core.path.spool, (this.url || core.name)  + ".db");
    new bksqlite.Database(file, this.settings.readonly ? bksqlite.OPEN_READONLY : 0, function(err) {
        if (err) {
            // Do not report errors about not existing databases
            if (err.code != "SQLITE_CANTOPEN" || !self.settings.silent) logger.error('open:', file, err);
            return callback(err);
        }
        var db = this;

        // Execute initial statements to setup the environment, like pragmas
        var opts = [];
        if (typeof self.settings.cache_size != "undefined") opts.push("PRAGMA cache_size=-" + self.settings.cache_size);
        if (typeof self.settings.temp_store != "undefined") opts.push("PRAGMA temp_store=" + self.settings.temp_store);
        if (typeof self.settings.journal_mode != "undefined") opts.push("PRAGMA journal_mode=" + self.settings.journal_mode);
        if (typeof self.settings.locking_mode != "undefined") opts.push("PRAGMA locking_mode=" + self.settings.locking_mode);
        if (typeof self.settings.synchronous != "undefined") opts.push("PRAGMA synchronous=" + self.settings.synchronous);
        if (typeof self.settings.read_uncommitted != "undefined") opts.push("PRAGMA read_uncommitted=" + self.settings.read_uncommitted);
        if (typeof self.settings.busy_timeout != "undefined") opts.push("SELECT busy_timeout(" + self.settings.busy_timeout + ")");
        lib.forEachSeries(opts, function(sql, next) {
            logger.debug('open:', file, sql);
            db.exec(sql, next);
        }, function(err) {
            if (err) logger.error('open:', file, err);
            callback(err, db);
        });
    });
}

Pool.prototype.close = function(client, callback)
{
    client.close(callback);
}

Pool.prototype.cacheColumns = function(options, callback)
{
    var self = this;

    this.acquire(function(err, client) {
        if (err) return callback(err, []);

        client.query("SELECT name FROM sqlite_master WHERE type='table'", function(err, tables) {
            if (err) return callback(err);
            lib.forEachSeries(tables, function(table, next) {

                client.query("PRAGMA table_info(" + table.name + ")", function(err, rows) {
                    if (err) return next(err);
                    for (var i = 0; i < rows.length; i++) {
                        if (!self.dbcolumns[table.name]) self.dbcolumns[table.name] = {};
                        if (!self.dbkeys[table.name]) self.dbkeys[table.name] = [];
                        // Split type cast and ignore some functions in default value expressions
                        var dflt = rows[i].dflt_value;
                        if (dflt && dflt[0] == "'" && dflt[dflt.length-1] == "'") dflt = dflt.substr(1, dflt.length-2);
                        self.dbcolumns[table.name][rows[i].name] = { id: rows[i].cid, name: rows[i].name, value: dflt, db_type: rows[i].type.toLowerCase(), data_type: rows[i].type, isnull: !rows[i].notnull, primary: rows[i].pk };
                        if (rows[i].pk) self.dbkeys[table.name].push(rows[i].name);
                    }
                    client.query("PRAGMA index_list(" + table.name + ")", function(err4, indexes) {
                        lib.forEachSeries(indexes, function(idx, next2) {
                            client.query("PRAGMA index_info(" + idx.name + ")", function(err5, cols) {
                                cols.forEach(function(x) {
                                    if (!self.dbcolumns[table.name]) self.dbcolumns[table.name] = {};
                                    if (!self.dbcolumns[table.name][x.name]) self.dbcolumns[table.name][x.name] = {};
                                    var col = self.dbcolumns[table.name][x.name];
                                    if (idx.unique) col.unique = 1;
                                    if (!self.dbindexes[idx.name]) self.dbindexes[idx.name] = [];
                                    self.dbindexes[idx.name].push(x.name);
                                });
                                next2();
                            });
                    }, function() {
                            next();
                        });
                    });
                });
            }, function(err) {
                self.release(client);
                callback(err);
            });
        });
    });
}

