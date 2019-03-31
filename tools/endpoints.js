//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Jan 2018
//

var fs = require('fs')
var path = require("path");

var files = fs.readdirSync(".").filter(function(x) { return fs.statSync(x).isFile() && x.match(/\.js$/); });
files = files.concat(fs.readdirSync("lib/").filter(function(x) { return fs.statSync("lib/" + x).isFile() && x.match(/\.js$/); }).map(function(x) { return "lib/" + x }));
files = files.concat(fs.readdirSync("modules/").filter(function(x) { return fs.statSync("modules/" + x).isFile() && x.match(/\.js$/); }).map(function(x) { return "modules/" + x }));

var text = "";

files.forEach(function(file) {
    if (process.argv.length > 2 && !file.match(process.argv[2])) return;
    var state, pos;
    var data = fs.readFileSync(file).toString().split("\n");
    for (var i = 0; i < data.length; i++) {
        var line = data[i];
        if (!line) continue;

        // express endpoint
        var d = line.match(/^ +api.app.(all|get|post)/);
        if (d) {
            text += "\n" + path.basename(file, '.js') + "\n  " + line.replace(/(^[^/]+|, function.+)/g, "").replace(/\\\//g, "/") + "\n    ";
            state = 1;
            continue;
        }
        // switch
        d = line.match(/^( +)switch \((req.params|cmd)/);
        if (d && state == 1) {
            state = 2;
            pos = d[1].length;
            continue;
        }
        // other switch
        d = line.match(/^( +)switch \(/);
        if (d && state == 2) {
            state = d[1].length;
            continue;
        }
        // end switch
        d = line.match(/^( +)}$/);
        if (d && state > 2 && state == d[1].length) {
            state = 2;
            continue;
        }
        // case
        d = line.match(/^ +case ["']/);
        if (d && state == 2) {
            text += line.replace(/case |['":]/g, "").trim() + " ";
            continue;
        }
        // default, end of switch
        d = line.match(/^( +)default:/);
        if (d && state && pos == d[1].length) {
            state = 0;
            text += "\n";
        }
        d = line.match(/^[a-zA-Z0-9._] = function/);
        if (d && state) {
            state = 0;
            text += "\n";
        }
    }
});

console.log(text);
process.exit(0);

