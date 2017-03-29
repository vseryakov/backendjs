//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Jan 2017
//

var fs = require('fs')
var path = require("path");
var bkjs = require('backendjs');
var lib = bkjs.lib;

var paths = ["."];
for (var i = 2; i < process.argv.length; i++) {
    if (process.argv[i][0] != "-") paths.push(process.argv[i]);
}

var files = [];
for (var i in paths) {
    files = files.concat(lib.findFileSync(paths[i], { depth: 2, types: "f", include: /\.js$/, exclude: /(tools|tests)\// }))
}
var msgs = {};
var locale = {};
var lang = lib.getArg("-lang");
if (lang) locale = JSON.parse(fs.readFileSync("locales/" + lang + ".json"));

var rx = [
   /api.sendReply\(res,[ 0-9]+, ?"([^\"]+)"/,
   /message: ?"([^\"]+)"/,
   /[_ ]msg: ?"([^\"]+)"/,
   /__\("([^""]+)"/,
   /phrase: ?"([^\"]+)"/,
   /"([^\"@]*@[^\"@]+@[^\"]*)"/,
];
files.forEach(function(file) {
    var doc = "";
    var data = fs.readFileSync(file).toString().split("\n");
    for (var i = 0; i < data.length; i++) {
        var line = data[i].trim();
        if (!line || line[0] == "/") continue;
        // Skip config help
        if (/{ *name:.+descr:/.test(line)) continue;
        for (var j in rx) {
            var d = line.match(rx[j]);
            if (d) {
                // Single placeholder
                if (/^[^a-z]*@[a-z0-9_]+@[^a-z]*$/i.test(d[1])) continue;
                msgs[d[1]] = locale[d[1]] || "";
                break;
            }
        }
    }
});
console.log(JSON.stringify(msgs, null, " "));
process.exit(0);

