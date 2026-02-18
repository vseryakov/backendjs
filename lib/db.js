/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const logger = require(__dirname + '/logger');
const app = require(__dirname + '/app');
const lib = require(__dirname + '/lib');
const ipc = require(__dirname + '/ipc');
const metrics = require(__dirname + '/metrics');
const dbPool = require(__dirname + '/db/pool');
const fs = require("fs");

/**
 * @typedef {object} DbRequestOptions
 * @property {string} pool - name of the database pool where to execute this query.
 *      The difference with the high level functions that take a table name as their firt argument, this function must use pool
 *      explicitely if it is different from the default. Other functions can resolve
 *      the pool by table name if some tables are assigned to any specific pool by configuration parameters `db-pool-tables__.
 * @property {function} filterrows - function to filter rows not to be included in the result, returns a new result set, args are: function(req, rows)
 * @property {function} processrows - function to process rows in the result, returns a new result, args are: function(req, rows), this result will be put in cache
 *      if requested so this may be used for preparing cached results, it must return an array
 * @property  {function} processasync - function to process result rows via async callback, return a new result in the callback, the function is: function(req, rows, callback),
 *      the callback is function(err, rows)
 * @property {string} logger_db - log results at the end with this level or __debug__ by default
 * @property {string} logger_error - log errors with this level instead  of __error__
 * @property {boolean|string[]} ignore_error - clear errors occurred as it never happen, do not report in the log, if an array then only matched codes will be cleared
 * @property {boolean} noprocessrows - if true then skip post processing result rows, return the data as is, this will result in returning combined columns as it is
 * @property {boolean} noconvertrows - if true skip converting the data from the database format into Javascript data types, it uses column definitions
 * @property {boolean} nopreparequery - if true skip query preparation and columns processing, the req.query is passed as is, useful for syncing between pools
 *      for the table to convert values returned from the db into the the format defined by the column
 * @property {boolean} total - if true then it is supposed to return only one record with property __count__, skip all post processing and convertion
 * @property {boolean} info_query - to return the record just processed in the info object as __query__ property, it will include all generated and updated columns
 * @property {boolean} result_query - to return the query record as result including all post processing and new generated columns, this is not what __returning__ property does, it only
 *      returns the query record with new columns from memory
 * @property {boolean} cached - if true then run getCached version directly
 * @property {boolean} nocache - disable caching even if configured for the table
 * @property {object} ops - operators to use for for properties, an object with column name and operator.
 *
 *   **Comparison** operators used in select/get:
 * ```>, gt, <, lt, =, !=, <>, >=, ge, <=, le, in, all_in,
 *    between, match, regexp, iregexp, begins_with, not_begins_with, ends_with, not_ends_with,
 *    like, like%, ilike%, contains, not_contains, expr
 * ```
 *
 *  **Update** operators used in incr/update/del:
 *    - add - add to list
 *    - del - remove from list
 *    - incr - increment a number
 *    - unset/remove - remove column or set to NULL
 *    - append - append to existing column value
 *    - prepend - prepend to existing column value
 *    - not_exists - update only if the value is null, otherwise skip
 *    - expr - SQL expression as is or can be an array of values with
 *       elememt 0 being the expression with the rest as values: ["COALESCE(name,$1)||$2", 'N/A', ' jr']
 *
 * As an alternative, operators also can be used inside column names, the format is **name_$op**:
 * ```js
 * { flags_$del: "flag" }
 * { count_$incr: 3 }
 * { tag_$expr: "COALESCE(name,'none')||count" }
 * { tag_$expr: ["COALESCE(name,$1)||count", "N/A"] }
 * ```
 * @property {object} opsMap - operator mapping between supplied operators and actual operators supported by the db
 * @property {object} typesOps - an object that defines ops by column type, for example __typesOps: { list: "add" }__ will
 * @property {object} typesMap - type mapping between supplied and actual column types, an object
 *   make sure all lists will have options.ops set to __add__ if not specified explicitly
 * @property {string|string[]} select - a list of columns or expressions to return or all columns if not specified, only existing columns will be returned
 * @property {string|object} start - start records with this primary key, this is the __next_token__ passed by the previous query from {@link module.db.select}
 * @property {int} count - how many records to retrieve in a single batch
 * @property {boolean} first - a convenient option to return the first record from the result or null (similar to __db.get__ method)
 * @property {boolean} last - similar to first but return the last record
 * @property {string} join - how to join condition expressions, default is AND
 * @property {object} joinOps - operators to use to combine several expressions in case when an array of values is given, supports __and|or|AND|OR____
 * @property {string} sort - sort by this column. if not provided then no sorting must be done at all, records will be returned in the order they are kept in the DB.
 *  - DynamoDB: this may affect the results if columns requsted are not projected in the index
 *  - Elasticsearch: by default page based pagination is used if no __fullscan__ is provided with or without the __sort__ option
 * @property {boolean} desc - if sorting, do in descending order
 * @property {int} page - starting page number for pagination, uses count to find actual record to start, for SQL databases mostly
 * @property {string} cacheKey - exlicit key for caching, return from the cache or from the DB and then cache it with this key, works the same as __get__
 * @property {string} cacheKeyName - a name of one of the cache keys to use, it must be defined by a __db-cache-keys-table-name__ parameter
 * @property {boolean} no_columns - do not check for actual columns defined in the pool tables and add all properties from the obj, only will work for NoSQL dbs,
 *        by default all properties in the obj not described in the table definition for the given table will be ignored.
 * @property {string[]} skip_columns - ignore properties by name listed in the this array, the most use case is to skip autogeneratd columns like "now"
 * @property {object} query - an object with the condition for the update/incr ops,
 *    it is used instead or in addition to the primary keys in the __query__,
 *    a property named $or/$and will be treated as a sub-expression if it is an object. For multiple OR/AND use $$or, $$$or,...
 * @property {boolean} upsert - create a new record if it does not exist
 * @property {string} useCapacity - triggers to use specific capacity, default is __read__
 * @property {number} factorCapacity - a factor to apply for the read or write capacity limit and trigger the capacity check, default is __0.9__
 * @property {string} tableCapacity - use a different table for capacity throttling instead of the __table__, useful for cases when the row callback performs
 *   writes into that other table and capacity is different
 * @property {object} capacity - a full capacity object to pass to select calls, used by {@link module:db.checkCapacity}
 * @property {boolean} batch - if true rowCallback will be called with all rows from the batch, used in {@link module:db.scan}
 *   not every row individually, batch size is defined by the __count__ property, used in {@link module:db.scan}
 * @property {boolean} sync - as batch mode but the rowCallback is called synchronously as __rowCallback(row, info)__, used in {@link module:db.scan}
 * @property {number} concurrency - how many rows or operations to process at the same time, used in {@link module:db.scan}, {@link module:db.batch}
 * @property {number} limit - total number of records to scan, used in {@link module:db.scan}
 * @property {boolean} noscan - if true no scan will be performed if no primary keys are specified to prevent scanning large tables, used in {@link module:db.scan}
 * @property {boolean} fullscan - if true force to perform a full scan, this is slightly different for each database, used in {@link module:db.scan}:
 *  - DynamoDB: used full table scan, the query condition still is checked, can be expensive for large table because pricing is by every object checked not by what is actually returned
 *  - Elasticsearch: performs streaming scan, using native order but all conditions are checked still, very effective for large scans
 * @property {boolean} syncMode - skip column preprocessing and dynamic values for pool sync and backup restore, used in {@link module:db.copy}
 *
 */

/**
 * @summary This callback is called by all DB methods
 * @callback DbResultCallback
 * @param {Error} err - and error object or null i fno errors
 * @param {object[]} rows - a list of result rows, in case of error it is an empty list
 * @param {object} info - an object with information about the last query:
 * @param {string} [info.inserted_oid] - new generated ID
 * @param {int} [info.affected_rows] - how many rows were affected by this operation
 * @param {string} [info.next_token] - next to ken to pass for pagination
 * @param {int} [info.consumed_capacity] - DynamoDB specific about capacity consumed
 */

/**
 * @summary A column prepared to be used in conditions, see {@link module:db.prepareColumn}
 * @typedef DbRequestColumn
 * @property {string} name - actual column name
 * @property {string} type - type from {@link DbTableColumn}
 * @property {string} op - operator to use in comparison or update, lowercase and all underscores are converted into spaces
 * @property {any} value - value passed for compare or update
 * @property {string} join - join operator, AND is default
 * @property {string} alias - original name in case name contained _$ placeholder
 * @property {DbTableColumn} [col] - existing column definition or undefined
 */

/**
 * @summary Database table object, each property represents a column
 * @typedef {object} DbTable
 * @property {DbTableColumn} name1 - column1
 * @property {DbTableColumn} name2 - column2
 * @property {DbTableColumn} ... - more columns
 */

