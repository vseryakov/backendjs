//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var core = require(__dirname + '/../core');
var lib = require(__dirname + '/../lib');
var db = require(__dirname + '/../db');
var logger = require(__dirname + '/../logger');
try {
    var bkmysql = require("bkjs-mysql");
} catch(e) {
    var bkmysql = {};
}

var pool = {
    name: "mysql",
    settings: {
        typesMap: { json: "text", bigint: "bigint" },
        sqlPlaceholder: "?",
        defaultType: "VARCHAR(128)",
        noIfExists: 1,
        noJson: 1,
        noMultiSQL: 1
    },
    createPool: function(options) { return new Pool(options); }
};
module.exports = pool;

db.modules.push(pool);

function Pool(options)
{
    if (!bkmysql.Database) {
        logger.error("MySQL driver is not installed or compiled properly, consider to install libmysqlclient library");
        return;
    }
    options.settings = lib.mergeObj(pool.settings, options.settings);
    options.type = pool.name;
    db.SqlPool.call(this, options);
}
util.inherits(Pool, db.SqlPool);

Pool.prototype.open = function(callback)
{
    if (this.url == "default") this.url = "mysql:///" + db.dbName;
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

        self.dbkeys = {};
        self.dbindexes = {};
        client.query("SHOW TABLES", function(err, tables) {
            lib.forEachSeries(tables, function(table, next) {
                table = table[Object.keys(table)[0]].toLowerCase();
                client.query("SHOW INDEX FROM " + table, function(err, rows) {
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

