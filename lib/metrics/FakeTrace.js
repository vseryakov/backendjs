const lib = require("../lib");

module.exports = FakeTrace;

function FakeTrace()
{
    this.start = () => (new FakeTrace());
    this.stop = lib.noop;
    this.send = lib.noop;
    this.toString = () => ("");
    this.destroy = lib.noop;
}
