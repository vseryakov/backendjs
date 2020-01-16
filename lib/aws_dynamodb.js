//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const logger = require(__dirname + '/logger');
const core = require(__dirname + '/core');
const lib = require(__dirname + '/lib');
const aws = require(__dirname + '/aws');

core.describeArgs("aws", [
    { name: "ddb-endpoint", descr: "Default endpoint to use, for LocalDynamoDB use" },
    { name: "ddb-read-capacity", type: "int", min: 0, descr: "Default DynamoDB read capacity for all tables" },
    { name: "ddb-write-capacity", type: "int", min: 0, descr: "Default DynamoDB write capacity for all tables" },
    { name: "ddb-retry-count", type: "int", min: 5, descr: "Default DynamoDB number of retries in case of throttling event" },
    { name: "ddb-retry-timeout", type: "int", min: 200, descr: "Default DynamoDB min timeout for retry backoff in case of throttling event" },
]);

// DynamoDB reserved keywords
aws.ddbReserved = {
    ABORT: 1, ABSOLUTE: 1, ACTION: 1, ADD: 1, AFTER: 1, AGENT: 1, AGGREGATE: 1, ALL: 1, ALLOCATE: 1, ALTER: 1, ANALYZE: 1, AND: 1, ANY: 1, ARCHIVE: 1, ARE: 1, ARRAY: 1, AS: 1, ASC: 1,
    ASCII: 1, ASENSITIVE: 1, ASSERTION: 1, ASYMMETRIC: 1, AT: 1, ATOMIC: 1, ATTACH: 1, ATTRIBUTE: 1, AUTH: 1, AUTHORIZATION: 1, AUTHORIZE: 1, AUTO: 1, AVG: 1, BACK: 1,
    BACKUP: 1, BASE: 1, BATCH: 1, BEFORE: 1, BEGIN: 1, BETWEEN: 1, BIGINT: 1, BINARY: 1, BIT: 1, BLOB: 1, BLOCK: 1, BOOLEAN: 1, BOTH: 1, BREADTH: 1,
    BUCKET: 1, BULK: 1, BY: 1, BYTE: 1, CALL: 1, CALLED: 1, CALLING: 1, CAPACITY: 1, CASCADE: 1, CASCADED: 1, CASE: 1, CAST: 1, CATALOG: 1, CHAR: 1, CHARACTER: 1, CHECK: 1,
    CLASS: 1, CLOB: 1, CLOSE: 1, CLUSTER: 1, CLUSTERED: 1, CLUSTERING: 1, CLUSTERS: 1, COALESCE: 1, COLLATE: 1, COLLATION: 1, COLLECTION: 1, COLUMN: 1, COLUMNS: 1, COMBINE: 1,
    COMMENT: 1, COMMIT: 1, COMPACT: 1, COMPILE: 1, COMPRESS: 1, CONDITION: 1, CONFLICT: 1, CONNECT: 1, CONNECTION: 1, CONSISTENCY: 1, CONSISTENT: 1, CONSTRAINT: 1,
    CONSTRAINTS: 1, CONSTRUCTOR: 1, CONSUMED: 1, CONTINUE: 1, CONVERT: 1, COPY: 1, CORRESPONDING: 1, COUNT: 1, COUNTER: 1, CREATE: 1, CROSS: 1, CUBE: 1, CURRENT: 1, CURSOR: 1, CYCLE: 1,
    DATA: 1, DATABASE: 1, DATE: 1, DATETIME: 1, DAY: 1, DEALLOCATE: 1, DEC: 1, DECIMAL: 1, DECLARE: 1, DEFAULT: 1, DEFERRABLE: 1, DEFERRED: 1, DEFINE: 1, DEFINED: 1, DEFINITION: 1,
    DELETE: 1, DELIMITED: 1, DEPTH: 1, DEREF: 1, DESC: 1, DESCRIBE: 1, DESCRIPTOR: 1, DETACH: 1, DETERMINISTIC: 1, DIAGNOSTICS: 1, DIRECTORIES: 1, DISABLE: 1, DISCONNECT: 1,
    DISTINCT: 1, DISTRIBUTE: 1, DO: 1, DOMAIN: 1, DOUBLE: 1, DROP: 1, DUMP: 1, DURATION: 1, DYNAMIC: 1, EACH: 1, ELEMENT: 1, ELSE: 1, ELSEIF: 1, EMPTY: 1, ENABLE: 1, END: 1, EQUAL: 1,
    EQUALS: 1, ERROR: 1, ESCAPE: 1, ESCAPED: 1, EVAL: 1, EVALUATE: 1, EXCEEDED: 1, EXCEPT: 1, EXCEPTION: 1, EXCEPTIONS: 1, EXCLUSIVE: 1, EXEC: 1, EXECUTE: 1, EXISTS: 1, EXIT: 1, EXPLAIN: 1,
    EXPLODE: 1, EXPORT: 1, EXPRESSION: 1, EXTENDED: 1, EXTERNAL: 1, EXTRACT: 1, FAIL: 1, FALSE: 1, FAMILY: 1, FETCH: 1, FIELDS: 1, FILE: 1, FILTER: 1, FILTERING: 1, FINAL: 1,
    FINISH: 1, FIRST: 1, FIXED: 1, FLATTERN: 1, FLOAT: 1, FOR: 1, FORCE: 1, FOREIGN: 1, FORMAT: 1, FORWARD: 1, FOUND: 1, FREE: 1, FROM: 1, FULL: 1, FUNCTION: 1, FUNCTIONS: 1,
    GENERAL: 1, GENERATE: 1, GET: 1, GLOB: 1, GLOBAL: 1, GO: 1, GOTO: 1, GRANT: 1, GREATER: 1, GROUP: 1, GROUPING: 1, HANDLER: 1, HASH: 1, HAVE: 1, HAVING: 1, HEAP: 1, HIDDEN: 1, HOLD: 1,
    HOUR: 1, IDENTIFIED: 1, IDENTITY: 1, IF: 1, IGNORE: 1, IMMEDIATE: 1, IMPORT: 1, IN: 1, INCLUDING: 1, INCLUSIVE: 1, INCREMENT: 1, INCREMENTAL: 1, INDEX: 1, INDEXED: 1,
    INDEXES: 1, INDICATOR: 1, INFINITE: 1, INITIALLY: 1, INLINE: 1, INNER: 1, INNTER: 1, INOUT: 1, INPUT: 1, INSENSITIVE: 1, INSERT: 1, INSTEAD: 1, INT: 1, INTEGER: 1, INTERSECT: 1,
    INTERVAL: 1, INTO: 1, INVALIDATE: 1, IS: 1, ISOLATION: 1, ITEM: 1, ITEMS: 1, ITERATE: 1, JOIN: 1, KEY: 1, KEYS: 1, LAG: 1, LANGUAGE: 1, LARGE: 1, LAST: 1, LATERAL: 1, LEAD: 1,
    LEADING: 1, LEAVE: 1, LEFT: 1, LENGTH: 1, LESS: 1, LEVEL: 1, LIKE: 1, LIMIT: 1, LIMITED: 1, LINES: 1, LIST: 1, LOAD: 1, LOCAL: 1, LOCALTIME: 1, LOCALTIMESTAMP: 1,
    LOCATION: 1, LOCATOR: 1, LOCK: 1, LOCKS: 1, LOG: 1, LOGED: 1, LONG: 1, LOOP: 1, LOWER: 1, MAP: 1, MATCH: 1, MATERIALIZED: 1, MAX: 1, MAXLEN: 1, MEMBER: 1, MERGE: 1, METHOD: 1,
    METRICS: 1, MIN: 1, MINUS: 1, MINUTE: 1, MISSING: 1, MOD: 1, MODE: 1, MODIFIES: 1, MODIFY: 1, MODULE: 1, MONTH: 1, MULTI: 1, MULTISET: 1, NAME: 1, NAME: 1, NAMES: 1, NATIONAL: 1, NATURAL: 1,
    NCHAR: 1, NCLOB: 1, NEW: 1, NEXT: 1, NO: 1, NONE: 1, NOT: 1, NULL: 1, NULLIF: 1, NUMBER: 1, NUMERIC: 1, OBJECT: 1, OF: 1, OFFLINE: 1, OFFSET: 1, OLD: 1, ON: 1, ONLINE: 1, ONLY: 1,
    OPAQUE: 1, OPEN: 1, OPERATOR: 1, OPTION: 1, OR: 1, ORDER: 1, ORDINALITY: 1, OTHER: 1, OTHERS: 1, OUT: 1, OUTER: 1, OUTPUT: 1, OVER: 1, OVERLAPS: 1, OVERRIDE: 1, OWNER: 1,
    PAD: 1, PARALLEL: 1, PARAMETER: 1, PARAMETERS: 1, PARTIAL: 1, PARTITION: 1, PARTITIONED: 1, PARTITIONS: 1, PATH: 1, PERCENT: 1, PERCENTILE: 1, PERMISSION: 1,
    PERMISSIONS: 1, PIPE: 1, PIPELINED: 1, PLAN: 1, POOL: 1, POSITION: 1, PRECISION: 1, PREPARE: 1, PRESERVE: 1, PRIMARY: 1, PRIOR: 1, PRIVATE: 1, PRIVILEGES: 1, PROCEDURE: 1,
    PROCESSED: 1, PROJECT: 1, PROJECTION: 1, PROPERTY: 1, PROVISIONING: 1, PUBLIC: 1, PUT: 1, QUERY: 1, QUIT: 1, QUORUM: 1, RAISE: 1, RANDOM: 1, RANGE: 1, RANK: 1, RAW: 1, READ: 1,
    READS: 1, REAL: 1, REBUILD: 1, RECORD: 1, RECURSIVE: 1, REDUCE: 1, REF: 1, REFERENCE: 1, REFERENCES: 1, REFERENCING: 1, REGEXP: 1, REGION: 1, REINDEX: 1, RELATIVE: 1, RELEASE: 1,
    REMAINDER: 1, RENAME: 1, REPEAT: 1, REPLACE: 1, REQUEST: 1, RESET: 1, RESIGNAL: 1, RESOURCE: 1, RESPONSE: 1, RESTORE: 1, RESTRICT: 1, RESULT: 1, RETURN: 1, RETURNING: 1,
    RETURNS: 1, REVERSE: 1, REVOKE: 1, RIGHT: 1, ROLE: 1, ROLES: 1, ROLLBACK: 1, ROLLUP: 1, ROUTINE: 1, ROW: 1, ROWS: 1, RULE: 1, RULES: 1, SAMPLE: 1, SATISFIES: 1,
    SAVE: 1, SAVEPOINT: 1, SCAN: 1, SCHEMA: 1, SCOPE: 1, SCROLL: 1, SEARCH: 1, SECOND: 1, SECTION: 1, SEGMENT: 1, SEGMENTS: 1, SELECT: 1, SELF: 1, SEMI: 1, SENSITIVE: 1, SEPARATE: 1,
    SEQUENCE: 1, SERIALIZABLE: 1, SESSION: 1, SET: 1, SETS: 1, SHARD: 1, SHARE: 1, SHARED: 1, SHORT: 1, SHOW: 1, SIGNAL: 1, SIMILAR: 1, SIZE: 1, SKEWED: 1, SMALLINT: 1, SNAPSHOT: 1,
    SOME: 1, SOURCE: 1, SPACE: 1, SPACES: 1, SPARSE: 1, SPECIFIC: 1, SPECIFICTYPE: 1, SPLIT: 1, SQL: 1, SQLCODE: 1, SQLERROR: 1, SQLEXCEPTION: 1, SQLSTATE: 1, SQLWARNING: 1, START: 1,
    STATE: 1, STATIC: 1, STATUS: 1, STORAGE: 1, STORE: 1, STORED: 1, STREAM: 1, STRING: 1, STRUCT: 1, STYLE: 1, SUB: 1, SUBMULTISET: 1, SUBPARTITION: 1, SUBSTRING: 1, SUBTYPE: 1,
    SUM: 1, SUPER: 1, SYMMETRIC: 1, SYNONYM: 1, SYSTEM: 1, TABLE: 1, TABLESAMPLE: 1, TEMP: 1, TEMPORARY: 1, TERMINATED: 1, TEXT: 1, THAN: 1, THEN: 1, THROUGHPUT: 1, TIME: 1,
    TIMESTAMP: 1, TIMEZONE: 1, TINYINT: 1, TO: 1, TOKEN: 1, TOTAL: 1, TOUCH: 1, TRAILING: 1, TRANSACTION: 1, TRANSFORM: 1, TRANSLATE: 1, TRANSLATION: 1, TREAT: 1, TRIGGER: 1, TRIM: 1,
    TRUE: 1, TRUNCATE: 1, TTL: 1, TUPLE: 1, TYPE: 1, UNDER: 1, UNDO: 1, UNION: 1, UNIQUE: 1, UNIT: 1, UNKNOWN: 1, UNLOGGED: 1, UNNEST: 1, UNPROCESSED: 1, UNSIGNED: 1, UNTIL: 1, UPDATE: 1,
    UPPER: 1, URL: 1, USAGE: 1, USE: 1, USER: 1, USERS: 1, USING: 1, UUID: 1, VACUUM: 1, VALUE: 1, VALUED: 1, VALUES: 1, VARCHAR: 1, VARIABLE: 1, VARIANCE: 1, VARINT: 1, VARYING: 1, VIEW: 1,
    VIEWS: 1, VIRTUAL: 1, VOID: 1, WAIT: 1, WHEN: 1, WHENEVER: 1, WHERE: 1, WHILE: 1, WINDOW: 1, WITH: 1, WITHIN: 1, WITHOUT: 1, WORK: 1, WRAPPED: 1, WRITE: 1, YEAR: 1, ZONE: 1,
};