/**
 * @summary Database column definition, all properties are optional
 * @typedef {object} DbTableColumn
 * @property {string} type -  column type, supported types:
 *  - __int, bigint, log, real, float, number__ -  numeric types
 *  - __bool, boolean__ -  stored as boolean type
 *  - __text, string, keyword__ -  text types
 *  - __date, time, timestamp__ -  Date stored in database supported type, usually as text in SQL
 *  - __mtime__ -  timestamp in milliseconds
 *  - __json__ -  stored as JSON text but converted to/from native Javascript objects
 *  - __obj, object__ -  native JSON object type
 *  - __array__ -  native JSON array type
 *  - __list__ -  store a list of primitive types, strings and/or numbers
 *  - __set__ - a unique set of string or numbers
 *  - __random__ -  generates a random number in {@link module:db.add}/{@link module:db.put} methods, uses optional .max/.min properties
 *  - __ttl__ -  in add/put save as timestamp in the future to be expired by database (DynamoDB)
 *  - __uuid, suuid, sfuuid__ -  autogenerate the column value with UUID,
 *       optional __prefix__ property will be prepended, __{ type: "uuid", prefix: "u_" }__,
 *       see {@link module:lib.uuid}, {@link module:lib.suuid}, {@link module:lib.tuuid}
 *  - __now__ -  defines a column to be automatically filled with the current timestamp
 *  - __counter__ -  defines a columns that will be automatically incremented by the {@link module:db.incr} command, on creation it is set with 0
 *  - __uid__ -  defines a columns to be automatically filled with the current user id, this assumes that user object is passed in the options from the API level
 *  - __uname__ -  defines a columns to be automatically filled with the current user name, this assumes that user object is passed in the options from the API level
 *  - __ttl__ -  mark the column to be auto expired, can be set directly to time in the future or use one of: __days__, __hours__, __minutes__ as a interval in the future
 * @property {int} primary -  column is part of the primary key, for composite keys the number defines the place starting with 1
 * @property {int} unique -  column is part of an unique key, the number defines the order if it is composite key
 * @property {int} index -  column is part of an index, the value is a number for the column position in the index
 * @property {int} uniqueN -  additonal unique indexes where N is 1..25
 * @property {int} indexN -  additonal indexes where N is 1..25
 * @property {any} value -  default value to save if not provided
 * @property {any} dflt - default value to return if not present in the db record
 * @property {int} length -  column length (SQL)
 * @property {boolean} not_null - true if should be NOT NULL (SQL)
 * @property {boolean} auto - true for AUTO_INCREMENT column (SQL)
 * @property {boolean} readonly -  only add/put operations will use the value, incr/update will not affect the value
 * @property {boolean} writeonly -  only incr/update can change this value, add/put will ignore it
 * @property {string} prefix -  prefix to be prepended for autogenerated columns: __uuid__, __suuid__, __sfuuid__
 * @property {string} separator -  to be used as a separator in join or lists depending on the column properties
 * @property {boolean} keyword - store as is without tokenizing (ElasticSearch)
 * @property {string[]} join - a list with property names that must be joined together before performing a db operation,
 *   it will use the given record to produce a new property, empty properties will be still joined as empty strings.
 *
 * @property {object} [foreign] -  foreign key reference (SQL)
 * @property {string} foreign.table - reference table name
 * @property {string} foreign.name - reference table primary key
 * @property {string} foreign.ondelete - action on delete, cascade, ...
 * @property {string} foreign.custom - additional SQL statements
 *
 * @property {object} [convert] - convert value on save
 * @property {boolean} convert.list -  on return splits the column value into an array, uses the __separator__ property
 * @property {boolean} convert.lower -  make string value lowercase
 * @property {boolean} convert.upper -  make string value uppercase
 * @property {boolean} convert.cap -  capitalize words
 * @property {regexp} convert.strip -  if a regexp strip on the column value before saving
 * @property {regexp} convert.replace -  if a regexp perform replace on the column value before saving
 * @property {boolean} convert.trim -  strim string value of whitespace
 * @property {int} convert.multiplier -  for numeric columns apply this multipliers before saving
 * @property {int} convert.increment -  for numeric columns add this value before saving
 * @property {int} convert.decimal -  for numeric columns convert into fixed number using this number of decimals
 * @property {function} convert.format -  a function (val, req) => {} that must return new value for the given column, for custom formatting
 * @property {boolean} convert.epoch -  for "now" type save as seconds since the Epoch, not milliseconds
 * @property {boolean} convert.clock -  for "now" type timestamp is in nanoseconds
 *
 * @property {object} check - validation checks
 * @property {int} check.max -  ignore the column if a __text__, __json__ or __obj__ value is greater than specified limit, unless __trunc__ is provided
 * @property {boolean} check.trunc -  truncate the column value, the value will be truncated before saving into the DB, uses the __max__ as the limit
 * @property {int} check.maxlist -  max number of items in the __list__, __set__ or __array__ column types
 * @property {boolean} check.not_zero - true if should be skipped if 0 value
 * @property {boolean} check.not_empty -  do not allow empty columns, if not provided it is filled with the default value
 * @property {boolean} check.skip_empty -  ignore the column if the value is empty, i.e. null or empty string
 * @property {boolean} check.fail_ifempty -  returtn an error if there is no  value for the column, this is checked during record preprocessing
 *
 * @property {string} sql - Generic SQL specific instructions to apply when creating a table or column
 * @property {string} sqlite - Sqlite specific instructions to apply when creating a table or column
 * @property {string} pg - PostgreSQL specific instructions to apply when creating a table or column
 * @property {object} dynamodb - DynamoDB specific instructions to apply when creating a table or column
 * @property {object} elasticsearch - Elasticsearch specific instructions to apply when creating a table or column
 *
 * @property {object} api - API access permisions
 * @property {boolean} api.pub - make a column as public, used by {@link module:api.sendJSON} in cleanup mode.
 *    **this is very important property because it allows anybody to see it when used with the default API functions, i.e. anybody with valid
 *    credentials can retrieve all public columns from all tables and may expose some personal information,
 *    so by default only a few columns are marked as public in the __users__ table**
 * @property {boolean} api.priv -  an opposite for the pub property, if defined this property should never be returned to the client by the API handlers
 * @property {boolean} api.admin -  a generic read permission requires __req.options.isAdmin__ when used with {@link module:api.cleanupResult}
 * @property {boolean} api.staff -  a generic read permission requires __req.options.isStaff__ when used with {@link module:api.cleanupResult}
 * @property {boolean} api.internal -  if set then this property can only be updated by admin/root or with __req.options.isInternal____ property
 * @property {string|string[]} api.roles -  a role or a list of roles which further restricts access to a public column, only users with specified roles can retrieve it
 * @property {string|string[]} api.noroles -  a role or a list of roles which excplicitely deny access to a column for users with provided roles
 */

 /**
  * @summary Common options for the pools that customize behaviour
  * @typedef DbConfigOptions
  * @property {boolean} upgrade - perform alter table instead of create
  * @property {boolean} typesMap - type mapping, convert lowercase type into other type supported by any specific database
  * @property {boolean} noDefaults - ignore default value if not supported (Cassandra)
  * @property {boolean} noNulls - NOT NULL restriction is not supported (Cassandra)
  * @property {boolean} noMultiSQL - return as a list, the driver does not support multiple SQL commands
  * @property {boolean} noLengths - ignore column length for columns (Cassandra)
  * @property {boolean} noIfExists - do not support IF EXISTS on table or indexes
  * @property {boolean} noCompositeIndex - does not support composite indexes (Cassandra)
  * @property {boolean} noAuto - no support for auto increment columns
  * @property {boolean} skipNull - object with operations which dont support null(empty) values
  */

/*
 * Config table schema
 */
const bk_config = {
    name: { primary: 1, keyword: 1 },       // name of the parameter
    ctime: { type: "now", primary: 2 },     // create time
    type: { type: "text", keyword: 1 },     // config type or tag
    value: { type: "text" },                // the value
    status: { value: "ok" },                // ok - availaible
    version: { type: "text" },              // version conditions, >M.N,<M.N
    stime: { type: "mtime" },               // start time when in use
    etime: { type: "mtime" },               // end time when not in use
    sort: { type: "int" },                  // sorting order
    mtime: { type: "now" }
};

/**
 * @module db
 */

const db =

/**
 * The Database API, a thin abstraction layer on top of SQLite, PostgreSQL, DynamoDB, Elasticsearch.
 *
 * The idea is to not introduce a new abstraction layer on top of all databases but to make
 * the API usable for common use cases.
 *
 * On the source code level access to all databases will be possible using
 * this API but any specific usage like SQL queries syntax or data types available only for some databases will not be
 * unified or automatically converted. Instead it is passed to the database directly.
 *
 * Only conversion between JavaScript types and
 * database types is unified to some degree meaning JavaScript data types will be converted into the corresponding
 * data types supported by any particular database and vice versa.
 *
 * Basic CRUD operations are supported for all database and modelled after NoSQL usage, this means no SQL joins are supported
 * by the API, only single table access. SQL joins can be passed as SQL statements directly to the database using low level
 * {@link module:db.query} API call, all high level operations like add/put/del perform SQL generation for single table on the fly.
 *
 * The common convention is to pass the options object with flags that are common for all drivers,
 * this options object can be modified with new properties but all drivers should try not to
 * modify or delete existing properties, so the same options object can be reused in subsequent operations.
 *
 * All queries and update operations ignore properties that starts with underscore.
 *
 * Before the DB functions can be used the __app.init__ MUST be called first, the typical usage:
 * ```js
 * const { db } = require("backendjs");
 * app.init((err) => {
 *   db.add(...
 *   ...
 * });
 * ```
 *
 * All database methods can use default db pool or any other available db pool by using __pool: name__ in the options. If not specified,
 * then default db pool is used, __none__ is default if no -db-pool config parameter specified in the command line or the config file.
 *
 * Even if the specified pool does not exist, the default pool will be returned, this allows to pre-configure the app with different pools
 * in the code and enable or disable any particular pool at any time.
 *
 * To use PostgreSQL db pool to get a record and update the current pool:
 *
 * db-pg-pool=pg://localhost/dbname
 *
 * ```js
 * db.get("users", { login: "123" }, { pool: "pg" }, (err, row) => {
 *    if (row) {
 *       ......
 *       db.update("users", row, { pool: "dynamodb" });
 *    }
 * });
 *
 * const { data } = await db.aget("users", { login: "123" });
 * ```
 *
 * Most database pools can be configured with options __min__ and __max__ for number of connections to be maintained, so no overload will happen and keep warm connection for
 * faster responses.
 *
 * ```
 * db-pg-pool-max = 100
 * db-sqlite-pool-max = 100
 * ```
 *
 * The following databases are supported with the basic db methods: __Sqlite, PostgreSQL, DynamoDB, Elasticsearch__
 *
 * Multiple pools of the same type can be opened, just add __N__ suffix to all database config parameters where N is a number,
 * referer to such pools in the code as __poolN__ or by an alias.
 *
 * ```
 * db-sqlite1-pool = /path/billing
 * db-sqlite1-pool-max = 10
 * db-sqlite1-pool-options = journal_mode:OFF
 * db-sqlite1-pool-alias = billing
 * ```
 * and in the Javascript using callback or await:
 *
 * ```js
 * db.select("bills", { status: "ok" }, { pool: "billing" }, lib.log)
 *
 * await db.aselect("bills", { status: "ok" }, { pool: "billing" })
 * ```
 *
 */

