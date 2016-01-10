//
// Vlad Seryakov 2014
//

Bkjs.configRows = [];
Bkjs.configRow0 = { type: "", name: "", value: "", old: "" };
Bkjs.configRow = ko.mapping.fromJS(Bkjs.configRow0);
Bkjs.configNodes = {};

Bkjs.configQuery = ko.observable("");
Bkjs.configQuery.subscribe(function(val) {
    Bkjs.configExpand();
});

Bkjs.configSaveNodes = function()
{
    Bkjs.configNodes = {};
    $('#config-tree').treeview("getNodes").forEach(function(x) {
        if (x.id && x._open) Bkjs.configNodes[x.id] = 1;
    });
}

Bkjs.configOpenNodes = function()
{
    $('#config-tree').treeview("getNodes").forEach(function(x) {
        if (x.id) Bkjs.configNodes[x.id] = 1;
    });
}

Bkjs.configFilter = function()
{
    var list = Bkjs.configRows;
    if (Bkjs.configQuery()) list = Bkjs.configRows.filter(function(x) { return x.type.indexOf(Bkjs.configQuery()) > -1 || x.name.indexOf(Bkjs.configQuery()) > -1 || x.value.indexOf(Bkjs.configQuery()) > -1 });
    list.sort(function(a,b) { return a.type < b.type ? -1 : a.type > b.type ? 1 : (a.name < b.name ? -1 : a.name > b.name ? 1 : 0 )});

    var types = {};
    list.forEach(function(x) {
        x.icon = "glyphicon glyphicon-unchecked";
        x.text = x.name + " = " + x.value;
        x.mtime = x.mtime ? Bkjs.strftime(x.mtime, "%a, %b %d %Y, %H:%M%p") : "";
        if (!types[x.type]) types[x.type] = [];
        types[x.type].push(x);
    });
    var nodes = [];
    for (var p in types) {
        nodes.push({ text: p, type: p, id: p, name: "", value: "", icon: "glyphicon glyphicon-folder-open", nodes: types[p] });
    }
    var options = {
        nodes: nodes,
        open: Bkjs.configNodes,
        onSelected: function(event, node) {
            Bkjs.configSelected = node;
            if (!node.nodes && !node._nodes) Bkjs.configEdit(node)
        }
    }
    $('#config-tree').treeview(options);
}

Bkjs.configExpand = function(data, event)
{
    Bkjs.configOpenNodes();
    Bkjs.configFilter();
}

Bkjs.configCollapse = function(data, event)
{
    Bkjs.configNodes = {};
    Bkjs.configFilter();
}

Bkjs.configShow = function(data, event)
{
    Bkjs.send({ url: '/data/scan/bk_config', data: { _count: 1000 }, jsonType: "list" }, function(rows) {
        Bkjs.configRows = rows;
        Bkjs.configFilter();
    });
}

Bkjs.configEdit = function(data, event)
{
    if (!data || !data.type) {
        Bkjs.configRow0.type = Bkjs.configSelected ? Bkjs.configSelected.type : "";
        ko.mapping.fromJS(Bkjs.configRow0, Bkjs.configRow);
        $('#config-form').modal("show");
        return;
    }
    data.old = { type: data.type, name: data.name, value: data.value };
    ko.mapping.fromJS(data, Bkjs.configRow);
    $('#config-form').modal("show");
}

Bkjs.configCopy = function(data, event)
{
    var obj = ko.mapping.toJS(Bkjs.configRow);
    if (!obj.name || !obj.type || !obj.value) return;

    if (obj.old && obj.old.type && obj.old.name && (obj.type != obj.old.type || obj.name != obj.old.name)) {
        Bkjs.send({ url: '/data/put/bk_config', data: { type: obj.type, name: obj.name, value: obj.value }, type: "POST" }, function() {
            $('#config-form').modal("hide");
            Bkjs.configSaveNodes();
            Bkjs.configShow();
        }, function(err) {
            $('#config-form').modal("hide");
            Bkjs.showAlert("danger", err);
        });
    } else {
        Bkjs.showAlert($("#config-form"), "danger", "Type and/or name must be different for a copy");
    }
}

Bkjs.configSave = function(data, event)
{
    var obj = ko.mapping.toJS(Bkjs.configRow);
    if (!obj.name || !obj.type || !obj.value) return;

    Bkjs.send({ url: '/data/put/bk_config', data: obj, type: "POST" }, function() {
        $('#config-form').modal("hide");
        // Delete the old record
        if (obj.old && obj.old.type && obj.old.name && (obj.type != obj.old.type || obj.name != obj.old.name)) {
            Bkjs.send({ url: '/data/del/bk_config', data: { type: obj.old.type, name: obj.old.name }, type: "POST" }, function() {
                Bkjs.configSaveNodes();
                Bkjs.configShow();
            }, function(err) {
                Bkjs.showAlert("danger", err);
            });
        } else {
            Bkjs.configSaveNodes();
            Bkjs.configShow();
        }
    }, function(err) {
        Bkjs.showAlert("danger", err);
        $('#config-form').modal("hide");
    });
}

Bkjs.configDelete = function(data, event)
{
    var obj = ko.mapping.toJS(Bkjs.configRow);
    if (!obj.name || !obj.type) return;
    if (!confirm("Delete this parameter?")) return;
    Bkjs.send({ url: '/data/del/bk_config', data: { type: obj.type, name: obj.name }, type: "POST" }, function() {
        Bkjs.configSaveNodes();
        Bkjs.configShow();
        $('#config-form').modal("hide");
    }, function(err) {
        Bkjs.showAlert("danger", err);
        $('#config-form').modal("hide");
    });
}

Bkjs.configDownload = function(data, event)
{
    var data = this.configRows.map(function(x) { return JSON.stringify(x) }).join("\n");
    var w = window.open('');
    w.document.write(data);
    w.select();
}

Bkjs.koShow = function(data, event)
{
    Bkjs.configShow(data, event);
}

$(function()
{
    // Autofocus for dialogs
    $(".modal").on('shown.bs.modal', function () {
        $(this).find('input:text:visible:first').focus();
    });
});