aws.ddbNameRx = /^[a-zA-Z][a-zA-Z0-9]+$/;
aws.ddbRetryCount = 9;
aws.ddbRetryTimeout = 200;
aws.ddbRetryRx = /(InternalServerError|ProvisionedThroughputExceededException|ThrottlingException|SerializationException|UnrecognizedClientException|LimitExceededException)/;

// DynamoDB requests
aws._queryDDB = function(target, service, action, obj, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = lib.empty;
    var start = Date.now();
    var region = options.region || this.region || 'us-east-1';
    if (options.endpoint && options.endpoint.match(/[a-z][a-z]-[a-z]+-[1-9]/)) region = options.endpoint;
    var uri = lib.rxUrl.test(options.endpoint) ? options.endpoint :
              lib.rxUrl.test(this.ddbEndpoint) ? this.ddbEndpoint :
              ((options.endpoint_protocol || 'https') + '://' + (service || 'dynamodb') + "." + region + '.amazonaws.com/');
    target = (target || 'DynamoDB_20120810') + "." + action;
    var headers = { 'content-type': 'application/x-amz-json-1.0; charset=utf-8', 'x-amz-target': target };
    // All capitalized options are passed as is and take priority because they are in native format
    for (var p in options) if (p[0] >= 'A' && p[0] <= 'Z') obj[p] = options[p];
    logger.logger(options.logger_db || "debug", 'queryDDB:', action, uri, 'obj:', obj, 'options:', options);

    var json = lib.stringify(obj);
    var opts = this.queryOptions("POST", json, headers, options);
    opts.retryCount = opts.retryCount || this.ddbRetryCount;
    opts.retryTimeout = opts.retryTimeout || this.ddbRetryTimeout;
    opts.retryOnError = this.ddbRetryOnError;
    opts.datatype = "obj";
    opts.region = region;
    opts.signer = this.ddbQuerySigner;
    core.httpGet(uri, opts, function(err, params) {
        if (!params.obj) params.obj = {};
        if (params.status != 200) {
            if (!err) {
                err = lib.newError(params.obj.message || params.obj.Message || (action + " Error " + params.status));
                err.code = lib.strSplit(params.obj.__type || params.obj.code, "#").pop();
            }
            err.action = action;
            if (err.code == "ConditionalCheckFailedException") options = "debug";
            logger.errorWithOptions(err, options, 'queryDDB:', err, action, obj, params.toJSON(options && options.debug_error));
        } else {
            logger.logger(options.logger_db || "debug", 'queryDDB:', action, 'finished:', Date.now() - start, 'ms', params.size, "bytes", params.obj.Item ? '1 row' : params.obj.Count ? params.obj.Count + ' rows' : "", params.obj.ConsumedCapacity || "");
        }
        if (params.retryCount < params.retryTotal) {
            params.obj.retry_count = params.retryTotal - Math.min(0, params.retryCount);
        }
        if (typeof callback == "function") callback(err, params.obj);
    });
}

