/*!
 *  backend.js client
 *  Vlad Seryakov vseryakov@gmail.com 2018
 */

bkjs.event = function(name, data)
{
    $(bkjs).trigger(name, data);
}

bkjs.on = function(name, callback)
{
    $(bkjs).on(name, callback);
}

bkjs.off = function(name, callback)
{
    $(bkjs).off(name, callback);
}
