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
files.forEach(function(file) {
    file = path.basename(file, '.js');
    toc += "* [ Module: " + file + "](#" + "module-" + file + ")\n";
});

var text = marked(toc, { renderer: renderer });

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
        doc = "";
    }
});

console.log(header + text);
