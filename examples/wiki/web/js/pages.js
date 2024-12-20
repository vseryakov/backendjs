//
// Vlad Seryakov 2014
//

bkjs.pages = [];
bkjs.pagesHistory = [];
bkjs.pagesList = ko.observableArray();
bkjs.pagesTitle = ko.observable();
bkjs.pagesSubtitle = ko.observable();
bkjs.pagesToc = ko.observable();
bkjs.pagesContent = ko.observable();
bkjs.pagesId = ko.observable();

bkjs.pagesQuery = ko.observable("");
bkjs.pagesQuery.subscribe(function(val) {
    if (!bkjs.pages.length) return bkjs.pagesIndex();
    bkjs.pagesFilter();
});

bkjs.pagesFilter = function()
{
    var list = bkjs.pages;
    if (bkjs.pagesQuery()) {
        var rx = new RegExp(bkjs.pagesQuery(), "i")
        list = list.filter(function(x) {
            return (x.title && x.title.match(rx)) || (x.subtitle && x.subtitle.match(rx));
        });
    }
    bkjs.pagesId("");
    bkjs.pagesToc("");
    bkjs.pagesTitle("Index of all pages");
    bkjs.pagesContent("");
    bkjs.pagesList(list);
}

bkjs.pagesSelect = function(callback)
{
    bkjs.send({ url: "/pages/select", data: { _select: "id,title,subtitle,icon,link,mtime" } }, function(rows) {
        rows.forEach(function(x) {
            x.subtitle = x.subtitle || "";
            x.icon = x.icon || "glyphicon glyphicon-book";
            x.time = bkjs.strftime(x.mtime, "%Y-%m-%d %H:%M");
        });
        bkjs.pages = rows;
        if (callback) callback();
    });
}

bkjs.pagesIndex = function(data, event)
{
    bkjs.pagesSelect(function() {
        bkjs.pagesFilter();
    }, function(err) {
        bkjs.showAlert("danger", err);
    });
}

bkjs.pagesBack = function(data, event)
{
    var id = bkjs.pagesHistory.pop();
    if (!bkjs.pagesHistory.length) return;
    bkjs.pagesShow({ id: bkjs.pagesHistory[bkjs.pagesHistory.length - 1] });
}

bkjs.pagesLink = function(data, event)
{
    event.preventDefault();
    // External link
    if (data.link) window.location.href = data.link;
    bkjs.pagesShow(data);
}

bkjs.pagesShow = function(data, event)
{
    var id = data && typeof data.id == "string" ? data.id : data && typeof data.id == "function" ? data.id() : "";
    var url = id.match(/^$|^[a-z0-9]+$/) ? "/pages/get/" + id : id.replace("/pages/show", "/pages/get");
    if (url.match("^/pages/get")) {
        var req = { url: url };
    } else {
        var req = { url: url, dataType: "text" };
    }
    bkjs.send(req, function(row) {
        if (typeof row == "string") {
            document.title = url;
            bkjs.pagesContent(marked(row));
        } else {
            document.title = row.title;
            bkjs.pagesId(row.id);
            bkjs.pagesToc(marked(row.toc));
            bkjs.pagesTitle(marked(row.title));
            bkjs.pagesContent(marked(row.content));
        }
        bkjs.pagesList([]);

        // Keep the browsing history
        if (id != bkjs.pagesHistory[bkjs.pagesHistory.length - 1]) bkjs.pagesHistory.push(id);
        if (bkjs.pagesHistory.length > 10) bkjs.pagesHistory.splice(0, bkjs.pagesHistory.length - 10);
    }, function(err) {
        bkjs.showAlert("danger", err);
    });
}

bkjs.pagesNew = function(data, event)
{
    $(".pages-field").val("");
    $("input[type=checkbox]").attr("checked", false);
    $('#pages-form').modal('show');
}

bkjs.pagesEdit = function(data, event)
{
    bkjs.send({ url: "/pages/get/" + bkjs.pagesId() }, function(row) {
        bkjs.pagesMtime = row.mtime;
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
        bkjs.showAlert("danger", err);
    });
}

bkjs.pagesSave = function(data, event)
{
    if (!bkjs.pagesId()) return bkjs.pagesPut();

    bkjs.send({ url: "/pages/get/" + bkjs.pagesId(), data: { _select: "mtime" } }, function(row) {
        if (row.mtime > bkjs.pagesMtime && confirm("The page has been modified already, continuing will override previous data with your version of the page.\nDo you want to cancel?")) return;
        bkjs.pagesPut();
    });
}

bkjs.pagesPut = function(data, event)
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
    bkjs.send({ url: '/pages/put/' + (obj.id || ""), data: obj, type: "POST" }, function() {
        bkjs.pagesShow(obj.id)
        $('#pages-form').modal("hide");
    }, function(err) {
        bkjs.showAlert($("#pages-form"), "danger", err);
    });
}

bkjs.pagesDelete = function(data, event)
{
    if (!confirm("Delete this page?")) return;
    bkjs.send({ url: '/pages/del/' + bkjs.pagesId, type: "POST" }, function() {
        bkjs.pagesBack();
    }, function(err) {
        bkjs.showAlert($("#pages-form"), "danger", err);
    });
}

bkjs.pagesPickerList = ko.observableArray();
bkjs.pagesPickerQuery = ko.observable("");
bkjs.pagesPickerQuery.subscribe(function(val) {
    if (bkjs.pages.length) return bkjs.pagesPickerFilter();
    bkjs.pagesSelect(function() { bkjs.pagesPickerFilter() })
});

bkjs.pagesShowPicker = function(event)
{
    bkjs.pagesPickerFilter();
    $("#pages-picker").toggle();
}

bkjs.pagesPickerLink = function(data, event)
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

bkjs.pagesPickerFilter = function()
{
    var list = bkjs.pages;
    if (bkjs.pagesPickerQuery()) {
        list = bkjs.pages.filter(function(x) {
            return (x.title && x.title.indexOf(bkjs.pagesPickerQuery()) > -1) ||
                   (x.subtitle && x.subtitle.indexOf(bkjs.pagesPickerQuery()) > -1);
        });
    }
    bkjs.pagesPickerList(list);
}

bkjs.koShow = function()
{
    bkjs.pagesSelect(function() {
        bkjs.pagesShow();
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
        bkjs.pagesLink({ id: $(this).attr('href') }, e);
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
                               bkjs.pagesShowPicker(e);
                           }
                       }]
               }]
           ]
        });
});
