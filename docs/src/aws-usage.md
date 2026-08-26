# Using the AWS Module

The `aws` module is a dependency-free AWS toolkit built on top of the raw HTTP API. It does
**not** require the `@aws-sdk/*` or `aws-sdk` packages — instead it signs requests itself
(AWS Signature Version 4, {@link module:aws.signQuery}) and talks to each service directly. XML
responses are parsed into objects with `fast-xml-parser`, JSON is returned as is.

```js
const { aws, logger } = require("backendjs");
```

Every method comes in two forms, use whichever you prefer:

```js
// callback
aws.s3GetFile("s3://bucket/key", (err, rc) => { ... });

// async — add the 'a' prefix, resolves { err, data, request }
const { err, data } = await aws.aqueryS3("bucket", "key", { method: "GET" });
```

---

## How credentials work

The module picks credentials from the first source that provides them:

| Source | How |
| --- | --- |
| Config / CLI | `-key`, `-secret`, `-token`, `-region` |
| Environment | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` |
| EC2/ECS instance | instance role + IMDS (metadata host `169.254.169.254`) |
| ECS container | `AWS_CONTAINER_CREDENTIALS_FULL_URI` / `RELATIVE_URI` |
| SDK profile file | `~/.aws/credentials` + `~/.aws/config` via `-sdk-profile` |

When backendjs detects it is running inside AWS, `app.env.type` is set to `"aws"` and
`app.env` is populated with `id`, `region`, `zone`, `image`, `instance_type`, etc. — no
extra code needed. This happens automatically in {@link module:aws.configure}, which is wired
into the normal startup sequence.

For local development, use the `bksh` shell to load credentials from your SDK profile:

```shell
# bin/bksh -aws-sdk-profile default

> aws.queryS3("", "/", (err, rc) => {
>     console.log(rc?.ListAllMyBucketsResult?.Buckets)
> })
```

---

## Loading external config

`aws.readConfig` pulls configuration from up to three external sources **before** the database
pools are initialized, and can refresh it on an interval.

**From an S3 bucket** (different file per run mode via `@..@` placeholders):

```
# bkjs-aws.conf  (running in AWS)          # bkjs-dev.conf  (local)
aws-config-s3-file = s3://mybucket/config/bkjs-@type@.conf
```
```
# s3 object bkjs-production.conf
[roles=production]
db-dynamodb-pool = default
db-pool = dynamodb
app-log-level    = info
```

**From AWS Systems Manager parameter store** — every parameter under the prefix is applied
as if passed on the command line:

```
aws-config-parameters = /bkjs/config/
```

**From Secrets Manager** — filters support `@..@` placeholders and resolve the run mode:

```
aws-config-secrets = production,production-@tag@,production-@role@
```
```shell
# two matching secrets, one per mode, each holding `key = value` lines
aws secretsmanager create-secret --name bkjs-production --secret-string "api-key = 9887"
aws secretsmanager create-secret --name bkjs-dev         --secret-string "api-key = 0000"
```

To reload on a schedule (interval is in minutes):

```
aws-config-s3-interval = 30
```

---

## DynamoDB

The `db` module uses DynamoDB when `BKJS_ROLES=dynamodb`, but you can also call the raw
helpers directly. All values are auto-converted via {@link module:aws.toDynamoDB} /
{@link module:aws.fromDynamoDB}, so you write plain objects. These are callback-based
helpers; the `db` module already calls them internally (`lib/db/dynamodb.js`), so the forms
below are what you typically use yourself:

```js
// Create a table: composite key, a local index, pay-per-request billing
aws.ddbCreateTable("users", {
    keys:  ["id", "name"],
    attrs: { id: "S", name: "S", gender: "S", mtime: "N" },
    local: { mtime: { mtime: "N", projection: "ALL" } },
    stream: "NEW_IMAGE",
}, (err, item) => { ... });

// Insert — condition that `name` must not already exist
aws.ddbPutItem("users", { id: 1, name: "john", mtime: Date.now() },
    { query: { name: null } }, (err, rc) => { ... });

// Update with per-column operators; `null` deletes the attribute
aws.ddbUpdateItem("users", { id: 1 }, { gender: "male", icons: "1.png" },
    { ops: { icons: "add" }, query: { id: 1 }, returning: "*" }, (err, rc) => {
        console.log(rc.Item.gender, rc.Item.icons);   // rc.Item is auto-converted back
    });