module.exports = {
    name: 'db',

    /**
     * @var {ConfigOptions[]}
     */
    args: [
        { name: "cap-(.+)", type: "int", strip: "cap-", descr: "Capability parameters" },
        { name: "none", type: "bool", descr: "disable all db pools" },
        { name: "pool", descr: "Default pool to be used for db access without explicit pool specified" },
        { name: "name", key: "db-name", descr: "Default database name to be used for default connections in cases when no db is specified in the connection url" },
        { name: "create-tables", key: "_createTables", type: "bool", nocamel: 1, primary: 1, pass: 1, descr: "Create tables in the database or perform table upgrades for new columns in all pools, only shell or server process can perform this operation" },
        { name: "cache-tables", array: 1, type: "list", descr: "List of tables that can be cached: users, bk_counter. This list defines which DB calls will cache data with currently configured cache. This is global for all db pools." },
        { name: "skip-tables", array: 1, type: "list", descr: "List of tables that will not be created or modified, this is global for all pools" },
        { name: "skip-pools", array: 1, type: "list", descr: "List of pools to be skipped during initialization" },
        { name: "cache-pools", array: 1, type: "list", descr: "List of pools which trigger cache flushes on update." },
        { name: "cache-sync", array: 1, type: "list", descr: "List of tables that perform synchronized cache updates before returning from a DB call, by default cache updates are done in the background" },
        { name: "cache-keys-([a-z0-9_]+)-(.+)", obj: "cacheKeys.$1", make: "$2", nocamel: 1, type: "list", descr: "List of columns to be used for the table cache, all update operations will flush the cache if the cache key can be created from the record columns. This is for ad-hoc and caches to be used for custom selects which specified the cache key." },
        { name: "describe-tables", type: "callback", callback: "describeTables", descr: "A JSON object with table descriptions to be merged with the existing definitions" },
        { name: "cache-ttl-(.+)", type: "int", obj: "cacheTtl", nocamel: 1, descr: "TTL in milliseconds for each individual table being cached, use * as default for all tables", },
        { name: "cache-name-(.+)", obj: "cacheName", nocamel: 1, make: "$1", descr: "Cache client name to use for cache reading and writing for each table instead of the default in order to split cache usage for different tables, it can be just a table name or `pool.table`, use `*` to set default cache for all tables", },
        { name: "cache-update-(.+)", obj: "cacheUpdate", nocamel: 1, make: "$1", descr: "Cache client name to use for updating only for each table instead of the default in order to split cache usage for different tables, it can be just a table name or `pool.table` or `*`. This cache takes precedence for updating cache over `cache-name` parameter", },
        { name: "cache2-max", type: "int", min: 1, obj: "lru", make: "max", descr: "Max number of items to keep in the LRU Level 2 cache" },
        { name: "cache2-(.+)", obj: "cache2", type: "int", nocamel: 1, min: 0, descr: "Tables with TTL for level2 cache, i.e. in the local process LRU memory. It works before the primary cache and keeps records in the local LRU cache for the given amount of time, the TTL is in ms and must be greater than zero for level 2 cache to work" },
        { name: "custom-column-([a-zA-Z0-9_]+)-(.+)", obj: "customColumn.$1", make: "$2", nocamel: 1, descr: "A column that is allowed to be used in any table, the name is a column name regexp with the value to be a type", example: "-db-custom-column-users-^stats=counter", },
        { name: "describe-column-([a-z0-9_]+)-([a-zA-Z0-9_.]+)", obj: "columns.$1", make: "$2", type: "map", nocamel: 1, dot: 1, descr: "Describe a table column properties, can be a new or existing column, overrides existing property", example: "-db-describe-column-users-name.check max:255", },
        { name: "config", descr: "Configuration database pool to be used to retrieve config parameters from the database, must be defined to use remote db for config parameters" },
        { name: "config-map", obj: "config-map", type: "map", merge: 1, descr: "Config options: `.interval` between loading configuration from the database configured with -db-config, in minutes, 0 disables refreshing config from the db, `.count` max records to load in one select, see the docs about `.top`, `.main`, `.other` config parameters" },
        { name: "skip-drop", type: "regexpobj", descr: "A pattern of table names which will skipp in db.drop operations to prevent accidental table deletion" },
        { name: "aliases-(.+)", obj: "aliases", nocamel: 1, reverse: 1, onparse: function(v,o) { o.name=this.table(o.name); return this.table(v) }, descr: "Table aliases to be used instead of the requested table name, only high level db operations will use it, al low level utilities use the real table names" },
        { name: "concurrency", type: "number", min: 1, max: 4, descr: "How many simultaneous tasks to run at the same time inside one process" },
        { name: "([a-z0-9]+)-pool", obj: '_config.$1', make: "url", dflt: "default", descr: "A database pool name, depending on the driver it can be an URL, name or pathname", example: "`-db-pg-pool`\n`-db-dynamodb-pool`\nurl format: `protocol://[user:password@]hostname[:port]/dbname`\n`default`" },
        { name: "([a-z0-9]+)-pool-(disabled)", obj: '_config.$1', make: "$2", type: "bool", descr: "Disable the specified pool but keep the configuration" },
        { name: "([a-z0-9]+)-pool-(max)", obj: '_config.$1', make: "$2", type: "number", min: 1, descr: "Max number of open connections for a pool, default is Infinity" },
        { name: "([a-z0-9]+)-pool-(min)", obj: '_config.$1', make: "$2", type: "number", min: 1, descr: "Min number of open connections for a pool" },
        { name: "([a-z0-9]+)-pool-(idle)", obj: '_config.$1', make: "$2", type: "number", min: 1000, descr: "Number of ms for a db pool connection to be idle before being destroyed" },
        { name: "([a-z0-9]+)-pool-(tables)", obj: '_config.$1.configOptions', make: "$2", array: 1, type: "list", onupdate: "applyPoolOptions", descr: "Tables to be created only in this pool, to prevent creating all tables in every pool" },
        { name: "([a-z0-9]+)-pool-connect", obj: '_config.$1.connectOptions', type: "map", merge: 1, logger: "warn", descr: "Connect options for a DB pool driver for new connection, driver specific" },
        { name: "([a-z0-9]+)-pool-options", obj: '_config.$1.configOptions', type: "map", merge: 1, onupdate: "applyPoolOptions", descr: "General options for a DB pool, a simple map case" },
        { name: "([a-z0-9]+)-pool-options-([a-zA-Z0-9_.-]+)$", obj: '_config.$1.configOptions', camel: '-', autotype: 1, make: "$2", onupdate: "applyPoolOptions", descr: "General options for a DB pool by name with specific type" },
        { name: "([a-z0-9]+)-pool-table-map", obj: '_config.$1.configOptions.tableMap', type: "map", merge: 1, onupdate: "applyPoolOptions", descr: "Table mapping, aliases" },
        { name: "([a-z0-9]+)-pool-(create-tables)", primary: 1, obj: '_config.$1.configOptions', make: "$2", type: "bool", descr: "Create tables for this pool on startup" },
        { name: "([a-z0-9]+)-pool-(skip-tables)", obj: '_config.$1.configOptions', make: "$2", array: 1, type: "list", descr: "Tables not to be created in this pool" },
        { name: "([a-z0-9]+)-pool-(metrics-tables)", obj: '_config.$1.configOptions', make: "$2", array: 1, type: "list", descr: "Tables to collect metrics in this pool" },
        { name: "([a-z0-9]+)-pool-cache2-(.+)", obj: 'cache2', nocamel: 1, strip: /pool-cache2-/, type: "int", descr: "Level 2 cache TTL for the specified pool and table, data is JSON strings in the LRU cache" },
        { name: "([a-z0-9]+)-pool-alias", obj: 'poolAliases', make: "$1", reverse: 1, descr: "Pool alias to refer by an alternative name" },
    ],

    /** @var {object} - Database modules by type */
    modules: {
        none: dbPool,
    },

    /** @var {object} - Database connection pools by pool name */
    pools: {
        none: new dbPool(),
    },

    // Configuration parameters
    _config: { none: {} },

    // Tables to be cached
    cacheTables: [],
    cachePools: [],
    cacheSync: [],
    cacheKeys: {},
    cacheName: {},
    cacheUpdate: {},
    cacheTtl: {},

    // Level 2 cache objects
    cache2: {},
    lru: new lib.LRUCache(),

    /** @var {string} - Default database pool for the backend */
    pool: process.env.BKJS_DB_POOL || '',

    /** @var {string} - Databse pool for config */
    config: process.env.BKJS_DB_CONFIG || '',

    /**
     * @var {object} - database config reload settings, set via db-config-map
     * @property {int} configMap.count - max number of records to load from the DB
     * @property {int} configMap.interval - how often to refresh config from DB, in mins
     */
    configMap: {
        count: 1000,
        interval: 1440,
        top: "roles",
        main: "role,tag",
        other: "role",
    },

    concurrency: 2,
    processRows: {},
    processColumns: [],
    customColumn: {},
    columns: {},
    aliases: {},
    poolAliases: {},

    // Separator to combined columns
    separator: "|",

    // Regexp for OR/AND properties
    rxOrAnd: /^\$+(or|and)$/i,

    ddlOps: ["incr","update","bulk","put","add","del","delall","updateall"],
    arrayOps: ["in","all in","all_in","not in","not_in","between","not between","not_between","contains","not contains","not_contains"],

    /** @var {object} - All tables from all modules by table name*/
    tables: {},

    /** @var {object} - All primary keys for each table by name */
    keys: {},

    indexes: {},
    joins: {},
};

db.configure = function(options, callback)
{
    if (this.config) {
        this.tables.bk_config = bk_config;
    }

    callback();
}

db.shutdown = function(options, callback)
{
    lib.deferShutdown(this);
    lib.forEach(Object.keys(this.pools), (name, next) => {
        var pool = this.pools[name];
        delete this.pools[name];
        pool.shutdown(options, next);
    }, callback);
}

/**
 * Initialize all database pools. the options may containt the following properties:
 * @param {boolean} [options.createTables] - if true then create new tables or upgrade tables with new columns
 * @param {function} callback
 * @memberof module:db
 * @method init
 */
db.init = function(options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    // Important parameters that can persist until cleared
    if (options?.createTables !== undefined) {
        this._createTables = options.createTables;
    }

    this.initTables();

    logger.debug("dbinit:", "start", app.role, options, Object.keys(this._config), Object.keys(this.pools));

    // Force clearing cache
    if (!db._ipc) {
        db._ipc = 1;
        ipc.on("db:cache:del", (msg) => {
            db.delCacheKeys(msg);
            lib.notifyWorkers(msg);
        });
    }

    var pools = db.none ? [] : Object.keys(db._config).filter(x => !lib.isFlag(this.skipPools, x));

    lib.forEachLimit(pools, options?.concurrency || db.concurrency, (name, next) => {
        var params = db._config[name];
        params.pool = name;
        params.type = name.replace(/[0-9]/, "");
        logger.debug("dbinit:", "check", app.role, name, options, params);

        if (params.disabled) return next();

        var pool, old = db.pools[name];

        // Do not re-create the pool if not forced, just update the properties
        if (old && !options?.force && (!params.url || !old.url || params.url == old.url)) {

            pool = old;
            pool.configure(params);

        } else {

            // Create a new pool for the given database module
            try {
                let Pool = db.modules[params.type];
                if (!Pool) {
                    Pool = db.modules[params.type] = require(__dirname + "/db/" + params.type);
                }
                pool = db.pools[name] = new Pool(params);
            } catch (e) {
                logger.error("dbinit:", app.role, params, e.stack);
                return next();
            }
            if (old) old.shutdown();

            logger.debug("dbinit:", "done", app.role, name, options, params);
        }

        // Trigger create columns only if explicitly set
        if (app.isPrimary && db._createTables) {
            return setTimeout(db.createTables.bind(db, name, next), 1000);
        }
        next();
    }, callback, true);
}

