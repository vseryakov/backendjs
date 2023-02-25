//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Jan 2014
//

var fs = require('fs')
var path = require("path");
var marked = require("marked");
var bkjs = require('backendjs');

function readDir(dir)
{
    if (dir.slice(-1) != "/") dir += "/";
    fs.readdirSync(dir).forEach((x) => {
        var s = fs.statSync(dir + x);
        if (s.isFile() && x.slice(-3) == ".js") {
            files.push(dir + x);
        } else
        if (s.isDirectory()) {
            fs.readdirSync(dir + x).forEach((y) => {
                var s = fs.statSync(dir + x + "/" + y);
                if (s.isFile() && y.slice(-3) == ".js") {
                    files.push(dir + x + "/" + y);
                }
            });
        }
    });
}

var dirs = bkjs.lib.strSplit(bkjs.lib.getArg("-dirs", "lib,modules"));

var files = [];
for (const d of dirs) readDir(d);

var skip = new RegExp(bkjs.lib.getArg("-skip", "index.js$"));

files = files.filter((x) => (!skip.test(x))).sort();

var name = bkjs.lib.getArg("-name", "Backendjs");

var header = `<head><title>${name} Documentation</title>` +
        '<link rel="shortcut icon" href="img/logo.png" type="image/png" />' +
        '<link rel="icon" href="img/logo.png" type="image/png" />' +
        '<script src="js/jquery.js"></script>' +
        '<link href="css/bootstrap.css" rel="stylesheet">' +
        '<script src="js/bootstrap.js"></script>' +
        '<link rel="stylesheet" href="css/doc.css">' +
        '<link href="css/font-awesome.css" rel="stylesheet">' +
        '</head>' +
        '<body>\n' +
        '<div class="container">' +
        '<nav class="navbar navbar-expand-lg navbar-light">' +
        '<div class="navbar-brand">' +
        '<a href="/"><img class="logo" src="img/logo.png"></a>' +
        '<span>Backend library for Node.js</span>' +
        '</div>' +
        '<button class="navbar-toggler" type="button" data-toggle="collapse" data-target="#navbar" aria-controls="navbar" aria-expanded="false" aria-label="Toggle navigation">' +
        '<span class="navbar-toggler-icon"></span>' +
        '</button>' +
        '<div id="navbar" class="navbar-collapse collapse">' +
        '<ul class="navbar-nav">' +
        '<li><a class="nav-link" href="doc.html"><i class="fa fa-gears fa-fw"></i> Documentation</a></li>' +
        '<li><a class="nav-link" href="http://github.com/vseryakov/backendjs"><i class="fa fa-github fa-fw"></i> Github</a><li>' +
        '</ul>' +
        '</div>' +
        '</nav>';

var toc = `# ${name} Documentation\n## Table of contents\n`;

var readme = fs.readFileSync("README.md").toString();

readme.split("\n").forEach((x) => {
    var d = x.match(/^([#]+) (.+)/);
    if (!d) return;
    d[2] = d[2].trim();
    for (var i = 0; i < d[1].length - 1; i++) toc += " ";
    toc += "* [ " + d[2] + "](#" + d[2].toLowerCase().replace(/[^\w]+/g, '-') + ")\n";
});

if (bkjs.lib.isArg("-args")) {
    toc += "* [Configuration parameters](#configuration-parameters)\n";
}

toc += "* Javascript Modules\n";

files.forEach((file) => {
    if (/^[a-zA-Z0-9_]+\/[a-z0-9_-]+.js$/.test(file)) {
        file = path.basename(file, '.js');
        toc += "    * [" + file + "](#module-" + file + ")\n";
    }
});

marked.setOptions({ gfm: true, tables: true, breaks: false, pedantic: false, smartLists: true, smartypants: false });

var renderer = new marked.Renderer();

var text = marked.parse(toc, { renderer: renderer });

text += marked.parse(readme, { renderer: renderer });

if (bkjs.lib.isArg("-args")) {
    text += marked.parse("## Configuration parameters\n", { renderer: renderer });
    text += marked.parse(bkjs.core.showHelp({ markdown: 1 }), { renderer: renderer });
}

var base = "", mod;

files.forEach((file) => {
    if (/^[a-zA-Z0-9_]+\/[a-z0-9_-]+.js$/.test(file)) base = file;
    var doc = "";
    var data = fs.readFileSync(file).toString().split("\n");
    if (base == file) {
        mod = path.basename(file, '.js');
        text += marked.parse("## Module: " + mod + "\n", { renderer: renderer });
    }
    for (var i = 0; i < data.length; i++) {
        var line = data[i];
        if (!line) continue;

        // Comments
        var d = line.match(/^\/\//);
        if (d) {
            doc += " " + line.substr(2) + "\n";
            continue;
        }
        // Function
        d = line.match(/([^ =]+)[= ]+function([^{]+)/);
        if (d && doc) {
            if (d[1].match(skip)) continue;
            d = d[1] + d[2];
            if (mod) {
                d = d.replace(/^mod\./, mod +".");
            }
            text += marked.parse("* `" + d + "`\n\n  " + doc, { renderer: renderer }) + "\n";
            doc = "";
            continue;
        }
        // Args
        d = line.match(/^ +args: \[$|^ +this.args = \[$|^ *core.describeArgs\(["']([a-z0-9_]+)["'],/);
        if (d) {
            let m = d[1] || mod;
            m = m == "core" ? "" : m + "-";
            doc = "* `Config parameters`\n\n";
            while (i < data.length) {
                line = data[++i];
                if (!line || line.match(/^ *\]\)?[,;]$/)) break;
                doc += "   - " + line.replace(/^ *\{|\},/g, "").replace(/name: *"([^"]+)"/g, `\`${m}$1\``).trim() + "\n";
            }
            // Precaution
            if (i < data.length) text += marked.parse(doc, { renderer: renderer }) + "\n";
            doc = "";
            continue;
        }
        // Tables
        d = line.match(/^ +tables: {$|^ *db.describeTables\(\{/);
        if (d) {
            doc = "* `Database tables`\n\n";
            while (i < data.length) {
                line = data[++i];
                if (!line || line.match(/^ {4}\},|^ +\}\);$/)) break;
                doc += "    " + line + "\n";
            }
            // Precaution
            if (i < data.length) text += marked.parse(doc, { renderer: renderer }) + "\n";
            doc = "";
            continue;
        }
        doc = "";
    }
});

console.log(header + text + "</div></body>");
process.exit(0);