// Query a GSI by range key
aws.ddbQueryTable("users", { id: 1, name: "john" },
    { select: "id,name", ops: { name: "gt" } }, (err, rc) => {
        console.log(rc.Items);   // auto-converted to plain objects
    });

// Scan with a raw filter expression
aws.ddbScanTable("users", "id=:id AND name=:name",
    { values: { id: 1, name: "a" } }, (err, rc) => { ... });

// Delete
aws.ddbDeleteItem("users", { id: 1 }, (err) => { ... });
```

Batch and transaction helpers group several operations:

```js
// Two writes at once, in one API call
aws.ddbBatchWriteItem({ users: [ { put: { id: 1, name: "tt" } }, { del: { id: 2 } }] }, callback);

// Atomic multi-table transaction — anything failing rolls everything back
aws.ddbTransactWriteItems([
    { op: "get",    table: "accounts", query: { id: 1 }, options: { query: { balance: 100 } } },
    { op: "update", table: "accounts", keys: { id: 1 }, query: { balance: -10 }, options: { ops: { balance: "incr" } } },
], callback);
```

For local development point the queries at a DynamoDB Local endpoint:

```
ddb-endpoint = http://localhost:8000
```

---

## S3 storage

S3 paths are expressed as `s3://bucket/key` and `@..@` placeholders are supported.
`modules.files` is a thin wrapper over these helpers, so most code just calls `files` —
but the raw calls are useful for custom flows.

```js
// Download (also used by readConfig to pull S3-hosted config)
aws.s3GetFile("s3://mybucket/config/bkjs.conf", { httpTimeout: 1000 }, (err, rc) => {
    if (rc.status === 200) app.parseConfig(rc.data);
});

// Upload a Buffer or a filename
aws.s3PutFile("s3://mybucket/out/report.json", myBuffer,
    { contentType: "application/json", acl: "private" }, (err, rc) => { ... });

// List everything under a prefix (auto-paginates)
aws.s3List("s3://mybucket/logs/", (err, rows, prefixes) => {
    console.log(rows, prefixes);
});

// Copy one object to another, optional ACL / content-type
aws.s3CopyFile("s3://mybucket/b/dest", "s3://mybucket/a/src",
    { acl: "public-read" }, callback);
```

To stream an object straight into an HTTP response (e.g. to serve a download), use
{@link module:aws.s3Proxy}, which is what `modules.files` uses:

```js
// in a middleware
modules.files.get(context.req, "reports/123.pdf", (err, rc) => {
    aws.s3Proxy(context.res, rc.bucket, rc.path, { attachment: "report.pdf" });
});
```

---

## Message queues (SQS)

SQS is one of the backends for the {@link module:jobs} queue — set `queue-name = sqs://my-queue`
in your config and jobs flow through AWS automatically. For direct use:

```js
// Send, with optional delay, FIFO group and message attributes
aws.sqsSendMessage("https://queue.amazonaws.com/123/my.fifo", "hello world", {
    delay: 5000,
    groupName: "order-42",
    attrs:   { priority: 5, kind: "critical" },
}, callback);

// Receive up to N messages with long-poll
aws.sqsReceiveMessage("https://queue.amazonaws.com/123/my-queue", {
    count: 10,
    timeout: 5000,
}, (err, rows) => {
    rows.forEach((m) => console.log(m.MessageId, m.Body));
});
```

### Handling event-driven work

SNS (and EventBridge) notifications that are delivered to an SQS queue are intercepted by
{@link module:aws.configureJob} before they ever reach your jobs. For SNS alarms it dispatches
to any `awsProcessNotification` handler you define; for `aws.ec2` / `aws.ecs` EventBridge
events it maps them to `awsProcessInstanceStateChange` / `awsProcessTaskStateChange`.

```js
// a module can react to CloudWatch/SNS alarms
module.exports = {
    name: "monitoring",

    awsProcessNotification(alarm, options, callback) {
        logger.warn("alarm fired:", alarm.alarmName, alarm.subject, alarm.newStateValue);
        callback();
    }
};
```

---

## Compute: EC2, ECS, and SSM

