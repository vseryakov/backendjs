/* global lib jobs core ipc sleep */

tests.test_jobs = function(callback, test)
{
    var file = core.path.tmp + "/" + process.pid + ".test";

    lib.series([
        function(next) {
            jobs.submitJob({ job: { "shell.testJob": { file } } }, lib.tryLater(next, 1000));
        },

        function(next) {
            var data = lib.readFileSync(file);
            expect(/^(server)/.test(data), "expect job finished", file, data);

            next();
        },

        function(next) {
            jobs.submitJob({ job: { "shell.testJob": { file, cancel: process.pid, timeout: 5000 } } }, lib.tryLater(next, 1000));
        },

        async function(next) {
            // cancelJob only sends to workers
            ipc.broadcast(core.name + ":shell", ipc.newMsg("jobs:cancel", { key: process.pid }));
            await sleep(1000);

            var data = lib.readFileSync(file);
            expect(/cancelled/.test(data), "expect job cancelled", file, data);

            next();
        },

        function(next) {
            jobs.submitJob({ job: { "shell.testJob": { file, data: "local" } } }, { queueName: "local" }, lib.tryLater(next, 1000));
        },

        function(next) {
            var data = lib.readFileSync(file);
            expect(/ local/.test(data), "expect local job", file, data);
            expect(data.includes(` ${process.pid} `), "expect local pid", file, data)
            next();
        },

    ], callback);
}

tests.test_master_worker = function(callback, test)
{
    var file = core.path.tmp + "/" + process.pid + ".test";

    lib.series([
        function(next) {
            jobs.submitJob({ job: { "shell.testJob": { file, data: "worker" } } }, { queueName: "worker" }, lib.tryLater(next, 2000));
        },

        function(next) {
            var data = lib.readFileSync(file);
            expect(/ worker/.test(data), "expect worker job", file, data);
            expect(!data.includes(` ${process.pid} `), "expect worker pid in worker job", file, data)
            next();
        },
    ], callback);
}

