//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Jan 2014
//

var fs = require('fs')
var path = require("path");
var marked = require("marked");
var bkjs = require('backendjs');

var skip = /tests\//;
var files = fs.readdirSync(".").filter((x) => (fs.statSync(x).isFile() && ["index.js", "doc.js"].indexOf(x) == -1 && x.match(/\.js$/)));
fs.readdirSync("lib/").forEach((x) => {
    var s = fs.statSync("lib/" + x);
    if (s.isFile() && x.slice(-3) == ".js") {
        files.push("lib/" + x);
    } else
    if (s.isDirectory()) {
        fs.readdirSync("lib/" + x).forEach((y) => {
            var s = fs.statSync("lib/" + x + "/" + y);
            if (s.isFile() && y.slice(-3) == ".js") files.push("lib/" + x + "/" + y);
        });
    }
});
files = files.concat(fs.readdirSync("modules/").filter((x) => (fs.statSync("modules/" + x).isFile() && x.match(/\.js$/))).map((x) => ("modules/" + x)));
files.sort();

marked.setOptions({ gfm: true, tables: true, breaks: false, pedantic: false, smartLists: true, smartypants: false });

var renderer = new marked.Renderer();

var header = '<head><title>Backendjs Documentation</title>' +
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

var toc = "# Backendjs Documentation\n## Table of contents\n";

var readme = fs.readFileSync("README.md").toString();

readme.split("\n").forEach(function(x) {
    var d = x.match(/^([#]+) (.+)/);
    if (!d) return;
    d[2] = d[2].trim();
    for (var i = 0; i < d[1].length - 1; i++) toc += " ";
    toc += "* [ " + d[2] + "](#" + d[2].toLowerCase().replace(/[^\w]+/g, '-') + ")\n";
});

toc += "* [Configuration parameters](#configuration-parameters)\n";
toc += "* Javascript API functions\n";

files.forEach(function(file) {
    if (/^(lib|modules)\/[a-z0-9_-]+.js$/.test(file)) {
        file = path.basename(file, '.js');
        toc += "    * [" + file + "](#module-" + file + ")\n";
    }
});

var text = marked.parse(toc, { renderer: renderer });

text += marked.parse(readme, { renderer: renderer });
text += marked.parse("## Configuration parameters\n", { renderer: renderer });
text += marked.parse(bkjs.core.showHelp({ markdown: 1 }), { renderer: renderer });

var base = "";

files.forEach(function(file) {
    if (/^(lib|modules)\/[a-z0-9_-]+.js$/.test(file)) base = file;
    var doc = "";
    var data = fs.readFileSync(file).toString().split("\n");
    if (base == file) {
        text += marked.parse("## Module: " + path.basename(file, '.js').toUpperCase() + "\n", { renderer: renderer });
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
            text += marked.parse("* `" + d[1] + d[2] + "`\n\n  " + doc, { renderer: renderer }) + "\n";
            doc = "";
            continue;
        }
        // Object
        d = line.match(/^var ([^ ]+)[ =]+{$/);
        if (d && doc) {
            if (d[1].match(skip)) continue;
            text += marked.parse("* `" + d[1] + "`\n\n  " + doc, { renderer: renderer }) + "\n";
            doc = "";
            continue;
        }
        // Tables
        d = line.match(/^ +tables: {$|^ *db.describeTables\(\{/);
        if (d) {
            doc = "* `Database tables`\n\n";
            while (i < data.length) {
                line = data[++i];
                if (line.match(/^ {4}\},|^ +\}\);$/)) break;
                doc += "    " + line + "\n";
            }
            // Precaution
            if (i < data.length) text += marked.parse(doc, { renderer: renderer }) + "\n";
            doc = "";
        }
        doc = "";
    }
});

console.log(header + text + "</div></body>");
process.exit(0);

