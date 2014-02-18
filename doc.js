//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Jan 2014
//

var fs = require('fs')
var path = require("path");
var marked = require("marked");

var files = fs.readdirSync(".").filter(function(x) { return fs.statSync(x).isFile() && ["index.js", "tests.js", "doc.js"].indexOf(x) == -1 && x.match(/\.js$/); });

marked.setOptions({ gfm: true, tables: true, breaks: false, pedantic: false, sanitize: true, smartLists: true, smartypants: false });

var renderer = new marked.Renderer();

var header = '<head><title>Backend Documentation</title><link rel="stylesheet" href="css/doc.css"></head>\n';
var toc = "# Backend Documentation\n##Table of contents:\n";

var readme = fs.readFileSync("README.md").toString();

readme.split("\n").forEach(function(x) {
    var d = x.match(/^# (.+)/);
    if (d) toc += "* [ " + d[1] + "](#" + d[1].toLowerCase().replace(/[^\w]+/g, '-') + ")\n";
});

toc += "* Javascript API functions\n";

files.forEach(function(file) {
    file = path.basename(file, '.js');
    toc += "    * [" + file + "](#" + "module-" + file + ")\n";
});

var text = marked(toc, { renderer: renderer });

text += marked(readme, { renderer: renderer });

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
            while(1) {
                var line = data[++i];
                if (line == "    }, // tables") break;
                doc += "    " + line + "\n";
            }
            text += marked(doc, { renderer: renderer }) + "\n";
            doc = "";
        }
        doc = "";
    }
});

console.log(header + text);
