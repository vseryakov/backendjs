//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const { api } = require('backendjs');

const mod = {
    name: "bk_file",
};
module.exports = mod;

// Create API endpoints and routes
mod.configureWeb = function(options, callback)
{
    api.app.all(/^\/file\/([a-z]+)$/, function(req, res) {
        var query = api.toParams(req, {
            name: { required: 1 },
            prefix: { required: 1 },
        }, { query: 1 });
        if (typeof query == "string") return api.sendReply(res, 400, query);

        var file = query.prefix.replace("/", "") + "/" + query.name.replace("/", "");

        switch (req.params[0]) {
        case "get":
            api.files.send(req, file);
            break;

        case "put":
            api.files.put(req, "file", query, (err) => {
                api.sendReply(res, err);
            });
            break;

        case "del":
            api.files.del(file, (err) => {
                api.sendReply(res, err);
            });
            break;

        default:
            api.sendReply(res, 400, "Invalid command");
        }
    });

    callback();
}
