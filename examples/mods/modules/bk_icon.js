//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const bkjs = require('backendjs');
const db = bkjs.db;
const api = bkjs.api;
const lib = bkjs.lib;

// Icons management
const mod = {
    name: "bk_icon",
    tables: {
        bk_icon: {
            id: { primary: 1 },                         // account id
            type: {                                     // prefix:type
                primary: 1,
                pub: 1,
                join: [ "prefix", "type" ],
                unjoin: 1,
                separator: ":",
                ops: { select: "begins_with" }
            },
            prefix: {},                                 // icon prefix/namespace
            descr: { pub: 1 },                          // user provided caption
            tags: { type: "list" },                     // detected or attached tags
            width: { type: "int" },
            height: { type: "int" },
            rotation: { type: "int" },                  // rotation angle
            ext: {},                                    // saved image extension
            latitude: { type: "real" },
            longitude: { type: "real" },
            mtime: { type: "now" },
        },
    },
};
module.exports = mod;

// Create API endpoints and routes
mod.configureWeb = function(options, callback)
{
    this.configureIconsAPI();
    callback()
}

// Generic icon management
mod.configureIconsAPI = function()
{
    api.app.all(/^\/icon\/([a-z]+)$/, function(req, res) {
        var options = api.getOptions(req);
        options.cleanup = "bk_icon";

        if (!req.query.prefix) return api.sendReply(res, 400, "prefix is required");
        if (!req.query.id) req.query.id = req.account.id;
        if (!req.query.type) req.query.type = "";

        switch (req.params[0]) {
        case "get":
            db.get("bk_icon", { id: req.query.id, type: req.query.type, prefix: req.query.prefix }, (err, row) => {
                if (err || !row) return api.sendReply(req.res, err || 404);
                api.sendIcon(req, row.id, row);
            });
            break;

        case "select":
            mod.select(req.query, options, (err, rows) => {
                api.sendJSON(req, err, rows);
            });
            break;

        case "put":
            mod.upload(req, options, (err, rows) => {
                api.sendJSON(req, err, rows);
            });
            break;

        case "del":
            mod.del(req.query, options, (err) => {
                api.sendJSON(req, err);
            });
            break;

        case "upload":
            req.query.autodel = 1;
            api.putIcon(req, req.account.id, req.query, (err, icon, info) => {
                if (info) {
                    info.id = req.account.id;
                    info.prefix = req.query.prefix;
                    info.type = req.query.type;
                    info.url = api.iconUrl(info, options);
                }
                api.sendJSON(req, err, info);
            });
            break;

        default:
            api.sendReply(res, 400, "Invalid command");
        }
    });

}

// Process icon upload request, update table and deal with the actual image data, always overwrite the icon file
mod.upload = function(req, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    req.query.id = req.query.id || req.account.id;
    req.query.prefix = req.query.prefix || "account";
    req.query.type = req.query.type || "";
    if (typeof req.query.autodel == "undefined") req.query.autodel = 1;

    api.putIcon(req, req.query.name || "icon", req.query.id, req.query, (err, icon, info) => {
        if (err || !icon) return lib.tryCall(callback, err || { status: 400, message: "Upload error" });
        for (const p in info) req.query[p] = info[p];
        db.put("bk_icon", req.query, callback);
    });
}

mod.get = function(query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    db.get("bk_icon", { id: query.id, type: query.type, prefix: query.prefix }, options, callback);
}

mod.put = function(query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    db.put("bk_icon", query, options, callback);
}

// Return list of icons for the account, used in /icon/get API call
mod.select = function(query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!query.id) return callback({ status: 400, message: "no id provided" })
    db.select("bk_icon", { id: query.id, type: query.type, prefix: query.prefix }, options || query, callback);
}

// Delete an icon, only one icon at a time, options must profile id, prefix. It will try to delete
// an icon file even if there is no record in the bk_icon table.
mod.del = function(query, callback)
{
    if (!query.id) return lib.tryCall(callback, { status: 400, message: "no id provided" })
    if (!query.prefix) return lib.tryCall(callback, { status: 400, message: "no prefix provided" })
    db.del("bk_icon", query, { returning: "*", first: 1 }, (err, row) => {
        if (err || !row) return lib.tryCall(callback, err || { status: 404, message: "not found" });
        api.delIcon(query.id, row, callback);
    });
}

mod.bkDeleteAccount = function(req, callback)
{
    if (lib.isFlag(req.options.keep, ["all","account","bk_icon"])) return callback();
    db.delAll("bk_icon", { id: req.account.id }, { delCollect: 1 }, (err, rows) => {
        if (lib.isFlag(req.options.keep, ["all","account","images"])) return callback();
        // Delete all image files
        lib.forEachSeries(rows, (row, next) => {
            api.delIcon(req.account.id, row, () => (next()));
        }, callback);
    });
}
