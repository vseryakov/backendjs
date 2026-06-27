# Config parameters
## api
See {@link module:api}
###  api-version 
---- 
Custom Server: header to return for all requests   
Default: "api/1.0"   
###  api-port 
---- 
port to listen for the HTTP server, this is global default   
Type: number   
Default: 8000   
###  api-bind 
---- 
Bind to this address only, if not specified listen on all interfaces   
Default: "0.0.0.0"   
###  api-backlog 
---- 
The maximum length of the queue of pending connections, used by HTTP server in listen.   
Type: int   
Default: 5000   
###  api-ssl 
---- 
SSL params: port, bind, key, cert, pfx, ca, passphrase, crl, ciphers   
Type: map   
Default: {"port":443,"bind":"0.0.0.0"}   
###  api-allow-middleware 
---- 
Modules allowed to call configureMiddleware, i.e. only allowed endpoints   
Type: regexp   
###  api-accesslog-disabled 
---- 
Disable access logging in both file or syslog   
Type: bool   
###  api-accesslog-file 
---- 
File for access logging   
###  api-accesslog-level 
---- 
Syslog level priority, default is local5.info, 21 * 8 + 6   
Type: int   
###  api-accesslog-fields 
---- 
Additional fields from the request or user to put in the access log, prefix defines where the field is lcoated: q: - query, b: - body, o: - options, h: - headers, u: - user otherwise from the request   
Type: list   
Example:
```
api-log-fields = h:Referer,u:name,q:action,b:id
```

###  api-max-requests 
---- 
Max number of requests in the processing queue, if exceeds this value server returns 503 too busy error   
Type: number   
###  api-requests-per-socket 
---- 
The maximum number of requests a socket can handle before closing keep alive connection   
Type: int   
###  api-idle-timeout 
---- 
HTTP request idle timeout for servers in ms, how long to keep the connection socket open, this does not affect Long Poll requests   
Type: number   
Default: 30000   
###  api-keep-alive-timeout 
---- 
Number of milliseconds to keep the HTTP conection alive   
Type: int   
Default: 61000   
###  api-request-timeout 
---- 
Number of milliseconds to receive the entire request from the client   
Type: int   
###  api-reuse-port 
---- 
Allow multiple sockets on the same host to bind to the same port   
Type: bool   
###  api-exit-on-error 
---- 
Exit on uncaught exception in the route handler, shutdown the worker process gracefully   
Type: bool   
Default: true   
###  api-run-mode 
---- 
als - run inside async local storage `lib.als`, domain - run inside node:domain, other - direct callback   
Default: "als"   
###  api-trust-proxy 
---- 
Trust proxy headers for IP/Host   
Type: bool   
Default: true   
###  api-defaults-([a-z0-9_]+)-(.+) 
---- 
Global body limits for `api.validate`, format is: api-defaults-LIMIT-NAME, where LIMIT is an property that performs limiting like max, maxlist, min, required.., NAME is a schema property, it can be path specific   
Example:
```
# Limit all names length up to 128 chars
api-defaults-max-name = 128
# Limit groups list size for /endpoint to 255
api-defaults-maxlist-/endpoint-groups = 255
```

###  api-restart-hours 
---- 
List of hours when to restart api workers, only done once for each hour   
Type: list   
###  api-restart-process 
---- 
On address in use error condition restart the specified servers, this assumes an external monitor like monit to handle restarts   
Default: "server,web"   
###  api-err-(.+) 
---- 
Error messages for various cases   
## api.acl
See {@link module:api/acl}
###  api-acl-add-([a-z0-9_*]+) 
---- 
Add URLs to the named ACL which can be used in allow/deny rules per role   
Type: regexpobj   
Example:
```
api-acl-add-admins = ^/admin
```

###  api-acl-deny-([a-z0-9_]+) 
---- 
Match all regexps from the specified acls to deny access for the specified role   
Type: list   
Example:
```
api-acl-deny-user = admins,billing
```

###  api-acl-allow-([a-z0-9_]+) 
---- 
Match all regexps from the specified acls for allow access for the specified role   
Type: list   
Example:
```
api-acl-allow-staff = admins,support,-billing
```

###  api-acl-reset 
---- 
Reset all acls   
Type: callback   
## api.passkey
See {@link module:api/passkey}
###  api-passkey-enable 
---- 
Enable the middlware globally   
Type: bool   
###  api-passkey-err-(.+) 
---- 
Error messages for various cases   
###  api-passkey-cap-(.+) 
---- 
Capability parameters   
Type: int   
###  api-passkey-secret 
---- 
Cookies secret   
###  api-passkey-cache 
---- 
Cache for challenges   
Default: "local"   
###  api-passkey-cookie 
---- 
Cookie name   
Default: "bk_passkey"   
###  api-passkey-domain 
---- 
Explicit domain to use instead of host   
## api.session
See {@link module:api/session}
###  api-session-cache 
---- 
Cache name for session control   
Example:
```
api-session-cache = redis
```