aws.queryDDB = function(action, obj, options, callback)
{
    this._queryDDB("", "", action, obj, options, callback);
}

aws.ddbRetryOnError = function()
{
    return this.status == 529 || this.status == 500 || this.status == 503 || aws.ddbRetryRx.test(this.data)
}

aws.ddbQuerySigner = function()
{
    aws.querySign(this.region, "dynamodb", this.hostname, "POST", this.path, this.postdata, this.headers, this.credentials);
}

// Convert a Javascript object into DynamoDB object
aws.toDynamoDB = function(value, level)
{
    var res;
    switch (lib.typeName(value)) {
    case 'null':
        return { "NULL": 'true' };

    case 'boolean':
        return { "BOOL": value.toString() };

    case 'number':
        return { "N": isNaN(value) ? 0 : value.toString() };

    case 'buffer':
        return { "B": value.toString("base64") };

    case "date":
        return { "N": Math.round(value.getTime()/1000) };

    case 'array':
        if (!value.length) return level ? { "L": value } : value;
        var types = { number: 0, string: 0 };
        for (let i = 0; i < value.length; i++) types[typeof value[i]]++;
        if (types.number == value.length) return { "NS": value };
        if (types.string == value.length) return { "SS": value };
        res = [];
        for (const i in value) {
            if (typeof value[i] != 'undefined') res.push(this.toDynamoDB(value[i], 1));
        }
        return level ? { "L": res } : res;

    case 'object':
        res = {};
        for (const p in value) {
            if (typeof value[p] != 'undefined') res[p] = this.toDynamoDB(value[p], 1);
        }
        return level ? { "M": res } : res;

    default:
        return { "S": String(value) };
    }
}

// Convert a DynamoDB object into Javascript object
aws.fromDynamoDB = function(value, level)
{
    var res;
    switch (lib.typeName(value)) {
    case 'array':
        res = [];
        for (var i in value) {
            res.push(this.fromDynamoDB(value[i], level));
        }
        return res;

    case 'object':
        if (level) {
            for (var p in value) {
                switch(p) {
                case 'NULL':
                    return null;
                case 'BOOL':
                    return lib.toBool(value[p]);
                case 'L':
                    return this.fromDynamoDB(value[p], 1);
                case 'M':
                    return this.fromDynamoDB(value[p]);
                case 'S':
                case 'SS':
                    return value[p];
                case 'B':
                    return Buffer.from(value[p].B, "base64");
                case 'BS':
                    res = [];
                    for (let j = 0; j < value[p].length; j++) {
                        res[j] = Buffer.from(value[p][j], "base64");
                    }
                    return res;
                case 'N':
                    return lib.toNumber(value[p]);
                case 'NS':
                    res = [];
                    for (let j = 0; j < value[p].length; j++) {
                        res[j] = lib.toNumber(value[p][j]);
                    }
                    return res;
                }
            }
            return null;
        }
        res = {};
        for (const p in value) {
            if (!value.hasOwnProperty(p)) continue;
            res[p] = this.fromDynamoDB(value[p], 1);
        }
        return res;

    default:
        return value;
    }
}

// Build a condition expression for the given object, all properties in the obj are used
aws.queryExpression = function(params, obj, options, join)
{
    var opsMap = { "!=": "<>", eq: "=", ne: "<>", lt: "<", le: "<=", gt: ">", ge: ">=" };
    var ops = options.ops || lib.empty;
    var jops = options.joinOps || lib.empty;
    var aliases = options.aliases || lib.empty;
    var expr = [];

    function _checkName() {
        if (!aws.ddbNameRx.test(name) || aws.ddbReserved[name.toUpperCase()]) {
            if (name.indexOf(".") > -1) {
                if (!params.ExpressionAttributeNames) params.ExpressionAttributeNames = {};
                name = name.split(".").map((x) => {
                    for (const n in params.ExpressionAttributeNames) if (params.ExpressionAttributeNames[n] == x) return n;
                    const h = lib.objKeys(params.ExpressionAttributeNames).length;
                    params.ExpressionAttributeNames["#n" + h] = x;
                    return "#n" + h;
                }).join(".");
            } else {
                for (const n in params.ExpressionAttributeNames) {
                    if (params.ExpressionAttributeNames[n] == name) name = params.ExpressionAttributeNames[n];
                }
                if (name[0] != "#") {
                    if (!params.ExpressionAttributeNames) params.ExpressionAttributeNames = {};
                    const h = lib.objKeys(params.ExpressionAttributeNames).length;
                    params.ExpressionAttributeNames["#n" + h] = name;
                    name = "#n" + h;
                }
            }
        }
    }
    function _addValue(val) {
        if (!params.ExpressionAttributeValues) params.ExpressionAttributeValues = {};
        const h = lib.objKeys(params.ExpressionAttributeValues).length;
        params.ExpressionAttributeValues[":v" + h] = aws.toDynamoDB(val);
        return h;
    }

    for (var name in obj) {
        var val = obj[name];
        var d = name.match(/^\$(or|and)/);
        if (d) {
            var e = this.queryExpression(params, val, options, d[1]);
            if (e) {
                expr.push("(" + e + ")");
            }
            continue;
        }

        var jop = jops[name];
        var op = ops[name] || "eq";
        if (opsMap[op]) op = opsMap[op];
        if (val === null) op = "null";
        if (aliases[name]) name = aliases[name];

        switch (op) {
        case 'not_between':
        case 'not between':
        case 'between':
            if (val.length < 2) continue;
            _checkName();
            expr.push((op[0] == 'n' ? "not " : "") + name + " between :v" + _addValue(val[0]) + " and :v" + _addValue(val[1]));
            break;

        case 'not_null':
        case 'not null':
            _checkName();
            expr.push("attribute_exists(" + name + ")");
            break;

        case 'null':
            _checkName();
            expr.push("attribute_not_exists(" + name + ")");
            break;

        case 'not in':
        case 'not_in':
        case 'in':
            if (Array.isArray(val)) {
                if (!val.length) break;
                _checkName();
                const vals = [];
                for (var i = 0; i < val.length; i++) {
                    if (val[i]) vals.push(":v" + _addValue(val[i]));
                }
                if (!vals.length) break;
                expr.push((op[0] == 'n' ? "not " : "") + name + " in (" + vals + ")");
            } else
            if (val) {
                _checkName();
                expr.push(name + " " + (op[0] == 'n' ? "<>" : "=") + " :v" + _addValue(val));
            }
            break;

        case 'all in':
        case 'all_in':
            if (Array.isArray(val)) {
                if (!val.length) break;
                _checkName();
                const vals = [];
                for (var i = 0; i < val.length; i++) {
                    if (val[i]) vals.push(":v" + _addValue(val[i]) + " in (" + name + ")");
                }
                if (!vals.length) break;
                expr.push("(" + vals.join(` ${jop} || 'and'} `) + ")");
            } else
            if (val) {
                _checkName();
                expr.push(name + " " + (op[0] == 'n' ? "<>" : "=") + " :v" + _addValue(val));
            }
            break;

        case 'not_contains':
        case 'not contains':
            if (!val && ["string","object","undefined"].indexOf(typeof val) > -1) break;
            if (Array.isArray(val)) {
                if (!val.length) break;
                _checkName();
                const vals = [];
                for (let i = 0; i < val.length; i++) {
                    if (val[i]) vals.push("not contains(" + name + ",:v" + _addValue(val[i]) + ")");
                }
                if (!vals.length) break;
                expr.push("(" + vals.join(` ${jop} || 'and'} `) + ")");
            } else {
                _checkName();
                expr.push("not contains(" + name + ", :v" + _addValue(val) + ")");
            }
            break;

        case 'contains':
            if (!val && ["string","object","undefined"].indexOf(typeof val) > -1) break;
            if (Array.isArray(val)) {
                if (!val.length) break;
                _checkName();
                const vals = [];
                for (let i = 0; i < val.length; i++) {
                    if (val[i]) vals.push("contains(" + name + ", :v" + _addValue(val[i]) + ")");
                }
                if (!vals.length) break;
                expr.push("(" + vals.join(` ${jop} || 'and'} `) + ")");
            } else {
                _checkName();
                expr.push("contains(" + name + ", :v" + _addValue(val) + ")");
            }
            break;

        case '=':
        case '<>':
        case '>':
        case '>=':
        case '<':
        case '<=':
            if (!val && ["string","object","undefined"].indexOf(typeof val) > -1) break;
            _checkName();
            expr.push(name + " " + op + " :v" + _addValue(val));
            break;

        case 'like%':
        case 'begins_with':
        case 'not like%':
        case 'not_begins_with':
            if (!val && ["string","object","number","undefined"].indexOf(typeof val) > -1) continue;
            _checkName();
            expr.push((op[0] == "n" ? "not " : "") + "begins_with(" + name + ", :v" + _addValue(val) + ")");
            break;
        }
    }
    return expr.join(" " + (join || "and") + " ");
}

