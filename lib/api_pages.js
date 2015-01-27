//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var path = require('path');
var util = require('util');
var fs = require('fs');
var http = require('http');
var url = require('url');
var marked = require('marked');
var core = require(__dirname + '/../core');
var corelib = require(__dirname + '/../corelib');
var msg = require(__dirname + '/../msg');
var api = require(__dirname + '/../api');
var db = require(__dirname + '/../db');
var logger = require(__dirname + '/../logger');
var utils = require(__dirname + '/../build/Release/backend');

api.endpoints["pages"] = "initPagesAPI";

// API for wiki pages support
api.initPagesAPI = function()
{
    var self = this;

    if (!this.markedRenderer) {
        this.markedRenderer = new marked.Renderer();
    }

    this.app.all(/^\/pages\/([a-z]+)\/?(.+)?$/, function(req, res) {
        var options = api.getOptions(req);
        // Make sure we have the main page, create it lazily
        var page0 = { id: "1", title: core.appDescr || core.appName, pub: 1, icon: "glyphicon glyphicon-home", content: self.pagesMain || "## Welcome to the Wiki" };

        switch (req.params[0]) {
        case "file":
            if (!req.params[1]) return self.sendReply(res, 400, "file is required");
            var file = core.path.web + '/' + path.normalize(req.params[1]);
            fs.readFile(file, 'utf8', function(err, data) {
                if (err) return self.sendReply(res, err);
                self.sendPages(req, { id: req.params[1], content: data });
            })
            break;

        case "show":
            if (!req.params[1]) req.params[1] = "1";
            db.get("bk_pages", { id: req.params[1] }, options, function(err, row) {
                if (err) return self.sendReply(res, err);
                if (!row && req.params[1] == "1") row = page0;
                if (!req.account.id && !row.pub) return self.sendReply(res, 400, "Access to page denied");
                self.sendPages(req, row);
            });
            break;

        case "select":
            // Not logged in, return only public pages
            if (!req.account.id) req.query.pub = 1;
            options.noscan = 0;
            db.select("bk_pages", req.query, options, function(err, rows) {
                self.sendJSON(req, err, rows);
            });
            break;

        case "get":
            if (!req.params[1]) req.params[1] = "1";
            db.get("bk_pages", { id: req.params[1] }, options, function(err, row) {
                if (err) return self.sendReply(res, err);
                if (!row && req.params[1] == "1") row = page0;
                if (!row) return self.sendReply(res, 404, "no page found");
                if (!req.account.id && !row.pub) return self.sendReply(res, 400, "Access to page denied");
                row.render = corelib.toBool(req.query._render);
                self.sendJSON(req, err, self.preparePages(row));
            });
            break;

        case "put":
            if (!req.query.title) return self.sendReply(res, 400, "title is required");
            if (!req.query.content && !req.query.link) return self.sendReply(res, 400, "link or content is required");
            req.query.id = req.params[1] || corelib.uuid();
            req.query.userid = req.account.id;
            db.put("bk_pages", req.query, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        case "del":
            if (!req.params[1]) return self.sendReply(res, 400, "id is required");
            db.put("bk_pages", { id: req.params[1] }, options, function(err, data) {
                self.sendJSON(req, err, data);
            });
            break;

        default:
            self.sendReply(res, 400, "invalid command");
        }
    });
};

// Prepare a markdown page, the following properties can be used in the options:
//  - content - the markdown contents
//  - title - tile to be rendered, this will be discovered by taking first # heading if not set
//  - subtitle - subtitle or short description
//  - toc - if not empty, then it is replaced with the table of contents by collecting all heading tags, i.e #
//  - id - id or file name, if no title is specified or discovered it will be used as a title
//  - render - if true render into html, otherwise return just markdown
api.preparePages = function(options)
{
    var self = this;
    var pages = { title: "", subtitle: "", toc: "", content: "", id: "" };
    for (var p in options) pages[p] = options[p];
    var toc = "";
    if (pages.toc || !pages.title) {
        String(pages.content || "").split("\n").forEach(function(x) {
            var d = x.match(/^([#]+) (.+)/);
            if (!d) return;
            d[2] = d[2].trim();
            if (pages.toc) {
                if (!toc) op = "#"; else op = '*', toc += " ";
                for (var i = 0; i < d[1].length - 1; i++) toc += " ";
                toc += op + " [ " + d[2] + "](#" + d[2].toLowerCase().replace(/[^\w]+/g, '-') + ")\n";
            }
            if (!pages.title && d[1].trim() == "#") pages.title = d[2];
        });
    }
    pages.toc = toc;
    pages.title = pages.title || path.basename(pages.id || "");
    if (pages.render) {
        pages.toc = marked(pages.toc || "", { renderer: this.markedRenderer });
        pages.subtitle = marked(pages.subtitle || "", { renderer: this.markedRenderer });
        pages.content = marked(pages.content || "", { renderer: this.markedRenderer });
    }
    return pages
}

// Send rendered markdown to the client response
api.sendPages = function(req, options)
{
    var pages = this.preparePages(corelib.extendObj(options, 'render', 1));
    req.res.render(this.pagesView, { pages: pages });
}
