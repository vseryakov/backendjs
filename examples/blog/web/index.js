//
// Vlad Seryakov 20014
//

var self = Bkjs;
self.session = true;
self.auth = ko.observable(0);
self.blog = ko.observableArray([]);
self.blog_token = null;

self.showAlert = function(type, text)
{
    $("#form-error").append("<span class='form-" + type + "'>" + text + "</span>");
    $("#form-error span").last().hide().fadeIn(200).delay(5000 + (type == "error" ? 5000 : 0)).fadeOut(1000, function () { $(this).remove(); });
}

self.previewImage = function(input)
{
    if (!input || !input.files || !input.files[0]) {
        $("#" + input.id + '-preview').attr('src', '#');
        return;
    }
    var reader = new FileReader();
    reader.onload = function(e) { $("#" + input.id + '-preview').attr('src', e.target.result); }
    reader.readAsDataURL(input.files[0]);
}

self.onImageError = function(data, event)
{
    $(event.currentTarget).context.src = "/img/1.png";
}

self.showBlog = function(data, event)
{
    if (self.blog_token === "") return;
    self.send({ url: '/blog/select', data: { _start: self.blog_token }, jsonType: "obj" }, function(data) {
        self.blog_token = data.next_token || "";
        data.data.forEach(function(x) {
            x.tags = x.tags ? x.tags.split(" ") : [];
            x.ctime = x.mtime;
            x.icon = x.icon || '/img/1.png';
            x.mtime = x.mtime ? self.strftime(x.mtime, "%a, %b %d %Y, %H:%M%p") : "";
        });
        self.blog(data.data);
    });
}

self.postBlog = function(data, event)
{
    var obj = {};
    ["msg","title","tags","mtime","sender"].forEach(function(x) { obj[x] = $("#blog-" + x).val(); });
    if (!obj.msg) return;

    var img = $("#blog-img");
    if (img[0].files && img[0].files.length) {
        self.sendFile({ file: img[0], url: '/blog/put', data: obj, callback: function() {
            self.blog_token = null;
            self.showBlog();
            $('#blog-form').modal("hide");
        } });
        return;
    }
    self.send({ url: '/blog/put', data: obj, type: "POST" }, function() {
        self.blog_token = null;
        self.showBlog();
        $('#blog-form').modal("hide");
    }, function(err) {
        self.showAlert("error", err);
        $('#blog-form').modal("hide");
    });
}

self.editBlog = function(data, event)
{
    if (!data || !data.ctime) {
        ["msg","title","tags","mtime","sender"].forEach(function(x) { $("#blog-" + x).val(""); });
        $('#blog-form').modal("show");
        return;
    }
    self.send({ url: '/blog/get', data: { mtime: data.ctime, sender: data.sender, jsonType: "obj"  }, type: "POST" }, function(obj) {
        ["msg","title","tags","mtime","sender"].forEach(function(x) { $("#blog-" + x).val(obj[x]); });
        $('#blog-form').modal("show");
    }, function(err) {
        self.showAlert("error", err);
    });
}

self.delBlog = function(data, event)
{
    if (!confirm("Delete this post?")) return;
    self.send({ url: '/blog/del', data: { mtime: data.ctime, sender: data.sender }, type: "POST" }, function() {
        self.blog_token = null;
        self.showBlog();
    }, function(err) {
        self.showAlert("error", err);
    });
}

self.doLogin = function(data, event)
{
    self.login($('#login').val(),  $('#secret').val(), function(err) {
        if (err) {
            $('#secret').val('');
            $('#login-form').modal("show");
            return;
        }
        $('#login-form').modal("hide");
        self.auth(self.loggedIn);
        self.showBlog();
    });
}

$(function() {

    $("input[type=file]").change(function() { self.previewImage(this); });

    // Autofocus for dialogs
    $(".modal").on('shown.bs.modal', function () {
        lastfocus = $(this);
        $(this).find('input:text:visible:first').focus();
    });

    // Auto load more items on scroll
    $('#blog-content').scroll(function() {
        if ($('#blog-content').scrollTop() >= $('#blog-content').prop('scrollHeight') - ($('#blog-content').prop('clientHeight'))) {
            self.showBlog();
        }
    });

    ko.applyBindings(self);
    self.login(function() {
        self.auth(self.loggedIn);
        self.showBlog();
    });

});