aws.buildExpression = function(params, name, obj, options, join)
{
    var expr = this.queryExpression(params, obj, options, join);
    if (!expr) return false;
    params[name] = expr;
    return true;
}

aws.buildProjectionExpression = function(params, names)
{
    var n = 0, list = [];
    lib.strSplit(names).forEach(function(name) {
        if (name.indexOf(".") > -1) {
            if (!params.ExpressionAttributeNames) params.ExpressionAttributeNames = {};
            name = name.split(".").map((x) => {
                for (const n in params.ExpressionAttributeNames) if (params.ExpressionAttributeNames[n] == x) return n;
                params.ExpressionAttributeNames["#n" + n] = x;
                return "#n" + n++;
            }).join(".");
        } else
        if (!aws.ddbNameRx.test(name) || aws.ddbReserved[name.toUpperCase()]) {
            if (!params.ExpressionAttributeNames) params.ExpressionAttributeNames = {};
            params.ExpressionAttributeNames["#n" + n] = name;
            name = "#n" + n++;
        }
        list.push(name);
    });
    params.ProjectionExpression = list.join(",");
}

// Return list of tables in .TableNames property of the result
//
// Example:
//
//          { TableNames: [ name, ...] }
aws.ddbListTables = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    var q = {}, rc = { TableNames: [] };
    lib.doWhilst(
        function(next) {
            aws.queryDDB('ListTables', q, options, function(err, res) {
                logger.debug("ListTables:", err, res);
                if (!err) {
                    q.ExclusiveStartTableName = res.LastEvaluatedTableName;
                    rc.TableNames.push.apply(rc.TableNames, res.TableNames);
                }
                next(err);
            });
    },
    function() {
        return q.ExclusiveStartTableName;
    },
    function(err) {
        if (typeof callback == "function") callback(err, rc);
    });
}

// Return table definition and parameters in the result structure with property of the given table name
//
// Example:
//
//          { name: { AttributeDefinitions: [], KeySchema: [] ...} }
aws.ddbDescribeTable = function(name, options, callback)
{
    var params = { TableName: name };
    this.queryDDB('DescribeTable', params, options, function(err, rc) {
        logger.debug('DescribeTable:', name, err, rc);
        if (typeof callback == "function") callback(err, rc);
    });
}

// Create a table
// - attrs can be an array in native DDB JSON format or an object with name:type properties, type is one of S, N, NN, NS, BS
// - options may contain any valid native property if it starts with capital letter and the following:
//   - waitTimeout - number of milliseconds to wait for ACTIVE status
//   - waitDelay - how often to pool for table status, default is 250ms
//   - keys is an array of column ids used for the primary key or a string with the hash key. if omitted, the first attribute will be used for the primary key
//   - local - an object with each property for a local secondary index name defining key format the same way as for primary keys, all Uppercase properties are added to the top index object
//   - global - an object for global secondary indexes, same format as for local indexes
//   - projections - an object with index name and list of projected properties to be included in the index or "ALL" for all properties, if omitted then default KEYS_ONLY is assumed
//   - readCapacity - read capacity units for provisioned throughput
//   - writeCapacity - write capacity units
//   - onDemand - billing mode, auto provision capacity and pay per request, if no read/write capacity is configured on-demand is the default
//   - stream - enable stream support
//
//
// Example:
//
//          ddbCreateTable('users', { id: 'S', mtime: 'N', name: 'S'},
//                                  { keys: ["id", "name"],
//                                    local: { mtime: { mtime: "HASH" } },
//                                    global: { name: { name: 'HASH', ProvisionedThroughput: { ReadCapacityUnits: 50 } } },
//                                    projections: { mtime: ['gender','age'],
//                                                   name: ['name','gender'] },
//                                    stream: "NEW_IMAGE",
//                                    readCapacity: 10,
//                                    writeCapacity: 10 });
aws.ddbCreateTable = function(name, attrs, options, callback)
{
    if (typeof options == "function") callback = options, options = {};
    if (!options) options = {};
    var r = options.readCapacity || aws.ddbReadCapacity, w = options.writeCapacity || aws.ddbWriteCapacity;
    var params = {
        TableName: name,
        AttributeDefinitions: [],
        KeySchema: [],
    };
    if (options.stream) {
        params.StreamSpecification = { StreamEnabled: true, StreamViewType: options.stream };
    }
    if (options.onDemand || !(r && w)) {
        params.BillingMode = "PAY_PER_REQUEST";
    } else
    if (r && w) {
        params.ProvisionedThroughput = { ReadCapacityUnits: r, WriteCapacityUnits: w };
    }
    if (Array.isArray(attrs) && attrs.length) {
        params.AttributeDefinitions = attrs;
    } else {
        for (var p in attrs) {
            params.AttributeDefinitions.push({ AttributeName: p, AttributeType: String(attrs[p]).toUpperCase() });
        }
    }
    if (Array.isArray(options.keys)) {
        options.keys.forEach(function(x, i) {
            params.KeySchema.push({ AttributeName: x, KeyType: !i ? "HASH" : "RANGE" });
        });
    } else
    if (typeof options.keys == "string" && options.keys) {
        params.KeySchema.push({ AttributeName: options.keys, KeyType: "HASH" });
    }
    if (!params.KeySchema.length && params.AttributeDefinitions.length) {
        params.KeySchema.push({ AttributeName: params.AttributeDefinitions[0].AttributeName, KeyType: "HASH" });
    }

    ["local","global"].forEach(function(t) {
        for (var n in options[t]) {
            var idx = options[t][n];
            var index = { IndexName: n, KeySchema: [] };
            for (var p in idx) {
                if (p[0] >= 'A' && p[0] <= 'Z') {
                    index[p] = idx[p];
                } else {
                    index.KeySchema.push({ AttributeName: p, KeyType: String(idx[p]).toUpperCase() })
                }
            }
            if (options.projections && options.projections[n]) {
                index.Projection = { ProjectionType: Array.isArray(options.projections[n]) ? "INCLUDE" : String(options.projections[n]).toUpperCase() };
                if (index.Projection.ProjectionType == "INCLUDE") index.Projection.NonKeyAttributes = options.projections[n];
            } else {
                index.Projection = { ProjectionType: "KEYS_ONLY" };
            }
            switch (t) {
            case "local":
                if (!params.LocalSecondaryIndexes) params.LocalSecondaryIndexes = [];
                params.LocalSecondaryIndexes.push(index);
                break;
            case "global":
                if (params.ProvisionedThroughput) {
                    if (!index.ProvisionedThroughput) index.ProvisionedThroughput = {};
                    if (!index.ProvisionedThroughput.ReadCapacityUnits) index.ProvisionedThroughput.ReadCapacityUnits = params.ProvisionedThroughput.ReadCapacityUnits;
                    if (!index.ProvisionedThroughput.WriteCapacityUnits) index.ProvisionedThroughput.WriteCapacityUnits = params.ProvisionedThroughput.WriteCapacityUnits;
                }
                if (!params.GlobalSecondaryIndexes) params.GlobalSecondaryIndexes = [];
                params.GlobalSecondaryIndexes.push(index);
                break;
            }
        }
    });

    this.queryDDB('CreateTable', params, options, function(err, item) {
        if (err || options.nowait) return typeof callback == "function" && callback(err, err ? { TableDescription: params } : item);

        // Wait because DynamoDB cannot create multiple tables at once especially with indexes
        options.waitStatus = "CREATING";
        aws.ddbWaitForTable(name, item, options, callback);
    });
}