/**
 * Execute query using native database driver, the query is passed directly to the driver.
 * @param {DbRequest} req - an object with request data prepared by {@link module:db.Request} or similar,
 *   missing required fileds will be filled by db.Request
 * @param {DbResultCallback} [callback] - an error or result
 *
 * @example
 * var req = new db.Request({
 *     pool: "sqlite",
 *     text: "SELECT a.id,c.type FROM users a,bk_icon c WHERE a.id=c.id and a.id=?",
 *     values: ['123']
 * });
 * db.query(req, (err, rows, info) => {  ... });
 *
 * // same as
 *
 * db.query({
 *     pool: "sqlite",
 *     text: "SELECT a.id,c.type FROM users a,bk_icon c WHERE a.id=c.id and a.id=?",
 *     values: ['123']
 * }, (err, rows, info) => {  ... });
 * @memberof module:db
 * @method query
 */
db.query = function(req, callback)
{
    if (!(req instanceof db.Request)) {
        req = new db.Request(req);
    }

    // Metrics collection
    req._timer = req.pool.metrics.req.start();
    req.pool.metrics.que.update(++req.pool.metrics.running);

    // Read/write rates for each table
    const table = req.op == "bulk" ? req.query[0]?.table : req.table;
    if (req.op && lib.isFlag(req.config.metricsTables, table)) {
        if (!req.pool.metrics.tables[table]) {
            req.pool.metrics.tables[table] = {
                read: new metrics.Meter(),
                write: new metrics.Meter(),
            };
        }
        req.pool.metrics.tables[table][db.ddlOps.includes(req.op) ? "write" : "read"].mark();
    }

    req.pool.use((err, client) => {
        if (err) return queryEnd(err, req, null, callback);
        try {
            queryRun(client, req, callback);
        } catch (e) {
            queryEnd(e, req, null, callback);
        }
    });
}

/**
 * Async version of {@link module:db.query} with the same parameters,
 * no exceptions are raised or reject, only resolve is called with an object `{ err, data, info }`
 * @param {DbRequest} req
 * @returns {Promise}
 * @example
 * const { err, data } = await db.aquery({ text: "SELECT ....." }, { pool: "sqlite" });
 * @memberof module:db
 * @method aquery
 * @async
 */
db.aquery = function(req)
{
    return new Promise((resolve, reject) => {
        db.query(req, (err, data, info) => {
            resolve({ err, data, info });
        });
    });
}

function queryRun(client, req, callback)
{
    req.client = client;
    req.pool.query(client, req, (err, rows, info) => {
        req.info = info || {};
        rows = rows || [];
        if (!err) {
            if (!req.info.affected_rows) req.info.affected_rows = client.affected_rows || 0;
            if (!req.info.inserted_oid) req.info.inserted_oid = client.inserted_oid || null;
            if (!req.info.next_token) req.info.next_token = req.pool.nextToken(client, req, rows);
            if (!req.info.consumed_capacity) req.info.consumed_capacity = client.consumed_capacity || 0;

            req.pool.release(client);
            delete req.client;

            queryResult(req, rows, (rows) => {
                queryEnd(err, req, rows, callback);
            });
        } else {
            queryEnd(err, req, rows, callback);
        }
    });
}

function queryEnd(err, req, rows, callback)
{
    var pool = db.pools[req.pool] || db.pools.none;
    pool.metrics.running--;

    req.elapsed = req._timer?.end();
    delete req._timer;

    if (req.client) {
        pool.release(req.client);
        delete req.client;
    }
    if (!Array.isArray(rows)) rows = [];
    if (err) {
        pool.metrics.err_count++;
        logger.logger(req.options.logger_error || "error", "queryEnd:", req, err);
    } else {
        if (req.info) req.info.count = rows.length;
        logger.logger(req.options.logger_db || req.failed && "warn" || "debug", "queryEnd:", req, rows.length, 'rows');
    }
    if (err) {
        err = db.convertError(req, err);
        if (req.options.ignore_error > 0 || lib.isFlag(req.options.ignore_error, err.code)) err = null;
    }
    if (req.info?.retry_count > 0) {
        pool.metrics.retry_count += req.info.retry_count;
    }
    var info = req.info;
    if (req.options.info_query) {
        if (!info) info = {};
        info.query = req.query;
        if (req.options.info_query.processrows) {
            db.runProcessRows("post", req.table, req, info.query);
        }
        if (req.options.info_query.convertrows) {
            info.query = Object.assign({}, req.query);
            db.convertRows(req, [info.query], req.options.info_query);
        }
    }
    if (info) info.elapsed = req.elapsed;

    if (callback || req.callback) {
        var first = req.options.first, last = req.options.last;
        lib.tryCatch(callback || req.callback, err, first ? rows[0] : last ? rows.at(-1) : rows, info || req);
    }
}

function queryResult(req, rows, callback)
{
    // With total we only have one property 'count'
    if (req.op == "select" && req.options.total) return callback(rows);

    lib.series([
        function(next) {
            // Automatic support for getCached and global caches
            if (lib.isArray(db.cachePools) && !lib.isFlag(db.cachePools, req.pool)) return next();
            // For sync cache flushes wait before returning
            var cbnext = lib.isFlag(db.cacheSync, req.table) ? next : undefined;
            switch (req.op) {
            case "bulk":
                var options = req.options, skipped = 0;
                lib.forEachLimit(req.query, db.concurrency, (row, next2) => {
                    db.delCacheKeys(row, rows, options, (e) => {
                        if (isNaN(e)) skipped++; else skipped = 0;
                        if (skipped < lib.maxStackDepth) return next2();
                        setImmediate(next2);
                        skipped = 0;
                    });
                }, cbnext, true);
                break;

            default:
                db.delCacheKeys(req, rows, req.options, cbnext);
            }
            if (!cbnext) next();
        },
        function(next) {
            rows = queryProcessResult(req, rows);
            if (typeof req.options.processasync != "function") return next();
            req.options.processasync(req, rows, (err, rc) => {
                if (!err && rc) rows = rc;
                next();
            });
        },
    ], () => {
        callback(rows);
    }, true);
}

function queryProcessResult(req, rows)
{
    // Treat the query as the result
    if (req.options.result_query) {
        rows = [ Object.assign({}, req.query) ];
    }

    // Make sure no duplicates
    if (req.options.unique) {
        rows = lib.arrayUnique(rows, req.options.unique);
    }

    // Convert from db types into javascript, deal with json and joined columns
    if (rows.length && !req.options.noconvertrows) {
        db.convertRows(req, rows);
    }

    // Convert values if we have custom column callback, for post process hook we
    // need to run it at least once even if there are no results
    if (!req.options.noprocessrows) {
        rows = db.runProcessRows("post", req.table, req, rows.length ? rows : {});
    }
    // Always run global hooks
    rows = db.runProcessRows("post", "*", req, rows.length ? rows : {});

    // Custom filters to return the final result set
    if (typeof req.options.filterrows == "function" && rows.length) {
        rows = req.options.filterrows(req, rows);
    }

    // Always run explicit post processing callback
    if (typeof req.options.processrows == "function") {
        rows = req.options.processrows(req, rows);
    }
    return rows;
}

/**
 * Post process hook to be used for replicating records to another pool, this is supposed to be used as this:
 *
 * The conditions when to use it is up to the application logic.
 *
 * It does not deal with the destination pool to be overloaded, all errors will be ignored, this is for simple and light load only
 *
 * The destination poll must have tables to be synced configured:
 * @example
 * db-elasticsearch-pool-tables=table1,table2
 * db.setProcessRow("post", "*", (req, row) => { db.queryProcessSync("elasticsearch", req, row) });
 *
 * @memberOf module:db
 * @method queryProcessSync
 */
db.queryProcessSync = function(pool, req, row)
{
    pool = db.getPool(pool);
    switch (req.op) {
    case "bulk":
    case "add":
    case "put":
    case "incr":
    case "update":
    case "del":
        if (!req.info?.affected_rows || pool.name == req.pool.name) break;
        var table = req.op == "bulk" ? req.query[0]?.table : req.table;
        if (!lib.isFlag(pool.configOptions.tables, table)) return;

        req = new db.Request({
            pool: pool.name,
            table,
            op: req.op,
            query: req.query,
            options: req.options,
            text: req.text,
            values: req.values,
        });
        switch (req.op) {
        case "add":
            req.op = "put";
            delete req.options.query;
            break;
        case "incr":
        case "update":
            req.op = "update";
            req.options.upsert = true;
            delete req.options.query;
            break;
        }
        req.options.no_columns = req.options.syncMode = 1;
        db.query(req);
    }
}

/**
 * Retrieve one record from the database by primary key, returns found record or null if not found
 * @param {string} table - table to read
 * @param {object} query - an object with primary key(s)
 * @param {DbRequestOptions} [options]
 * @param {DbResultCallback} callback
 *
 * NOTE: On return the `info.cached` will be set to
 * - 1 if retrieved from top level cache
 * - 2 if retrieved from level 2 cache
 * - 0 if retrieved from db and put in the cache
 *
 * @example
 *
 * db.get("users", { login: '12345' }, function(err, row) {
 *    if (row) console.log(row.name);
 * });
 * @memberOf module:db
 * @method get
 */
db.get = function(table, query, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    if (typeof callback != "function") callback = lib.noop;

    if (!options?.__cached && !options?.nocache && (options?.cached || this.cacheTables.includes(table))) {
        if (this.getCached("get", table, query, options, callback) === true) return;
    }
    var req = this.prepare({ op: "get", table, query, options });
    this.query(req, (err, rows, info) => {
        callback(err, rows.length ? rows[0] : null, info);
    });
}

/**
 * Async version of {@link module:db.get}
 * @param {string} table - db table name
 * @param {object} query - an object with primary keys
 * @param {DbRequestOptions} [options]
 * @memberOf module:db
 * @method aget
 * @async
 * @example
 * const { err, data } = await db.aget("users", { login: '12345' });
 */

