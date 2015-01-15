//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

// Bootstrap backend support

Backendjs.showAlert = function(obj, type, text, dismiss)
{
    if (typeof obj == "string") text = type, type = obj, obj = $("body");
    text = "<div class='alert alert-dissmisible alert-" + type + "' role='alert'>" + text + "</div>";
    if (dismiss) text += '<button type="button" class="close" data-dismiss="alert"><span aria-hidden="true">&times;</span><span class="sr-only">Close</span></button>';
    $(obj).find(".alerts").empty().append(text);
    if (!dismiss) $(obj).find(".alerts div").hide().fadeIn(200).delay(5000 + (type == "error" ? 5000 : 0)).fadeOut(1000, function () { $(this).remove(); });
}

// Login UI control
Backendjs.hideLogin = function()
{
    $("#backendjs-login-modal").modal("hide");
}

Backendjs.showLogin = function(callback)
{
    var modal = $('#backendjs-login-modal');
    if (!modal.length) {
        modal = $(
        '<div id="backendjs-login-modal" class="modal fade" tabindex="-1" role="dialog" aria-labelledby="LoginLabel" aria-hidden="true">\
          <div class="modal-dialog">\
           <div class="modal-content">\
            <form role="form">\
            <div class="modal-header">\
             <button type="button" class="close" data-dismiss="modal"><span aria-hidden="true">&times;</span><span class="sr-only">Close</span></button>\
             <h4 class="modal-title" id="LoginLabel">Please Sign In</h4>\
            </div>\
            <div class="modal-body">\
              <div class="alerts"></div>\
              <div class="form-group">\
               <label for="backendjs-login">Login</label>\
               <input class="form-control" placeholder="Login" type="text" autofocus>\
              </div>\
              <div class="form-group">\
               <label for="backendjs-login">Password</label>\
               <input class="form-control" placeholder="Password" type="password" value="">\
              </div>\
            </div>\
            <div class="modal-footer">\
             <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>\
             <button type="submit" class="btn btn-primary">Login</button>\
            </div>\
            </form>\
           </div>\
          </div>\
        </div>').
        appendTo("body");
    }
    var form = modal.find('form');
    var login = form.find('input[type=text]');
    var secret = form.find('input[type=password]');
    modal.off().on('shown.bs.modal', function () { $(this).find('input:text:visible:first').focus(); });
    login.off().on("keyup", function(e) { if (e.which == 13) { secret.focus(); e.preventDefault(); } });
    secret.off().on("keyup", function(e) { if (e.which == 13) { form.trigger("submit"); e.preventDefault(); } });
    form.find('button[type=submit]').off().on("click", function(e) { form.trigger("submit"); e.preventDefault(); });
    form.off().on("submit", function() {
        Backendjs.login(login.val(), secret.val(), function(err, data) {
            if (err) Backendjs.showAlert(modal, "danger", err);
            if (typeof callback == "function") callback(err, data)
        });
        return false;
    });
    modal.modal("show");
}
