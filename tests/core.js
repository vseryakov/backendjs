
tests.test_config_sections = function(callback)
{
    var data = `
line1=line1
[tag=test1]
line3=line3
[runMode=test2]
line4=line4
[tag=test]
line5=line5
[instance.tag=tag]
line6=line6
[configRoles=dev,staging]
line7=line7
[aws.key=]
line8=line8
[instance.tag!=]
line9=line9
[none.test=1]
line10=line10
[instance.tag!=aaa]
line11=line11
[configRoles=dev]
line12=line12
[configRoles=beta]
line13=line13
[global]
line2=line2
`;

    var args = lib.configParse(data);
    expect(args.includes("-line1"), "expects line1", args)
    expect(args.includes("-line2"), "expects line2", args)
    expect(!args.includes("-line3"), "not expects line3", args)
    expect(!args.includes("-line4"), "not expects line4", args)

    args = lib.configParse(data, { tag: "test1" });
    expect(args.includes("-line1"), "tag: expects line1", args)
    expect(args.includes("-line2"), "tag: expects line2", args)
    expect(args.includes("-line3"), "tag: expects line3", args)
    expect(!args.includes("-line4"), "tag: not expects line4", args)
    expect(!args.includes("-line5"), "tag: not expects line5", args)

    args = lib.configParse(data, { tag: "test", runMode: "test2" });
    expect(args.includes("-line1"), "runMode: expects line1", args)
    expect(args.includes("-line2"), "runMode: expects line2", args)
    expect(!args.includes("-line3"), "runMode: expects line3", args)
    expect(args.includes("-line4"), "runMode: expects line4", args)
    expect(args.includes("-line5"), "runMode: expects line5", args)

    core.instance.tag = "tag";
    core.configRoles = ["dev", "staging", "prod"];
    args = lib.configParse(data, core);
    expect(args.includes("-line6"), "instance tag: expects line6", args, core.instance)
    expect(!args.includes("-line8"), "no aws key: not expects line8", args, aws.key)
    expect(args.includes("-line9"), "instance tag not empty: expects line9", args, core.instance)
    expect(!args.includes("-line10"), "bad module: not expects line10", args)
    expect(args.includes("-line11"), "instance tags != aaa: not expects line11", args)
    expect(args.includes("-line12"), "config roles = dev: expects line12", args)
    expect(!args.includes("-line13"), "config roles != beta: not expects line13", args)

    callback();
}