db.aget = function(table, query, options)
{
    return new Promise((resolve, reject) => {
        db.get(table, query, options, (err, data, info) => {
            resolve({ err, data, info });
        });
    });
}

/**
 * Select objects from the database that match supplied conditions.
 * @param {string} table - table to read
 * @param {object} query - an object with properties for the condition, all matching records will be returned.
 *   Columns may contain deep property path can be used as well, like `prop.subprop`,
 *   the top level column must be defined to work, this is for DBs that support JSON objects like DymamoDB, Elasticsearch.
 * @param {DbRequestOptions} [options]
 * @param {DbResultCallback} callback
 *
 * @example <caption>get by primary key</caption>
 *
 * db.select("users", { login: 'admin' }, (err, rows) => {  });
 *
 * @example <caption>get all users by roles, only 2 columns</caption>
 *
 * db.select("users", { role: 'admin' }, { select: 'login,role' }, (err, rows) => { });
 *
 * @example <caption>all Johns sorted by time, recent first</caption>
 *
 * db.select("users", { name: 'John:' }, { sort: "mtime", desc: 1, ops: { name: "begins_with" } }, (err, rows) => { });
 *
 * @example <caption>select users by type modified in last 24 hours</caption>
 *
 * db.select("users", { role: 'admin', mtime: Date.now()-86400000 }, { ops: { mtime: "gt" } }, (err, rows) => { });
 *
 * @example <caption>same as above with column alias</caption>
 *
 * db.select("users", {
 *    role_$in: ['admin', 'user'],
 *    mtime_$gt: Date.now()-86400000
 * }, (err, rows) => { });
 *
 * @example <caption>same as above OR created within 24hrs</caption>
 *
 * db.select("users", {
 *    role: 'admin',
 *    $or: {
 *       mtime_$gt: Date.now()-86400000
 *       ctime_$gt: Date.now()-86400000
 *    },
 * }, (err, rows) => { });
 *
 * @example <caption>select users by JSON sub property using Elasticsearch</caption>
 *
 * db.select("users", { "settings.status": "ok" }, { pool: "elasticsearch" }, (err, rows) => { });
 *
 * @example <caption>select admin users with tags/roles using simple SQL join</caption>
 * const query = {
 *    role_$in: ["admin", "user"],
 *    $join: { tag: "tags.id" },
 * }
 * const select = "users.*, tags.name as tagname"
 *
 * db.select("users", query, { select, pool: "pg" }, lib.log)
 *
 * @memberOf module:db
 * @method select
 */
db.select = function(table, query, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    if ((options?.cacheKey || options?.cacheKeyName) && !options.__cached && !options.nocache) {
        if (this.getCached("select", table, query, options, callback) === true) return;
    }
    this.query(this.prepare({ op: "select", table, query, options, callback }));
}

/**
 * Async version of {@link module:db.select}
 * @param {string} table - db table name
 * @param {object} query - condition
 * @param {DbRequestOptions} [options]
 * @memberOf module:db
 * @method aselect
 * @async
 * @example
 * const { err, data } = await db.aselect("users", { roles: 'admin' });
 */
db.aselect = function(table, query, options)
{
    return new Promise((resolve, reject) => {
        db.select(table, query, options, (err, data, info) => {
            resolve({ err, data, info });
        });
    });
}


/**
 * Perform full text search on the given table, the database implementation may ignore table name completely
 * in case of global text index.
 *
 * Query in general is a text string with the format that is supported by the underlying driver,
 * the db module *DOES NOT PARSE* the query at all if the driver supports full text search, otherwise it behaves like `select`.
 *
 * Options make take the same properties as in the `select` method.
 *
 * A special query property `q` may be used for generic search in all fields.
 *
 * Without full text search support in the driver this may return nothing or an error.
 *
 * @param {string} table - db table name
 * @param {object|string} query - condition
 * @param {DbRequestOptions} [options]
 * @param {DbResultCallback} [callback]
 * @example
 * db.search("users", { roles: "admin", q: "john*" }, { pool: "elasticsearch" }, lib.log);
 * db.search("users", "john*", { pool: "elasticsearch" }, lib.log);
 *
 * @memberOf module:db
 * @method search
 */
db.search = function(table, query, options, callback)
{
    this.query(this.prepare({ op: "search", table, query, options, callback }));
}

/**
 * Async version of {@link module:db.search}
 * @param {string} table - db table name
 * @param {object} query - condition
 * @param {DbRequestOptions} [options]
 * @example
 * await db.asearch("users", "john*", { pool: "elasticsearch" });
 * @memberOf module:db
 * @method asearch
 * @async
 */
db.asearch = function(table, query, options)
{
    return new Promise((resolve, reject) => {
        db.search(table, query, options, (err, data, info) => {
            resolve({ err, data, info });
        });
    });
}


/**
 * Insert new object into the database
 *
 * @param {string} table - table to use
 * @param {object} query - an actual record to be updated, primary key properties must be specified
 * @param {DbRequestOptions} [options]
 * @param {DbResultCallback} [callback]
 *
 * @example
 *
 * db.add("users", { id: '123', login: 'admin', name: 'test' }, (err, rows, info) => {
 * });
 *
 * @memberOf module:db
 * @method add
 */
db.add = function(table, query, options, callback)
{
    this.query(this.prepare({ op: "add", table, query, options, callback }));
}

/**
 * Async version of {@link module:db.add}
 * @param {string} table - db table name
 * @param {object} query - properties to add with primary keys
 * @param {DbRequestOptions} [options]
 * @memberOf module:db
 * @method aadd
 * @async
 * @example
 * const { err, data, info } = await db.aadd("users", { id: '123', login: 'admin', name: 'test' })
 */

db.aadd = function(table, query, options)
{
    return new Promise((resolve, reject) => {
        db.add(table, query, options, (err, data, info) => {
            resolve({ err, data, info });
        });
    });
}


/**
 * Counter operation, increase or decrease column values, similar to update but all specified columns except primary
 * key will be incremented, use negative value to decrease the value.
 *
 * If no `options.ops` object specified or no 'incr' operations are provided then
 * all columns with type 'counter' will use the update op `incr`, i.e. all counters will be incremented
 * by the provided number
 *
 * *Note: The record must exist already for SQL databases without UPSERT support,
 * for DynamoDB and Elasticsearch a new record will be created if it does not exist yet.*
 *
 * @param {string} table - table to use
 * @param {object} query - an actual record to be updated, primary key properties must be specified
 * @param {DbRequestOptions} [options]
 * @param {DbResultCallback} [callback]
 *
 * @example
 * db.incr("bk_counter", { id: '123', like0: 1, invite0: 1 }, (err, rows, info) => {
 * });
 *
 * @memberOf module:db
 * @method incr
 */
db.incr = function(table, query, options, callback)
{
    this.query(this.prepare({ op: "incr", table, query, options, callback }));
}

/**
 * Async version of {@link module:db.incr}
 * @param {string} table - db table name
 * @param {object} query - properties to update with primary keys
 * @param {DbRequestOptions} [options]
 * @memberOf module:db
 * @async
 * @example
 * const { err, data, info } = await db.aincr("bk_counter", { id: '123', like0: 1, invite0: 1 })
 * @method aincr
 */

db.aincr = function(table, query, options)
{
    return new Promise((resolve, reject) => {
        db.incr(table, query, options, (err, data, info) => {
            resolve({ err, data, info });
        });
    });
}

/**
 * Add/update an object in the database, if object already exists it will be replaced with all new properties from the obj
 * @param {string} table - table to use
 * @param {object} query - an actual record to be updated, primary key properties must be specified
 * @param {DbRequestOptions} [options]
 * @param {DbResultCallback} [callback]
 *
 * @example
 *
 * db.put("users", { id: '123', login: 'test', name: 'test' }, function(err, rows, info) {
 * });
 *
 * @memberOf module:db
 * @method put
 */
db.put = function(table, query, options, callback)
{
    this.query(this.prepare({ op: "put", table, query, options, callback }));
}

/**
 * Async version of {@link module:db.put}
 * @param {string} table - db table name
 * @param {object} query - properties to update with primary keys
 * @param {DbRequestOptions} [options]
 * @memberOf module:db
 * @method aput
 * @async
 * @example
 *  const { err, data } = await db.aput("users", { id: '123', login: 'test', name: 'test' })
 */

db.aput = function(table, query, options)
{
    return new Promise((resolve, reject) => {
        db.put(table, query, options, (err, data, info) => {
            resolve({ err, data, info });
        });
    });
}


/**
 * Update existing object in the database. The primary use case is to update one row by the primary key, this way all columns and values
 * are in the query object.
 * @param {string} table - table to use
 * @param {object} query - an actual record to be updated, primary key properties may be specified here or in the `expected` object
 * @param {DbRequestOptions} [options]
 * @param {DbResultCallback} [callback]
 *
 * @example <caption>update users by primary key login</caption>
 *
 * db.update("users", { login: 'test', id: '123' }, (err, rows, info) => {
 *   console.log('updated:', info.affected_rows);
 * });
 *
 * db.update("users", { login: 'test', id: '123', first_name: 'Mr' }, { pool: 'pg' }, (err, rows, info) => {
 *    console.log('updated:', info.affected_rows);
 * });
 *
 * @example <caption>update a row with primary key login = 'test' and first_name='Carl' to 'John'</caption>
 * db.update("users", { login: 'test', first_name: 'John' }, { query: { first_name: "Carl" } }, (err, rows, info) => {
 *    console.log('updated:', info.affected_rows);
 * });
 *
 * @example <caption>update all rows with first_name='Carl' or NULL to first_name='John'</caption>
 * db.update("users", { first_name: 'John' }, { query: { $or: { first_name: "Carl", first_name_$: null } }, { pool: "elasticsearch" }, (err, rows, info) => {
 *    console.log('updated:', info.affected_rows);
 * });
 *
 * @example <caption>remove "admin" role from the roles column by primary key</caption>
 * db.update("users", { login: "test", roles_$del: "admin" }, { pool: "dynamodb" }, (err, rows, info) => {
 *    console.log('updated:', info.affected_rows);
 * });
 * @memberOf module:db
 * @method update
 */
db.update = function(table, query, options, callback)
{
    this.query(this.prepare({ op: "update", table, query, options, callback }));
}

