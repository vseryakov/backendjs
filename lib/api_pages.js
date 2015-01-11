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
var msg = require(__dirname + '/../msg');
var api = require(__dirname + '/../api');
var logger = require(__dirname + '/../logger');
var utils = require(__dirname + '/../build/Release/backend');

api.endpoints["pages"] = "initPagesAPI";

// API for wiki pages support
api.initPagesAPI = function()
{
    var self = this;
    var db = core.modules.db;

    this.app.all(/^\/pages\/([a-z]+)\/?([a-z0-9]+)?$/, function(req, res) {
        var options = api.getOptions(req);

        switch (req.params[0]) {
        case "show":
            db.get("bk_pages", { id: req.params[1] }, options, function(err, row) {
                if (err) return self.sendReply(res, err);
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
            db.get("bk_pages", { id: req.params[1] || "1" }, options, function(err, row) {
                if (err) return self.sendReply(res, err);
                if (!row) return self.sendReply(res, 404, "no page found");
                if (!req.account.id && !row.pub) return self.sendReply(res, 400, "Access to page denied");
                row.render = core.toBool(req.query._render);
                self.sendJSON(req, err, self.preparePages(row));
            });
            break;

        case "put":
            if (!req.query.title) return self.sendReply(res, 400, "title is required");
            if (!req.query.content && !req.query.link) return self.sendReply(res, 400, "link or content is required");
            if (!req.query.id) req.query.id = core.uuid();
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

    // Make sure we have the main page
    db.get("bk_pages", { id: "1" }, function(err, row) {
        if (!row) db.put("bk_pages", { id: "1", title: core.appDescr || core.appName, pub: 1, icon: "glyphicon glyphicon-home", content: self.pagesMain || "## Welcome to the Wiki" });
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
                for (var i = 0; i < d[1].length - 1; i++) toc += " ";
                toc += "* [ " + d[2] + "](#" + d[2].toLowerCase().replace(/[^\w]+/g, '-') + ")\n";
            }
            if (!pages.title && d[1].trim() == "#") pages.title = d[2];
        });
    }
    pages.toc = toc;
    pages.title = pages.title || path.basename(pages.id || "");
    if (pages.render) {
        if (!this.markedRenderer) {
            this.markedRenderer = new marked.Renderer();
            this.markedLink = this.markedRenderer.link;
            // Just handle pages links, let marked to handle the output
            this.markedRenderer.link = function(href, title, text) {
                if (href && href.match(/[0-9a-z]+/)) href = "/pages/show/" + href;
                return self.markedLink.call(self.markedRenderer, href, title, text);
            }
        }
        pages.toc = marked(pages.toc || "", { renderer: this.markedRenderer });
        pages.subtitle = marked(pages.subtitle || "", { renderer: this.markedRenderer });
        pages.content = marked(pages.content || "", { renderer: this.markedRenderer });
    }
    return pages
}

// Send rendered markdown to the client response
api.sendPages = function(req, options)
{
    var pages = this.preparePages(core.extendObj(options, 'render', 1));
    req.res.render(this.pagesView, { pages: pages });
}
