//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Jan 2018
//

const fs = require('fs')
const path = require("path");
const { lib } = require('backendjs');

function readDir(dir) {
    try {
        if (dir.endsWith("examples")) return;
        if (dir.slice(-1) !== "/") dir += "/";
        fs.readdirSync(dir).forEach((x) => {
            var fullPath = path.join(dir, x);
            var s = fs.statSync(fullPath);
            if (s.isFile() && x.slice(-3) === ".js") {
                files.push(fullPath);
            } else
            if (s.isDirectory()) {
                readDir(fullPath); // Recursive call for subdirectories
            }
        });
    } catch (e) {}
}
var files = [];
lib.strSplit(lib.getArg("-dirs", ".")).forEach(readDir);

var text = "";

files.forEach((file) => {
    if (process.argv.length > 2 && !file.match(process.argv[2])) return;
    var state, pos;
    var data = lib.readFileSync(file).split("\n");
    var name = "### " + file;

    for (let i = 0; i < data.length; i++) {
        var line = data[i];
        if (!line) continue;

        // express endpoint
        var d = line.match(/^ +api.app.(all|get|post)/);
        if (d) {
            text += "\n\n" + name + "\n\n`" + line.replace(/(^[^/]+|, (\(|function).+)/g, "").replace(/\\\//g, "/") + "`\n";
            state = 1;
            name = "";
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
            text += "  - " + line.replace(/case |['":]/g, "").trim() + "\n";
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

console.log(text.replace(/\n{3,}/g, "\n\n"));
process.exit(0);