/**
 * Async version of {@link module:db.update}
 * @param {string} table - db table name
 * @param {object} query - properties to update with primary keys
 * @param {DbRequestOptions} [options]
 * @memberOf module:db
 * @method aupdate
 * @async
 * @example
 * const { err, data, info } = await db.aupdate("users", { login: 'test', name: 'Test' })
 * if (!err && !info?.affected_rows) logger.error("no updates")
 */

db.aupdate = function(table, query, options)
{
    return new Promise((resolve, reject) => {
        db.update(table, query, options, (err, data, info) => {
            resolve({ err, data, info });
        });
    });
}

/**
 * Update all records that match given `query` using properties from the `data` object
 * @param {string} table - db table name
 * @param {object} data - properties to update
 * @param {object} query - condition for update
 * @param {DbRequestOptions} [options]
 * @param {DbResultCallback} [callback]
 * @example <caption>set status ok for all users with type = 'admin' or 'staff'</caption>
 * db.updateAll("users", { status: "ok" }, { type: ["admin", "staff"] }, lib.log)
 * @memberOf module:db
 * @method updateAll
 */
db.updateAll = function(table, data, query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    options = Object.assign(options || {}, { query });
    this.query(this.prepare({ op: "updateall", table, query, options, callback }));
}

/**
 * Async version of {@link module:db.updateAll}
 * @param {string} table - db table name
 * @param {object} data - properties to update
 * @param {object} query - condition
 * @param {DbRequestOptions} [options]
 * @memberOf module:db
 * @method aupdateAll
 * @async
 */

db.aupdateAll = function(table, data, query, options)
{
    return new Promise((resolve, reject) => {
        db.updateAll(table, data, query, options, (err, data, info) => {
            resolve({ err, data, info });
        });
    });
}


/**
 * Delete an object in the database, no error if the object does not exist
 * @param {string} table - table to use
 * @param {object} query - object with column values
 * @param {DbRequestOptions} [options]
 * @param {DbResultCallback} [callback]
 *
 * @example
 *
 * db.del("users", { login: '123' }, (err, rows, info) => {
 *    console.log('deleted:', info.affected_rows);
 * });
 * @memberOf module:db
 * @method del
 */
db.del = function(table, query, options, callback)
{
    this.query(this.prepare({ op: "del", table, query, options, callback }));
}

/**
 * Async version of {@link module:db.del}
 * @param {string} table - db table name
 * @param {object} query - condition
 * @param {DbRequestOptions} [options]
 * @memberOf module:db
 * @method adel
 * @async
 * @example
 * const { err, info } = db.adel("users", { login: '123' });
 * console.log('deleted:', info.affected_rows);
 */

db.adel = function(table, query, options)
{
    return new Promise((resolve, reject) => {
        db.del(table, query, options, (err, data, info) => {
            resolve({ err, data, info });
        });
    });
}


/**
 * Delete all records that match given condition in `query`
 * @param {string} table - db table name
 * @param {object} query - condition
 * @param {DbRequestOptions} [options]
 * @param {DbResultCallback} [callback]
 * @example
 * db.delAll("users", { type: "tester" }, lib.log)
 * @memberOf module:db
 * @method delAll
 */
db.delAll = function(table, query, options, callback)
{
    this.query(this.prepare({ op: "delall", table, query, options, callback }));
}

/**
 * Async version of {@link module:db.delAll}
 * @param {string} table - db table name
 * @param {object} query - condition
 * @param {DbRequestOptions} [options]
 * @memberOf module:db
 * @method adelAll
 * @async
 */

db.adelAll = function(table, query, options)
{
    return new Promise((resolve, reject) => {
        db.delAll(table, query, options, (err, data, info) => {
            resolve({ err, data, info });
        });
    });
}


/**
 * Convenient helper to retrieve all records by primary key, the obj must be a list with key property or a string with list of primary key columns
 * @param {string} table - table to use
 * @param {string[]|object[]} query - list of records
 * @param {DbRequestOptions} [options]
 * @param {DbResultCallback} callback
 * @example
 * db.list("users", ["id1", "id2"], (err, rows) => { console.log(err, rows) });
 *
 * db.list("users", "id1,id2", (err, rows) => { console.log(err, rows) });
 *
 * db.list("users", [{ login: "id1" },{ login: "id2" }], (err, rows) => { console.log(err, rows) });
 * @memberOf module:db
 * @method list
 */
db.list = function(table, query, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    if (typeof callback != "function") callback = lib.noop;

    switch (lib.typeName(query)) {
    case "string":
    case "array":
        query = lib.split(query, null, { unique: 1 }).filter(x => x);
        if (typeof query[0] == "string") {
            var keys = this.getKeys(table, options);
            if (!keys.length) return callback(lib.newError("invalid keys"), []);
            if (keys.length == 1) {
                query = query.map((x) => ({ [keys[0]]: x }));
            } else {
                query = query.map((x) => (keys.reduce((a, b) => { a[b] = x[b]; return a }), {}));
            }
        }
        break;

    default:
        return callback(lib.newError("invalid list"), []);
    }
    if (!query.length) return callback(null, []);
    this.query(this.prepare({ op: "list", table, query, options, callback }));
}

/**
 * Async version of {@link module:db.list}
 * @param {string} table - table to use
 * @param {string[]|object[]} query - list of records
 * @param {DbRequestOptions} [options]
 * @memberOf module:db
 * @method alist
 * @async
 * @example
 * const { err, data } = db.alist("users", ["id1", "id2"]);
 * console.log(data);
 */

db.alist = function(table, query, options)
{
    return new Promise((resolve, reject) => {
        db.list(table, query, options, (err, data, info) => {
            resolve({ err, data, info });
        });
    });
}

/**
 * Perform a batch of operations at the same time, all operations for the same table will be run
 * together one by one but different tables will be updated in parallel.
 *
 * NOTE: it may use different DB client(session) even for the same table due to each op running independently.
 *
 * On return the second arg to the callback is a list of records with errors as the input record with added property `errstatus` and `errmsg`,
 * for get ops the result will be retrieved record if exists.
 *
 * One advantage using this with `op: get` over {@link module:db.list} is caching,
 * {@link module:db.get} may use both local and remote caches but db.list always hits the database.
 *
 * @param {object[]} list - an array of objects to get/put/update/delete from the database in the format:
 * @param {string} [list[].op=add] - is one of get, add, incr, put, update, del
 * @param {string} list[].table - which table to use
 * @param {object} list[].query - an object with data to be saved
 * @param {DbRequestOptions} [list[].options] - params for the operation
 * @param {DbRequestOptions} [options] - default options with additional specific below
 * @param {number} options.concurrency - number of how many operations to run at the same time for a table, 1 means sequential
 * @param {boolean} options.no_errors - will stop on first error, because operations will be run in parallel some operations still may be performed
 * @param {number} options.factorCapacity - a capacity factor to apply to the write capacity if present, by default it is used write capacity at 100%
 * @param {DbResultCallback} [callback]
 *
 *  @example
 *  var ops = [ { table: "bk_counter", query: { id:1, like:1 } },
 *              { op: "put", table: "users", query: { login: "test", id:1, name:"test" }]
 *  db.batch(ops, { factorCapacity: 0.5 }, lib.log);
 *
 * @memberOf module:db
 * @method batch
 */
db.batch = function(list, options, callback)
{
    if (typeof options == "function") callback = options,options = null;

    var info = [], tables = {}, caps = {};
    lib.isArray(list, []).forEach((x) => {
        if (!x?.table || !x.query || (x.op && !db[x.op])) return;
        if (!tables[x.table]) tables[x.table] = [];
        if (!x.op) x.op = "add";
        tables[x.table].push(x);
    });
    lib.forEach(Object.keys(tables), (table, next) => {
        caps[table] = db.getCapacity(table, options);
        lib.forEachLimit(tables[table], options?.concurrency, (obj, next2) => {
            db[obj.op](obj.table, obj.query, obj.options, (err, rc) => {
                if (err) {
                    info.push(Object.assign(obj, { errstatus: err.code || err.status, errmsg: err.message }));
                    if (options?.no_errors) return next2(err);
                } else
                if (lib.isObject(rc)) {
                    info.push(rc);
                }
                db.checkCapacity(caps[obj.table], next2);
            });
        }, next, true);
    }, (err) => {
        lib.tryCall(callback, err, info, {});
    }, true);
}

/**
 * Async version of {@link module:db.batch}
 * @param {object[]} list - an array of objects to get/put/update/delete from the database in the format:
 * @param {DbRequestOptions} [options]
 * @memberOf module:db
 * @method abatch
 * @async
 */

db.abatch = function(list, options)
{
    return new Promise((resolve, reject) => {
        db.batch(list, options, (err, data, info) => {
            resolve({ err, data, info });
        });
    });
}

/**
 * Bulk operations, it will be noop if the driver does not support it.
 * The input format is the same as for the {@link module:db.batch} method.
 *
 * The following databases support bulk:
 * - DynamoDB: only supports `add/put/del` and 25 at a time, if more specified it will send multiple batches sequentially
 * - ElasticSearch: supports all update ops
 * - SQL: supports all ops, runs sequentially or concurrently if `options.concurrency` is provided, uses the same client(session)
 *
 * @param {object[]} list - an array of objects to get/put/update/delete from the database in the format:
 * @param {DbRequestOptions} [options]
 * @param {DbResultCallback} [callback] - second arg is a list of records with errors, same input record with added property `error`
 * @example
 * var ops = [
 *    { table: "bk_counter", query: { id:1, like:1 } },
 *    { op: "del", table: "users", query: { login: "test1" } },
 *    { op: "incr", table: "bk_counter", query: { id:2, like:1 } },
 *    { table: "users", query: { login: "test2", id:2, name:"test2" } }
 * ]
 * db.bulk(ops, { pool: "elasticsearch" }, lib.log);
 *
 * @memberOf module:db
 * @method bulk
 */
db.bulk = function(list, options, callback)
{
    this.query(this.prepare({ op: "bulk", query: list, options, callback }));
}

/**
 * Async version of {@link module:db.bulk}
 * @param {object[]} list - an array of objects to get/put/update/delete from the database in the format:
 * @param {DbRequestOptions} [options]
 * @memberOf module:db
 * @method abulk
 * @async
 */

db.abulk = function(table, query, options)
{
    return new Promise((resolve, reject) => {
        db.bulk(table, query, options, (err, data, info) => {
            resolve({ err, data, info });
        });
    });
}