// Update tables provisioned throughput settings, options is used instead of table name so this call can be used directly in the cron jobs to adjust
// provisionined throughput on demand.
// Options must provide the following properties:
//  - name - table name
//  - readCapacity and writeCapacity - new povisioned throughtput settings, both must be specified
//  - stream - null to disable or one of the NEW_IMAGE | OLD_IMAGE | NEW_AND_OLD_IMAGES | KEYS_ONLY
//  - add - an object with indexes to create
//  - del - delete a global secondary index by name, a string or a list with multiple indexes
//  - update - an object with indexes to update
//  - waitTimeout - how long to wait in ms until the table is active again
//  - onDemand - true to switch to pat per request mode, false to switch to provisioning mode
//
//  Example
//
//              aws.ddbUpdateTable({ name: "users", add: { name_id: { name: "S", id: 'N', readCapacity: 20, writeCapacity: 20, projections: ["mtime","email"] } })
//              aws.ddbUpdateTable({ name: "users", add: { name: { name: "S", readCapacity: 20, writeCapacity: 20, projections: ["mtime","email"] } })
//              aws.ddbUpdateTable({ name: "users", del: "name" })
//              aws.ddbUpdateTable({ name: "users", update: { name: { readCapacity: 10, writeCapacity: 10 } })
//
// Example of crontab job in etc/crontab:
//
//              [
//              { "type": "server", "cron": "0 0 1 * * *", "job": { "aws.ddbUpdateTable": { "name": "bk_account", "readCapacity": 1000, "writeCapacity": 1000 } } },
//              { "type": "server", "cron": "0 0 6 * * *", "job": { "aws.ddbUpdateTable": { "name": "bk_account", "readCapacity": 2000, "writeCapacity": 2000 } } }
//              ]
//
aws.ddbUpdateTable = function(options, callback)
{

    if (typeof options == "function") callback = options, options = null;
    if (!options) options = {};
    var params = {
        TableName: options.name,
    };
    if (typeof options.onDemand == "boolean") {
        params.BillingMode = options.onDemand ? "PAY_PER_REQUEST" : "PROVISIONED";
    }

    if (typeof options.stream != "undefined") {
        params.StreamSpecification = { StreamEnabled: options.stream ? true : false };
        if (options.stream) params.StreamSpecification.StreamViewType = options.stream;
    } else

    if (options.BillingMode != "PAY_PER_REQUEST" && options.readCapacity && options.writeCapacity) {
        params.ProvisionedThroughput = { ReadCapacityUnits: options.readCapacity, WriteCapacityUnits: options.writeCapacity };
    } else

    if (options.add) {
        if (!params.AttributeDefinitions) params.AttributeDefinitions = [];
        if (!params.GlobalSecondaryIndexUpdates) params.GlobalSecondaryIndexUpdates = [];
        for (var name in options.add) {
            var obj = options.add[name];
            var index = { IndexName: name, KeySchema: [], Projection: { ProjectionType: "KEYS_ONLY" } };
            for (var p in obj) {
                if (lib.isEmpty(obj[p])) continue;
                switch (p) {
                case "readCapacity":
                    if (!index.ProvisionedThroughput) index.ProvisionedThroughput = {};
                    index.ProvisionedThroughput.ReadCapacityUnits = obj[p];
                    break;
                case "writeCapacity":
                    if (!index.ProvisionedThroughput) index.ProvisionedThroughput = {};
                    index.ProvisionedThroughput.WriteCapacityUnits = obj[p];
                    break;
                case "projection":
                    index.Projection = { ProjectionType: Array.isArray(obj[p]) ? "INCLUDE" : String(obj[p]).toUpperCase() };
                    if (index.Projection.ProjectionType == "INCLUDE") index.Projection.NonKeyAttributes = obj[p];
                    break;
                default:
                    index.KeySchema.push({ AttributeName: p, KeyType: index.KeySchema.length ? "RANGE" : "HASH" })
                    if (!params.AttributeDefinitions.some(function(x) { return x.AttributeName == p })) {
                        params.AttributeDefinitions.push({ AttributeName: p, AttributeType: obj[p] || "S" });
                    }
                }
            }
            params.GlobalSecondaryIndexUpdates.push({ Create: index });
            break;
        }
    } else

    if (options.del) {
        if (!params.GlobalSecondaryIndexUpdates) params.GlobalSecondaryIndexUpdates = [];
        lib.strSplit(options.del).forEach(function(x) {
            params.GlobalSecondaryIndexUpdates.push({ Delete: { IndexName: x } });
        });
    } else

    if (options.update) {
        if (!params.GlobalSecondaryIndexUpdates) params.GlobalSecondaryIndexUpdates = [];
        for (const p in options.update) {
            var idx = { Update: { IndexName: p, ProvisionedThroughput: {} } };
            idx.Update.ProvisionedThroughput.ReadCapacityUnits = options.update[p].readCapacity;
            idx.Update.ProvisionedThroughput.WriteCapacityUnits = options.update[p].writeCapacity;
            params.GlobalSecondaryIndexUpdates.push(idx);
        }
    }

    this.queryDDB('UpdateTable', params, options, function(err, item) {
        logger.debug('UpdateTable:', options, err, item);
        if (err || options.nowait) return typeof callback == "function" && callback(err, item);
        options.waitStatus = "UPDATING";
        aws.ddbWaitForTable(name, item, options, callback);
    });
}

