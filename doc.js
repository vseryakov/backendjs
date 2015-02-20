//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Jan 2014
//

var fs = require('fs')
var path = require("path");
var marked = require("marked");
var bkjs = require('backendjs');

var files = fs.readdirSync(".").filter(function(x) { return fs.statSync(x).isFile() && ["index.js", "tests.js", "doc.js"].indexOf(x) == -1 && x.match(/\.js$/); });
files = files.concat(fs.readdirSync("lib/").filter(function(x) { return fs.statSync("lib/" + x).isFile() && x.match(/\.js$/); }).map(function(x) { return "lib/" + x }));
files = files.concat(fs.readdirSync("modules/").filter(function(x) { return fs.statSync("modules/" + x).isFile() && x.match(/\.js$/); }).map(function(x) { return "modules/" + x }));

marked.setOptions({ gfm: true, tables: true, breaks: false, pedantic: false, sanitize: true, smartLists: true, smartypants: false });

var renderer = new marked.Renderer();

var header = '<head><title>Backendjs Documentation</title><link rel="stylesheet" href="css/doc.css"></head><body class="pages">\n';
var toc = "# ![Backend](img/logo.png) Backendjs Documentation\n##Table of contents\n";

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
            text += marked("* `" + d[1] + d[2] + "`\n\n  " + doc, { renderer: renderer }) + "\n";
            doc = "";
            continue;
        }
        // Object
        d = line.match(/^var ([^ ]+)[ =]+{$/);
        if (d && doc) {
            text += marked("* `" + d[1] + "`\n\n  " + doc, { renderer: renderer }) + "\n";
            doc = "";
            continue;
        }
        // Tables
        d = line.match(/^    tables: {$/);
        if (d) {
            doc = "* `Database tables`\n\n";
            while (i < data.length) {
                var line = data[++i];
                if (line == "    }, // tables") break;
                doc += "    " + line + "\n";
            }
            // Precaution
            if (i < data.length) text += marked(doc, { renderer: renderer }) + "\n";
            doc = "";
        }
        doc = "";
    }
});

console.log(header + text + "</body>");
process.exit(0);

