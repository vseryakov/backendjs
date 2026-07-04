/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');

var deferId = 0;

const deferMap = new Map();

/**
 * To be called on timeout or when explicitly called by the `runCallback`
 */
function DeferCallback(msg)
{
    const item = deferMap.get(msg.__deferId);
    if (!item) return;

    logger.dev("DeferCallback:", msg, item);

    deferMap.delete(msg.__deferId);
    msg.__deferId = undefined;

    clearTimeout(item.timer);

    try {
        item.callback(msg);
    } catch (e) {
        logger.error('DeferCallback:', e, msg, e.stack);
    }
    item.callback = undefined;
}

/**
 * Register the callback to be run later for the given message, after registering the callback the `msg` object will
 * have the `__deferId`  property which will be used for keeping track of the responses.
 *
 * The reason this property is used for tracking because the message can be send over the wire or IPC socket to other process.
 *
 * A timeout is created for this message, if `runCallback` for this message will not be called in time the timeout handler will call the callback
 * anyway with the original message.
 * @param {object} msg - the message
 * @param {function} callback - will be called with only one argument which is the message itself, what is inside the message
 * this function does not care. If any errors must be passed, use the message object for it, no other arguments are expected.
 * NOTE: this must be a function, not closure due to binding context
 * @param {int} [timeout] - if non-zero the callback will be called if no response is received after this amount of time in ms
 * @return {number|undefined} a deferId generated for the message or undefined if not registered
 * @memberof module:lib
 * @method deferCallback
 */
lib.deferCallback = function(msg, callback, timeout)
{
    if (!lib.isFunc(callback) || !lib.isObject(msg)) return;

    msg.__deferId = deferId++;

    deferMap.set(msg.__deferId, {
        callback,
        timer: timeout > 0 ? setTimeout(DeferCallback, timeout, msg) : 0,
    });
    logger.dev("deferCallback:", msg);

    return msg.__deferId;
}

/**
 * Run delayed callback for the message previously registered with the `deferCallback` method.
 * The message must have `__deferId` property which is used to find the corresponding callback,
 * if the msg is a JSON string it will be converted into the object.
 *
 * Same parent object must be used for `deferCallback` and this method.
 * @param {object} msg - the message with __deferId key
 * @memberof module:lib
 * @method runCallback
 */
lib.runCallback = function(msg)
{
    if (msg && typeof msg === "string") {
        msg = lib.jsonParse(msg, { logger: "error" });
    }
    const item = deferMap.get(msg?.__deferId);
    if (!item) return;

    logger.dev("runCallback:", msg);

    clearTimeout(item.timer);
    setImmediate(DeferCallback, msg);
}

/**
 * Clear all pending timers
 * @memberof module:lib
 * @method deferShutdown
 */
lib.deferShutdown = function()
{
    for (const item of deferMap.values()) {
        clearTimeout(item.timer);
        item.callback = undefined;
    }
    deferMap.clear();
}
