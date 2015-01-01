//
// Vlad Seryakov 20014
//

var self = Backendjs;
self.session = true;
self.auth = ko.observable(0);
self.query = ko.observable("");
self.rows = [];
self.row0 = { type: "", name: "", value: "" }
self.row = ko.mapping.fromJS(self.row0);
self.openNodes = {};

self.query.subscribe(function(val) {
    self.openNodes();
    self.doFilter();
});

self.saveNodes = function()
{
    self.openNodes = {};
    $('#config-tree').treeview("getNodes").forEach(function(x) {
        if (x.id && x._open) self.openNodes[x.id] = 1;
    });
}

self.openNodes = function()
{
    $('#config-tree').treeview("getNodes").forEach(function(x) {
        if (x.id) self.openNodes[x.id] = 1;
    });
}

self.doFilter = function()
{
    var list = self.rows;
    if (self.query()) list = self.rows.filter(function(x) { return x.type.indexOf(self.query()) > -1 || x.name.indexOf(self.query()) > -1 | x.value.indexOf(self.query()) > -1 });
    list.sort(function(a,b) { return a.type < b.type ? -1 : a.type > b.type ? 1 : (a.name < b.name ? -1 : a.name > b.name ? 1 : 0 )});

    var types = {};
    list.forEach(function(x) {
        x.icon = "glyphicon glyphicon-unchecked";
        x.text = x.name + " = " + x.value;
        x.mtime = x.mtime ? self.strftime(x.mtime, "%a, %b %d %Y, %H:%M%p") : "";
        if (!types[x.type]) types[x.type] = [];
        types[x.type].push(x);
    });
    var nodes = [];
    for (var p in types) {
        nodes.push({ text: p, type: p, id: p, name: "", value: "", icon: "glyphicon glyphicon-folder-open", nodes: types[p] });
    }
    var options = {
        nodes: nodes,
        open: self.openNodes,
        onSelected: function(event, node) {
            self.selected = node;
            if (!node.nodes && !node._nodes) self.doEdit(node)
        }
    }
    $('#config-tree').treeview(options);
}

self.doExpand = function(data, event)
{
    self.openNodes();
    self.doFilter();
}

self.doCollapse = function(data, event)
{
    self.openNodes = {};
    self.doFilter();
}

self.doShow = function(data, event)
{
    self.send({ url: '/data/scan/bk_config', data: { _noscan: 0, _count: 1000 }, jsonType: "list" }, function(rows) {
        self.rows = rows;
        self.doFilter();
    });
}

self.doEdit = function(data, event)
{
    if (!data || !data.type) {
        self.row0.type = self.selected ? self.selected.type : "";
        ko.mapping.fromJS(self.row0, self.row);
        $('#config-form').modal("show");
        return;
    }
    data.old = { type: data.type, name: data.name, value: data.value };
    ko.mapping.fromJS(data, self.row);
    $('#config-form').modal("show");
}

self.doCopy = function(data, event)
{
    var obj = ko.mapping.toJS(self.row);
    if (!obj.name || !obj.type || !obj.value) return;

    if (obj.old && obj.old.type && obj.old.name && (obj.type != obj.old.type || obj.name != obj.old.name)) {
        self.send({ url: '/data/put/bk_config', data: { type: obj.type, name: obj.name, value: obj.value }, type: "POST" }, function() {
            $('#config-form').modal("hide");
            self.saveNodes();
            self.doShow();
        }, function(err) {
            $('#config-form').modal("hide");
            self.showAlert("danger", err);
        });
    } else {
        self.showAlert($("#config-form"), "danger", "Type and/or name must be different for a copy");
    }
}

self.doSave = function(data, event)
{
    var obj = ko.mapping.toJS(self.row);
    if (!obj.name || !obj.type || !obj.value) return;

    self.send({ url: '/data/put/bk_config', data: obj, type: "POST" }, function() {
        $('#config-form').modal("hide");
        // Delete the old record
        if (obj.old && obj.old.type && obj.old.name && (obj.type != obj.old.type || obj.name != obj.old.name)) {
            self.send({ url: '/data/del/bk_config', data: { type: obj.old.type, name: obj.old.name }, type: "POST" }, function() {
                self.saveNodes();
                self.doShow();
            }, function(err) {
                self.showAlert("danger", err);
            });
        } else {
            self.saveNodes();
            self.doShow();
        }
    }, function(err) {
        self.showAlert("danger", err);
        $('#config-form').modal("hide");
    });
}

self.doDelete = function(data, event)
{
    var obj = ko.mapping.toJS(self.row);
    if (!obj.name || !obj.type) return;
    if (!confirm("Delete this parameter?")) return;
    self.send({ url: '/data/del/bk_config', data: { type: obj.type, name: obj.name }, type: "POST" }, function() {
        self.saveNodes();
        self.doShow();
        $('#config-form').modal("hide");
    }, function(err) {
        self.showAlert("danger", err);
        $('#config-form').modal("hide");
    });
}

self.doLogin = function(data, event)
{
    self.showLogin(function(err) {
        if (err) {
            self.showAlert("danger", err);
        } else {
            self.hideLogin()
            self.auth(self.loggedIn);
            self.doShow();
        }
    });
}

self.doLogout = function()
{
    $('#secret').val('');
    self.logout(function() {
        window.location.href = "/";
    });
}

$(function()
{
    // Autofocus for dialogs
    $(".modal").on('shown.bs.modal', function () {
        $(this).find('input:text:visible:first').focus();
    });

    ko.applyBindings(self);
    self.login(function() {
        self.auth(self.loggedIn);
        if (self.auth()) self.doShow();
    });
});