###  api-session-age 
---- 
Session age in milliseconds   
Type: int   
Default: 86400000   
Example:
```
api-session-age = 86400000
```

###  api-session-same-site 
---- 
Session SameSite header   
Default: "strict"   
###  api-session-secure 
---- 
Set cookie Secure flag   
Type: bool   
Default: true   
###  api-session-cookie-(.+) 
---- 
Cookie settings for requests that match beginning of the path   
Type: map   
Example:
```
api-session-cookie-/testing = secure:false,sameSite:None
```

###  api-session-secret 
---- 
Encryption secret, if empty sessions will only be signed but not encrypted   
###  api-session-header 
---- 
Cookie name to use for session   
Default: "bk-sid"   
## api.users
See {@link module:api/users}
###  api-users-err-(.+) 
---- 
Error messages for various cases   
###  api-users-table 
---- 
Database table to create and use for users   
###  api-users-max-length 
---- 
Max length for user name, login   
Type: number   
Default: 140   
###  api-users-mfa-age 
---- 
Age in ms of a MFA code   
Type: int   
Default: 600000   
## api.ws
See {@link module:api/ws}
###  api-ws-port 
---- 
Port to listen for WebSocket server, it can be the same as HTTP/S ports to co-exist on existing web servers   
Type: number   
###  api-ws-bind 
---- 
Bind to this address only for WebSocket, if not specified listen on all interfaces, only when the port is different from existing web ports   
Default: "0.0.0.0"   
###  api-ws-ping 
---- 
How often to ping WebSocket connections   
Type: number   
Default: 30000   
###  api-ws-path 
---- 
WebSockets will be accepted only if request matches this pattern   
Type: regexp   
###  api-ws-origin 
---- 
WebSockets will be accepted only if request Origin: header maches the pattern   
Type: regexp   
###  api-ws-queue 
---- 
A queue where to publish messages for WebSockets, API process will listen for messages and proxy it to all macthing connected WebSockets    
## app
See {@link module:app}
###  app-cap-(.+) 
---- 
Capability parameters   
Type: int   
###  app-log 
---- 
Set debugging level to any of DEV,DEBUG,INFO,LOG,WARN,ERROR,NONE   
Type: callback   
###  app-log-options 
---- 
Update logger options, the format is a map: name:val,...   
Type: map   
###  app-log-file 
---- 
Log to a file, if not specified used default logfile, disables syslog   
Type: callback   
###  app-log-ignore 
---- 
Regexp with property names which must not be exposed in the log when using custom logger inspector   
Type: regexp   
###  app-log-inspect 
---- 
Install custom logger inspector instead of util.inspect: 'json' - JSON output, 1|true - lib.inspect, 0 - util.inspect   
Type: callback   
Default: {"depth":7,"count":200,"keys":100,"func":0,"keepempty":1,"length":1500,"ignore":{},"replace":{" ":{}}}   
###  app-log-inspect-options 
---- 
Options for the logger using lib.inspect   
Type: map   
###  app-log-filter 
---- 
Enable debug filters, format is: label,... to enable, and !label,... to disable. First 2 arguments are used by debug filter in logger.debug   
Type: callback   
Example:
```
//To log all debugging api and queries: as first/second args
app-log-filter = api,query:
```