// Update TTL attribute.
// The options properties:
// - name - table name
// - attribute - the attribute name
// - enabled - true or false
aws.ddbUpdateTimeToLive = function(options, callback)
{
    var params = {
        TableName: options.name,
        TimeToLiveSpecification: {
            AttributeName: options.attribute,
            Enabled: lib.toBool(options.enabled)
        }
    };
    this.queryDDB('UpdateTimeToLive', params, options, callback);
}

// Returns status of Time to live attribute for a table
aws.ddbDescribeTimeToLive = function(name, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    var params = { TableName: name };
    this.queryDDB('DescribeTimeToLive', params, options, function(err, rc) {
        logger.debug('DescribeTimeToLive:', name, rc);
        if (typeof callback == "function") callback(err, rc);
    });
}

// Remove a table from the database.
// By default the callback will ba callled only after the table is deleted, specifying `options.nowait` will return immediately
aws.ddbDeleteTable = function(name, options, callback)
{

    var params = { TableName: name };
    this.queryDDB('DeleteTable', params, options, function(err, item) {
        if (err || options.nowait) return typeof callback == "function" && callback(err, item);
        options.waitStatus = "DELETING";
        aws.ddbWaitForTable(name, item, options, callback);
    });
}

// Call the callback after specified period of time or when table status become different from the given waiting status.
// if options.waitTimeout is not specified calls the callback immediately. options.waitStatus is checked if given and keeps waiting
// while the status is equal to it. options.waitDelay can be specified how often to request new status, default is 250ms.
aws.ddbWaitForTable = function(name, item, options, callback)
{

    if (typeof callback != "function") callback = lib.noop;
    if (!options.waitTimeout) return typeof callback == "function" && callback(null, item);

    var expires = Date.now() + options.waitTimeout;
    var status = item.TableDescription.TableStatus;
    options = lib.objClone(options);
    options.quiet = 1;
    lib.whilst(
      function() {
          return status == options.waitStatus && Date.now() < expires;
      },
      function(next) {
          aws.ddbDescribeTable(name, options, function(err, rc) {
              if (err) {
                  // Table deleted, does not exist anymore
                  if (err.code == "ResourceNotFoundException" && options.waitStatus == "DELETING") {
                      status = err = null;
                  }
                  return next(err);
              }
              status = rc.Table.TableStatus;
              setTimeout(next, options.waitDelay || 1000);
          });
      },
      function(err) {
          if (typeof callback == "function") callback(err, item);
      });
}

// Put or add an item
// - item is an object, type will be inferred from the native js type.
// - options may contain any valid native property if it starts with capital letter or special properties:
//    - expected - an object with column names to be used in Expected clause and value as null to set condition to { Exists: false } or
//          any other exact value to be checked against which corresponds to { Exists: true, Value: value }
//    - expectedJoin - how to join conditions, default is AND
//    - expr - condition expression
//    - values - an object with values map to be used for in the update and/or condition expressions, to be used
//          for ExpressionAttributeValues parameters
//    - names - an object with a map to be used for attribute names in condition and update expressions, to be used
//          for ExpressionAttributeNames parameter
//    - returning - values to be returned on success, any value means ALL_OLD
//
// Example:
//
//          ddbPutItem("users", { id: 1, name: "john", mtime: 11233434 }, { expected: { name: null } })
//
aws.ddbPutItem = function(name, item, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = lib.empty;
    var params = { TableName: name, Item: aws.toDynamoDB(item) };
    if (options.expected) {
        this.buildExpression(params, "ConditionExpression", options.expected, options, options.expectedJoin);
    }
    if (options.expr) {
        params.ConditionExpression = options.expr;
    }
    if (options.names) {
        params.ExpressionAttributeNames = aws.toDynamoDB(options.names);
    }
    if (options.values) {
        params.ExpressionAttributeValues = aws.toDynamoDB(options.values);
    }
    if (options.returning) {
        params.ReturnValues = "ALL_OLD";
    }
    if (options.return_params) return params;
    this.queryDDB('PutItem', params, options, function(err, rc) {
        rc.Item = rc.Attributes ? aws.fromDynamoDB(rc.Attributes) : {};
        if (typeof callback == "function") callback(err, rc);
    });
}

// Update an item
// - keys is an object with primary key attributes name and value.
// - item is an object with properties where value can be:
//      - number/string/array - action PUT, replace or add new value
//      - null/empty string - action DELETE
// - item can be a string with Update expression
// - options may contain any valid native property if it starts with capital letter or special properties:
//      - expr - condition expression
//      - values - an object with values map to be used for in the update and/or condition expressions, to be used
//          for ExpressionAttributeValues parameters
//      - names - an object with a map to be used for attribute names in condition and update expressions, to be used
//          for ExpressionAttributeNames parameter
//      - updateOps - an object with operators to be used for properties, one of the: set, remove, unset, delete, incr, add, append, prepend, not_exists
//      - expected - an object with columns to be used in ConditionExpression, value null means the attribute does not exists,
//          any other value to be checked against using regular compare rules. The conditional comparison operator is taken
//          from `options.ops` the same way as for queries.
//      - returning - values to be returned on success, `*` or `new` means ALL_NEW, `old` means ALL_OLD,
//                    `updated` means UPDATED_NEW, `old_updated` means UPDATED_OLD
//
// Example:
//
//          ddbUpdateItem("users", { id: 1, name: "john" }, { gender: 'male', icons: '1.png' }, { action: { icons: 'add' }, expected: { id: 1 }, returning: "*" })
//          ddbUpdateItem("users", { id: 1, name: "john" }, { gender: 'male', icons: '1.png' }, { action: { icons: 'incr' }, expected: { id: null } })
//          ddbUpdateItem("users", { id: 1, name: "john" }, { gender: 'male', icons: '1.png', num: 1 }, { action: { num: 'add', icons: 'add' }, expected: { id: null, num: 0 }, ops: { num: "gt" } })
//
aws.ddbUpdateItem = function(name, keys, item, options, callback)
{

    if (typeof options == "function") callback = options, options = null;
    if (!options) options = lib.empty;
    var params = { TableName: name, Key: {} };
    for (var p in keys) {
        params.Key[p] = aws.toDynamoDB(keys[p]);
    }
    if (options.expected) {
        this.buildExpression(params, "ConditionExpression", options.expected, options, options.expectedJoin);
    }
    if (options.expr) {
        params.ConditionExpression = options.expr;
    }
    if (options.names) {
        params.ExpressionAttributeNames = aws.toDynamoDB(options.names);
    }
    if (options.values) {
        params.ExpressionAttributeValues = aws.toDynamoDB(options.values);
    }
    if (options.returning) {
        params.ReturnValues = options.returning == "*" || options.returning == "new" ? "ALL_NEW" :
                              options.returning == "updated" ? "UPDATED_NEW" :
                              options.returning == "old" ? "ALL_OLD" :
                              options.returning == "old_updated" ? "UPDATED_OLD" :
                              options.returning;
    }
    if (typeof item == "string") {
        params.UpdateExpression = item;
    } else
    if (typeof item == "object") {
        var c = 0, d = 0, names = {}, values = {}, actions = { SET: [], REMOVE: [], ADD: [], DELETE: [] };
        for (let p in item) {
            if (params.Key[p]) continue;
            var val = item[p], colname = p;
            if (p.indexOf(".") > -1) {
                p = p.split(".").map((x) => {
                    for (const n in names) if (names[n] == x) return n;
                    names["#c" + c] = x;
                    return "#c" + c++;
                }).join(".");
            } else
            if (!aws.ddbNameRx.test(p) || this.ddbReserved[p.toUpperCase()]) {
                names["#c" + c] = p;
                p = "#c" + c++;
            }
            switch (lib.typeName(val)) {
                case 'null':
                case 'undefined':
                    actions.REMOVE.push(p);
                    break;

                case 'array':
                    if (!val.length) {
                        actions.REMOVE.push(p)
                        break;
                    }

                case "string":
                    if (!val) {
                        actions.REMOVE.push(p);
                        break;
                    }

                default:
                    var op = (options.updateOps && options.updateOps[colname]);
                    switch (op) {
                    case "add":
                    case "incr":
                        actions.ADD.push(p + " :d" + d);
                        values[":d" + d++] = val;
                        break;

                    case "del":
                        actions.DELETE.push(p + " :d" + d);
                        values[":d" + d++] = val;
                        break;

                    case "unset":
                    case "remove":
                        actions.REMOVE.push(p);
                        break;

                    case "append":
                        actions.SET.push(p + "=list_append(" + p + ",:d" + d + ")");
                        values[":d" + d++] = val;
                        break;

                    case "prepend":
                        actions.SET.push(p + "=list_append(:d" + d + "," + p + ")");
                        values[":d" + d++] = val;
                        break;

                    case "not_exists":
                        actions.SET.push(p + "=if_not_exists(" + p + ",:d" + d + ")");
                        values[":d" + d++] = val;
                        break;

                    default:
                        actions.SET.push(p + "= :d" + d);
                        values[":d" + d++] = val;
                    }
                    break;
            }
            params.UpdateExpression = "";
            for (const p in actions) {
                var expr = actions[p].join(",");
                if (expr) params.UpdateExpression += " " + p + " " + expr;
            }
            if (c) {
                if (!params.ExpressionAttributeNames) params.ExpressionAttributeNames = {};
                for (const p in names) params.ExpressionAttributeNames[p] = names[p];
            }
            if (d) {
                if (!params.ExpressionAttributeValues) params.ExpressionAttributeValues = {};
                for (const p in values) params.ExpressionAttributeValues[p] = this.toDynamoDB(values[p], 1);
            }
        }
    }
    if (options.return_params) return params;
    this.queryDDB('UpdateItem', params, options, function(err, rc) {
        rc.Item = rc.Attributes ? aws.fromDynamoDB(rc.Attributes) : {};
        if (typeof callback == "function") callback(err, rc);
    });
}

