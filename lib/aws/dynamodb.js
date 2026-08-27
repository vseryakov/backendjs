/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const modules = require(__dirname + '/../modules');
const logger = require(__dirname + '/../logger');
const app = require(__dirname + '/../app');
const lib = require(__dirname + '/../lib');
const aws = require(__dirname + '/../aws');

app.describeArgs("aws", [
    { name: "ddb-endpoint", descr: "Default endpoint to use, for local DynamoDB use" },
    { name: "ddb-read-capacity", type: "int", min: 0, descr: "Default DynamoDB read capacity for all tables" },
    { name: "ddb-write-capacity", type: "int", min: 0, descr: "Default DynamoDB write capacity for all tables" },
    { name: "ddb-retry-count", type: "int", min: 5, descr: "Default DynamoDB number of retries in case of throttling event" },
    { name: "ddb-retry-timeout", type: "int", min: 200, descr: "Default DynamoDB min timeout for retry backoff in case of throttling event" },
    { name: "ddb-retry-status", type: "regexp", descr: "Default DynamoDB HTTP statuses to retry in case of throttling event or an error" },
    { name: "ddb-table-map", type: "map", obj: "ddb-table-map", merge: 1, descr: "Table mappings" },
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
    METRICS: 1, MIN: 1, MINUS: 1, MINUTE: 1, MISSING: 1, MOD: 1, MODE: 1, MODIFIES: 1, MODIFY: 1, MODULE: 1, MONTH: 1, MULTI: 1, MULTISET: 1, NAME: 1, NAMES: 1, NATIONAL: 1, NATURAL: 1,
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
aws.ddbRetryCount = 11;
aws.ddbRetryTimeout = 200;
aws.ddbRetryRx = /(InternalServerError|ProvisionedThroughputExceededException|ThrottlingException|SerializationException|UnrecognizedClientException|LimitExceededException|Syntax error;)/;
aws.ddbRetryStatus = /(405|429|500|503|529)/;
aws.ddbTableMap = {};

/**
 * Low-level DynamoDB API request with DynamoDB-specific retry/backoff handling.
 * @memberof module:aws
 * @method queryDDB
 * @param {string} action - DynamoDB API action, e.g. `PutItem`, `Query`, `Scan`
 * @param {object} obj - native DynamoDB request body
 * @param {object} [options] - request options; capitalized options are passed through as native parameters
 * @param {function} callback - `(err, obj)`
 */
aws.queryDDB = function(action, obj, options, callback)
{
    const req = {
        action,
        endpoint: "dynamodb",
        target: "DynamoDB_20120810",
        native: true,
        retryCount: this.ddbRetryCount,
        retryTimeout: this.ddbRetryTimeout,
        retryOnError: this.ddbRetryOnError,
        signer: this.ddbSigner,
        headers: {
            'content-type': 'application/x-amz-json-1.0; charset=utf-8'
        }
    };
    this.queryService(req, obj, options, (err, obj, rc) => {
        if (rc.retryCount < rc.retryTotal) {
            rc.obj.retry_count = rc.retryTotal - Math.min(0, rc.retryCount);
        }
        if (typeof callback === "function") callback(err, obj);
    });
}

/**
 * DynamoDB retry predicate, called in the context of a request; retries on throttling/internal errors.
 * @memberof module:aws
 * @method ddbRetryOnError
 * @returns {boolean} true if the request should be retried
 */
aws.ddbRetryOnError = function()
{
    return aws.ddbRetryStatus.test(this.status) || aws.ddbRetryRx.test(this.data);
}

/**
 * DynamoDB request signer, called in the context of an HTTP request to apply Signature V4 headers.
 * @memberof module:aws
 * @method ddbSigner
 */
aws.ddbSigner = function()
{
    aws.signQuery(this.region, "dynamodb", this.hostname, "POST", this.pathname, this.postdata, this.headers, this.credentials);
}

/**
 * Resolve a logical table name to its real name using `aws.ddbTableMap`.
 * @memberof module:aws
 * @method ddbTable
 * @param {string} name - logical table name
 * @returns {string} mapped table name or the name itself
 */
aws.ddbTable = function(name)
{
    return aws.ddbTableMap[name] || name;
}

/**
 * Convert a JavaScript value into DynamoDB attribute-value format (`{ S }`, `{ N }`, `{ M }`, `{ L }`...).
 * @memberof module:aws
 * @method toDynamoDB
 * @param {*} value - the value to convert
 * @param {number} [level] - internal recursion level; when set, scalars/collections are wrapped in typed descriptors
 * @returns {object} the DynamoDB representation
 */
aws.toDynamoDB = function(value, level)
{
    var res;
    switch (lib.typeName(value)) {
    case 'null':
        return { "NULL": true };

    case 'boolean':
        return { "BOOL": value };

    case 'number':
        return { "N": Number.isNaN(value) ? "0" : value.toString() };

    case 'buffer':
        return { "B": value.toString("base64") };

    case "date":
        return { "N": Math.round(value.getTime()/1000) };

    case "set":
        return { "SS": Array.from(value) };

    case 'array':
        if (!value.length) return level ? { "L": value } : value;
        const types = { number: 0, string: 0 };
        for (let i = 0; i < value.length; i++) types[typeof value[i]]++;
        if (types.number === value.length) return { "NS": value };
        if (types.string === value.length) return { "SS": value };
        res = [];
        for (const i in value) {
            if (value[i] !== undefined) res.push(this.toDynamoDB(value[i], 1));
        }
        return level ? { "L": res } : res;

    case 'object':
        res = {};
        for (const p in value) {
            if (value[p] !== undefined) res[p] = this.toDynamoDB(value[p], 1);
        }
        return level ? { "M": res } : res;

    default:
        return { "S": String(value) };
    }
}

/**
 * Convert a DynamoDB attribute-value object back into a plain JavaScript value.
 * @memberof module:aws
 * @method fromDynamoDB
 * @param {object} value - DynamoDB formatted value or item
 * @param {number} [level] - internal recursion level
 * @returns {*} the native JavaScript value
 */
aws.fromDynamoDB = function(value, level)
{
    var res;
    switch (lib.typeName(value)) {
    case 'array':
        res = [];
        for (const i in value) {
            res.push(this.fromDynamoDB(value[i], level));
        }
        return res;

    case 'object':
        if (level) {
            for (const p in value) {
                switch (p) {
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
            if (!Object.hasOwn(value, p)) continue;
            res[p] = this.fromDynamoDB(value[p], 1);
        }
        return res;

    default:
        return value;
    }
}

function _checkName(params, name)
{
    if (!aws.ddbNameRx.test(name) || aws.ddbReserved[name.toUpperCase()]) {
        if (name.includes(".")) {
            if (!params.ExpressionAttributeNames) params.ExpressionAttributeNames = {};
            name = name.split(".").map((x) => {
                for (const n in params.ExpressionAttributeNames) {
                    if (params.ExpressionAttributeNames[n] === x) return n;
                }
                const h = lib.objKeys(params.ExpressionAttributeNames).length;
                params.ExpressionAttributeNames["#n" + h] = x;
                return "#n" + h;
            }).join(".");
        } else {
            for (const n in params.ExpressionAttributeNames) {
                if (params.ExpressionAttributeNames[n] === name) {
                    name = params.ExpressionAttributeNames[n];
                }
            }
            if (name[0] !== "#") {
                if (!params.ExpressionAttributeNames) params.ExpressionAttributeNames = {};
                const h = lib.objKeys(params.ExpressionAttributeNames).length;
                params.ExpressionAttributeNames["#n" + h] = name;
                name = "#n" + h;
            }
        }
    }
    return name;
}

function _addValue(params, val)
{
    if (!params.ExpressionAttributeValues) params.ExpressionAttributeValues = {};
    const len = lib.objKeys(params.ExpressionAttributeValues).length;
    params.ExpressionAttributeValues[":v" + len] = aws.toDynamoDB(val);
    return len;
}

// Build a condition expression for the given object, all properties in the query are used
function getQueryExpression(params, query, options, join)
{
    const req = new modules.db.Request({ table: params.TableName, query, options });
    const expr = [];

    for (let name in query) {
        let val = query[name];
        const op = name.match(/^\$+(OR|AND|NOT)$/i)?.[1];
        if (op) {
            switch (op) {
            case "NOT":
            case "not":
                val = getQueryExpression(params, val, options);
                if (val) expr.push("not (" + val + ")");
                break;

            default:
                val = getQueryExpression(params, val, options, op);
                if (val) expr.push("(" + val + ")");
            }
            continue;
        }

        const col = modules.db.prepareColumn(req, name, val);
        val = col.value;

        const not = col.op[0] === 'n' ? "not " : "";

        switch (col.op) {
        case 'not between':
        case 'between':
            if (val.length < 2) continue;
            name = _checkName(params, col.name);
            expr.push(not + name + " between :v" + _addValue(params, val[0]) + " and :v" + _addValue(params, val[1]));
            break;

        case 'not null':
            name = _checkName(params, col.name);
            expr.push(`(attribute_exists(${name}) AND NOT attribute_type(${name},:v${_addValue(params, "NULL")}))`);
            break;

        case 'null':
            name = _checkName(params, col.name);
            expr.push(`(attribute_not_exists(${name}) OR attribute_type(${name},:v${_addValue(params, "NULL")}))`);
            break;

        case 'in':
        case 'not in':
            if (Array.isArray(val)) {
                if (!val.length) break;
                name = _checkName(params, col.name);
                const vals = [];
                for (let i = 0; i < val.length; i++) {
                    if (val[i]) vals.push(":v" + _addValue(params, val[i]));
                }
                if (!vals.length) break;
                expr.push(not + name + " in (" + vals + ")");
            } else
            if (val) {
                name = _checkName(params, col.name);
                expr.push(name + " " + (col.op[0] === 'n' ? "<>" : "=") + " :v" + _addValue(params, val));
            }
            break;

        case 'all in':
        case "not all in":
            if (Array.isArray(val)) {
                if (!val.length) break;
                name = _checkName(params, col.name);
                const vals = [];
                for (let i = 0; i < val.length; i++) {
                    if (val[i]) vals.push(not + "contains(" + name + ",:v" + _addValue(params, val[i]) + ")");
                }
                if (!vals.length) break;
                expr.push("(" + vals.join(` ${col.join || 'and'} `) + ")");
            } else
            if (val) {
                name = _checkName(params, col.name);
                expr.push(not + name + " " + (col.op[0] === 'n' ? "<>" : "=") + " :v" + _addValue(params, val));
            }
            break;

        case 'contains':
        case 'not contains':
            if (!val && ["string","object","undefined"].includes(typeof val)) break;
            if (Array.isArray(val)) {
                if (!val.length) break;
                name = _checkName(params, col.name);
                const vals = [];
                for (let i = 0; i < val.length; i++) {
                    if (val[i]) vals.push(not + "contains(" + name + ",:v" + _addValue(params, val[i]) + ")");
                }
                if (!vals.length) break;
                expr.push("(" + vals.join(` ${col.join || 'or'} `) + ")");
            } else {
                name = _checkName(params, col.name);
                expr.push(not + "contains(" + name + ", :v" + _addValue(params, val) + ")");
            }
            break;

        case '=':
        case '<>':
        case '>':
        case '>=':
        case '<':
        case '<=':
            if (!val && ["string","object","undefined"].includes(typeof val)) break;
            name = _checkName(params, col.name);
            expr.push(name + " " + col.op + " :v" + _addValue(params, val));
            break;

        case 'like%':
        case 'begins with':
        case 'not like%':
        case 'not begins with':
            if (!val && ["string","object","undefined"].includes(typeof val)) break;
            name = _checkName(params, col.name);
            expr.push(not + "begins_with(" + name + ", :v" + _addValue(params, val) + ")");
            break;

        case 'includes':
        case 'not includes':
        case '%like%':
        case 'not %like%':
            if (!val && ["string","object","undefined"].includes(typeof val)) break;
            name = _checkName(params, col.name);
            expr.push(not + "contains(" + name + ", :v" + _addValue(params, val) + ")");
            break;
        }
    }
    return expr.join(" " + (join || "and") + " ") || undefined;
}

function setProjectionExpression(params, names)
{
    var n = 0, list = [];
    lib.split(names).forEach((name) => {
        if (name.includes(".")) {
            if (!params.ExpressionAttributeNames) params.ExpressionAttributeNames = {};
            name = name.split(".").map((x) => {
                for (const n in params.ExpressionAttributeNames) {
                    if (params.ExpressionAttributeNames[n] === x) return n;
                }
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
    if (list.length) {
        params.ProjectionExpression = list.join(",");
    }
}

function createIndex(params, name, options)
{
    const index = {
        IndexName: name,
        KeySchema: [],
        Projection: {
            ProjectionType: "KEYS_ONLY"
        }
    };
    for (const p in options) {
        const val = options[p];
        switch (p) {
        case "readCapacity":
            if (!val) break;
            if (!index.ProvisionedThroughput) index.ProvisionedThroughput = {};
            index.ProvisionedThroughput.ReadCapacityUnits = val;
            break;

        case "writeCapacity":
            if (!val) break;
            if (!index.ProvisionedThroughput) index.ProvisionedThroughput = {};
            index.ProvisionedThroughput.WriteCapacityUnits = val;
            break;

        case "projection":
            if (lib.isArray(val)) {
                index.Projection = { ProjectionType: "INCLUDE", NonKeyAttributes: val };
            } else
            if (lib.isString(val)) {
                index.Projection = { ProjectionType: val.toUpperCase() };
            }
            break;

        default:
            index.KeySchema.push({ AttributeName: p, KeyType: index.KeySchema.length ? "RANGE" : "HASH" })
            if (!params.AttributeDefinitions) params.AttributeDefinitions = [];
            if (!params.AttributeDefinitions.find(x => (x.AttributeName === p))) {
                params.AttributeDefinitions.push({ AttributeName: p, AttributeType: val || "S" });
            }
        }
    }
    return index;
}

/**
 * Return the list of tables (handles pagination).
 * @memberOf module:aws
 * @method ddbListTables
 * @param {object} [options]
 * @param {function} callback - `(err, rc)` where `rc` is `{ TableNames: [name, ...] }`
 */
aws.ddbListTables = function(options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    const q = {}, rc = { TableNames: [] };
    lib.doWhilst(
        function(next) {
            aws.queryDDB('ListTables', q, options, (err, res) => {
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
        if (typeof callback === "function") callback(err, rc);
    }, true);
}

/**
 * Return a table's definition and parameters.
 * @memberOf module:aws
 * @method ddbDescribeTable
 * @param {string} name - table name
 * @param {object} [options]
 * @param {function} callback - `(err, rc)` where `rc.Table` holds AttributeDefinitions, KeySchema, etc.
 */
aws.ddbDescribeTable = function(name, options, callback)
{
    var params = { TableName: aws.ddbTable(name) };
    this.queryDDB('DescribeTable', params, options, (err, rc) => {
        logger.debug('DescribeTable:', name, err, rc);
        if (typeof callback === "function") callback(err, rc);
    });
}

/**
 * Create a table
 * @param {object} options - may contain any valid native property if it starts with capital letter and the following:
 * @param {number} [options.waitTimeout] - number of milliseconds to wait for ACTIVE status
 * @param {number} [options.waitDelay] - how often to pool for table status, default is 250ms
 * @param {string[]|object} [options.attrs] can be an array in native DDB JSON format or an object with name:type properties, type is one of S, N, NN, NS, BS, if not provided
 *     attributes from keys will be added with type S
 * @param {string[]} [options.keys] - is an array of column ids used for the primary key or a string with the hash key. if omitted, the first attribute
 *     will be used for the primary key
 * @param {object} [options.local] - an object with each property for a local secondary index name, special properties are:
 *    `projection, readCapacity, writeCapacity`, other properties are key schema, first is HASH, second is RANGE
 * @param {object} [options.global] - an object for global secondary indexes, same format as for local indexes
 * @param {number} [options.readCapacity] - read capacity units for provisioned throughput
 * @param {number} [options.writeCapacity] - write capacity units
 * @param {boolean} [options.onDemand] - billing mode, auto provision capacity and pay per request, if no read/write capacity is configured on-demand is the default
 * @param {boolean} [options.stream] - enable stream support
 *
 *
 * @example
 * aws.ddbCreateTable('users',
 *                    {
 *                        keys: ["id", "name"],
 *                        attrs: { id: 'S', name: 'S' },
 *                        local: {
 *                            mtime: {
 *                                mtime: "N",
 *                                projection: "ALL",
 *                            }
 *                        },
 *                        global: {
 *                            name: {
 *                               name: 'N',
 *                               projection: ['name','gender'],
 *                               readCapacity: 5,
 *                            }
 *                        },
 *                        stream: "NEW_IMAGE",
 *                        readCapacity: 10,
 *                        writeCapacity: 10
 * });
 * @memberOf module:aws
 * @method ddbCreateTable
 */
aws.ddbCreateTable = function(name, options, callback)
{
    const r = options.readCapacity || aws.ddbReadCapacity;
    const w = options.writeCapacity || aws.ddbWriteCapacity;
    const params = {
        TableName: aws.ddbTable(name),
        AttributeDefinitions: [],
        KeySchema: [],
    };
    if (options.stream) {
        params.StreamSpecification = {
            StreamEnabled: true,
            StreamViewType: options.stream
        };
    }
    if (options.onDemand || !(r && w)) {
        params.BillingMode = "PAY_PER_REQUEST";
    } else

    if (r && w) {
        params.ProvisionedThroughput = {
            ReadCapacityUnits: r,
            WriteCapacityUnits: w
        };
    }
    if (lib.isArray(options.attrs)) {
        params.AttributeDefinitions = options.attrs;
    } else {
        for (const p in options.attrs) {
            params.AttributeDefinitions.push({ AttributeName: p, AttributeType: options.attrs[p] });
        }
    }
    if (Array.isArray(options.keys)) {
        options.keys.forEach((x, i) => {
            params.KeySchema.push({ AttributeName: x, KeyType: !i ? "HASH" : "RANGE" });
        });
    } else
    if (lib.isString(options.keys)) {
        params.KeySchema.push({ AttributeName: options.keys, KeyType: "HASH" });
    }

    if (!params.KeySchema.length && params.AttributeDefinitions.length) {
        params.KeySchema.push({ AttributeName: params.AttributeDefinitions[0].AttributeName, KeyType: "HASH" });
    }
    for (const key of params.KeySchema) {
        if (!params.AttributeDefinitions.find(x => (x.AttributeName === key))) {
            params.AttributeDefinitions.push({ AttributeName: key.AttributeName, AttributeType: "S" });
        }
    }

    for (const name in options.local) {
        const index = createIndex(params, name, options.local[name]);
        if (!params.LocalSecondaryIndexes) params.LocalSecondaryIndexes = [];
        params.LocalSecondaryIndexes.push(index);
    }

    for (const name in options.global) {
        if (params.ProvisionedThroughput) {
            options.global[name].readCapacity ??= r;
            options.global[name].writeCapacity ??= w;
        }
        const index = createIndex(params, name, options.local[name]);
        if (!params.GlobalSecondaryIndexes) params.GlobalSecondaryIndexes = [];
        params.GlobalSecondaryIndexes.push(index);
    }
    this.queryDDB('CreateTable', params, options, (err, item) => {
        logger.debug('CreateTable:', params, "OPTS:", options, err, "ITEM:", item);
        if (err || options.nowait) return typeof callback === "function" && callback(err, err ? { TableDescription: params } : item);

        // Wait because DynamoDB cannot create multiple tables at once especially with indexes
        options.waitStatus = "CREATING";
        aws.ddbWaitForTable(name, item, options, callback);
    });
}

/**
 * Update tables provisioned throughput settings, options is used instead of table name so this call can be used directly in the cron jobs to adjust
 * provisionined throughput on demand.
 * @param {object} options
 * @param {string} options.name - table name
 * @param {number} [options.readCapacity] and writeCapacity - new povisioned throughtput settings, both must be specified
 * @param {null|string} [options.stream] - null to disable or one of the NEW_IMAGE | OLD_IMAGE | NEW_AND_OLD_IMAGES | KEYS_ONLY
 * @param {object} [options.add] - an object with indexes to create { hash, range, projections, readCapacity, writeCapacity }
 * @param {object} [options.del] - delete a global secondary index by name, a string or a list with multiple indexes
 * @param {object} [options.update] - an object with indexes to update
 * @param {number} [options.waitTimeout] - how long to wait in ms until the table is active again
 * @param {boolean} [options.onDemand] - true to switch to pat per request mode, false to switch to provisioning mode
 * @param {function} callback
 *
 * @example
 *
 * aws.ddbUpdateTable({ name: "users", add: { name_id: { name: "S", id: 'N', readCapacity: 20, writeCapacity: 20, projection: ["mtime","email"] } })
 * aws.ddbUpdateTable({ name: "users", add: { name: { name: "S", readCapacity: 20, writeCapacity: 20, projection: "ALL" } })
 * aws.ddbUpdateTable({ name: "users", del: "name" })
 * aws.ddbUpdateTable({ name: "users", update: { name: { readCapacity: 10, writeCapacity: 10 } })
 *
 * @example of crontab job in etc/crontab:
 *
 * [
 *   { "cron": "0 0 1 * * *", "job": { "aws.ddbUpdateTable": { "name": "bk_user", "readCapacity": 1000, "writeCapacity": 1000 } } },
 *   { "cron": "0 0 6 * * *", "job": { "aws.ddbUpdateTable": { "name": "bk_user", "readCapacity": 2000, "writeCapacity": 2000 } } }
 * ]
 * @memberOf module:aws
 * @method ddbUpdateTable
 */
aws.ddbUpdateTable = function(options, callback)
{
    const params = {
        TableName: aws.ddbTable(options.name),
    };
    if (typeof options.onDemand === "boolean") {
        params.BillingMode = options.onDemand ? "PAY_PER_REQUEST" : "PROVISIONED";
    }

    if (typeof options.stream !== "undefined") {
        params.StreamSpecification = { StreamEnabled: !!options.stream };
        if (options.stream) {
            params.StreamSpecification.StreamViewType = options.stream;
        }
    } else

    if (options.BillingMode !== "PAY_PER_REQUEST" && options.readCapacity && options.writeCapacity) {
        params.ProvisionedThroughput = { ReadCapacityUnits: options.readCapacity, WriteCapacityUnits: options.writeCapacity };
    } else

    if (options.add) {
        for (const name in options.add) {
            const index = createIndex(params, name, options.add[name]);
            if (!params.GlobalSecondaryIndexUpdates) params.GlobalSecondaryIndexUpdates = [];
            params.GlobalSecondaryIndexUpdates.push({ Create: index });
        }
    } else

    if (options.del) {
        if (!params.GlobalSecondaryIndexUpdates) params.GlobalSecondaryIndexUpdates = [];
        lib.split(options.del).forEach(name => {
            params.GlobalSecondaryIndexUpdates.push({ Delete: { IndexName: name } });
        });
    } else

    if (options.update) {
        if (!params.GlobalSecondaryIndexUpdates) params.GlobalSecondaryIndexUpdates = [];
        for (const name in options.update) {
            params.GlobalSecondaryIndexUpdates.push({
                Update: {
                    IndexName: name,
                    ProvisionedThroughput: {
                        ReadCapacityUnits: options.update[name].readCapacity,
                        WriteCapacityUnits: options.update[name].writeCapacity,
                    }
                }
            });
        }
    }

    this.queryDDB('UpdateTable', params, options, (err, item) => {
        logger.debug('UpdateTable:', params, "OPTS:", options, err, "ITEM:", item);
        if (err || options.nowait) return typeof callback === "function" && callback(err, item);
        options.waitStatus = "UPDATING";
        aws.ddbWaitForTable(options.name, item, options, callback);
    });
}

/**
 * Enable or disable the Time-To-Live attribute for a table.
 * @memberOf module:aws
 * @method ddbUpdateTimeToLive
 * @param {object} options
 * @param {string} options.name - table name
 * @param {string} options.attribute - the TTL attribute name
 * @param {boolean} options.enabled - enable or disable TTL
 * @param {function} callback
 */
aws.ddbUpdateTimeToLive = function(options, callback)
{
    var params = {
        TableName: aws.ddbTable(options.name),
        TimeToLiveSpecification: {
            AttributeName: options.attribute,
            Enabled: lib.toBool(options.enabled)
        }
    };
    this.queryDDB('UpdateTimeToLive', params, options, callback);
}

/**
 * Return the status of the Time-To-Live attribute for a table.
 * @memberOf module:aws
 * @method ddbDescribeTimeToLive
 * @param {string} name - table name
 * @param {object} [options]
 * @param {function} callback - `(err, rc)`
 */
aws.ddbDescribeTimeToLive = function(name, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    const params = { TableName: aws.ddbTable(name) };
    this.queryDDB('DescribeTimeToLive', params, options, (err, rc) => {
        logger.debug('DescribeTimeToLive:', name, rc);
        if (typeof callback === "function") callback(err, rc);
    });
}

/**
 * Delete a table. By default the callback fires only after the table is fully deleted.
 * @memberOf module:aws
 * @method ddbDeleteTable
 * @param {string} name - table name
 * @param {object} [options]
 * @param {boolean} [options.nowait] - return immediately instead of waiting for deletion
 * @param {number} [options.waitTimeout] - how long to wait in ms for deletion
 * @param {function} callback
 */
aws.ddbDeleteTable = function(name, options, callback)
{
    var params = { TableName: aws.ddbTable(name) };
    this.queryDDB('DeleteTable', params, options, (err, item) => {
        if (err || options.nowait) return typeof callback === "function" && callback(err, item);
        options.waitStatus = "DELETING";
        aws.ddbWaitForTable(name, item, options, callback);
    });
}

/**
 * Wait until a table leaves the given `waitStatus` state or the timeout expires. If `waitTimeout` is not
 * set the callback fires immediately.
 * @memberOf module:aws
 * @method ddbWaitForTable
 * @param {string} name - table name
 * @param {object} item - the response item from the originating create/update/delete call
 * @param {object} options
 * @param {string} [options.waitStatus] - status to keep waiting while equal to (e.g. CREATING, UPDATING, DELETING)
 * @param {number} [options.waitTimeout] - how long to wait in ms
 * @param {number} [options.waitDelay=1000] - how often in ms to poll for status
 * @param {function} callback - `(err, item)`
 */
aws.ddbWaitForTable = function(name, item, options, callback)
{
    if (typeof callback !== "function") callback = lib.noop;
    if (!options.waitTimeout) return typeof callback === "function" && callback(null, item);

    const expires = Date.now() + options.waitTimeout;
    let status = item.TableDescription.TableStatus;
    options = lib.clone(options);
    options.quiet = 1;
    lib.whilst(
        function() {
            return status === options.waitStatus && Date.now() < expires;
        },
        function(next) {
            aws.ddbDescribeTable(name, options, (err, rc) => {
                if (err) {
                    // Table deleted, does not exist anymore
                    if (err.code === "ResourceNotFoundException" && options.waitStatus === "DELETING") {
                        status = err = null;
                    }
                    return next(err);
                }
                status = rc.Table.TableStatus;
                setTimeout(next, options.waitDelay || 1000);
            });
        },
        function(err) {
            if (typeof callback === "function") callback(err, item);
        }, true);
}

/**
 * Put (create or replace) an item; value types are inferred from the native JS types.
 * @memberOf module:aws
 * @method ddbPutItem
 * @param {string} name - table name
 * @param {object} item - the item to store
 * @param {object} [options] - any capitalized native property is passed through, plus:
 * @param {object} [options.query] - condition columns; value null means the attribute must not exist, any other value is compared for equality
 * @param {string} [options.expr] - raw ConditionExpression
 * @param {object} [options.values] - ExpressionAttributeValues map
 * @param {object} [options.names] - ExpressionAttributeNames map
 * @param {*} [options.returning] - any value returns the old item (ALL_OLD)
 * @param {function} callback - `(err, rc)` where `rc.Item` is the converted returned attributes
 * @example
 * ddbPutItem("users", { id: 1, name: "john", mtime: 11233434 }, { query: { name: null } })
 */
aws.ddbPutItem = function(name, item, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    if (!options) options = lib.empty;
    const params = { TableName: aws.ddbTable(name), Item: aws.toDynamoDB(item) };
    if (options.expr) {
        params.ConditionExpression = options.expr;
    } else
    if (options.query) {
        params.ConditionExpression = getQueryExpression(params, options.query, options);
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
        if (typeof callback === "function") callback(err, rc);
    });
}

/**
 * Update an item.
 * @memberOf module:aws
 * @method ddbUpdateItem
 * @param {string} name - table name
 * @param {object} keys - primary key attributes name:value
 * @param {object|string} item - attributes to update (number/string/array = set/add, null/empty = delete) or a raw UpdateExpression string
 * @param {object} [options] - any capitalized native property is passed through, plus:
 * @param {object} [options.ops] - per-attribute operators: set, remove, unset, delete, incr, add, append, prepend, not_exists
 * @param {object} [options.query] - condition columns (null = attribute absent), operator taken from `options.ops`
 * @param {string} [options.expr] - raw ConditionExpression
 * @param {object} [options.values] - ExpressionAttributeValues map
 * @param {object} [options.names] - ExpressionAttributeNames map
 * @param {string} [options.returning] - `*`/`new`=ALL_NEW, `old`=ALL_OLD, `updated`=UPDATED_NEW, `old_updated`=UPDATED_OLD
 * @param {function} callback - `(err, rc)` where `rc.Item` is the converted returned attributes
 * @example
 * ddbUpdateItem("users", { id: 1, name: "john" }, { gender: 'male', icons: '1.png' }, { ops: { icons: 'add' }, query: { id: 1 }, returning: "*" })
 */
aws.ddbUpdateItem = function(name, keys, item, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    if (!options) options = lib.empty;
    const params = { TableName: aws.ddbTable(name), Key: {} };
    for (const p in keys) {
        params.Key[p] = aws.toDynamoDB(keys[p]);
    }
    if (options.expr) {
        params.ConditionExpression = options.expr;
    } else
    if (options.query) {
        params.ConditionExpression = getQueryExpression(params, options.query, options);
    }
    if (options.names) {
        params.ExpressionAttributeNames = aws.toDynamoDB(options.names);
    }
    if (options.values) {
        params.ExpressionAttributeValues = aws.toDynamoDB(options.values);
    }
    if (options.returning) {
        params.ReturnValues = options.returning === "*" || options.returning === "new" ? "ALL_NEW" :
                              options.returning === "updated" ? "UPDATED_NEW" :
                              options.returning === "old" ? "ALL_OLD" :
                              options.returning === "old_updated" ? "UPDATED_OLD" :
                              options.returning;
    }
    if (typeof item === "string") {
        params.UpdateExpression = item;
    } else
    if (typeof item === "object") {
        let c = 0, d = 0;
        const names = {}, values = {};
        const actions = { SET: [], REMOVE: [], ADD: [], DELETE: [] };

        for (let p in item) {
            if (params.Key[p]) continue;
            const val = item[p], colname = p;

            let op = options.ops?.[colname];
            if (val === null || val === undefined) {
                op = "remove";
            } else
            if (Array.isArray(val) || typeof val === "string") {
                if (!val.length) {
                    if (op) continue;
                    op = "remove";
                }
            }

            if (p.includes(".")) {
                p = p.split(".").map((x) => {
                    for (const n in names) {
                        if (names[n] === x) return n;
                    }
                    names["#c" + c] = x;
                    return "#c" + c++;
                }).join(".");
            } else
            if (!aws.ddbNameRx.test(p) || this.ddbReserved[p.toUpperCase()]) {
                names["#c" + c] = p;
                p = "#c" + c++;
            }

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
        }

        params.UpdateExpression = "";
        for (const p in actions) {
            const expr = actions[p].join(",");
            if (expr) params.UpdateExpression += " " + p + " " + expr;
        }
        if (c) {
            if (!params.ExpressionAttributeNames) params.ExpressionAttributeNames = {};
            for (const p in names) {
                params.ExpressionAttributeNames[p] = names[p];
            }
        }
        if (d) {
            if (!params.ExpressionAttributeValues) params.ExpressionAttributeValues = {};
            for (const p in values) {
                params.ExpressionAttributeValues[p] = this.toDynamoDB(values[p], 1);
            }
        }
    }
    if (options.return_params) return params;

    this.queryDDB('UpdateItem', params, options, (err, rc) => {
        rc.Item = rc.Attributes ? aws.fromDynamoDB(rc.Attributes) : {};
        if (typeof callback === "function") callback(err, rc);
    });
}

/**
 * Delete an item from a table.
 * @memberOf module:aws
 * @method ddbDeleteItem
 * @param {string} name - table name
 * @param {object} keys - primary key attributes name:value (hash/range)
 * @param {object} [options] - any capitalized native property is passed through, plus:
 * @param {object} [options.query] - condition columns as in {@link module:aws.ddbPutItem}
 * @param {string} [options.expr] - raw ConditionExpression
 * @param {object} [options.values] - ExpressionAttributeValues map
 * @param {object} [options.names] - ExpressionAttributeNames map
 * @param {*} [options.returning] - any value returns the old item (ALL_OLD)
 * @param {function} callback - `(err, rc)` where `rc.Item` is the converted returned attributes
 * @example
 *          ddbDeleteItem("users", { id: 1, name: "john" }, {})
 */
aws.ddbDeleteItem = function(name, keys, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    if (!options) options = lib.empty;
    const params = { TableName: aws.ddbTable(name), Key: {} };
    for (const p in keys) {
        params.Key[p] = aws.toDynamoDB(keys[p]);
    }
    if (options.expr) {
        params.ConditionExpression = options.expr;
    } else
    if (options.query) {
        params.ConditionExpression = getQueryExpression(params, options.query, options);
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
    this.queryDDB('DeleteItem', params, options, (err, rc) => {
        rc.Item = rc.Attributes ? aws.fromDynamoDB(rc.Attributes) : {};
        if (typeof callback === "function") callback(err, rc);
    });
}

/**
 * Put and/or delete multiple items across tables in one BatchWriteItem request.
 * @memberOf module:aws
 * @method ddbBatchWriteItem
 * @param {object} items - map of table name to a list of operations, each `{ put|add: item }` or `{ del: keys }`
 * @param {object} [options] - any capitalized native property is passed through
 * @param {function} callback
 * @example
 *          aws.ddbBatchWriteItem({ table: [ { put: { id: 1, name: "tt" } }, { del: { id: 2 } } ] })
 */
aws.ddbBatchWriteItem = function(items, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    const params = { RequestItems: {} };
    for (const p in items) {
        const table = aws.ddbTable(p);
        params.RequestItems[table] = [];
        items[p].forEach(obj => {
            const item = {};
            for (const p in obj) {
                switch (p) {
                case "add":
                case "put":
                    item.PutRequest = { Item: aws.toDynamoDB(obj[p]) };
                    break;

                case "del":
                    item.DeleteRequest = { Key: aws.toDynamoDB(obj[p]) };
                    break;
                }
            }
            params.RequestItems[table].push(item);
        });
    }
    this.queryDDB('BatchWriteItem', params, options, callback);
}

/**
 * Retrieve multiple items across tables in one BatchGetItem request.
 * @memberOf module:aws
 * @method ddbBatchGetItem
 * @param {object} items - map of table name to `{ keys: [key,...], [select], [consistent] }`
 * @param {object} [options] - any capitalized native property is passed through
 * @param {function} callback - `(err, rc)` where `rc.Responses` is keyed by the logical table names
 * @example
 *          aws.ddbBatchGetItem({ users: { keys: [{ id: 1, name: "john" }], select: ['name','id'], consistent: true } })
 */
aws.ddbBatchGetItem = function(items, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    if (!options) options = lib.empty;
    const params = { RequestItems: {} }, map = {};
    for (const p in items) {
        const table = aws.ddbTable(p);
        const obj = {};
        obj.Keys = items[p].keys.map(x => aws.toDynamoDB(x));
        if (items[p].select) {
            setProjectionExpression(obj, items[p].select);
        }
        if (items[p].consistent) obj.ConsistentRead = true;
        params.RequestItems[table] = obj;
        map[table] = p;
    }
    this.queryDDB('BatchGetItem', params, options, (err, rc) => {
        for (const p in rc.Responses) {
            rc.Responses[map[p]] = aws.fromDynamoDB(rc.Responses[p]);
            if (p !== map[p]) delete rc.Responses[p];
        }
        if (typeof callback === "function") callback(err, rc);
    });
}


/**
 * Retrieve one item by primary key.
 * @memberOf module:aws
 * @method ddbGetItem
 * @param {string} name - table name
 * @param {object} keys - primary key attributes name:value
 * @param {object} [options] - any capitalized native property is passed through, plus:
 * @param {string|string[]} [options.select] - columns to return (default all)
 * @param {string} [options.projection] - raw ProjectionExpression
 * @param {boolean} [options.consistent] - use a strongly consistent read
 * @param {object} [options.names] - ExpressionAttributeNames map
 * @param {function} callback - `(err, rc)` where `rc.Item` is the converted item or null
 * @example
 *       ddbGetItem("users", { id: 1, name: "john" }, { select: 'id,name' })
 */
aws.ddbGetItem = function(name, keys, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    if (!options) options = lib.empty;
    const params = { TableName: aws.ddbTable(name), Key: {} };
    if (options.select) {
        setProjectionExpression(params, options.select);
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
    this.queryDDB('GetItem', params, options, (err, rc) => {
        if (!options.debug) rc.Item = rc.Item ? aws.fromDynamoDB(rc.Item) : null;
        if (typeof callback === "function") callback(err, rc);
    });
}

/**
 * Query a table and return all matching items.
 * @memberOf module:aws
 * @method ddbQueryTable
 * @param {string} name - table name
 * @param {object|string} condition - name:value pairs (EQ by default) or a raw KeyConditionExpression string
 * @param {object} [options] - any capitalized native property is passed through, plus:
 *      - start - starting primary key for pagination (string/number hash or `{hash, range}` object)
 *      - consistent - use a strongly consistent read
 *      - select - list of attributes to return
 *      - total - return only the count of matching records
 *      - count - limit the number of records
 *      - desc - descending order
 *      - sort - index name to query (indexes named after their key column)
 *      - ops - per-attribute comparison operators when other than EQ
 *      - keys - list of primary key columns, if there are other properties in the condition then they will be
 *          put into FilterExpression instead of KeyConditionExpression. If keys are absent, all properties in the
 *          condition are treated as primary keys.
 *      - projection - projection expression
 *      - values - an object with values map to be used for in the update and/or condition expressions, to be used
 *          for ExpressionAttributeValues parameters
 *      - names - an object with a map to be used for attribute names in condition and update expressions, to be used
 *          for ExpressionAttributeNames parameter
 *      - expr - filtering expression
 *
 * @example
 *
 * aws.ddbQueryTable("users", { id: 1, name: "john" }, { select: 'id,name', ops: { name: 'gt' } })
 * aws.ddbQueryTable("users", { id: 1, name: "john", status: "ok" }, { keys: ["id"], select: 'id,name', ops: { name: 'gt' } })
 * aws.ddbQueryTable("users", { id: 1 }, { expr: "status=:s", values: { s: "status" } })
 * @param {function} callback - `(err, rc)` where `rc.Items` is the converted result set
 */
aws.ddbQueryTable = function(name, condition, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    if (!options) options = lib.empty;
    const params = { TableName: aws.ddbTable(name) };
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
        setProjectionExpression(params, options.select);
    }
    if (options.count > 0) {
        params.Limit = options.count;
    }
    if (options.total) {
        params.Select = "COUNT";
    }
    if (typeof condition === "string") {
        params.KeyConditionExpression = condition;
    } else
    if (Array.isArray(options.keys)) {
        const keys = {}, filter = {};
        for (const p in condition) {
            const name = p.includes("_$") ? p.substr(0, p.indexOf("_$")) : p;
            if (options.keys.includes(name)) {
                keys[p] = condition[p];
            } else {
                filter[p] = condition[p];
            }
        }
        params.KeyConditionExpression = getQueryExpression(params, keys, options);
        if (filter) {
            params.FilterExpression = getQueryExpression(params, filter, options);
        }
    } else
    if (lib.isObject(options.keys)) {
        params.KeyConditionExpression = getQueryExpression(params, options.keys, options);
    } else {
        params.KeyConditionExpression = getQueryExpression(params, condition, options);
    }

    this.queryDDB('Query', params, options, (err, rc) => {
        if (!options.debug) rc.Items = rc.Items ? aws.fromDynamoDB(rc.Items) : [];
        if (typeof callback === "function") callback(err, rc);
    });
}

/**
 * Scan a table and return all matching items.
 * @memberOf module:aws
 * @method ddbScanTable
 * @param {string} name - table name
 * @param {object|string} condition - name:value pairs or a raw FilterExpression string
 * @param {object} [options] - any capitalized native property is passed through, plus:
 * @param {object|string|number} [options.start] - starting primary key for pagination
 * @param {object} [options.ops] - per-attribute comparison operators when other than EQ
 * @param {string} [options.projection] - raw ProjectionExpression
 * @param {string|string[]} [options.select] - attributes to return
 * @param {string} [options.sort] - index name to scan
 * @param {boolean} [options.consistent] - use a strongly consistent read
 * @param {number} [options.count] - limit the number of records
 * @param {boolean} [options.total] - return only the count of matching records
 * @param {object} [options.values] - ExpressionAttributeValues map
 * @param {object} [options.names] - ExpressionAttributeNames map
 * @param {function} callback - `(err, rc)` where `rc.Items` is the converted result set
 * @example
 *          aws.ddbScanTable("users", { id: 1, name: 'a' }, { ops: { name: 'gt' }})
 *          aws.ddbScanTable("users", "id=:id AND name=:name", { values: { id: 1, name: 'a' } });
 */
aws.ddbScanTable = function(name, condition, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    if (!options) options = lib.empty;
    const params = { TableName: aws.ddbTable(name) };
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
        setProjectionExpression(params, options.select);
    }
    if (options.count > 0) {
        params.Limit = options.count;
    }
    if (options.total) {
        params.Select = "COUNT";
    }
    params.FilterExpression = lib.isString(condition) || getQueryExpression(params, condition, options);

    this.queryDDB('Scan', params, options, (err, rc) => {
        if (!options.debug) rc.Items = rc.Items ? aws.fromDynamoDB(rc.Items) : [];
        if (typeof callback === "function") callback(err, rc);
    });
}

/**
 * Perform multiple write operations in one transaction; any failure rolls everything back.
 * @memberOf module:aws
 * @method ddbTransactWriteItems
 * @param {object[]} items - list of operations, each `{ op, table, keys, query, options }` where `op` is one of
 *   put/add, update/incr, del, check; `query`/`keys`/`options` follow the corresponding ddb item methods
 * @param {object} [options] - any capitalized native property is passed through
 * @param {function} callback
 * @example
 *          aws.ddbTransactWriteItems([
 *            { op: "put", table: "table-name", query: { id: 1, name: "tt" } },
 *            { op: "del", table: "table-name", query: { id: 2 } },
 *            { op: "update", table: "table-name", keys: { id: 1 }, query: { name: "test" }, options: { query: { status: "ok" } } },
 *            { op: "check", table: "table-name", query: { id: 1 }, options: { query: { status: "ok" } } }
 *          ])
 */
aws.ddbTransactWriteItems = function(items, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    const params = { TransactItems: [] };
    lib.isArray(items, []).forEach(x => {
        var item, opts = Object.assign({ return_params: 1 }, x.options);
        switch (x.op) {
        case "get":
        case "check":
            item = { TableName: aws.ddbTable(x.table), Key: {} };
            for (const p in x.query) {
                item.Key[p] = aws.toDynamoDB(x.query[p]);
            }
            if (opts.query) {
                item.ConditionExpression = getQueryExpression(item, opts.query, opts);
            }
            if (opts.expr) {
                item.ConditionExpression = opts.expr;
            }
            if (opts.names) {
                item.ExpressionAttributeNames = aws.toDynamoDB(opts.names);
            }
            if (opts.values) {
                item.ExpressionAttributeValues = aws.toDynamoDB(opts.values);
            }
            item = { ConditionCheck: item };
            break;
        case "incr":
        case "update":
            item = { Update: aws.ddbUpdateItem(x.table, x.keys, x.query, opts) };
            if (item.Update.ReturnValues) item.Update.ReturnValuesOnConditionCheckFailure = "ALL_OLD";
            item.Update.ReturnValues = undefined;
            break;
        case "add":
        case "put":
            item = { Put: aws.ddbPutItem(x.table, x.query, opts) };
            if (item.Put.ReturnValues) item.Put.ReturnValuesOnConditionCheckFailure = "ALL_OLD";
            item.Put.ReturnValues = undefined;
            break;
        case "del":
            item = { Delete: aws.ddbDeleteItem(x.table, x.query, opts) };
            if (item.Delete.ReturnValues) item.Update.ReturnValuesOnConditionCheckFailure = "ALL_OLD";
            item.Delete.ReturnValues = undefined;
            break;
        default:
            return;
        }
        for (const p in opts) if (p[0] >= 'A' && p[0] <= 'Z') item[p] = opts[p];
        params.TransactItems.push(item);
    });
    this.queryDDB('TransactWriteItems', params, options, callback);
}

/**
 * Run a single PartiQL statement against DynamoDB.
 * @memberof module:aws
 * @method ddbExecuteStatement
 * @param {string} text - the PartiQL statement
 * @param {object} [options]
 * @param {boolean} [options.consistent] - use a strongly consistent read
 * @param {string} [options.start] - pagination token (NextToken)
 * @param {object[]} [options.params] - positional parameters for the statement
 * @param {function} callback - `(err, rc)` where `rc.Items` is the converted result set
 */
aws.ddbExecuteStatement = function(text, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    if (!options) options = lib.empty;
    const params = { Statement: text };
    if (options.consistent) {
        params.ConsistentRead = true;
    }
    if (options.start) {
        params.NextToken = options.start;
    }
    if (lib.isArray(options.params)) {
        params.Parameters = aws.toDynamoDB(options.params);
    }

    this.queryDDB('ExecuteStatement', params, options, function(err, rc) {
        if (!options.debug) rc.Items = rc.Items ? aws.fromDynamoDB(rc.Items) : [];
        if (typeof callback === "function") callback(err, rc);
    });
}

/**
 * Run multiple PartiQL statements in a single DynamoDB transaction.
 * @memberof module:aws
 * @method ddbExecuteTransaction
 * @param {string[]|object[]} items - statements as strings or `{ text, params }` objects
 * @param {object} [options]
 * @param {string} [options.start] - idempotency token (ClientRequestToken)
 * @param {function} callback - `(err, rc)` where `rc.Responses` is the converted result
 */
aws.ddbExecuteTransaction = function(items, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    if (!options) options = lib.empty;
    const params = { TransactStatements: [] };
    if (options.start) {
        params.ClientRequestToken = options.start;
    }
    lib.isArray(items, []).forEach(function(x) {
        var o = { Statement: typeof x === "string" ? x : x.text };
        if (lib.isArray(x.params)) {
            o.Parameters = aws.toDynamoDB(x.params);
        }
        params.TransactStatements.push(o);
    });

    this.queryDDB('ExecuteTransaction', params, options, function(err, rc) {
        if (!options.debug) rc.Responses = rc.Responses ? aws.fromDynamoDB(rc.Responses) : [];
        if (typeof callback === "function") callback(err, rc);
    });
}

/**
 * Run a batch of independent PartiQL statements against DynamoDB.
 * @memberof module:aws
 * @method ddbBatchExecuteStatement
 * @param {string[]|object[]} items - statements as strings or `{ text, params, consistent }` objects
 * @param {object} [options]
 * @param {function} callback - `(err, rc)` where each `rc.Responses[].Item` is converted
 */
aws.ddbBatchExecuteStatement = function(items, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    if (!options) options = lib.empty;
    const params = { Statements: [] };
    lib.isArray(items, []).forEach(function(x) {
        var o = { Statement: typeof x === "string" ? x : x.text };
        if (x.consistent) {
            o.ConsistentRead = true;
        }
        if (lib.isArray(x.params)) {
            o.Parameters = aws.toDynamoDB(x.params);
        }
        params.Statements.push(o);
    });

    this.queryDDB('BatchExecuteStatement', params, options, function(err, rc) {
        if (!options.debug) rc.Responses = lib.isArray(rc.Responses, []).map((x) => { x.Item = aws.fromDynamoDB(x.Item); return x });
        if (typeof callback === "function") callback(err, rc);
    });
}

/**
 * Export a DynamoDB table to S3, as a full or incremental point-in-time export.
 * @memberof module:aws
 * @method ddbExportTableToPointInTime
 * @param {object} query
 * @param {string} query.table - table name (mapped via `ddbTableMap`) or full table ARN
 * @param {string} query.bucket - destination S3 bucket
 * @param {string} [query.prefix] - S3 key prefix
 * @param {boolean} [query.incr] - perform an incremental export instead of a full export
 * @param {number|string} [query.stime] - incremental export start time
 * @param {number|string} [query.etime] - incremental export end time
 * @param {boolean} [query.new] - for incremental exports use NEW_IMAGE only (default NEW_AND_OLD_IMAGES)
 * @param {object} [options]
 * @param {string} [options.token] - client idempotency token
 * @param {function} callback
 */
aws.ddbExportTableToPointInTime = function(query, options, callback)
{
    if (typeof options === "function") callback = options, options = null;
    let table = aws.ddbTableMap[query.table] || query.table || "";
    if (!table.includes(":")) table = `arn:aws:dynamodb:${aws.region}:${aws.accountId}:table/${table}`;

    const req = {
        ExportType: query.incr ? "INCREMENTAL_EXPORT" : "FULL_EXPORT",
        S3Bucket: query.bucket,
        S3Prefix: query.prefix,
        TableArn: table,
        ClientToken: options.token || `${query.table}:${query.stime}:${query.etime}`,
    }
    if (query.incr) {
        req.IncrementalExportSpecification = {
            ExportFromTime: Math.round(lib.toMtime(query.stime)/1000),
            ExportToTime: Math.round(lib.toMtime(query.etime)/1000),
            ExportViewType: query.new ? "NEW_IMAGE" : "NEW_AND_OLD_IMAGES",
        }
    }
    this.queryDDB('ExportTableToPointInTime', req, options, callback);
}