###  app-log-clear 
---- 
Clear all log filters   
Type: bool   
###  app-syslog 
---- 
Log messages to syslog, pass 0 to disable, 1 or url (tcp|udp|unix):[//host:port][/path]?[facility=F][&tag=T][&retryCount=N][&bsd=1][&rfc5424=1][&rfc3164=1]...   
Type: callback   
###  app-console 
---- 
All logging goes to the console resetting all previous log related settings, this is used in the development mode mostly   
Type: callback   
###  app-home 
---- 
Specify home directory for the server, the server will try to chdir there or exit if it is not possible, the directory must exist   
Type: callback   
Default: "/Users/vlad/src/backendjs"   
###  app-config 
---- 
Name of the config file to be loaded, can be relative or absolute path   
Type: path   
Default: "bkjs.conf"   
###  app-tmp-dir 
---- 
Path where to keep temp files   
Type: path   
Default: "/tmp"   
###  app-path-web 
---- 
Add a path where to keep web pages and other static files to be served by the web servers   
Type: path   
###  app-path-modules 
---- 
Add a path from where to load modules, these are the backendjs modules but in the same format and same conventions as regular node.js modules. The modules can load any other files or directories, this is just an entry point   
Type: path   
###  app-salt 
---- 
Set random or specific salt value to be used for consistent suuid generation   
Type: callback   
###  app-version 
---- 
Set app name/version explicitely and skip reading it from the package.json   
Default: "bkjs/0.0"   
###  app-roles 
---- 
Additional config roles, a shortcut for app-env-roles   
Type: list   
Example:
```
app-roles = redis, dynamodb
```

###  app-env-([a-z0-9_-]+) 
---- 
Set runtime env properties explicitly: tag, region, zone, roles, ...   
Example:
```
app-env-roles = dev,web
app-env-tag = api
```

###  app-daemon 
---- 
Daemonize the process, go to the background, can be specified only in the command line   
Type: none   
###  app-shell 
---- 
Run command line shell, load the backend into the memory and prompt for the commands, can be specified only in the command line   
Type: none   
###  app-server 
---- 
Start the server server, can be specified only in the command line, this process handles job schedules and starts Web server in separate process, keeps track of failed processes and restarts them   
Type: none   
###  app-worker 
---- 
Set this process as a worker even it is actually a primary, this skips some initializations   
Type: bool   
###  app-no 
---- 
List of subsystems to disable instead of using many inidividual -no-NNN parameters   
Type: callback   
###  app-no-([a-z]+) 
---- 
Do not start or disable a service, server, web, jobs, ipc, db, dbconf, watch, modules, packages, configure   
Type: callback   
###  app-ok-(.+) 
---- 
Enable disabled service, opposite of -no   
Type: callback   
###  app-repl-port-([a-z]+)$ 
---- 
Base REPL port for process role (server, web, worker), if specified it initializes REPL in the processes, for workers the port is computed by adding a worker id to the base port, for example if specified `-repl-port-web 2090` then a web worker will use any available 2091,2092...   
Type: number   
###  app-repl-([a-z]+) 
---- 
REPL settings: listen, file, size   
Type: auto   
###  app-import 
---- 
NPM packages to load on startup, the modules, views, web subfolders from the package will be added automatically to the system paths, modules will be loaded if present, the bkjs.conf will be parsed if present   
Type: list   
Default: []   
###  app-modules-include 
---- 
Modules to load only, the whole path is checked   
Type: regexp   
###  app-modules-exclude 
---- 
Modules not to load, the whole path is checked   
Type: regexp   
###  app-modules-depth 
---- 
How deep to go looking for modules, it uses lib.findFileSync to locate all .js files   
Type: int   
###  app-modules-methods-(.+) 
---- 
Modules that allowed to run methods by name, useful to restrict configure methods   
Type: regexp   
Example:
```
-app-modules-methods-configureMiddleware myapp
```

###  app-host-name 
---- 
Hostname/domain to use for communications, default is current domain of the host machine   
Type: callback   
###  app-workers 
---- 
Max number of web processes to launch, -1 disables workers, 0 means launch as many as the CPUs available`   
Type: int   
Default: 1   
###  app-worker-cpu-factor 
---- 
A number to multiply the number of CPUs available to make the total number of workers to launch, only used if `workers` is 0   
Type: real   
Default: 2   
###  app-worker-args 
---- 
Node arguments for workers, job and web processes, for passing v8 options, use %20 for spaces   
Type: list   
Default: []   
###  app-worker-delay 
---- 
Delay in milliseconds for a web worker before it will start accepting requests, for cases when other dependencies may take some time to start   
Type: int   
###  app-no-restart 
---- 
Do not restart any workers   
Type: bool   
###  app-stop-on-error 
---- 
Exit the process on any error when loading modules, for dev purposes   
Type: bool   
###  app-exit-timeout 
---- 
Duration in ms to delay process exit in app.exit   
Type: int   
###  app-exit-on-empty 
---- 
Duration in ms to exit the server process after last worker terminated   
Type: int   
###  app-pid-file 
---- 
Server process pid file   
###  app-err-file 
---- 
Server error log file in daemon mode   
## aws
See {@link module:aws}
###  aws-key 
---- 
AWS access key   
###  aws-secret 
---- 
AWS access secret   
###  aws-token 
---- 
AWS security token   
###  aws-region 
---- 
AWS region   
###  aws-zone 
---- 
AWS availability zone   
###  aws-meta 
---- 
Retrieve instance metadata, 0 to disable   
Type: bool   
Default: 1   
###  aws-sdk-profile 
---- 
AWS SDK profile to use when reading credentials file   
###  aws-sns-app-arn 
---- 
SNS Platform application ARN to be used for push notifications   
###  aws-key-name 
---- 
AWS instance keypair name for remote job instances or other AWS commands   
###  aws-target-group 
---- 
AWS ELB target group to be registered with on start up or other AWS commands   
###  aws-elastic-ip 
---- 
AWS Elastic IP to be associated on start   
###  aws-host-name 
---- 
List of hosts to update in Route54 zone with the current private IP address, hosts must be in FQDN format, supports @..@ app.env placeholders   
Type: list   
###  aws-iam-profile 
---- 
IAM instance profile name for instances or commands   
###  aws-image-id 
---- 
AWS image id to be used for instances or commands   
###  aws-subnet-id 
---- 
AWS subnet id to be used for instances or commands   
###  aws-vpc-id 
---- 
AWS VPC id to be used for instances or commands   
###  aws-group-id 
---- 
AWS security group(s) to be used for instances or commands   
###  aws-public-ip 
---- 
AWS public IP option for instances or commands   
Type: bool   
###  aws-ecs-cluster 
---- 
AWS ECS cluster to use as default   
###  aws-instance-type 
---- 
AWS instance type to launch on demand   
###  aws-metadata-options 
---- 
Default instance metadata options   
Type: list   
###  aws-account-id 
---- 
AWS account id if not running on an instance   
###  aws-eni-id 
---- 
AWS Elastic Network Interfaces to attach on start, format is: eni[:index],eni...   
Type: list   
###  aws-config-parameters 
---- 
Prefix for AWS Systems Manager parameters to load and parse as config before initializing the database pools   
Example:
```
/bkjs/config/
```

###  aws-config-secrets 
---- 
AWS Secrets Manager filters to load and parse as config before initializing the database pools, supports @..@ app.env placeholders in filters   
Type: list   
Example:
```
production,production-@tag@,production-@role@
```

###  aws-config-s3-file 
---- 
S3 url for config file to download on start, may include @placeholders@ to refer properties from app.env   
###  aws-config-s3-interval 
---- 
Load S3 config file every specified interval in minites   
Type: int   
## cache
See {@link module:cache}
###  cache-config 
---- 
An object with driver configs, an object with at least url or an url string   
Type: json   
Example:
```
-cache-config {"redis":{"url":redis://localhost","count":1},"nats":"nats://localhost:4222"}
```

###  cache-([a-z0-9]+)-options$ 
---- 
Additional parameters for clients, specific to each implementation   
Type: map   
Example:
```
-cache-redis-options count:10,interval:100
```

###  cache-([a-z0-9]+)-options-(.+) 
---- 
Additional parameters for clients, specific to each implementation   
Example:
```
-cache-default-options-count 10
```

###  cache-([a-z0-9]+) 
---- 
An URL that points to a cache server in the format PROTO://HOST[:PORT]?PARAMS, multiple clients can be defined with unique names, all params starting with bk- will be copied into the options without the prefix and removed from the url, the rest of params will be left in the url   
Example:
```
-cache-redis redis://localhost?bk-count=3&bk-ttl=3000
```

## db
See {@link module:db}
###  db-cap-(.+) 
---- 
Capability parameters   
Type: number   
###  db-none 
---- 
disable all db pools   
Type: bool   
###  db-pool 
---- 
Default pool to be used for db access without explicit pool specified   
###  db-name 
---- 
Default database name to be used for default connections in cases when no db is specified in the connection url   
Default: "db"   
###  db-config 
---- 
Configuration database pool to be used to retrieve config parameters from the database, must be defined to use remote db for config parameters   
###  db-config-map 
---- 
Config options: `.interval` between loading configuration from the database configured with -db-config, in minutes, 0 disables refreshing config from the db, `.count` max records to load in one select, see the docs about `.top`, `.main`, `.other` config parameters   
Type: map   
Default: {"count":1000,"interval":1440,"top":"roles","main":"role,tag","other":"role"}   
###  db-aliases-(.+) 
---- 
Table aliases to be used instead of the requested table name, only high level db operations will use it, low level utilities use the real table names   
###  db-describe-tables 
---- 
A JSON object with table descriptions to be merged with the existing definitions   
Type: callback   
###  db-describe-column-([a-z0-9_]+)-([a-zA-Z0-9_.]+) 
---- 
Describe a table column properties, can be a new or existing column, overrides existing property   
Type: map   
Example:
```
-db-describe-column-users-name.check max:255
```

###  db-cache-tables 
---- 
List of tables that can be cached: users, bk_counter. This list defines which DB calls will cache data with currently configured cache. This is global for all db pools.   
Type: list   
###  db-cache-pools 
---- 
List of pools which trigger cache flushes on update.   
Type: list   
###  db-cache-sync 
---- 
List of tables that perform synchronized cache updates before returning from a DB call, by default cache updates are done in the background   
Type: list   
###  db-cache-keys-([a-z0-9_]+)-(.+) 
---- 
List of columns to be used for the table cache, all update operations will flush the cache if the cache key can be created from the record columns. This is for ad-hoc and caches to be used for custom selects which specified the cache key.   
Type: list   
###  db-cache-ttl-(.+) 
---- 
TTL in milliseconds for each individual table being cached, use * as default for all tables   
Type: int   
###  db-cache-name-(.+) 
---- 
Cache client name to use for cache reading and writing for each table instead of the default in order to split cache usage for different tables, it can be just a table name or `pool.table`, use `*` to set default cache for all tables   
###  db-cache-update-(.+) 
---- 
Cache client name to use for updating only for each table instead of the default in order to split cache usage for different tables, it can be just a table name or `pool.table` or `*`. This cache takes precedence for updating cache over `cache-name` parameter   
###  db-cache2-max 
---- 
Max number of items to keep in the LRU Level 2 cache   
Type: int   
###  db-cache2-(.+) 
---- 
Tables with TTL for level2 cache, i.e. in the local process LRU memory. It works before the primary cache and keeps records in the local LRU cache for the given amount of time, the TTL is in ms and must be greater than zero for level 2 cache to work   
Type: int   
###  db-skip-tables 
---- 
List of tables that will not be created or modified, this is global for all pools   
Type: list   
###  db-skip-pools 
---- 
List of pools to be skipped during initialization   
Type: list   
###  db-skip-drop 
---- 
A pattern of table names which will skipp in db.drop operations to prevent accidental table deletion   
Type: regexpobj   
###  db-custom-column-([a-zA-Z0-9_]+)-(.+) 
---- 
A column that is allowed to be used in any table, the name is a column name regexp with the value to be a type   
Example:
```
-db-custom-column-users-^stats=counter
```

###  db-cleanup-rules-(.+) 
---- 
Rules for the db.cleanupResult per table   
Type: map   
Example:
```
db-cleanup-rules-bk_user = email:0,phone:1
```

###  db-cleanup-strict 
---- 
Default strict mode for cleanup results   
Type: bool   
###  db-([a-z0-9]+)-pool 
---- 
A database pool name, depending on the driver it can be an URL, name or pathname   
Example:
```
`-db-pg-pool`
`-db-dynamodb-pool`
url format: `protocol://[user:password@]hostname[:port]/dbname`
`default`
```

###  db-([a-z0-9]+)-pool-(disabled) 
---- 
Disable the specified pool but keep the configuration   
Type: bool   
###  db-([a-z0-9]+)-pool-(max) 
---- 
Max number of open connections for a pool, default is Infinity   
Type: number   
###  db-([a-z0-9]+)-pool-(min) 
---- 
Min number of open connections for a pool   
Type: number   
###  db-([a-z0-9]+)-pool-(idle) 
---- 
Number of ms for a db pool connection to be idle before being destroyed   
Type: number   
###  db-([a-z0-9]+)-pool-(tables) 
---- 
Tables to be created only in this pool, to prevent creating all tables in every pool   
Type: list   
###  db-([a-z0-9]+)-pool-connect 
---- 
Connect options for a DB pool driver for new connection, driver specific   
Type: map   
###  db-([a-z0-9]+)-pool-options 
---- 
General options for a DB pool, a simple map case   
Type: map   
###  db-([a-z0-9]+)-pool-options-([a-zA-Z0-9_.-]+)$ 
---- 
General options for a DB pool by name with specific type   
###  db-([a-z0-9]+)-pool-table-map 
---- 
Table mapping, aliases   
Type: map   
###  db-([a-z0-9]+)-pool-(skip-tables) 
---- 
Tables not to be created in this pool   
Type: list   
###  db-([a-z0-9]+)-pool-(metrics-tables) 
---- 
Tables to collect metrics in this pool   
Type: list   
###  db-([a-z0-9]+)-pool-cache2-(.+) 
---- 
Level 2 cache TTL for the specified pool and table, data is JSON strings in the LRU cache   
Type: int   
###  db-([a-z0-9]+)-pool-alias 
---- 
Pool alias to refer by an alternative name   
## events
See {@link module:events}
###  events-cap-(.+) 
---- 
Capability parameters   
Type: int   
###  events-worker-queue 
---- 
Queues to subscribe for workers, same queues can be used at the same time with different functions and channels and consumers, event queue format is `queue.subject#group`   
Type: map   
Default: {}   
Example:
```
events-worker-queue = ticket:ticket.processEvents, ticket.inbox#staff: ticket.processInboxEvents, ticket#staff: ticket.processStaffEvents
```

###  events-worker-options-(.+) 
---- 
Custom parameters by queue name, passed to `queue.listen` on worker start, useful with channels   
Type: map   
Example:
```
-events-worker-options-ticket count:3,raw:1
```

###  events-worker-delay 
---- 
Delay in milliseconds for a worker before it will start accepting jobs, for cases when other dependencies may take some time to start   
Type: int   
Default: 50   
###  events-max-runtime 
---- 
Max number of seconds an event processing can run before being killed   
Type: int   
Default: 60000   
###  events-routing 
---- 
Routing map by event subject or type   
Type: map   
Default: {}   
Example:
```
-events-routing redis:local.+, nats:.+, sqs:billing.+
```

###  events-routing-options-(.+) 
---- 
Routing options by queue name, used by `putEvent` to merge with passed queue options   
Type: map   
Example:
```
-events-routing-options-nats groupName:group
```

###  events-shutdown-timeout 
---- 
Max number of milliseconds to wait for the graceful shutdown sequence to finish, after this timeout the process just exits   
Type: int   
Default: 50   
## files
See {@link module:files}
###  files-s3 
---- 
S3 bucket name where to store files uploaded with the File API   
###  files-root 
---- 
Root directory where to keep files   
Type: path   
###  files-max-age 
---- 
Max age for files in ms, -1 to disable   
Type: int   
###  files-no-cache 
---- 
Serve files as non cacheable   
Type: bool   
###  files-last-modified 
---- 
Serve Last-Modified header to support conditional requests   
Type: bool   
Default: true   
###  files-etag 
---- 
Produce weak ETag header for static files   
Type: bool   
Default: true   
## ipc
See {@link module:ipc}
###  ipc-ping 
---- 
Keep alive pings for workers: interval:ms how oftern do pings, kill:ms kill worker after this period   
Type: map   
Default: {}   
###  ipc-system-queue 
---- 
System queue name to send broadcast control messages, this is a PUB/SUB queue to process system messages like restart, re-init config,...   
## jobs
See {@link module:jobs}
###  jobs-cap-(.+) 
---- 
Capability parameters   
Type: int   
###  jobs-workers 
---- 
How many worker processes to launch to process the job queue, -1 disables jobs, 0 means launch as many as the CPUs available   
Type: number   
Default: -1   
###  jobs-worker-cpu-factor 
---- 
A number to multiply the number of CPUs available to make the total number of workers to launch, only used if `workers` is 0   
Type: real   
Default: 2   
###  jobs-worker-env 
---- 
Environment to be passed to the worker via fork, see `cluster.fork`   
Type: map   
Default: {}   
###  jobs-worker-settings 
---- 
Worker fork setting, see cluster.setupPrimary   
Type: json   
###  jobs-worker-delay 
---- 
Delay in milliseconds for a worker before it will start accepting jobs, for cases when other dependencies may take some time to start   
Type: int   
Default: 50   
###  jobs-worker-queue 
---- 
Queue(s) to subscribe for workers, multiple queues can be processes at the same time, i.e. more than one job can run from different queues   
Type: list   
Default: []   
###  jobs-worker-options-(.+) 
---- 
Custom parameters by queue name, passed to `queue.subscribeQueue` on worker start, useful with channels   
Type: json   
Example:
```
-jobs-worker-options-nats#events {"count":10}
```

###  jobs-max-runtime 
---- 
Max number of milliseconds a job can run before being killed   
Type: int   
Default: 900000   
###  jobs-max-lifetime 
---- 
Max number of milliseconds a worker can live, after that amount of time it will exit once all the jobs are finished, 0 means indefinitely   
Type: int   
Default: 43200000   
###  jobs-shutdown-timeout 
---- 
Max number of milliseconds to wait for the graceful shutdown sequence to finish, after this timeout the process just exits   
Type: int   
Default: 50   
###  jobs-cron-queue 
---- 
Default queue to use for cron jobs   
Type: list   
###  jobs-global-queue 
---- 
Default queue for all jobs, the queueName is ignored   
Type: list   
###  jobs-global-ignore 
---- 
Queue names which ignore the global setting, the queueName is used as usual, local and worker are ignored by default   
Type: list   
Default: ["local","worker"]   
###  jobs-cron-file 
---- 
File with cron jobs in JSON format   
###  jobs-cron 
---- 
Cron jobs to be scheduled, the JSON must be in the same format as crontab file, cron format by https://croner.56k.guru   
Type: json   
###  jobs-unique-cache 
---- 
Default cache name to use for keeping track of unique jobs   
Default: "local"   
###  jobs-unique-ignore 
---- 
Ignore all unique parameters if a job's uniqueKey matches   
Type: regexp   
###  jobs-unique-ttl-([0-9]+) 
---- 
Override unique TTL to a new value if matches the unique key   
Type: regexp   
Example:
```
-jobs-unique-ttl-100 KEY
```

###  jobs-unique-logger 
---- 
Log level for unique error conditions   
###  jobs-retry-visibility-timeout 
---- 
Visibility timeout by error code >= 500 for queues that support it   
Type: map   
###  jobs-task-ignore 
---- 
Ignore matched tasks   
Type: regexp   
## middleware.body
See {@link module:middleware/body}
###  middleware-body-enable 
---- 
Enable the middlware globally   
Type: bool   
###  middleware-body-methods 
---- 
HTTP methods enabled in global mode   
Type: list   
Default: ["POST","PUT","PATCH"]   
###  middleware-body-content-type 
---- 
List of additional content types to be parsed in additional to default json/url-encoded/text   
Type: list   
Example:
```
middleware-body-content-type = text/xml, image/png
```

###  middleware-body-max-size 
---- 
Max size for body in bytes   
Type: number   
Default: 64000   
###  middleware-body-timeout 
---- 
Max time in ms to read the body   
Type: number   
Default: 30000   
###  middleware-body-err-(.+) 
---- 
Error messages for various cases   
## middleware.cors
See {@link module:middleware/cors}
###  middleware-cors-origin 
---- 
Origin header   
Default: "*"   
###  middleware-cors-credentials 
---- 
Allow credentials   
Type: bool   
Default: true   
###  middleware-cors-methods 
---- 
Allow methods   
Type: list   
Default: ["OPTIONS","HEAD","GET","POST","PUT","PATCH","DELETE"]   
###  middleware-cors-headers 
---- 
Allow headers   
Type: list   
Default: ["content-type"]   
###  middleware-cors-expose 
---- 
Expose headers   
Type: list   
###  middleware-cors-max-age 
---- 
Set max-age   
Type: number   
## middleware.csrf
See {@link module:middleware/csrf}
###  middleware-csrf-enable 
---- 
Enable the middlware, 'true' means dynamicaly check all requests, 'fixed' means set routes from the config on start   
###  middleware-csrf-origin-(/.+) 
---- 
Paths to by allowed by origin   
Type: list   
Example:
```
middleware-csrf-origin-/account = http://host.com
middleware-csrf-origin-/account/* = https://host.com,http://localhost
```

###  middleware-csrf-sec-fetch-site-(/.+) 
---- 
Paths to use specific Sec-Fetch-Site header validation by: same-origin, same-site, cross-site, none   
Type: list   
Example:
```
middleware-csrf-sec-fetch-/webhook/* = cross-site
middleware-csrf-sec-fetch-/* = same-origin,same-site
```

###  middleware-csrf-reset 
---- 
Reset all rules   
Type: callback   
###  middleware-csrf-err-(.+) 
---- 
Error messages for various cases   
## middleware.limiter
See {@link module:middleware/limiter}
###  middleware-limiter-enable 
---- 
Enable the middlware, 'true' means dynamicaly check all requests, 'fixed' means set routes from the config on start   
###  middleware-limiter-ip-([a-z,*]+)-(/.+) 
---- 
Endpoints/methods to limit by IP address for all users   
Type: map   
Example:
```
middleware-limiter-*-ip-/account = rate:10,interval:30000
```

###  middleware-limiter-path-([a-z,*]+)-(/.+) 
---- 
Endpoints/methods to limit by path for all users   
Type: map   
Example:
```
middleware-limiter-path-post-/webhook/* = rate:100,interval:30000
```

###  middleware-limiter-user-([a-z,*]+)-(/.+) 
---- 
Endpoints/methods to limit by path and authenticated user   
Type: map   
Example:
```
middleware-limiter-user-get,post,put-/admin/* = rate:10,interval:5000
```

###  middleware-limiter-reset 
---- 
Reset all rules   
Type: callback   
## middleware.multipart
See {@link module:middleware/multipart}
###  middleware-multipart-enable 
---- 
Enable the middlware globally   
Type: bool   
###  middleware-multipart-max-size 
---- 
Max size for uploads in bytes   
Type: number   
Default: 25000000   
###  middleware-multipart-max-(files|fields) 
---- 
Max number of files or fields in uploads   
Type: number   
###  middleware-multipart-timeout 
---- 
Max time in ms to read the body   
Type: number   
###  middleware-multipart-err-(.+) 
---- 
Error messages for various cases   
## middleware.proxy
See {@link module:middleware/proxy}
###  middleware-proxy-host 
---- 
Host where to proxy requests, takes precedence over the path, for direct routing   
Example:
```
middleware-proxy-host = myhost.com
```

###  middleware-proxy-path-(.+) 
---- 
Proxy matched requests by path to given host   
Type: regexp   
Example:
```
middleware-proxy-path-blog.host.com = ^/blog/
middleware-proxy-path-www.host.com = ^/products/
```

## middleware.routing
See {@link module:middleware/routing}
###  middleware-routing-enable 
---- 
Enable the middlware, 'true' means dynamicaly check all requests, 'fixed' means set routes from the config on start   
###  middleware-routing-reset 
---- 
Reset all rules   
Type: callback   
###  middleware-routing-/.+ 
---- 
Paths to be re-routed/redirected   
Example:
```
middleware-routing-/user/get = /user/details
middleware-routing-/old/path = 302/new/path?@SEARCH@
```

## middleware.static
See {@link module:middleware/static}
###  middleware-static-enable 
---- 
Enable the middlware for all folders in 'app.path.web'   
Type: bool   
###  middleware-static-root 
---- 
Root path for files   
###  middleware-static-max-age 
---- 
Max age for files in ms, -1 to disable   
Type: int   
###  middleware-static-no-cache 
---- 
Serve files as non cacheable   
Type: bool   
###  middleware-static-last-modified 
---- 
Serve Last-Modified header to support conditional requests   
Type: bool   
Default: true   
###  middleware-static-index 
---- 
Name of index file to use for default directory requests   
Default: "index.html"   
###  middleware-static-precompressed 
---- 
Match request path to serve pre-compressed files with given encoding or default gzip   
Type: regexp   
###  middleware-static-encoding 
---- 
Compress encoding to use for precompressed files: gzip, br, zstd   
###  middleware-static-etag 
---- 
Produce weak ETag header for static files   
Type: bool   
Default: true   
## middleware.users
See {@link module:middleware/users}
###  middleware-users-enable 
---- 
Enable user session middlware globally for the given list of endpoints   
Type: list   
###  middleware-users-enable-token 
---- 
Enable user API token middlware globally for the given list of endpoints   
Type: list   
###  middleware-users-login-path 
---- 
Endpoint path for the login middleware, method POST   
###  middleware-users-login-redirect 
---- 
Location where to redirect if authentication failed   
###  middleware-users-profile-path 
---- 
Endpoint path for the profile middleware, method GET   
###  middleware-users-logout-path 
---- 
Endpoint path for the logout middleware., method POST   
###  middleware-users-err-(.+) 
---- 
Error messages for various cases   
## middleware.xray
See {@link module:middleware/xray}
###  middleware-xray-path 
---- 
Trace only if request path match   
Type: regexp   
###  middleware-xray-interval 
---- 
Interval in ms how often to trace requests, must be > 0 to enable tracing   
Type: number   
###  middleware-xray-host 
---- 
Host where to send traces   
## push
See {@link module:push}
###  push-config 
---- 
An object with client configs by type   
Type: json   
Example:
```
-push-config {"webpush":{"type":"webpush",key":XXX","pubkey":"XXXX"}}
```

###  push-([a-z0-9]+) 
---- 
A single client type parameters   
Type: map   
Example:
```
-push-webpush type:webpush,key:K,pubkey:PK,email:XXX
```

## queue
See {@link module:queue}
###  queue-config 
---- 
An object with driver configs, an object with at least url or an url string   
Type: json   
Example:
```
-queue-config {"redis":{"url":redis://localhost","count":1},"nats":"nats://localhost:4222"}
```

###  queue-([a-z0-9_]+)-options$ 
---- 
Additional parameters for drivers, specific to each implementation   
Type: map   
Example:
```
-queue-redis-options count:10,interval:100
```

###  queue-([a-z0-9_]+)-options-(.+) 
---- 
Additional parameters for drivers, specific to each implementation   
Example:
```
-queue-default-options-count 10
```

###  queue-([a-z0-9_]+) 
---- 
An URL that points to a server in the format `PROTO://HOST[:PORT]?PARAMS`, multiple clients can be defined with unique names, all params starting with `bk-` will be copied into the options without the prefix and removed from the url, the rest of params will be left in the url   
Example:
```
-queue-redis redis://localhost?bk-count=3&bk-ttl=3000
```

## sendmail
See {@link module:sendmail}
###  sendmail-from 
---- 
Email address to be used when sending emails from the backend   
###  sendmail-transport 
---- 
Send emails via supported transports: ses:, sendgrid:, fake:, file:, json:, if not set default SMTP settings are used   
###  sendmail-smtp 
---- 
SMTP server parameters, user, password, host, ssl, tls...see nodemailer for details   
Type: map   
###  sendmail-options-(.+) 
---- 
Transport specific parameters   
Type: map   
Example:
```
sendmail-options-sendgrid = key:xxxx
sendmail-options-ses = config:cfg1,region:us-west-2
```

## stats
See {@link module:stats}
###  stats-flags 
---- 
Feature flags   
Type: list   
###  stats-interval 
---- 
Interval for process stats collection in ms   
Type: int   
###  stats-target 
---- 
Target options, one of file, url, log...   
Type: json   
###  stats-roles 
---- 
Process roles that report stats only   
Type: list   
Default: []   
###  stats-filter 
---- 
For each metric prefix provide regexp to keep only matched stats   
Type: map   
Example:
```
-stats-filter db:dynamodb
```

