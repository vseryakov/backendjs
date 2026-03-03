/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2025
 */

const net = require('net');
const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');

var Parser;

class Client {
    callbacks = [];

    constructor(options)
    {
        this.options = Object.assign({ port: mod.port, host: mod.host }, options);

        Parser = Parser || require('redis-parser');

        this.parser = new Parser({
            returnBuffers: this.options.returnBuffers,
            returnReply: data => {
                const cb = this.callbacks[0];
                if (typeof cb != "function" || cb(null, data) !== -1999) this.callbacks.shift();
            },
            returnError: err => {
                const cb = this.callbacks[0];
                if (typeof cb != "function" || cb(err) !== -1999) this.callbacks.shift();
            }
        });

        this.connect();
    }

    connect()
    {
        this.connecting = true;
        this.callbacks = [];

        this.socket = net.createConnection(this.options, () => {
            this.ready = true;
            delete this.connecting;
            logger.debug("connect:", mod.name, "ready")
        });

        this.socket.on('data', (data) => {
            logger.debug("connect:", mod.name, "data:", data.toString());
            this.parser.execute(data);
        }).on('error', (err) => {
            logger.error("connect:", mod.name, err);
            const cb = this.callbacks.shift();
            if (typeof cb == "function") cb(err);
        }).on('close', () => {
            logger.debug("connect:", mod.name, "closed");
            this.socket.removeAllListeners();
            delete this.ready;
            delete this.socket;
        });
    }

    call(...args)
    {
        if (!this.ready) return;
        this.callbacks.push(args.at(-1));
        const data = this.encode(args);
        logger.debug("call:", mod.name, data)
        this.socket.write(data);
    }

    multi(...args)
    {
        if (!this.ready) return;
        var replies = [], error, callback = args.at(-1);
        var cmds = args.filter(lib.isArray);
        this.callbacks.push((err, reply) => {
            error = error || err;
            replies.push(err || reply);
            if (replies.length != cmds.length) return -1999;
            if (typeof callback == "function") callback(error, replies);
        });
        this.socket.write(cmds.map(this.encode).join("") + "\r\n");
    }

    destroy()
    {
        this.destroyed = true;
        if (this.socket) this.socket.destroy();
    }

    encode(cmd)
    {
        if (!lib.isArray(cmd)) return "";
        var str = "", i = 0;
        for (let arg of cmd) {
            if (typeof arg == "function") continue;
            if (typeof arg != "string") arg = String(arg);
            str += `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`;
            i++;
        }
        return `*${i}\r\n${str}`;
    }

}

const mod = {
    name: "redis",
    args: [
        { name: "host", descr: "Default Redis host" },
        { name: "port", type: "int", descr: "Default Redis port" },
    ],
    port: 6379,
    Client,
};
module.exports = mod;