```js
// Launch on-demand instances. Any native EC2 param is accepted with a capital first
// letter, plus a set of convenience options (imageId, instanceType, keyName, targetGroup,
// elasticIp, alarms, device, ...). Callback gets (err, rawResponse, info) where info holds
// the prepared instance objects and the context needed to continue configuring them.
aws.ec2RunInstances({
    min: 2,
    imageId: "ami-0123456789abcdef0",
    instanceType: "t4g.small",
    name: "my-worker-%i",          // %i is replaced with the instance index
    tags: { app: "backendjs" },
    targetGroup: "arn:aws:elasticloadbalancing:...",
    alarms: [ { metric: "CPUUtilization", threshold: 90 } ],
    waitRunning: 1, waitTimeout: 120000,
}, (err, _rc, info) => {
    info.instances.forEach((i) => {
        console.log(i.instanceId, i.privateIpAddress, i.name);
    });
});
```

`ec2RunInstances` already waits for `running`, applies tags, registers the instance with the
target group, attaches the Elastic IP and creates the CloudWatch alarms — see
{@link module:aws.ec2AfterRunInstances} for what it does under the hood.

```js
// Look up instances by tag, state, group, vpc, ...
aws.ec2DescribeInstances({ tagName: "my-worker-%i", stateName: "running" },
    (err, list) => { ... });

// Register / deregister with an Application Load Balancer target group
aws.elb2RegisterInstances("arn:aws:elasticloadbalancing:.../tg/my-tg", "i-0abc123", callback);
aws.elb2DeregisterInstances("arn:aws:elasticloadbalancing:.../tg/my-tg", ["i-0abc123"], callback);

// Run a shell command on remote instances via SSM
aws.ssmSendCommand("uptime", ["i-0abc123"], { region: "us-east-1" }, (err, rc) => {
    aws.ssmWaitForCommand(rc.CommandId, "i-0abc123", (err, output) => {
        console.log(output.Status, output.StandardOutputContent);
    });
});
```

The same `bksh` shell can drive these from the command line, e.g. `bksh -aws-run-instances -image-name ...`.

---

## Monitoring: CloudWatch

```js
// Create / update an alarm. A topic ARN to notify on each state can be given.
aws.cwPutMetricAlarm({
    name:  "worker-high-cpu",
    metric: "CPUUtilization",
    namespace: "AWS/EC2",
    dimensions: { InstanceId: "i-0abc123" },
    op: ">=", threshold: 90, period: 60, evaluationPeriods: 3,
    alarm: "arn:aws:sns:...:my-topic",
}, callback);

// Publish custom metrics
aws.cwPutMetricData("MyApp", {
    requests: 12,
    latency: { value: [0, 200, 2400, 12], Host: "i-0abc123" },   // [min, max, sum, count]
}, callback);

// Fetch time-series for one or more metrics over the last 5 minutes
aws.cwGetMetricData({
    age: 300000,
    metrics: [
        { name: "NetworkOut", label: "Traffic", stat: "Average",
          dimensions: { InstanceId: "i-0abc123" } },
        { name: "CPUUtilization", label: "CPU", dimensions: { InstanceId: "i-0abc123" } },
    ],
}, (err, rc) => {
    rc.data.forEach((m) => console.log(m.label, m.data.length, "points"));
});
```

CloudWatch **Logs** helpers ({@link module:aws.cwlFilterLogEvents},
{@link module:aws.cwPutLogEvents}) let you read and write log streams:

```js
aws.cwlFilterLogEvents({
    name: "/backendjs/prod", filter: "ERROR",
    stime: Date.now() - 3600000, limit: 500,
}, (err, rc) => rc.events.forEach((e) => console.log(e.message)));
```

---

## Notifications: SNS and SES

```js
// Send a push to a device endpoint (modules.push uses this)
aws.snsPublish("arn:aws:sns:us-west-2:123:app/APNE/my-app", {
    alert: "title", body: "hello"
}, callback);

// Create a topic and get its ARN back
aws.snsCreateTopic("my-notifications", (err, arn) => { ... });

// Send an email (text or HTML)
aws.sesSendEmail("alice@example.com", "Hi", "This is the body", {
    from: "admin@example.com", html: false, cc: "bob@example.com"
}, callback);
```

Set the platform application ARN used for push once, globally: `-sns-app-arn arn:...`.

---

## DNS: Route53