// Delete an item from a table
// - keys is an object with name: value for hash/range attributes
// - options may contain any valid native property if it starts with capital letter and the following special options:
//      - expr - condition expression
//      - values - an object with values map to be used for in the update and/or condition expressions, to be used
//          for ExpressionAttributeValues parameters
//      - names - an object with a map to be used for attribute names in condition and update expressions, to be used
//          for ExpressionAttributeNames parameter
//      - returning - values to be returned on success, any value means ALL_OLD
//
// Example:
//
//          ddbDeleteItem("users", { id: 1, name: "john" }, {})
//
aws.ddbDeleteItem = function(name, keys, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = lib.empty;
    var params = { TableName: name, Key: {} };
    for (const p in keys) {
        params.Key[p] = aws.toDynamoDB(keys[p]);
    }
    if (options.expected) {
        this.buildExpression(params, "ConditionExpression", options.expected, options, options.expectedJoin);
    }
    if (options.expr) {
        params.ConditionExpression = options.expr;
    }
    if (options.names) {
        params.ExpressionAttributeNames = aws.toDynamoDB(options.names);
    }
    if (options.values) {
        params.ExpressionAttributeValues = aws.toDynamoDB(options.values);
    }
    if (options.returning) {
        params.ReturnValues = "ALL_OLD";
    }
    if (options.return_params) return params;
    this.queryDDB('DeleteItem', params, options, function(err, rc) {
        rc.Item = rc.Attributes ? aws.fromDynamoDB(rc.Attributes) : {};
        if (typeof callback == "function") callback(err, rc);
    });
}

// Update items from the list at the same time
// - items is a list of objects with table name as property and list of operations, an operation can be PutRequest or DeleteRequest
// - options may contain any valid native property if it starts with capital letter.
//
// Example:
//
//          { table: [ { put: { id: 1, name: "tt" } }, { del: { id: 2 } }] }
//
aws.ddbBatchWriteItem = function(items, options, callback)
{

    if (typeof options == "function") callback = options, options = null;
    if (!options) options = lib.empty;
    var params = { RequestItems: {} };
    for (const p in items) {
        params.RequestItems[p] = [];
        items[p].forEach(function(x) {
            var obj = {};
            for (var m in x) {
                switch (m) {
                case "add":
                case "put":
                    obj.PutRequest = { Item: aws.toDynamoDB(x[m]) };
                    break;
                case "del":
                    obj.DeleteRequest = { Key: aws.toDynamoDB(x[m]) };
                    break;
                }
            }
            params.RequestItems[p].push(obj);
        });
    }
    this.queryDDB('BatchWriteItem', params, options, callback);
}

// Retrieve all items for given list of keys
// - items is an object with table name as property name and list of options for GetItem request
// - options may contain any valid native property if it starts with capital letter.
//
// Example:
//
//          { users: { keys: [{ id: 1, name: "john" },{ id: .., name: .. }], select: ['name','id'], consistent: true }, ... }
aws.ddbBatchGetItem = function(items, options, callback)
{

    if (typeof options == "function") callback = options, options = null;
    if (!options) options = lib.empty;
    var params = { RequestItems: {} };
    for (const p in items) {
        var obj = {};
        obj.Keys = items[p].keys.map(function(x) { return aws.toDynamoDB(x); });
        if (items[p].select) this.buildProjectionExpression(obj, items[p].select);
        if (items[p].consistent) obj.ConsistentRead = true;
        params.RequestItems[p] = obj;
    }
    this.queryDDB('BatchGetItem', params, options, function(err, rc) {
        for (const p in rc.Responses) {
            rc.Responses[p] = aws.fromDynamoDB(rc.Responses[p]);
        }
        if (typeof callback == "function") callback(err, rc);
    });
}


// Retrieve one item by primary key
//  - keys - an object with primary key attributes name and value.
//  - select - list of columns to return, otherwise all columns will be returned
//  - options may contain any native property allowed in the request or special properties:
//    - consistent - set consistency level for the request
//    - names - an object with a map to be used for attribute names in condition and update expressions, to be used
//        for ExpressionAttributeNames parameter
// Example:
//
//       ddbGetItem("users", { id: 1, name: "john" }, { select: 'id,name' })
//
aws.ddbGetItem = function(name, keys, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = lib.empty;
    var params = { TableName: name, Key: {} };
    if (options.select) {
        this.buildProjectionExpression(params, options.select);
    }
    if (options.projection) {
        params.ProjectionExpression = options.projection;
    }
    if (options.names) {
        params.ExpressionAttributeNames = aws.toDynamoDB(options.names);
    }
    if (options.consistent) {
        params.ConsistentRead = true;
    }
    for (const p in keys) {
        params.Key[p] = aws.toDynamoDB(keys[p]);
    }
    this.queryDDB('GetItem', params, options, function(err, rc) {
        if (!options.debug) rc.Item = rc.Item ? aws.fromDynamoDB(rc.Item) : null;
        if (typeof callback == "function") callback(err, rc);
    });
}