tests.test_config = function(callback)
{
    var argv = ["-force-uid", "1,1",
                "-api-allow-path", "^/a",
                "-api-allow-admin", "^/a",
                "-api-allow-account-dev=^/a",
                "-api-allow-anonymous=^/a",
                "-api-redirect-url", '{ "^a/$": "a", "^b": "b" }',
                "-logwatcher-send-error", "a",
                "-logwatcher-file-error", "a",
                "-logwatcher-file", "b",
                "-logwatcher-match-error", "a",
                "-db-create-tables",
                "-db-sqlite-pool-max", "10",
                "-db-sqlite1-pool", "a",
                "-db-sqlite1-pool-max", "10",
                "-db-sqlite1-pool-options-cache-columns", "1",
                "-db-sqlite1-pool-options-test", "test",
                "-db-sqlite-pool-options-discovery-interval", "30000",
                "-db-sqlite-pool-options-map.test", "test",
                "-db-sqlite-pool-options", "arg1:1,arg2:2",
                "-db-aliases-Test6", "t",
                "-ipc-queue", "local://default?bk-count=2",
                "-ipc-queue-q", "local://queue?bk-test=10",
                "-ipc-queue-q-options", "count:10,interval:100",
                "-ipc-queue-q-options-visibilityTimeout", "1000",
                "-api-cleanup-rules-aaa", "one:1,two:2",
                "-api-cleanup-rules-aaa", "three:3",
            ];
    core.parseArgs(argv);
    logger.debug("config:", db.poolParams);

    describe("core parameters");

    assert(core.forceUid[0] != 1, "invalid force-uid", core.forceUid)
    assert(!core.workerId && !db._createTables, "invalid db-create-tables");

    describe("DB parameters");

    expect(db.aliases.t == "test6", "db alias must be lowercase", db.aliases);

    assert(db.poolParams.sqlite?.max != 10, "invalid sqlite max", db.poolParams.sqlite);
    assert(db.poolParams.sqlite.configOptions.arg1 != 1 || db.poolParams.sqlite.configOptions.arg2 != 2, "invalid sqlite map with args", db.poolParams.sqlite);

    assert(db.poolParams.sqlite1?.url != "a", "invalid sqlite1 url", db.poolParams.sqlite1);
    assert(db.poolParams.sqlite1.max != 10, "invalid sqlite1 max", db.poolParams.sqlite1);
    assert(!db.poolParams.sqlite1.configOptions.cacheColumns, "invalid sqlite1 cache-columns", db.poolParams.sqlite1);
    assert(db.poolParams.sqlite.configOptions.discoveryInterval != 30000, "invalid sqlite interval", db.poolParams.sqlite);
    assert(db.poolParams.sqlite.configOptions['map.test'] != "test", "invalid sqlite map", db.poolParams.sqlite);
    assert(db.poolParams.sqlite1.configOptions.test != "test", "invalid sqlite1 map", db.poolParams.sqlite1);

    describe("IPC parameters");

    logger.debug("config:", ipc.configParams);
    assert(ipc.configParams.q?.count != 10 || ipc.configParams.q?.interval != 100, "invalid queue options", ipc.configParams.q);
    assert(ipc.configParams.q?.visibilityTimeout != 1000, "invalid queue visibility timeout", ipc.configParams.q);

    describe("dynamic IPC parameters");

    for (const p in ipc.configParams) if (p && p != "q") delete ipc.configParams[p];
    ipc.closeClients();
    ipc.initClients();
    var q = ipc.getQueue("");
    assert(q.options.count != 2, "invalid default queue count", q, ipc.configParams)

    core.parseArgs(["-ipc-queue--options-visibilityTimeout", "99", "-ipc-queue", "local://default?bk-count=10"]);
    assert(q.options.visibilityTimeout != 99 || q.options.count != 10, "invalid default queue options", q, ipc.configParams)

    core.parseArgs(["-ipc-queue-fake-options-visibilityTimeout", "11"]);
    assert(q.options.visibilityTimeout == 11, "fake queue should be ignored", q, ipc.configParams)

    describe("default IPC parameters");

    q = ipc.getQueue("q");
    assert(q.options.test != 10, "invalid queue url options", q, ipc.configParams)
    core.parseArgs(["-ipc-queue-q-options-visibilityTimeout", "99", "-ipc-queue-q-options", "count:99"]);
    assert(q.options.visibilityTimeout != 99 || q.options.count != 99, "invalid q queue options", q, ipc.configParams)

    describe("logwatcher parameters");

    assert(core.logwatcherSend.error != "a", "invalid logwatcher email", core.logwatcherSend);
    assert(core.logwatcherMatch.error.indexOf("a") == -1, "invalid logwatcher match", core.logwatcherMatch);
    assert(!core.logwatcherFile.some(function(x) { return x.file == "a" && x.type == "error"}), "invalid logwatcher file", core.logwatcherFile);
    assert(!core.logwatcherFile.some(function(x) { return x.file == "b"}), "invalid logwatcher file", core.logwatcherFile);

    describe("API parameters");

    assert(!api.allow.list.some(function(x) { return x == "^/a"}), "invalid allow path", api.allow);
    assert(!api.allowAdmin.list.some(function(x) { return x == "^/a"}), "invalid allow admin", api.allowAdmin);

    assert(api.cleanupRules.aaa?.one != 1 || api.cleanupRules.aaa?.two != 2 || api.cleanupRules.aaa?.three != 3, "invalid api cleanup rules", api.cleanupRules);

    callback();
}

tests._test_logwatcher = function(callback)
{
    var argv = ["-logwatcher-send-error", "console://",
                "-logwatcher-send-test", "console://",
                "-logwatcher-send-ignore", "console://",
                "-logwatcher-send-warning", "console://",
                "-logwatcher-send-any", "console://",
                "-logwatcher-match-test", "TEST: ",
                "-logwatcher-ignore-error", "error2",
                "-logwatcher-ignore-warning", "warning2",
                "-logwatcher-once-test2", "test2",
                "-logwatcher-match-any", "line:[0-9]+",
                "-log-file", "tmp/message.log",
                "-err-file", "tmp/error.log",
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

    core.logwatcherFile = core.logwatcherFile.filter((x) => (x.name));

    core.parseArgs(argv);
    fs.writeFileSync(core.errFile, lines.join("\n"));
    fs.writeFileSync(core.logFile, lines.join("\n"));
    core.watchLogs((err, rc) => {
        expect(lib.objKeys(rc.errors).length == 4, "no errors matched", rc);
        callback(err);
    });
}

