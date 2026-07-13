
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { lib } = require("../");

describe("execProcess", function () {
  it("returns stdout from a command", function (t, done) {
    lib.execProcess("echo hello", (err, stdout, stderr) => {
      assert.ifError(err);
      assert.strictEqual(stdout.trim(), "hello");
      assert.strictEqual(stderr, "");
      done();
    });
  });

  it("captures stderr separately", function (t, done) {
    lib.execProcess("echo oops 1>&2", (err, stdout, stderr) => {
      assert.ifError(err);
      assert.strictEqual(stdout, "");
      assert.strictEqual(stderr.trim(), "oops");
      done();
    });
  });

  it("merges stderr into stdout with merge option", function (t, done) {
    lib.execProcess("echo oops 1>&2", { merge: true }, (err, stdout, stderr) => {
      assert.ifError(err);
      assert.strictEqual(stdout.trim(), "oops");
      assert.strictEqual(stderr, "");
      done();
    });
  });

  it("returns an error for non-zero exit status", function (t, done) {
    lib.execProcess("exit 3", { logger: "none" }, (err) => {
      assert.ok(err);
      assert.strictEqual(err.code, 3);
      done();
    });
  });
});

describe("aexecProcess", function () {
  it("resolves with stdout", async function () {
    const { stdout, err } = await lib.aexecProcess("echo async");
    assert.ifError(err);
    assert.strictEqual(stdout.trim(), "async");
  });

  it("resolves with err on failure", async function () {
    const { err } = await lib.aexecProcess("exit 1", { logger: "none" });
    assert.ok(err);
    assert.strictEqual(err.code, 1);
  });
});

describe("spawnProcess", function () {
  it("runs a command with args", function (t, done) {
    lib.spawnProcess("echo", ["a", "b"], {}, (err, stdout) => {
      assert.ifError(err);
      assert.strictEqual(stdout.trim(), "a b");
      done();
    });
  });

  it("accepts a single arg as string", function (t, done) {
    lib.spawnProcess("echo", "solo", {}, (err, stdout) => {
      assert.ifError(err);
      assert.strictEqual(stdout.trim(), "solo");
      done();
    });
  });

  it("returns a ChildProcess with a pid", function (t, done) {
    const proc = lib.spawnProcess("echo", ["x"], {}, () => done());
    assert.ok(proc.pid > 0);
  });

  it("reports error for a missing command", function (t, done) {
    lib.spawnProcess("no_such_cmd_xyz", [], { logger: "none" }, (err) => {
      assert.ok(err);
      done();
    });
  });

  it("honors cwd option", function (t, done) {
    lib.spawnProcess("pwd", [], { cwd: "/tmp" }, (err, stdout) => {
      assert.ifError(err);
      assert.ok(stdout.trim().endsWith("/tmp"));
      done();
    });
  });
});

describe("aspawnProcess", function () {
  it("resolves with stdout", async function () {
    const { stdout, err } = await lib.aspawnProcess("echo", ["hi"]);
    assert.ifError(err);
    assert.strictEqual(stdout.trim(), "hi");
  });
});

describe("spawnSeries", function () {
  it("concatenates output from string commands", function (t, done) {
    lib.spawnSeries(["echo one", "echo two"], (err, stdout) => {
      assert.ifError(err);
      assert.strictEqual(stdout.trim().split("\n").map((x) => x.trim()).join(","), "one,two");
      done();
    });
  });

  it("supports object command form", function (t, done) {
    lib.spawnSeries([{ command: "echo", args: ["obj"] }], (err, stdout) => {
      assert.ifError(err);
      assert.strictEqual(stdout.trim(), "obj");
      done();
    });
  });

  it("ignores invalid command entries", function (t, done) {
    lib.spawnSeries([null, 123, "echo ok"], (err, stdout) => {
      assert.ifError(err);
      assert.strictEqual(stdout.trim(), "ok");
      done();
    });
  });

  it("stops on error with stopOnError", function (t, done) {
    lib.spawnSeries(["exit 2", "echo after"], { stopOnError: true, logger: "none" }, (err, stdout) => {
      assert.ok(err);
      assert.strictEqual(stdout.trim(), "");
      done();
    });
  });

  it("continues on error without stopOnError", function (t, done) {
    lib.spawnSeries(["exit 2", "echo after"], { logger: "none" }, (err, stdout) => {
      assert.ifError(err);
      assert.strictEqual(stdout.trim(), "after");
      done();
    });
  });
});

describe("aspawnSeries", function () {
  it("resolves with concatenated stdout", async function () {
    const { stdout, err } = await lib.aspawnSeries(["echo a", "echo b"]);
    assert.ifError(err);
    assert.strictEqual(stdout.trim().split("\n").map((x) => x.trim()).join(","), "a,b");
  });
});

describe("findProcess / afindProcess", function () {
  it("returns a list including the current process command", function (t, done) {
    lib.findProcess({}, (err, list) => {
      assert.ifError(err);
      assert.ok(Array.isArray(list));
      assert.ok(list.length > 0);
      assert.ok(list.every((x) => typeof x.pid === "number" && typeof x.cmd === "string"));
      done();
    });
  });

  it("excludes the current pid", function (t, done) {
    lib.findProcess({}, (err, list) => {
      assert.ifError(err);
      assert.ok(!list.some((x) => x.pid === process.pid));
      done();
    });
  });

  it("filters by regexp", function (t, done) {
    lib.findProcess({ filter: /node|bkjs/ }, (err, list) => {
      assert.ifError(err);
      assert.ok(Array.isArray(list));
      done();
    });
  });

  it("async version resolves with data", async function () {
    const { data, err } = await lib.afindProcess({});
    assert.ifError(err);
    assert.ok(Array.isArray(data));
  });
});