/**
 * Same as the {@link module:db.bulk} but in transaction mode, all operations must succeed or fail. Not every driver can support it
 *
 *  - DynamoDB: only 25 operations can be done at the same time, if the list is larger then it will be sequentially run with batches of 25 records.
 *  - Elasticsearch: same as regular bulk
 *  - SQL: wraps all ops into standard SQL transaction using (BEGIN/COMMIT/ROLLBACK TRANSACTION).
 *
 *    NOTE: For specific SQL syntax the first statement can be `BEGIN ...`, in this case only COMMIT/ROLLBACK will be added.
 *
 *
 * @param {object[]} list - an array of objects to get/put/update/delete from the database in the format:
 * @param {DbRequestOptions} [options]
 * @param {DbResultCallback} [callback] - second arg is a list of records with errors, same input record with added property `error`
 * @example
 * var ops = [
 *    { text: "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE" },
 *    { op: "del", table: "users", query: { login: "test1" } },
 *    { op: "incr", table: "bk_counter", query: { id:2, like:1 } },
 *    { table: "users", query: { login: "test2", id:2, name:"test2" } }
 * ]
 * db.transaction(ops, { pool: "pg" }, lib.log);
 *
 * @example
 * db.transaction([
 *   { op: "del", table: "users", query: { login: "test1" } },
 *   { op: "add", table: "users", query: { login: "test2", name: "tester 2" } },
 * ], lib.log);
 * @memberOf module:db
 * @method transaction
 */
db.transaction = function(list, options, callback)
{
    var req = this.prepare({ op: "bulk", query: list, options, callback });
    req.options.transaction = 1;
    this.query(req);
}

/**
 * Async version of {@link module:db.transaction}
 * @param {object[]} list - an array of objects to get/put/update/delete from the database in the format:
 * @param {DbRequestOptions} [options]
 * @memberOf module:db
 * @method atransaction
 * @async
 */

db.atransaction = function(list, options)
{
    return new Promise((resolve, reject) => {
        db.transaction(list, options, (err, data, info) => {
            resolve({ err, data, info });
        });
    });
}

/**
 * Convenient helper for scanning a table for some processing, rows are retrieved in batches and passed to the callback until there are no more
 * records matching given criteria. The `query` is the same as in {@link module:db.select} method which definedsa condition which records to get.
 * The `rowCallback` must be present and is called for every row or batch retrieved and second parameter which is the function to be called
 * once the processing is complete. At the end, the callback will be called just with 1 argument, err, this indicates end of scan operation.
 * Basically, db.scan is the same as db.select but can be used to retrieve large number of records in batches and allows async processing of such records.
 * To hint a driver that scanning is in progress the `options.scanning` will be set to true.
 *
 * Parameters:
 * @param {string} table - table to scan
 * @param {object} query - an object with query conditions, same as in {@link module:db.select}
 * @param {DbRequestOptions} [options] - default options with additional specific below
 * @param {number} [options.search] - use {@link module:db.search} instead of {@link module:db.select}
 * @param {number} [options.limit] - total number of records to scan
 * @param {boolean} [options.batch] - if true rowCallback will be called with all rows from the batch,
 *   not every row individually, batch size is defined by the `options.count` property, used in `scan`
 * @param {boolean} [options.sync] - as batch mode but the rowCallback is called synchronously as `rowCallback(row, info)`
 * @param {number} [options.concurrency] - how many rows or operations to process at the same time
 * @param {boolean} [options.noscan] - if true no scan will be performed if no primary keys are specified to prevent scanning large tables
 * @param {boolean} [options.fullscan] - if true force to perform a full scan, this is slightly different for each database:
 *  - DynamoDB: used full table scan, the query condition still is checked, can be expensive for large table because pricing is by every object checked not by what is actually returned
 *  - Elasticsearch: performs streaming scan, using native order but all conditions are checked still, very effective for large scans
 * @param {function} rowCallback - process records when called like this `callback(rows, next, info)
 * @param {DbResultCallback} [endCallback] - end of scan when called like this: `callback(err)
 *
 * @example
 * // Copy all users from one db into another
 * db.scan("users", {}, { count: 10, pool: "dynamodb" }, (row, next) => {
 *    db.add("users", row, { pool: "pg" }, next);
 * }, console.log;
 * @memberOf module:db
 * @method scan
 */
db.scan = function(table, query, options, rowCallback, endCallback)
{
    if (typeof options == "function") endCallback = rowCallback, rowCallback = options, options = null;

    options = lib.objClone(options);
    options.count = lib.toNumber(options.count, { dflt: 100 });
    options.concurrency = lib.toNumber(options.concurrency, { min: 0 });

    var pool = this.getPool(options);
    if (pool.configOptions.requireCapacity || options.useCapacity || options.factorCapacity) {
        options.capacity = db.getCapacity(options.tableCapacity || table, { useCapacity: options.useCapacity || "read", factorCapacity: options.factorCapacity || 0.9 });
    }
    options.limit_count = 0;
    options.scanning = true;

    lib.whilst(
        function() {
            if (options.limit > 0 && options.limit_count >= options.limit) return false;
            return options.start !== null;
        },
        function(next) {
            if (options.limit > 0) options.count = Math.min(options.limit - options.limit_count, options.count);
            db[options.search ? "search" : "select"](table, query, options, (err, rows, info) => {
                if (err) return next(err);
                options.start = info.next_token || null;
                options.limit_count += rows.length;
                info.scan_count = options.limit_count;
                if (options.sync) {
                    rowCallback(rows, info);
                    next();
                } else
                if (options.batch) {
                    rowCallback(rows, next, info);
                } else
                if (options.concurrency > 0) {
                    var cnt = 0;
                    lib.forEachLimit(rows, options.concurrency, (row, next2) => {
                        if (++cnt > lib.maxStackDepth) {
                            setImmediate(rowCallback, row, next2, info);
                            cnt = 0;
                        } else {
                            rowCallback(row, next2, info);
                        }
                    }, next, true);
                } else {
                    lib.forEachSeries(rows, (row, next2) => {
                        if (++cnt > lib.maxStackDepth) {
                            setImmediate(rowCallback, row, next2, info);
                            cnt = 0;
                        } else {
                            rowCallback(row, next2, info);
                        }
                    }, next, true);
                }
            });
        }, endCallback, true);
}

/**
 * Async version of {@link module:db.scan}
 * @param {string} table - table name
 * @param {DbTable} query - an object with query condition
 * @param {DbRequestOptions} [options]
 * @memberOf module:db
 * @method ascan
 * @async
 */

db.ascan = function(table, query, options, rowCallback)
{
    return new Promise((resolve, reject) => {
        db.scan(table, query, options, rowCallback, (err, data, info) => {
            resolve({ err, data, info });
        });
    });
}


/**
 * Copy records from one table to another between different DB pools or regions
 * Returns stats how many copied or errors
 *
 * @param {string} table - name of the table to copy
 * @param {object} query - a query condition for the table
 * @param {DbRequestOptions} [options] - default options with additional specific below
 * @param {string} [options.sourcePool] - source DB pool, default if not provided
 * @param {string} [options.pool] - destination DB pool
 * @param {int} [options.minCapacity] - capacity minimum for read/writes, it will override actual DB capacity
 * @param {boolean} [options.stopOnError] - stop the copy on first DB error, otherwise ignore errors
 * @param {string} [options.region] - other region where to copy for DynamoDB
 * @param {string} [options.file] - dump the data into a file as JSON
 * @param {function} [options.preprocess] - a function(table, row, options) to be called before the update, if it returns true the record will be skipped
 * @param {function} [options.posprocess] - a function(table, row, options, next) to be called after the record is copied, for recursive or joined cases
 * @param {boolean} [options.reget] - if set the actual record will read using db.get, for cases when db.scan returns only partial record as in DynamoDB cases with indexes
 * @param {boolean} [options.incremental] - if set, try to read the latest record in the other table and continue from there, uses `sort` index in desc order
 * @param {object} [options.queryOptions] - pass options to scan operations
 * @param {object} [options.updateOptions] - pass options to update/bulk operations
 * @param {DbResultCallback} [callback]
 * @memberOf module:db
 * @method copy
 */
db.copy = function(table, query, options, callback)
{
    if (typeof options == "function") callback = options, options = null;

    options = lib.objClone(options);
    var copied = 0, errors = 0, started = Date.now(), elapsed = Date.now();
    var cap = db.getCapacity(table, { pool: options.pool, factorCapacity: options.factorCapacity || 0.99, minCapacity: options.minCapacity });

    var qopts = lib.objMerge({
        pool: options.sourcePool,
        sort: options.sort,
        useCapacity: "read",
        factorCapacity: options.factorCapacity || 0.99,
        minCapacity: options.minCapacity
    }, options.queryOptions);

    var uopts = lib.objMerge(options.updateOptions, {
        syncMode: lib.toNumber(options.syncMode, { dflt: 1 }),
        region: options.region,
        pool: options.pool,
        endpoint: options.endpoint,
        upsert: true
    });

    var file = options.file === 1 || options.file === true ? table + ".json" : options.file;
    logger.logger(options.logger || "debug", "copy:", table, query, options, "started:", cap.rateCapacity);

    lib.series([
        function(next) {
            if (!(options.region || file) && db.getPool(qopts) == db.getPool(uopts)) {
                return next({ status: 400, message: "no copy in the same pool" });
            }
            if (!options.incremental || file) return next();
            var keys = db.getIndexes(table)[options.sort] || db.getKeys(table);
            var sopts = lib.objMerge(uopts, { desc: 1, sort: options.sort, count: 1, first: 1 });
            db.select(table, query, sopts, (err, row) => {
                if (row) {
                    qopts.start = keys.reduce((a, b) => {a[b] = row[b]; return a}, {});
                }
                next();
            });
        },
        function(next) {
            if (options.batch > 0) {
                uopts.bulkSize = options.batch;
                qopts.count = options.batch;
                qopts.batch = 1;
            }
            db.scan(table, query, qopts, (row, next2) => {
                if (options.progress && Date.now() - elapsed > options.progress) {
                    elapsed = Date.now();
                    logger.logger(options.logger || "debug", "copy:", table, query, options, "progress:", copied, "records", errors, "errors", lib.toDuration(started, { age: 1 }));
                }
                if (qopts.batch) {
                    lib.series([
                        function(next3) {
                            if (!options.reget) return next3();
                            db.list(table, row, { pool: qopts.pool }, (err, rc) => {
                                if (!err) row = rc;
                                next3();
                            });
                        },
                        function(next3) {
                            var rows = [];
                            for (const i in row) {
                                if (typeof options.preprocess == "function" && options.preprocess(table, row[i], options)) continue;
                                rows.push({ op: "put", table: table, obj: row[i], options: uopts });
                            }
                            if (file) {
                                return fs.appendFile(file, rows.map((x) => (lib.stringify(x.query))).join("\n") + "\n", next3);
                            }
                            db.bulk(rows, uopts, (err, rc) => {
                                if (err && options.stopOnError) return next2(err);
                                if (!err) copied += rows.length - rc.length; else errors++;
                                db.checkCapacity(cap, next3);
                            });
                        },
                        function(next3) {
                            if (typeof options.postprocess != "function") return next3();
                            var cnt = 0;
                            lib.forEachSeries(row, (r, next4) => {
                                if (++cnt > lib.maxStackDepth) {
                                    setImmediate(options.postprocess, table, r, options, next4);
                                    cnt = 0;
                                } else {
                                    options.postprocess(table, r, options, next4);
                                }
                            }, next3);
                        },
                    ], next2, true);
                } else {
                    lib.series([
                        function(next3) {
                            if (!options.reget) return next3();
                            db.get(table, row, { pool: qopts.pool }, (err, r) => {
                                if (r) row = r;
                                next3();
                            });
                        },
                        function(next3) {
                            if (typeof options.preprocess == "function" && options.preprocess(table, row, options)) return next3();
                            if (file) {
                                return fs.appendFile(file, lib.stringify(row) + "\n", next3);
                            }
                            db.update(table, row, uopts, (err) => {
                                if (err && options.stopOnError) return next2(err);
                                if (!err) copied++; else errors++;
                                db.checkCapacity(cap, next3);
                            });
                        },
                        function(next3) {
                            if (typeof options.postprocess != "function") return next3();
                            options.postprocess(table, row, options, next3);
                        },
                    ], next2, true);
                }
            }, next);
        },
    ], (err) => {
        var rc = { table, query, copied, errors, elapsed: lib.toDuration(started, { age: 1 }) };
        logger.logger(options.logger || "debug", "copy:", table, query, options, "done:", rc, err);
        lib.tryCall(callback, err, rc);
    }, true);
}

