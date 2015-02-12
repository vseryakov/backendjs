//
// Vlad Seryakov 2014
//

Bkjs.pages = [];
Bkjs.pagesHistory = [];
Bkjs.pagesList = ko.observableArray();
Bkjs.pagesTitle = ko.observable();
Bkjs.pagesSubtitle = ko.observable();
Bkjs.pagesToc = ko.observable();
Bkjs.pagesContent = ko.observable();
Bkjs.pagesId = ko.observable();

Bkjs.pagesQuery = ko.observable("");
Bkjs.pagesQuery.subscribe(function(val) {
    if (!Bkjs.pages.length) return Bkjs.pagesIndex();
    Bkjs.pagesFilter();
});

Bkjs.pagesFilter = function()
{
    var list = Bkjs.pages;
    if (Bkjs.pagesQuery()) {
        var rx = new RegExp(Bkjs.pagesQuery(), "i")
        list = list.filter(function(x) {
            return (x.title && x.title.match(rx)) || (x.subtitle && x.subtitle.match(rx));
        });
    }
    Bkjs.pagesId("");
    Bkjs.pagesToc("");
    Bkjs.pagesTitle("Index of all pages");
    Bkjs.pagesContent("");
    Bkjs.pagesList(list);
}

Bkjs.pagesSelect = function(callback)
{
    Bkjs.send({ url: "/pages/select", data: { _select: "id,title,subtitle,icon,link,mtime" }, jsonType: "list" }, function(rows) {
        rows.forEach(function(x) {
            x.subtitle = x.subtitle || "";
            x.icon = x.icon || "glyphicon glyphicon-book";
            x.time = Bkjs.strftime(x.mtime, "%Y-%m-%d %H:%M");
        });
        Bkjs.pages = rows;
        if (callback) callback();
    });
}

Bkjs.pagesIndex = function(data, event)
{
    Bkjs.pagesSelect(function() {
        Bkjs.pagesFilter();
    }, function(err) {
        Bkjs.showAlert("danger", err);
    });
}

Bkjs.pagesBack = function(data, event)
{
    var id = Bkjs.pagesHistory.pop();
    if (!Bkjs.pagesHistory.length) return;
    Bkjs.pagesShow({ id: Bkjs.pagesHistory[Bkjs.pagesHistory.length - 1] });
}

Bkjs.pagesLink = function(data, event)
{
    event.preventDefault();
    // External link
    if (data.link) window.location.href = data.link;
    Bkjs.pagesShow(data);
}

Bkjs.pagesShow = function(data, event)
{
    var id = data && typeof data.id == "string" ? data.id : data && typeof data.id == "function" ? data.id() : "";
    var url = id.match(/^$|^[a-z0-9]+$/) ? "/pages/get/" + id : id.replace("/pages/show", "/pages/get");
    if (url.match("^/pages/get")) {
        var req = { url: url, jsonType: "obj" };
    } else {
        var req = { url: url, dataType: "text" };
    }
    Bkjs.send(req, function(row) {
        if (typeof row == "string") {
            document.title = url;
            Bkjs.pagesContent(marked(row));
        } else {
            document.title = row.title;
            Bkjs.pagesId(row.id);
            Bkjs.pagesToc(marked(row.toc));
            Bkjs.pagesTitle(marked(row.title));
            Bkjs.pagesContent(marked(row.content));
        }
        Bkjs.pagesList([]);

        // Keep the browsing history
        if (id != Bkjs.pagesHistory[Bkjs.pagesHistory.length - 1]) Bkjs.pagesHistory.push(id);
        if (Bkjs.pagesHistory.length > 10) Bkjs.pagesHistory.splice(0, Bkjs.pagesHistory.length - 10);
    }, function(err) {
        Bkjs.showAlert("danger", err);
    });
}

Bkjs.pagesNew = function(data, event)
{
    $(".pages-field").val("");
    $("input[type=checkbox]").attr("checked", false);
    $('#pages-form').modal('show');
}

Bkjs.pagesEdit = function(data, event)
{
    Bkjs.send({ url: "/pages/get/" + Bkjs.pagesId(), jsonType: "obj" }, function(row) {
        Bkjs.pagesMtime = row.mtime;
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
        Bkjs.showAlert("danger", err);
    });
}

Bkjs.pagesSave = function(data, event)
{
    if (!Bkjs.pagesId()) return Bkjs.pagesPut();

    Bkjs.send({ url: "/pages/get/" + Bkjs.pagesId(), data: { _select: "mtime" }, jsonType: "obj" }, function(row) {
        if (row.mtime > Bkjs.pagesMtime && confirm("The page has been modified already, continuing will override previous data with your version of the page.\nDo you want to cancel?")) return;
        Bkjs.pagesPut();
    });
}

Bkjs.pagesPut = function(data, event)
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
    Bkjs.send({ url: '/pages/put/' + (obj.id || ""), data: obj, type: "POST" }, function() {
        Bkjs.pagesShow(obj.id)
        $('#pages-form').modal("hide");
    }, function(err) {
        Bkjs.showAlert($("#pages-form"), "danger", err);
    });
}

Bkjs.pagesDelete = function(data, event)
{
    if (!confirm("Delete this page?")) return;
    Bkjs.send({ url: '/pages/del/' + Bkjs.pagesId, type: "POST" }, function() {
        Bkjs.pagesBack();
    }, function(err) {
        Bkjs.showAlert($("#pages-form"), "danger", err);
    });
}

Bkjs.pagesPickerList = ko.observableArray();
Bkjs.pagesPickerQuery = ko.observable("");
Bkjs.pagesPickerQuery.subscribe(function(val) {
    if (Bkjs.pages.length) return Bkjs.pagesPickerFilter();
    Bkjs.pagesSelect(function() { Bkjs.pagesPickerFilter() })
});

Bkjs.pagesShowPicker = function(event)
{
    Bkjs.pagesPickerFilter();
    $("#pages-picker").toggle();
}

Bkjs.pagesPickerLink = function(data, event)
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

Bkjs.pagesPickerFilter = function()
{
    var list = Bkjs.pages;
    if (Bkjs.pagesPickerQuery()) {
        list = Bkjs.pages.filter(function(x) {
            return (x.title && x.title.indexOf(Bkjs.pagesPickerQuery()) > -1) ||
                   (x.subtitle && x.subtitle.indexOf(Bkjs.pagesPickerQuery()) > -1);
        });
    }
    Bkjs.pagesPickerList(list);
}

Bkjs.koShow = function()
{
    Bkjs.pagesSelect(function() {
        Bkjs.pagesShow();
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
        Bkjs.pagesLink({ id: $(this).attr('href') }, e);
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
                               Bkjs.pagesShowPicker(e);
                           }
                       }]
               }]
           ]
        });
});