// Query on a table, return all matching items
// - condition is an object with name: value pairs, by default EQ opeartor is used for comparison
// - options may contain any valid native property if it starts with capital letter or special property:
//      - start - defines starting primary key when paginating, can be a string/number for hash or an object with hash/range properties
//      - consistent - set consistency level for the request
//      - select - list of attributes to get only
//      - total - return number of matching records
//      - count - limit number of record in result
//      - desc - descending order
//      - sort - index name to use, indexes are named the same as the corresponding column, with index primary keys for Keycondition will be used
//      - ops - an object with operators to be used for properties if other than EQ.
//      - keys - list of primary key columns, if there are other properties in the condition then they will be
//               put into QueryFilter instead of KeyConditions. If keys are absent, all properties in the condition are treated as primary keys.
//      - projection - projection expression
//      - values - an object with values map to be used for in the update and/or condition expressions, to be used
//          for ExpressionAttributeValues parameters
//      - names - an object with a map to be used for attribute names in condition and update expressions, to be used
//          for ExpressionAttributeNames parameter
//      - expr - filtering expression
//
// Example:
//
//          aws.ddbQueryTable("users", { id: 1, name: "john" }, { select: 'id,name', ops: { name: 'gt' } })
//          aws.ddbQueryTable("users", { id: 1, name: "john", status: "ok" }, { keys: ["id"], select: 'id,name', ops: { name: 'gt' } })
//          aws.ddbQueryTable("users", { id: 1 }, { expr: "status=:s", values: { s: "status" } })
//
aws.ddbQueryTable = function(name, condition, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = lib.empty;
    var params = { TableName: name };
    if (options.names) {
        params.ExpressionAttributeNames = aws.toDynamoDB(options.names);
    }
    if (options.values) {
        params.ExpressionAttributeValues = aws.toDynamoDB(options.values);
    }
    if (options.projection) {
        params.ProjectionExpression = options.projection;
    }
    if (options.expr) {
        params.FilterExpression = options.expr;
    }
    if (options.consistent) {
        params.ConsistentRead = true;
    }
    if (options.start) {
        params.ExclusiveStartKey = aws.toDynamoDB(options.start);
    }
    if (options.sort) {
        params.IndexName = options.sort;
    }
    if (options.desc) {
        params.ScanIndexForward = false;
    }
    if (options.select) {
        this.buildProjectionExpression(params, options.select);
    }
    if (options.count > 0) {
        params.Limit = options.count;
    }
    if (options.total) {
        params.Select = "COUNT";
    }
    if (typeof condition == "string") {
        params.KeyConditionExpression = condition;
    } else
    if (Array.isArray(options.keys)) {
        var keys = {}, filter = {};
        for (const p in condition) {
            if (options.keys.indexOf(p) > -1) keys[p] = condition[p]; else filter[p] = condition[p];
        }
        this.buildExpression(params, "KeyConditionExpression", keys, options, "", 10);
        this.buildExpression(params, "FilterExpression", filter, options, "", 20);
    } else
    if (lib.isObject(options.keys)) {
        this.buildExpression(params, "KeyConditionExpression", options.keys, options, "", 10);
    } else {
        this.buildExpression(params, "KeyConditionExpression", condition, options, "", 10);
    }

    this.queryDDB('Query', params, options, function(err, rc) {
        if (!options.debug) rc.Items = rc.Items ? aws.fromDynamoDB(rc.Items) : [];
        if (typeof callback == "function") callback(err, rc);
    });
}

// Scan a table for all matching items
// - condition is an object with name: value pairs or a string with FilterExpression
// - options may contain any valid native property if it starts with capital letter or special property:
//      - start - defines starting primary key
//      - ops - an object with operators to be used for properties if other than EQ.
//      - projection - projection expression
//      - values - an object with values map to be used for in the update and/or condition expressions, to be used
//          for ExpressionAttributeValues parameters
//      - names - an object with a map to be used for attribute names in condition and update expressions, to be used
//          for ExpressionAttributeNames parameter
//
// Example:
//
//          aws.ddbScanTable("users", { id: 1, name: 'a' }, { ops: { name: 'gt' }})
//          aws.ddbScanTable("users", "id=:id AND name=:name", { values: { id: 1, name: 'a' } });
//
aws.ddbScanTable = function(name, condition, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = lib.empty;
    var params = { TableName: name };
    if (options.projection) {
        params.ProjectionExpression = options.projection;
    }
    if (options.names) {
        params.ExpressionAttributeNames = aws.toDynamoDB(options.names);
    }
    if (options.sort) {
        params.IndexName = options.sort;
    }
    if (options.values) {
        params.ExpressionAttributeValues = aws.toDynamoDB(options.values);
    }
    if (options.consistent) {
        params.ConsistentRead = true;
    }
    if (options.start) {
        params.ExclusiveStartKey = aws.toDynamoDB(options.start);
    }
    if (options.select) {
        this.buildProjectionExpression(params, options.select);
    }
    if (options.count > 0) {
        params.Limit = options.count;
    }
    if (options.total) {
        params.Select = "COUNT";
    }
    if (typeof condition == "string") {
        params.FilterExpression = condition;
    } else {
        this.buildExpression(params, "FilterExpression", condition, options, "");
    }

    this.queryDDB('Scan', params, options, function(err, rc) {
        if (!options.debug) rc.Items = rc.Items ? aws.fromDynamoDB(rc.Items) : [];
        if (typeof callback == "function") callback(err, rc);
    });
}

// Update items from the list at the same time in one transaction, on any failure everything is rolled back
// - items is a list of operations to be performed in the same format as for aws.ddbPutItem, aws.ddbUpdateItem, aws.ddbDeleteItem and aws.ddbQueryItem
// - options may contain any valid native property if it starts with capital letter.
//
// Example:
//
//          { op: "put": table: "table-name", obj: { id: 1, name: "tt" } },
//          { op: "del": table: "table-name", obj: { id: 2 } },
//          { op: "update": table: "table-name", obj: { id: 1, name: "test" }, options: { expected: { status: "ok" } } },
//          { op: "check": table: "table-name", obj: { id: 1 }, options: { expected: { status: "ok" } } }
//
aws.ddbTransactWriteItems = function(items, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    var params = { TransactItems: [] };
    lib.isArray(items, []).forEach(function(x) {
        var obj, opts = lib.objClone(x.options, "return_params", 1);
        switch (x.op) {
        case "get":
        case "check":
            obj = { TableName: x.table, Key: {} };
            for (const p in x.obj) {
                obj.Key[p] = aws.toDynamoDB(x.obj[p]);
            }
            if (opts.expected) {
                aws.buildExpression(obj, "ConditionExpression", opts.expected, opts, opts.expectedJoin);
            }
            if (opts.expr) {
                obj.ConditionExpression = x.opts.expr;
            }
            if (opts.names) {
                obj.ExpressionAttributeNames = aws.toDynamoDB(opts.names);
            }
            if (opts.values) {
                obj.ExpressionAttributeValues = aws.toDynamoDB(opts.values);
            }
            obj = { ConditionCheck: obj };
            break;
        case "incr":
        case "update":
            obj = { Update: aws.ddbUpdateItem(x.table, x.keys, x.obj, opts) };
            if (obj.Update.ReturnValues) obj.Update.ReturnValuesOnConditionCheckFailure = "ALL_OLD";
            delete obj.Update.ReturnValues;
            break;
        case "add":
        case "put":
            obj = { Put: aws.ddbPutItem(x.table, x.obj, opts) };
            if (obj.Put.ReturnValues) obj.Put.ReturnValuesOnConditionCheckFailure = "ALL_OLD";
            delete obj.Put.ReturnValues;
            break;
        case "del":
            obj = { Delete: aws.ddbDeleteItem(x.table, x.obj, opts) };
            if (obj.Delete.ReturnValues) obj.Update.ReturnValuesOnConditionCheckFailure = "ALL_OLD";
            delete obj.Delete.ReturnValues;
            break;
        default:
            return;
        }
        for (const p in opts) if (p[0] >= 'A' && p[0] <= 'Z') obj[p] = opts[p];
        params.TransactItems.push(obj);
    });
    this.queryDDB('TransactWriteItems', params, options, (err) => {
        if (err && err.code == "TransactionCanceledException") {
            var d = err.message.match(/reasons \[([^]+)\]/);
            if (d) d[1].split(",").forEach((x, i) => {
                if (!x || x == "None") return;
                items[i].errcode = x.trim();
            });
        }
        lib.tryCall(callback, err, items);
    });
}

