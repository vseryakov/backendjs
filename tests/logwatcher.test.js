
const fs = require("fs");
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { app, lib, logwatcher } = require("../");

describe("Logwatcher tests", () => {

    var argv = ["-logwatcher-send-error", "none://",
                "-logwatcher-send-test", "none://",
                "-logwatcher-send-ignore", "none://",
                "-logwatcher-send-warning", "none://",
                "-logwatcher-send-any", "none://",
                "-logwatcher-matches-test", "TEST: ",
                "-logwatcher-ignore-error", "error2",
                "-logwatcher-ignore-warning", "warning2",
                "-logwatcher-once-test2", "test2",
                "-logwatcher-matches-any", "line:[0-9]+",
                "-logwatcher-interval", "1",
                "-app-log-file", "/tmp/message.log",
                "-app-err-file", "/tmp/error.log",
                "-db-pool", "none",
            ];
    var lines = [
                " ERROR: error1",
                " continue error1",
                "]: WARN: warning1",
                "]: WARN: warning2",
                " backtrace test line:123",
                "[] TEST: test1",
                "[] TEST: test2 shown",
                "[] TEST: test2 skipped",
                "[] TEST: test2 skipped",
                "[] ERROR: error2",
                "no error string",
                "no error string",
                "no error string",
                "no error string",
                "no error string",
                "no error string",
                " backtrace test line:456",
            ];

    logwatcher.files = logwatcher.files.filter((x) => (x.name));

    app.parseArgs(argv);
    fs.writeFileSync(app.errFile, lines.join("\n"));
    fs.writeFileSync(app.logFile, lines.join("\n"));

    it("process log files", (t, callback) => {
        logwatcher.run((err, rc) => {
            assert.ifError(err);
            assert.equal(lib.objKeys(rc?.errors).length, 5);
            callback(err);
        });
    });
})

