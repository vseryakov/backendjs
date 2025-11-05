//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

var util = require('util');
var core = require(__dirname + '/../lib/core');
var lib = require(__dirname + '/../lib/lib');
var db = require(__dirname + '/../lib/db');
var logger = require(__dirname + '/../lib/logger');

var pool = {
    name: "mysql",
    configOptions: {
        typesMap: { json: "text", bigint: "bigint", now: "bigint" },
        sqlPlaceholder: "?",
        defaultType: "VARCHAR(128)",
        noIfExists: 1,
        noMultiSQL: 1
    },
    createPool: function(options) { return new Pool(options); }
};
module.exports = pool;

db.modules.push(pool);

function Pool(options)
{
    var bkmysql = require("bkjs-mysql");
    if (!bkmysql.Database) {
        logger.error("MySQL driver is not installed or compiled properly, consider to install libmysqlclient library");
        return;
    }
    options.type = pool.name;
    db.SqlPool.call(this, options);
    this.configOptions = lib.objMerge(this.configOptions, pool.configOptions);
}
util.inherits(Pool, db.SqlPool);

Pool.prototype.open = function(callback)
{
    if (this.url == "default") this.url = "mysql:///" + db.dbName;
    var bkmysql = require("bkjs-mysql");
    new bkmysql.Database(this.url, function(err) {
        callback(err, this);
    });
}

Pool.prototype.close = function(client, callback)
{
    client.close(callback);
}

Pool.prototype.cacheIndexes = function(options, callback)
{
    var self = this;
    this.acquire(function(err, client) {
        if (err) return callback ? callback(err, []) : null;

        client.query("SHOW TABLES", function(err, tables) {
            lib.forEachSeries(tables, function(table, next) {
                table = table[Object.keys(table)[0]].toLowerCase();
                client.query("SHOW INDEX FROM " + table, function(err, rows) {
                    self.dbkeys = {};
                    self.dbindexes = {};
                    for (var i = 0; i < rows.length; i++) {
                        if (!self.dbcolumns[table]) continue;
                        var col = self.dbcolumns[table][rows[i].Column_name];
                        switch (rows[i].Key_name) {
                        case "PRIMARY":
                            if (!self.dbkeys[table]) self.dbkeys[table] = [];
                            self.dbkeys[table].push(rows[i].Column_name);
                            if (col) col.primary = true;
                            break;

                        default:
                            if (!self.dbindexes[rows[i].Key_name]) self.dbindexes[rows[i].Key_name] = [];
                            self.dbindexes[rows[i].Key_name].push(rows[i].Column_name);
                            break;
                        }
                    }
                    next();
                });
            }, function(err) {
                self.release(client);
                if (callback) callback(err);
            });
        });
    });
}

