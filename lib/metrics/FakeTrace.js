const lib = require("../lib");

module.exports = class FakeTrace {

    /**
     * Noop trace class
     * @implements {Trace}
     *
     * @class FakeTrace
     */
'use strict';
    constructor()
    {
        this.start = () => (new FakeTrace());
        this.stop = lib.noop;
        this.send = lib.noop;
        this.toString = () => ("");
        this.destroy = lib.noop;
    }
}

