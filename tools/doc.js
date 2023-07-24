//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Jan 2014
//

var marked = require("marked");
const fs = require('fs')
const path = require("path");
const bkjs = require('backendjs');
const lib = bkjs.lib;

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

var header = "", footer = "", renderer;

var name = bkjs.lib.getArg("-name", "Backendjs");

if (!lib.isArg("-nohdr")) {
    header =
`<head>
   <title>${name} Documentation</title>
   <link rel="shortcut icon" href="img/logo.png" type="image/png" />
   <link rel="icon" href="img/logo.png" type="image/png" />
   <link href="css/bootstrap.css" rel="stylesheet">
   <link rel="stylesheet" href="css/doc.css">
</head>
<body>
    <div class="container">
        <div class="d-flex justify-content-between align-items-center w-100 pb-4">
            <div><a href="/"><img class="logo" height=22 src="img/logo.png"></a>
                <span class="px-2">Backend library for Node.js</span>
            </div>
            <a href="${lib.getArg("-repo", "https://github.com/vseryakov/backendjs")}">[Repository]</a>
        </div>`;
    footer = "</div></body>";
}

var toc = `# ${name} Documentation\n\n## Table of contents\n\n`;

var readme = lib.isArg("-noreadme") ? "" : lib.readFileSync("README.md");
readme.split("\n").forEach((x) => {
    var d = x.match(/^([#]+) (.+)/);
    if (!d) return;
    d[2] = d[2].trim();
    for (var i = 0; i < d[1].length - 1; i++) toc += " ";
    toc += "* [ " + d[2] + "](#" + d[2].toLowerCase().replace(/[^\w]+/g, '-') + ")\n";
});

if (lib.isArg("-args")) {
    toc += "* [Configuration parameters](#configuration-parameters)\n";
}

toc += "* Javascript Modules\n";

var files = [];
bkjs.lib.strSplit(bkjs.lib.getArg("-dirs", "lib,modules")).forEach(readDir);

var skip = new RegExp(lib.getArg("-skip", "index.js$"));
files = files.filter((x) => (!skip.test(x))).sort()

if (lib.isArg("-md")) {
    header = footer = "";
    marked = { parse: (s) => (s) };
} else {
    marked.setOptions({ gfm: true, tables: true, breaks: false, pedantic: false, smartLists: true, smartypants: false });
    renderer = new marked.Renderer();
}

var mod, text = "";

files.forEach((file) => {
    var base = path.basename(file, '.js');
    if (/^[a-zA-Z0-9_]+\/[a-z0-9_-]+.js$/.test(file)) {
        mod = base;
        toc += "    * [" + base + "](#module-" + base + ")\n";
        text += marked.parse("## Module: " + mod + "\n\n", { renderer: renderer });
    }
    var doc = "", overview, submod;
    var data = fs.readFileSync(file).toString().split("\n");
    for (var i = 0; i < data.length; i++) {
        var line = data[i];
        if (!line) continue;

        // Comments
        var d = line.match(/^\/\//);
        if (d) {
            doc += " " + line.substr(2) + "\n";
            continue;
        }

        // Module overview
        d = line.match(/^(const|var) ([^ ]+)[ =]+{$|^function [^(]+\([^)]*\)$/);
        if (d && !overview) {
            // Check for submodule
            if (d[2] == "mod" && base != mod) {
                submod = base;
                toc += "    * [" + base + "](#module-" + base + ")\n";
                text += marked.parse("### Module: " + submod + "\n\n", { renderer: renderer });
            }
            text += marked.parse(doc, { renderer: renderer }) + "\n";
            doc = "";
            overview = 1;
            continue;
        }
        // Function
        d = line.match(/([^ =]+)[= ]+function([^{]+)/);
        if (d && doc) {
            if (d[1].match(skip)) continue;
            d = d[1] + d[2];
            if (mod || submod) {
                d = d.replace(/^mod\./, (submod || mod) + ".");
            }
            text += marked.parse("* `" + d + "`\n\n  " + doc, { renderer: renderer }) + "\n";
            doc = "";
            continue;
        }
        // Args
        d = line.match(/^ +args: \[$|^ +this.args = \[$|^ *core.describeArgs\(["']([a-z0-9_]+)["'],/);
        if (d) {
            let m = d[1] || submod || mod;
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
                doc += "    " + line.substr(4) + "\n";
            }
            // Precaution
            if (i < data.length) text += marked.parse(doc, { renderer: renderer }) + "\n";
            doc = "";
            continue;
        }
        doc = "";
    }
});

if (lib.isArg("-notoc")) toc = ""; else toc = marked.parse(toc + readme, { renderer: renderer });

console.log(header);
console.log(toc);
console.log(text);
console.log(footer);
process.exit(0);

