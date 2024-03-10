/*!
 *  backend.js client
 *  Vlad Seryakov vseryakov@gmail.com 2018
 */

bkjs.event = function(name, data)
{
    $(this).trigger(name, data);
}

bkjs.on = function(name, callback)
{
    $(this).on(name, callback);
}

bkjs.off = function(name, callback)
{
    $(this).off(name, callback);
}
