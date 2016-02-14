//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Jan 2014
//

var fs = require('fs')
var path = require("path");
var marked = require("marked");
var bkjs = require('backendjs');

var skip = /tests\//;
var files = fs.readdirSync(".").filter(function(x) { return fs.statSync(x).isFile() && ["index.js", "doc.js"].indexOf(x) == -1 && x.match(/\.js$/); });
files = files.concat(fs.readdirSync("lib/").filter(function(x) { return fs.statSync("lib/" + x).isFile() && x.match(/\.js$/); }).map(function(x) { return "lib/" + x }));
files = files.concat(fs.readdirSync("modules/").filter(function(x) { return fs.statSync("modules/" + x).isFile() && x.match(/\.js$/); }).map(function(x) { return "modules/" + x }));

marked.setOptions({ gfm: true, tables: true, breaks: false, pedantic: false, sanitize: true, smartLists: true, smartypants: false });

var renderer = new marked.Renderer();

var header = '<head><title>Backendjs Documentation</title>' +
        '<link rel="shortcut icon" href="img/logo.png" type="image/png" />' +
        '<link rel="icon" href="img/logo.png" type="image/png" />' +
        '<link href="css/font-awesome.css" rel="stylesheet">' +
        '<script src="js/jquery.js"></script>' +
        '<link href="css/bootstrap.css" rel="stylesheet">' +
        '<script src="js/bootstrap.js"></script>' +
        '<link rel="stylesheet" href="css/doc.css">' +
        '</head>' +
        '<body class="pages">\n' +
        '<div class="container">' +
        '<nav class="navbar">' +
        '<div class="container-fluid">' +
        '<div class="navbar-header">' +
        '<button type="button" class="navbar-toggle collapsed" data-toggle="collapse" data-target="#navbar" aria-expanded="false" aria-controls="navbar">' +
        '<span class="sr-only">Toggle navigation</span>' +
        '<span class="icon-bar"></span>' +
        '<span class="icon-bar"></span>' +
        '<span class="icon-bar"></span>' +
        '</button>' +
        '<a href="/"><img class="logo" style="max-height:30px;" src="img/logo.png"></a>' +
        '<span>Backendjs Documentation</span>' +
        '</div>' +
        '<div id="navbar" class="navbar-collapse collapse">' +
        '<ul class="nav navbar-nav navbar-right">' +
        '<li><a href="/"><span class="fa fa-gears fa-fw"></span> Home</a></li>' +
        '<li><a href="http://github.com/vseryakov/backendjs"><span class="fa fa-github fa-fw"></span> Github</a><li>' +
        '</ul>' +
        '</div>' +
        '</div>' +
        '</nav>';

var toc = "# Backendjs Documentation\n##Table of contents\n";

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
    file = path.basename(file, '.js');
    toc += "    * [" + file + "](#" + "module-" + file + ")\n";
});

var text = marked(toc, { renderer: renderer });

text += marked(readme, { renderer: renderer });
text += marked("## Configuration parameters\n", { renderer: renderer });
text += marked(bkjs.core.showHelp({markdown:1}), { renderer: renderer });

files.forEach(function(file) {
    var doc = "";
    var data = fs.readFileSync(file).toString().split("\n");
    text += marked("## Module: " + path.basename(file, '.js').toUpperCase() + "\n", { renderer: renderer });
    for (var i = 0; i < data.length; i++) {
        var line = data[i];
        if (!line) continue;

        // Comments
        var d = line.match(/^\/\//);
        if (d) {
            doc += line.substr(2) + "\n";
            continue;
        }
        // Function
        d = line.match(/([^ =]+)[= ]+function([^{]+)/);
        if (d && doc) {
            if (d[1].match(skip)) continue;
            text += marked("* `" + d[1] + d[2] + "`\n\n  " + doc, { renderer: renderer }) + "\n";
            doc = "";
            continue;
        }
        // Object
        d = line.match(/^var ([^ ]+)[ =]+{$/);
        if (d && doc) {
            if (d[1].match(skip)) continue;
            text += marked("* `" + d[1] + "`\n\n  " + doc, { renderer: renderer }) + "\n";
            doc = "";
            continue;
        }
        // Tables
        d = line.match(/^ +tables: {$|^ *db.describeTables\(\{/);
        if (d) {
            doc = "* `Database tables`\n\n";
            while (i < data.length) {
                var line = data[++i];
                if (line.match(/\}, \/\/ tables$|^ +}\);$/)) break;
                doc += "    " + line + "\n";
            }
            // Precaution
            if (i < data.length) text += marked(doc, { renderer: renderer }) + "\n";
            doc = "";
        }
        doc = "";
    }
});

console.log(header + text + "</div></body>");
process.exit(0);

