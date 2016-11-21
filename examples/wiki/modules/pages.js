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
var bkjs = require('backendjs');
var db = bkjs.db;
var api = bkjs.api;
var app = bkjs.app;
var ipc = bkjs.ipc;
var msg = bkjs.msg;
var core = bkjs.core;
var lib = bkjs.lib;
var logger = bkjs.logger;

// Wiki pages management
var pages = {
    name: "pages",
    view: "pages.html",
    tables: {
       bk_pages: { 
          id: { primary: 1, pub: 1 },
          title: { pub: 1 },
          subtitle: { pub: 1 },
          icon: { pub: 1 },                            // icon class, glyphicon, fa....
          link: { pub: 1 },                            // external link to the content
          content: { pub: 1 },                         // the page content
          toc: { type:" bool", pub: 1 },               // produce table of content
          pub: { type: "bool", pub: 1 },               // no account to see thos page
          userid: { pub: 1 },                          // id of the last user
          mtime: { type: "now", pub: 1 }
       },
    },
};
module.exports = pages;

// Initialize the module
pages.init = function(options)
{
    core.describeArgs("pages", [
         { name: "view", descr: "A view template to be used when rendering markdown pages using Express render engine, for /pages/show command and .md files" },
         { name: "main", descr: "A template for the main page to be created when starting the wiki engine for the first time, if not given a default simple welcome message will be used" },
    ]);
}

// Create API endpoints and routes
pages.configureWeb = function(options, callback)
{
    this.configurePagesAPI();
    callback()
}

// API for wiki pages support
pages.configurePagesAPI = function()
{
    var self = this;

    if (!this.markedRenderer) {
        this.markedRenderer = new marked.Renderer();
    }

    api.app.all(/^\/pages\/([a-z]+)\/?(.+)?$/, function(req, res) {
        var options = api.getOptions(req);
        // Make sure we have the main page, create it lazily
        var page0 = { id: "1", title: core.appDescr || core.appName, pub: 1, icon: "glyphicon glyphicon-home", content: self.main || "## Welcome to the Wiki" };

        switch (req.params[0]) {
        case "file":
            if (!req.params[1]) return api.sendReply(res, 400, "file is required");
            var file = core.path.web + '/' + path.normalize(req.params[1]);
            fs.readFile(file, 'utf8', function(err, data) {
                if (err) return api.sendReply(res, err);
                self.sendPages(req, { id: req.params[1], content: data });
            })
            break;

        case "show":
            if (!req.params[1]) req.params[1] = "1";
            db.get("bk_pages", { id: req.params[1] }, options, function(err, row) {
                if (err) return api.sendReply(res, err);
                if (!row && req.params[1] == "1") row = page0;
                if (!req.account.id && !row.pub) return api.sendReply(res, 400, "Access to page denied");
                self.sendPages(req, row);
            });
            break;

        case "select":
            // Not logged in, return only public pages
            if (!req.account.id) req.query.pub = 1;
            options.noscan = 0;
            db.select("bk_pages", req.query, options, function(err, rows) {
                api.sendJSON(req, err, rows);
            });
            break;

        case "get":
            if (!req.params[1]) req.params[1] = "1";
            db.get("bk_pages", { id: req.params[1] }, options, function(err, row) {
                if (err) return api.sendReply(res, err);
                if (!row && req.params[1] == "1") row = page0;
                if (!row) return api.sendReply(res, 404, "no page found");
                if (!req.account.id && !row.pub) return api.sendReply(res, 400, "Access to page denied");
                row.render = lib.toBool(req.query._render);
                api.sendJSON(req, err, self.preparePages(row));
            });
            break;

        case "put":
            if (!req.query.title) return api.sendReply(res, 400, "title is required");
            if (!req.query.content && !req.query.link) return api.sendReply(res, 400, "link or content is required");
            req.query.id = req.params[1] || lib.uuid();
            req.query.userid = req.account.id;
            db.put("bk_pages", req.query, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        case "del":
            if (!req.params[1]) return api.sendReply(res, 400, "id is required");
            db.put("bk_pages", { id: req.params[1] }, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        default:
            api.sendReply(res, 400, "invalid command");
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
pages.preparePages = function(options)
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
    return pages;
}

// Send rendered markdown to the client response
pages.sendPages = function(req, options)
{
    req.res.render(this.view, { pages: this.preparePages(lib.objExtend(options, 'render', 1)) });
}
