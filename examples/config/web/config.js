//
// Vlad Seryakov 20014
//

Backendjs.configRows = [];
Backendjs.configRow0 = { type: "", name: "", value: "" };
Backendjs.configRow = ko.mapping.fromJS(Backendjs.configRow0);
Backendjs.configNodes = {};

Backendjs.configQuery = ko.observable("");
Backendjs.configQuery.subscribe(function(val) {
    Backendjs.configExpand();
});

Backendjs.configSaveNodes = function()
{
    Backendjs.configNodes = {};
    $('#config-tree').treeview("getNodes").forEach(function(x) {
        if (x.id && x._open) Backendjs.configNodes[x.id] = 1;
    });
}

Backendjs.configOpenNodes = function()
{
    $('#config-tree').treeview("getNodes").forEach(function(x) {
        if (x.id) Backendjs.configNodes[x.id] = 1;
    });
}

Backendjs.configFilter = function()
{
    var list = Backendjs.configRows;
    if (Backendjs.configQuery()) list = Backendjs.configRows.filter(function(x) { return x.type.indexOf(Backendjs.configQuery()) > -1 || x.name.indexOf(Backendjs.configQuery()) > -1 || x.value.indexOf(Backendjs.configQuery()) > -1 });
    list.sort(function(a,b) { return a.type < b.type ? -1 : a.type > b.type ? 1 : (a.name < b.name ? -1 : a.name > b.name ? 1 : 0 )});

    var types = {};
    list.forEach(function(x) {
        x.icon = "glyphicon glyphicon-unchecked";
        x.text = x.name + " = " + x.value;
        x.mtime = x.mtime ? Backendjs.strftime(x.mtime, "%a, %b %d %Y, %H:%M%p") : "";
        if (!types[x.type]) types[x.type] = [];
        types[x.type].push(x);
    });
    var nodes = [];
    for (var p in types) {
        nodes.push({ text: p, type: p, id: p, name: "", value: "", icon: "glyphicon glyphicon-folder-open", nodes: types[p] });
    }
    var options = {
        nodes: nodes,
        open: Backendjs.configNodes,
        onSelected: function(event, node) {
            Backendjs.configSelected = node;
            if (!node.nodes && !node._nodes) Backendjs.configEdit(node)
        }
    }
    $('#config-tree').treeview(options);
}

Backendjs.configExpand = function(data, event)
{
    Backendjs.configOpenNodes();
    Backendjs.configFilter();
}

Backendjs.configCollapse = function(data, event)
{
    Backendjs.configNodes = {};
    Backendjs.configFilter();
}

Backendjs.configShow = function(data, event)
{
    Backendjs.send({ url: '/data/scan/bk_config', data: { _noscan: 0, _count: 1000 }, jsonType: "list" }, function(rows) {
        Backendjs.configRows = rows;
        Backendjs.configFilter();
    });
}

Backendjs.configEdit = function(data, event)
{
    if (!data || !data.type) {
        Backendjs.configRow0.type = Backendjs.configSelected ? Backendjs.configSelected.type : "";
        ko.mapping.fromJS(Backendjs.configRow0, Backendjs.configRow);
        $('#config-form').modal("show");
        return;
    }
    data.old = { type: data.type, name: data.name, value: data.value };
    ko.mapping.fromJS(data, Backendjs.configRow);
    $('#config-form').modal("show");
}

Backendjs.configCopy = function(data, event)
{
    var obj = ko.mapping.toJS(Backendjs.configRow);
    if (!obj.name || !obj.type || !obj.value) return;

    if (obj.old && obj.old.type && obj.old.name && (obj.type != obj.old.type || obj.name != obj.old.name)) {
        Backendjs.send({ url: '/data/put/bk_config', data: { type: obj.type, name: obj.name, value: obj.value }, type: "POST" }, function() {
            $('#config-form').modal("hide");
            Backendjs.configSaveNodes();
            Backendjs.configShow();
        }, function(err) {
            $('#config-form').modal("hide");
            Backendjs.showAlert("danger", err);
        });
    } else {
        Backendjs.showAlert($("#config-form"), "danger", "Type and/or name must be different for a copy");
    }
}

Backendjs.configSave = function(data, event)
{
    var obj = ko.mapping.toJS(Backendjs.configRow);
    if (!obj.name || !obj.type || !obj.value) return;

    Backendjs.send({ url: '/data/put/bk_config', data: obj, type: "POST" }, function() {
        $('#config-form').modal("hide");
        // Delete the old record
        if (obj.old && obj.old.type && obj.old.name && (obj.type != obj.old.type || obj.name != obj.old.name)) {
            Backendjs.send({ url: '/data/del/bk_config', data: { type: obj.old.type, name: obj.old.name }, type: "POST" }, function() {
                Backendjs.configSaveNodes();
                Backendjs.configShow();
            }, function(err) {
                Backendjs.showAlert("danger", err);
            });
        } else {
            Backendjs.configSaveNodes();
            Backendjs.configShow();
        }
    }, function(err) {
        Backendjs.showAlert("danger", err);
        $('#config-form').modal("hide");
    });
}

Backendjs.configDelete = function(data, event)
{
    var obj = ko.mapping.toJS(Backendjs.configRow);
    if (!obj.name || !obj.type) return;
    if (!confirm("Delete this parameter?")) return;
    Backendjs.send({ url: '/data/del/bk_config', data: { type: obj.type, name: obj.name }, type: "POST" }, function() {
        Backendjs.configSaveNodes();
        Backendjs.configShow();
        $('#config-form').modal("hide");
    }, function(err) {
        Backendjs.showAlert("danger", err);
        $('#config-form').modal("hide");
    });
}

Backendjs.configDownload = function(data, event)
{
    var data = this.configRows.map(function(x) { return JSON.stringify(x) }).join("\n");
    var w = window.open('');
    w.document.write(data);
    w.select();
}

Backendjs.koShow = function(data, event)
{
    Backendjs.configShow(data, event);
}

$(function()
{
    // Autofocus for dialogs
    $(".modal").on('shown.bs.modal', function () {
        $(this).find('input:text:visible:first').focus();
    });
});

