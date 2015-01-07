//
// Vlad Seryakov 2014
//

// 0 to render html locally, 1 to ask the server to render markdown to html
Backendjs.pagesRender = 0;

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
        list = Backendjs.pages.filter(function(x) {
            return (x.title && x.title.indexOf(Backendjs.pagesQuery()) > -1) ||
                   (x.subtitle && x.subtitle.indexOf(Backendjs.pagesQuery()) > -1);
        });
    }
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
        Backendjs.pagesId("");
        Backendjs.pagesToc("");
        Backendjs.pagesTitle("Index of all pages");
        Backendjs.pagesContent("");
        Backendjs.pagesFilter();
    }, function(err) {
        Backendjs.showAlert("danger", err);
    });
}

Backendjs.pagesBack = function(data, event)
{
    var id = Backendjs.pagesHistory.pop();
    if (!Backendjs.pagesHistory.length) window.location.href = "/";
    Backendjs.pagesShow({ id: Backendjs.pagesHistory[Backendjs.pagesHistory.length - 1] });
}

Backendjs.pagesLink = function(data, event)
{
    event.preventDefault();
    if (data.link) window.location.href = data.link;
    Backendjs.pagesShow(data);
}

Backendjs.pagesShow = function(data, event)
{
    var id = data && typeof data.id == "string" ? data.id : data && typeof data.id == "function" ? data.id() : "";
    Backendjs.send({ url: "/pages/get/" + id, data: { _render: Backendjs.pagesRender }, jsonType: "obj" }, function(row) {
        document.title = row.title;
        Backendjs.pagesId(row.id);
        Backendjs.pagesList([]);
        Backendjs.pagesToc(Backendjs.pagesRender ? row.toc : marked(row.toc, { renderer: Backendjs.pagesRenderer }));
        Backendjs.pagesTitle(marked(Backendjs.pagesRender ? row.title : row.title, { renderer: Backendjs.pagesRenderer }));
        Backendjs.pagesContent(marked(Backendjs.pagesRender ? row.content : row.content, { renderer: Backendjs.pagesRenderer }));

        $("a.pages-link").each(function() {
            var d = $(this).attr('href').match(/^\/pages\/show\/([a-z0-9]+)/);
            if (d) $(this).on("click", function(e) { Backendjs.pagesLink({ id: d[1] }, e); });
        });
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
    Backendjs.send({ url: '/pages/put', data: obj, type: "POST" }, function() {
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
    var link = "[" + data.title + "](" + data.id + ")";
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

    Backendjs.pagesRenderer = new marked.Renderer();
    Backendjs.pagesRenderer.link = function(href, title, text) {
        if (href && href.match(/^[0-9a-z]+$/)) href = "/pages/show/" + href;
        return '<a class="pages-link" href="' + href + '"' + (title ? ' title="' + title + '"' : "") + '>' + text + '</a>';
    }

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