```js
// UPSERT an A record for a host at the current machine's IP address.
// `names` may be a FQDN string (app.env / app placeholders are expanded) or an array
// of { name, value, type, ttl, zoneId, alias } objects.
aws.route53Change("api.example.com", { type: "A", ttl: 300 }, callback);

aws.route53Change([
    { name: "web1.example.com", value: "10.0.0.5", type: "A" },
    { name: "cdn.example.com",  value: "my-elb-1234.us-east-1.elb.amazonaws.com", type: "CNAME", alias: 1 },
], callback);
```

This is also used on server startup when `host-name` is configured, so that the running
instance registers a live DNS entry pointing at its private IP.

---

## Secrets, certificates, and Bedrock

```js
// Read a secret
aws.getSecretValue("bkjs/db", { region: "us-east-1" }, (err, rc) => {
    console.log(JSON.parse(rc.SecretString));
});

// Read several secrets at once
aws.batchGetSecretValue({ filters: "production,production-@tag@" },
    (err, list) => list.forEach((s) => console.log(s.Name, s.SecretString)));

// List ACM certificates (paginated)
aws.listCertificates({ status: "ISSUED" }, (err, list) => { ... });

// Temporary credentials via a different role (cross-account access)
aws.stsAssumeRole({ role: "arn:aws:iam::123456789012:role/reader", name: "job-worker" },
    (err, creds) => {
        // creds.credentials = { key, secret, token, expiration }
        aws.s3GetFile("s3://other-account-bucket/key",
            { credentials: creds.credentials }, (err, rc) => { ... });
    });
```

For AI workloads, Bedrock is reachable directly through the SigV4 request helpers:

```js
aws.bedrockConverse("anthropic.claude-<model>", {
    prompt: "Explain backendjs in one sentence",
    system: "You are concise.",
    maxTokens: 64,
}, (err, obj) => console.log(obj?.completion?.[0]?.content?.[0]?.text));
```

---

## Other databases: RDS Data API

Run SQL against an Aurora Serverless cluster without a driver:

```js
aws.rdsDataExecuteStatement({
    resourceArn: "arn:aws:rds:us-east-1:123456789012:cluster:mydbcluster",
    secretArn:   "arn:aws:secretsmanager:us-east-1:123456789012:secret:mysecret",
    database:    "mydb",
    sql: "select id, name from mytable where id = :id",
    parameters: [{ name: "id", value: { longValue: 1 } }],
    convertResult: true,      // rows returned as plain objects
}, (err, obj) => console.log(obj.records));
```

---

## Calling a service directly

When a convenience helper is not provided, drop down to the two raw request builders. These
are also where the `a`-prefixed async form is available:

`queryEndpoint` (and its `a`-prefixed `aqueryEndpoint`) handles the EC2-style services that
speak query strings + XML:

```js
// equivalent to aws.queryEC2 / aws.querySTS / aws.querySQS / ...
aws.queryEndpoint("ec2", "2016-11-15", "DescribeInstances", { "Filter.1.Name": "instance-id" },
    { region: "us-east-1" }, (err, rc) => { ... });
```

`queryService` (and `aqueryService`) handles the JSON/`X-Amz-Target` services (SSM, ACM, ECR,
Secrets, CloudWatch Logs, ECS):

```js
aws.queryService({ endpoint: "ssm", target: "AmazonSSM", action: "GetParameter" },
    { Name: "my/param" }, (err, rc) => { ... });
```

All the named helpers (`queryEC2`, `querySSM`, `queryECS`, `querySecrets`, ...) are thin
wrappers over one of these two — use them when available because they pin the correct
service version for you.

---

## Per-service tuning

Each `query*` call accepts standard options that control retries, region and endpoints:

| option | effect |
| --- | --- |
| `region` | override the region used (per service region limits apply, e.g. route53domains → `us-east-1`) |
| `retryCount` | max retries; each service has a default in `aws.retryCount` |
| `retryTimeout` | back-off between retries |
| `retryOnError(err,res)` | per-request retry predicate; uses `aws.retryOnError` by default |
| `endpoint` | custom base URL, handy for local stacks (e.g. DynamoDB Local) |
| `credentials` | `{ key, secret, token }` to sign with a different identity |
| `httpTimeout` | per-request timeout in ms |

The full set of config options (`-key`, `-secret`, `-target-group`, `-image-id`,
`-config-s3-file`, `-ddb-endpoint`, ...) is listed on the top-level
{@link module:aws} object under `args`.
