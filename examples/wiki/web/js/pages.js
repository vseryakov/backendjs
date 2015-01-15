//
// Vlad Seryakov 2014
//

Backendjs.logoutUrl = "/";
Backendjs.pages = [];
Backendjs.pagesHistory = [];
Backendjs.pagesList = ko.observableArray();
Backendjs.pagesTitle = ko.observable();
Backendjs.pagesSubtitle = ko.observable();
Backendjs.pagesToc = ko.observable();
Backendjs.pagesContent = ko.observable();
Backendjs.pagesId = ko.observable();

Backendjs.pagesQuery = ko.observable("");
Backendjs.pagesQuery.subscribe(function(val) {
    if (!Backendjs.pages.length) return Backendjs.pagesIndex();
    Backendjs.pagesFilter();
});

Backendjs.pagesFilter = function()
{
    var list = Backendjs.pages;
    if (Backendjs.pagesQuery()) {
        var rx = new RegExp(Backendjs.pagesQuery(), "i")
        list = list.filter(function(x) {
            return (x.title && x.title.match(rx)) || (x.subtitle && x.subtitle.match(rx));
        });
    }
    Backendjs.pagesId("");
    Backendjs.pagesToc("");
    Backendjs.pagesTitle("Index of all pages");
    Backendjs.pagesContent("");
    Backendjs.pagesList(list);
}

Backendjs.pagesSelect = function(callback)
{
    Backendjs.send({ url: "/pages/select", data: { _select: "id,title,subtitle,icon,link,mtime" }, jsonType: "list" }, function(rows) {
        rows.forEach(function(x) {
            x.subtitle = x.subtitle || "";
            x.icon = x.icon || "glyphicon glyphicon-book";
            x.time = Backendjs.strftime(x.mtime, "%Y-%m-%d %H:%M");
        });
        Backendjs.pages = rows;
        if (callback) callback();
    });
}

Backendjs.pagesIndex = function(data, event)
{
    Backendjs.pagesSelect(function() {
        Backendjs.pagesFilter();
    }, function(err) {
        Backendjs.showAlert("danger", err);
    });
}

Backendjs.pagesBack = function(data, event)
{
    var id = Backendjs.pagesHistory.pop();
    if (!Backendjs.pagesHistory.length) return;
    Backendjs.pagesShow({ id: Backendjs.pagesHistory[Backendjs.pagesHistory.length - 1] });
}

Backendjs.pagesLink = function(data, event)
{
    event.preventDefault();
    // External link
    if (data.link) window.location.href = data.link;
    Backendjs.pagesShow(data);
}

Backendjs.pagesShow = function(data, event)
{
    var id = data && typeof data.id == "string" ? data.id : data && typeof data.id == "function" ? data.id() : "";
    var url = id.match(/^$|^[a-z0-9]+$/) ? "/pages/get/" + id : id.replace("/pages/show", "/pages/get");
    if (url.match("^/pages/get")) {
        var req = { url: url, jsonType: "obj" };
    } else {
        var req = { url: url, dataType: "text" };
    }
    Backendjs.send(req, function(row) {
        if (typeof row == "string") {
            document.title = url;
            Backendjs.pagesContent(marked(row));
        } else {
            document.title = row.title;
            Backendjs.pagesId(row.id);
            Backendjs.pagesToc(marked(row.toc));
            Backendjs.pagesTitle(marked(row.title));
            Backendjs.pagesContent(marked(row.content));
        }
        Backendjs.pagesList([]);

        // Keep the browsing history
        if (id != Backendjs.pagesHistory[Backendjs.pagesHistory.length - 1]) Backendjs.pagesHistory.push(id);
        if (Backendjs.pagesHistory.length > 10) Backendjs.pagesHistory.splice(0, Backendjs.pagesHistory.length - 10);
    }, function(err) {
        Backendjs.showAlert("danger", err);
    });
}

Backendjs.pagesNew = function(data, event)
{
    $(".pages-field").val("");
    $("input[type=checkbox]").attr("checked", false);
    $('#pages-form').modal('show');
}

