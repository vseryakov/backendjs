//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

// Bootstrap backend support

Backendjs.showAlert = function(obj, type, text)
{
    if (typeof obj == "string") text = type, type = obj, obj = $("body");
    if (text) $(obj).find(".alerts").append("<div class='alert alert-" + type + "' role='alert'>" + text + "</div>");
    $(obj).find(".alerts div").hide().fadeIn(200).delay(5000 + (type == "error" ? 5000 : 0)).fadeOut(1000, function () { $(this).remove(); });
}

// Login UI control
Backendjs.hideLogin = function()
{
    $("#backendjs-login-modal").modal("hide");
}

Backendjs.showLogin = function(callback)
{
    var div = $('#backendjs-login-modal');
    if (!div.length) {
        $('<div id="backendjs-login-modal" class="modal fade" tabindex="-1" role="dialog" aria-labelledby="LoginLabel" aria-hidden="true">\
        <div class="modal-dialog">\
        <div class="modal-content">\
        <div class="modal-header">\
        <button type="button" class="close" data-dismiss="modal"><span aria-hidden="true">&times;</span><span class="sr-only">Close</span></button>\
        <h4 class="modal-title" id="LoginLabel">Please Sign In</h4>\
        </div>\
        <div class="modal-body">\
        <form id="backendjs-login-form" role="form">\
        <div class="alerts"></div>\
        <div class="form-group">\
        <label for="backendjs-login">Login</label>\
        <input class="form-control" placeholder="Login" id="backendjs-login" autofocus>\
        </div>\
        <div class="form-group">\
        <label for="backendjs-login">Password</label>\
        <input class="form-control" placeholder="Password" id="backendjs-secret" type="password" autocomplete=off value="">\
        </div>\
        </div>\
        <div class="modal-footer">\
        <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>\
        <button type="button" class="btn btn-primary" id="backendjs-submit">Login</button>\
        </div>\
        </form>\
        </div>\
        </div>\
        </div>').appendTo("body");

        $("#backendjs-login-modal").on('shown.bs.modal', function () { $(this).find('input:text:visible:first').focus(); });
        $('#backendjs-login').keyup(function(e) { if (e.which == 13) { $('#backendjs-secret').focus(); e.preventDefault(); } });
        $('#backendjs-secret').keyup(function(e) { if (e.which == 13) { $('#backendjs-login-form').trigger("submit"); e.preventDefault(); } });
        $('#backendjs-submit').click(function(e) { $('#backendjs-login-form').trigger("submit"); });
    }
    $('#backendjs-login-form').submit(function() {
        Backendjs.login($('#backendjs-login').val(), $('#backendjs-secret').val(), callback);
        return false;
    });
    $("#backendjs-login-modal").modal("show");
}
