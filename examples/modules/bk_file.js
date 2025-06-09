//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const { api } = require('backendjs');

var files = {
    name: "bk_file",
};
module.exports = files;

// Create API endpoints and routes
files.configureWeb = function(options, callback)
{
    api.app.all(/^\/file\/([a-z]+)$/, function(req, res) {
        var options = api.getOptions(req);

        if (!req.query.name) return api.sendReply(res, 400, "name is required");
        if (!req.query.prefix) return api.sendReply(res, 400, "prefix is required");
        var file = req.query.prefix.replace("/", "") + "/" + req.query.name.replace("/", "");
        if (options.tm) file += options.tm;

        switch (req.params[0]) {
        case "get":
            api.files.send(req, file, options);
            break;

        case "add":
        case "put":
            options.name = req.query.name;
            options.prefix = req.query.prefix;
            api.files.put(req, req.query._name || "data", options, function(err) {
                api.sendReply(res, err);
            });
            break;

        case "del":
            api.files.del(file, options, function(err) {
                api.sendReply(res, err);
            });
            break;

        default:
            api.sendReply(res, 400, "Invalid command");
        }
    });

    callback();
}
