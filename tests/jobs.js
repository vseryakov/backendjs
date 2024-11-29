/* global lib jobs core ipc sleep queue promisify */

const submitJob = promisify(jobs.submitJob.bind(jobs));

tests.test_jobs = async function(callback, test)
{
    const queueName = test.queue || lib.getArg("-test-queue") || queue.getClient().queueName;

    // To avoid racing conditions and poll faster
    var q = queue.getClient(queueName);
    q.options.interval = q.options.retryInterval = 50;

    var file = core.path.tmp + "/" + process.pid + ".test";
    var opts = { queueName };

    await jobs.submitJob({ job: { "shell.testJob": { file, data: "job" } } }, opts);
    await sleep(1000)

    var data = lib.readFileSync(file);
    expect(/job/.test(data), "expect job finished", file, data, opts);

    await submitJob({ job: { "shell.testJob": { file, cancel: process.pid, timeout: 5000 } } }, opts);
    await sleep(1000)

    // jobs.cancelJob only sends to workers so we send to all shells explicitly
    ipc.broadcast(core.name + ":" + core.role, ipc.newMsg("jobs:cancel", { key: process.pid }));
    await sleep(1000);

    data = lib.readFileSync(file);
    expect(/cancelled/.test(data), "expect job cancelled", file, data, opts);

    await submitJob({ job: { "shell.testJob": { file, data: "local" } } }, { queueName: "local" });
    await sleep(1000)

    data = lib.readFileSync(file);
    expect(/local/.test(data), "expect local job", file, data);

    callback();
}

tests.test_master_worker = async function(callback, test)
{
    var file = core.path.tmp + "/" + process.pid + ".test";

    await submitJob({ job: { "shell.testJob": { file, data: "worker" } } }, { queueName: "worker" });
    await sleep(2000)

    var data = lib.readFileSync(file);
    expect(/worker/.test(data), "expect worker job", file, data);
    expect(!data.includes(` ${process.pid} `), "expect worker pid in worker job", file, data)

    callback();
}