/**
 * Async version of {@link module:db.copy}
 * @param {string} table - name of the table to copy
 * @param {object} query - a query condition for the table
 * @param {DbRequestOptions} [options]
 * @memberOf module:db
 * @method acopy
 * @async
 */

db.acopy = function(table, query, options)
{
    return new Promise((resolve, reject) => {
        db.copy(table, query, options, (err, data, info) => {
            resolve({ err, data, info });
        });
    });
}


/**
 * Create a table using column definitions represented as a list of objects.
 *
 * Some properties may be defined multiple times with number suffixes like: `unique1, unique2, index1, index2` to create more than one index for the table, same
 * properties define a composite key in the order of definition or sorted by the property value, for example: `{ a: { index:2 }, b: { index:1 } }` will create index (b,a)
 * because of the `index:` property value being not the same. If all index properties are set to 1 then a composite index will use the order of the properties.*
 *
 * Each database pool also can support native options which are passed directly to the driver in the options, these properties are
 * defined in the object with the same name as the db driver: `pg, sql, sqlite, dynamodb, elasticsearch`
 *
 * DynmamoDB:
 *
 * To create a DynamoDB secondary index, the first index property if not the same as primary key hash defines global index, if it is the same then local,
 * or if the first property contains `dynamodb.global` property then it is a global index.
 *
 * DynamoDB projections are defined by the `dynamodb.projections[N]` property in the first index property
 * as an array with names of properties to include in projection or ALL for all properties.
 *
 *  When using real DynamoDB creating a table may take some time, for such cases if `options.waitTimeout` is not specified it defaults to 1min,
 *  so the callback is called as soon as the table is active or after the timeout whichever comes first.
 *
 * @param {string} table - table name
 * @param {DbTable} schema - an object with table schema
 * @param {DbConfigOptions} [options] - options for the database driver
 * @param {DbResultCallback} [callback] - response handler
 *
 * @example
 * // DynamoDB global index `name_descr` will include `type` property in the projection but local index `id_title` will include
 * // name and descr properties
 * db.create("test_table2", {
 *     id: { primary: 1, type: "int", index1: 1, dynamodb: { projections1: ["name","descr"] } },
 *     type: { primary: 2 },
 *     title: { index1: 2 },
 *     name: { index: 1, dynamodb: { projections: ["type"] } },
 *     descr: { index: 2 },
 * });
 *
 * @memberOf module:db
 * @method create
 */
db.create = function(table, schema, options, callback)
{
    this.query(this.prepare({ op: "create", table, query: schema, options, callback }));
}

/**
 * Async version of {@link module:db.create}
 * @param {string} table - table name
 * @param {DbTable} schema - an object with table schema
 * @param {DbConfigOptions} [options] - options for the database driver
 * @memberOf module:db
 * @method acreate
 * @async
 */

db.acreate = function(table, schema, options)
{
    return new Promise((resolve, reject) => {
        db.create(table, schema, options, (err, data, info) => {
            resolve({ err, data, info });
        });
    });
}

/**
 * Upgrade a table with missing columns from the definition list, if after the upgrade new columns must be re-read from the database
 * then `info.affected_rows` must be non zero.
 * @param {string} table - table name
 * @param {DbTable} schema - an object with table schema
 * @param {DbConfigOptions} [options] - options for the database driver
 * @param {DbResultCallback} [callback] - response handler
 * @memberOf module:db
 * @method upgrade
 */
db.upgrade = function(table, schema, options, callback)
{
    this.query(this.prepare({ op: "upgrade", table, query: schema, options, callback }));
}

/**
 * Async version of {@link module:db.upgrade}
 * @param {string} table - table name
 * @param {DbTable} schema - an object with table schema
 * @param {DbConfigOptions} [options] - options for the database driver
 * @memberOf module:db
 * @method aupgrade
 * @async
 */

db.aupgrate = function(table, schema, options)
{
    return new Promise((resolve, reject) => {
        db.upgrate(table, schema, options, (err, data, info) => {
            resolve({ err, data, info });
        });
    });
}

/**
 * Drop a table
 * @param {string} table - table name
 * @param {DbRequestOptions} [options]
 * @param {DbResultCallback} [callback]
 * @memberOf module:db
 * @method drop
 */
db.drop = function(table, options, callback)
{
    if (typeof options == "function") callback = options,options = null;
    if (lib.testRegexpObj(this.skipDrop, table)) return lib.tryCall(callback, "skip-drop");

    var req = this.prepare({ op: "drop", table, options });
    this.query(req, (err, rows, info) => {
        // Clear the table cache
        if (!err) {
            delete req.pool.dbcolumns[table];
            delete req.pool.dbkeys[table];
            delete req.pool.dbindexes[table];
        }
        lib.tryCall(callback, err, rows, info);
    });
}

/**
 * Async version of {@link module:db.drop}
 * @param {string} table - table name
 * @param {DbRequestOptions} [options]
 * @memberOf module:db
 * @method adrop
 * @async
 */

db.adrop = function(table, options)
{
    return new Promise((resolve, reject) => {
        db.drop(table, options, (err, data, info) => {
            resolve({ err, data, info });
        });
    });
}

/**
 * Execute arbitrary SQL-like statement if the pool supports it, values must be an Array with query parameters or can be omitted.
 *
 * @param {string} test - SQL statement
 * @param {any[]} - values for position placeholders
 * @param {DbRequestOptions} [options]
 * @param {DbResultCallback} [callback]
 * @example
 * db.sql("SELECT id,name FROM users WHERE name=$1 LIMIT $2", ["admin", 1], { pool: "sqlite" }, lib.log)
 *
 * db.sql("SELECT * FROM users", { pool: "dynamodb" }, lib.log)
 *
 * db.sql("SELECT * FROM users WHERE name=$1", ["John"], { pool: "pg", count: 10 }, lib.log)
 *
 * db.sql("SELECT * FROM users", lib.log);
 * @memberOf module:db
 * @method sql
 */
db.sql = function(text, values, options, callback)
{
    if (!Array.isArray(values)) callback = options, options = values, values = null;
    if (typeof options == "function") callback = options,options = null;
    var req = this.prepare({ op: "sql", options, callback });
    req.text = text;
    req.values = values;
    this.query(req);
}

/**
 * Async version of {@link module:db.sql}
 * @param {string} test - SQL statement
 * @param {any[]} - values for position placeholders
 * @param {DbRequestOptions} [options]
 * @memberOf module:db
 * @method asql
 * @async
 * @example
 * const { err, data, info } = await db.asql("SELECT * FROM users WHERE name=$1 LIMIT $2", ["admin", 1])
 */

db.asql = function(text, values, options)
{
    return new Promise((resolve, reject) => {
        db.sql(text, values, options, (err, data, info) => {
            resolve({ err, data, info });
        });
    });
}

/**
 * Collect stats for enabled pools, this is called by the `stats` module
 *
 * To enable stats collection for a pool it must be explicitly set via config options,
 * additionally collect stats individually for a list of tables
 * ```
 * db-dynamodb-pool-options = metrics:1
 * db-dynamodb-pool-metrics-tables = bk_config, users
 * ```
 * @memberOf module:db
 * @method configureCollectStats
 */

db.configureCollectStats = function(options)
{
    for (let pool in this.pools) {
        pool = this.pools[pool];
        if (!pool.configOptions?.metrics) continue;

        const m = metrics.toJSON(pool.metrics, { reset: 1, take: /_count$/ });
        if (!m.req?.meter?.count) continue;

        options.stats["db_" + pool.name + "_req_count"] = m.req.meter.count;
        options.stats["db_" + pool.name + "_req_rate"] = m.req.meter.rate;
        options.stats["db_" + pool.name + "_res_time"] = m.req.histogram.med;
        options.stats["db_" + pool.name + "_que_size"] = m.que?.med;
        options.stats["db_" + pool.name + "_cache_time"] = m.cache?.med;
        for (const p in m.tables) {
            options.stats["db_" + pool.name + "_" + p + "_read_count"] = m.tables[p].read?.count;
            options.stats["db_" + pool.name + "_" + p + "_read_rate"] = m.tables[p].read?.rate;
            options.stats["db_" + pool.name + "_" + p + "_write_count"] = m.tables[p].write?.count;
            options.stats["db_" + pool.name + "_" + p + "_write_rate"] = m.tables[p].write?.rate;
        }
    }
}

require(__dirname + "/db/tables")
require(__dirname + "/db/config")
require(__dirname + "/db/pool")
require(__dirname + "/db/prepare")
require(__dirname + "/db/cache")
require(__dirname + "/db/utils")