Backendjs.pagesEdit = function(data, event)
{
    Backendjs.send({ url: "/pages/get/" + Backendjs.pagesId(), jsonType: "obj" }, function(row) {
        Backendjs.pagesMtime = row.mtime;
        for (var p in row) {
            switch ($("#pages-" + p).attr("type")) {
            case "checkbox":
                $("#pages-" + p).prop("checked", row[p] ? true : false);
                break;
            default:
                $("#pages-" + p).val(row[p]);
            }
        }
        $('#pages-form').modal('show');
    }, function(err) {
        Backendjs.showAlert("danger", err);
    });
}

Backendjs.pagesSave = function(data, event)
{
    if (!Backendjs.pagesId()) return Backendjs.pagesPut();

    Backendjs.send({ url: "/pages/get/" + Backendjs.pagesId(), data: { _select: "mtime" }, jsonType: "obj" }, function(row) {
        if (row.mtime > Backendjs.pagesMtime && confirm("The page has been modified already, continuing will override previous data with your version of the page.\nDo you want to cancel?")) return;
        Backendjs.pagesPut();
    });
}

Backendjs.pagesPut = function(data, event)
{
    var obj = {};
    $(".pages-field").each(function() {
        var name = $(this).attr("id").split("-").pop();
        switch ($(this).attr("type")) {
        case "checkbox":
            obj[name] = $(this).prop("checked");
            break;
        default:
            obj[name] = $(this).val();
        }
    });
    Backendjs.send({ url: '/pages/put/' + (obj.id || ""), data: obj, type: "POST" }, function() {
        Backendjs.pagesShow(obj.id)
        $('#pages-form').modal("hide");
    }, function(err) {
        Backendjs.showAlert($("#pages-form"), "danger", err);
    });
}

Backendjs.pagesDelete = function(data, event)
{
    if (!confirm("Delete this page?")) return;
    Backendjs.send({ url: '/pages/del/' + Backendjs.pagesId, type: "POST" }, function() {
        Backendjs.pagesBack();
    }, function(err) {
        Backendjs.showAlert($("#pages-form"), "danger", err);
    });
}

Backendjs.pagesPickerList = ko.observableArray();
Backendjs.pagesPickerQuery = ko.observable("");
Backendjs.pagesPickerQuery.subscribe(function(val) {
    if (Backendjs.pages.length) return Backendjs.pagesPickerFilter();
    Backendjs.pagesSelect(function() { Backendjs.pagesPickerFilter() })
});

Backendjs.pagesShowPicker = function(event)
{
    Backendjs.pagesPickerFilter();
    $("#pages-picker").toggle();
}

Backendjs.pagesPickerLink = function(data, event)
{
    event.preventDefault();
    var md = $('#pages-content').data().markdown;
    var link = "[" + data.title + "](/pages/get/" + data.id + ")";
    md.replaceSelection(link);
    var selected = md.getSelection();
    var cursor = selected.start;
    md.setSelection(cursor, cursor + link.length);
    $("#pages-picker").hide();
}

Backendjs.pagesPickerFilter = function()
{
    var list = Backendjs.pages;
    if (Backendjs.pagesPickerQuery()) {
        list = Backendjs.pages.filter(function(x) {
            return (x.title && x.title.indexOf(Backendjs.pagesPickerQuery()) > -1) ||
                   (x.subtitle && x.subtitle.indexOf(Backendjs.pagesPickerQuery()) > -1);
        });
    }
    Backendjs.pagesPickerList(list);
}

Backendjs.koShow = function()
{
    Backendjs.pagesSelect(function() {
        Backendjs.pagesShow();
    });
}

$(function()
{
    $('#pages-iconpicker').iconpicker();
    $('#pages-iconpicker').on('change', function(e) {
        $('#pages-icon').val(e.icon.split("-")[0] + " " + e.icon);
    });

    $("body").on("click", 'a[href^="/pages/get"], a[href^="/pages/show"], a[href$=".md"]', function(e) {
        e.preventDefault()
        Backendjs.pagesLink({ id: $(this).attr('href') }, e);
    });

    $('#pages-content').markdown(
        { resize: "vertical", fullscreen: false, autofocus: true,
           additionalButtons: [
              [{
                   name: "pagesGroup",
                   data: [{
                           name: "picker",
                           title: "Pick a page to link",
                           icon: "fa fa-file-text-o",
                           callback: function(e) {
                               Backendjs.pagesShowPicker(e);
                           }
                       }]
               }]
           ]
        });
});
