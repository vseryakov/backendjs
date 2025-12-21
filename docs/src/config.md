# Config parameters
- [api](#api)
- [api.access](#api.access)
- [api.acl](#api.acl)
- [api.csrf](#api.csrf)
- [api.files](#api.files)
- [api.images](#api.images)
- [api.passkeys](#api.passkeys)
- [api.redirect](#api.redirect)
- [api.routing](#api.routing)
- [api.session](#api.session)
- [api.signature](#api.signature)
- [api.users](#api.users)
- [api.ws](#api.ws)
- [app](#app)
- [aws](#aws)
- [cache](#cache)
- [db](#db)
- [events](#events)
- [ipc](#ipc)
- [jobs](#jobs)
- [logwatcher](#logwatcher)
- [push](#push)
- [queue](#queue)
- [sendmail](#sendmail)
- [sql](#sql)
- [stats](#stats)
# <a name="api">api</a>
See {@link module:api}
### **api-err-(.+)**
 Error messages for various cases   
### **api-cap-(.+)**
 Capability parameters   
##### Type: int   
### **api-max-request-queue**
 Max number of requests in the processing queue, if exceeds this value server returns too busy error   
##### Type: number   
### **api-timeout**
 HTTP request idle timeout for servers in ms, how long to keep the connection socket open, this does not affect Long Poll requests   
##### Type: number   
##### Default: 30000   
### **api-keep-alive-timeout**
 Number of milliseconds to keep the HTTP conection alive   
##### Type: int   
##### Default: 61000   
### **api-request-timeout**
 Number of milliseconds to receive the entire request from the client   
##### Type: int   
### **api-max-requests-per-socket**
 The maximum number of requests a socket can handle before closing keep alive connection   
##### Type: int   
### **api-port**
 port to listen for the HTTP server, this is global default   
##### Type: number   
##### Default: 8000   
### **api-bind**
 Bind to this address only, if not specified listen on all interfaces   
##### Default: "0.0.0.0"   
### **api-backlog**
 The maximum length of the queue of pending connections, used by HTTP server in listen.   
##### Type: int   
##### Default: 5000   
### **api-reuse-port**
 Allow multiple sockets on the same host to bind to the same port   
##### Type: bool   
### **api-ssl**
 SSL params: port, bind, key, cert, pfx, ca, passphrase, crl, ciphers   
##### Type: map   
##### Default: {"port":443,"bind":"0.0.0.0"}   
### **api-accesslog-disable**
 Disable access logging in both file or syslog   
##### Type: bool   
### **api-accesslog-file**
 File for access logging   
### **api-accesslog-level**
 Syslog level priority, default is local5.info, 21 * 8 + 6   
##### Type: int   
### **api-accesslog-fields**
 Additional fields from the request or user to put in the access log, prefix defines where the field is lcoated: q: - query, h: - headers, u: - user otherwise from the request   
##### Type: list   
##### Example:
```
-api-log-fields h:Referer,u:name,q:action
```

### **api-errlog-max**
 How many error messages to put in the log before throttling kicks in   
##### Type: int   
### **api-errlog-interval**
 Interval for error log limiter, max errors per this interval   
##### Type: int   
### **api-errlog-ignore**
 Do not show errors that match the regexp   
##### Type: regexpobj   
### **api-errlog-codes**
 Error codes in exceptions to return in the response to the user, if not matched the errlog.message will be returned   
##### Type: regexpobj   
### **api-qs-options-(.+)**
 Options to pass to qs when parsing the body: depth, arrayLimit, allowDots, comma, plainObjects, allowPrototypes, parseArrays   
### **api-no-static**
 Disable static files from /web folder, no .js or .html files will be served by the server   
##### Type: bool   
### **api-static-options**
 Options to pass to serve-static module: maxAge, dotfiles, etag, redirect, fallthrough, extensions, index, lastModified   
##### Type: map   
##### Default: {"maxAge":0}   
### **api-vhost-path-([^/]+)**
 Define a virtual host regexp to be matched against the hostname header to serve static content from a different root, a vhost path must be inside the web directory, if the regexp starts with !, that means negative match   
##### Type: regexp   
##### Example:
```
api-vhost-path-test_dir=test.com$
```

### **api-no-vhost-path**
 Add to the list of URL paths that should be served for all virtual hosts   
##### Type: regexpobj   
### **api-query-token-secret**
 Name of the property to be used for encrypting tokens for pagination or other sensitive data, any property from bk_user can be used, if empty no secret is used, if not a valid property then it is used as the secret   
### **api-no-cache-files**
 Set cache-control=no-cache header for matching static files   
##### Type: regexpobj   
### **api-access-token-secret**
 A generic secret to be used for API access or signatures   
### **api-allow-configure-(web|middleware)**
 Modules allowed to call configureWeb or Middleware, i.e. only allowed endpoints   
##### Type: regexp   
### **api-express-options**
 Set Express config options during initialization   
##### Type: json   
##### Default: {}   
##### Example:
```
-api-express-options { "trust proxy": 1, "strict routing": true }
```

### **api-body-methods**
 HTTP methods allowed to have body   
##### Type: list   
##### Default: ["POST","PUT","PATCH"]   
### **api-body-types**
 Collect full request body in the req.body property for the given MIME types in addition to default json/form posts, this is for custom body processing   
##### Type: regexpobj   
### **api-body-raw**
 Do not parse the collected body for the following MIME content types, keep it as a string   
##### Type: regexpobj   
### **api-body-multipart**
 URLs that expect multipart/form-data payloads, parsing will happend after the signature processed   
##### Type: regexpobj   
### **api-mime-map-(.+)**
 File extension to MIME content type mapping, this is used by static-serve   
##### Example:
```
-api-mime-map-mobileconfig application/x-apple-aspen-config
```

### **api-cors-origin**
 Origin header for CORS requests   
##### Default: "*"   
### **api-cors-allow**
 Enable CORS requests if a request host/path matches the given regexp   
##### Type: regexpobj   
### **api-tz-header**
 Name for the timezone offset header a client can send for time sensitive requests, the backend decides how to treat this offset   
##### Default: "bk-tz"   
### **api-server-header**
 Custom Server: header to return for all requests   
### **api-rlimits-([a-z]+)$**
 Default rate limiter parameters, default interval is 1s, `ttl` is to expire old cache entries, message for error   
### **api-rlimits-(rate|max|interval|ttl|ip|delay|multiplier|queue)-(.+)**
 Rate limiter parameters by type for Token Bucket algorithm. `queue` to use specific queue, ttl` is to expire cache entries, `ip` is to limit by IP address as well   
##### Example:
```
api-rlimits-ip-ip=10
api-rlimits-rate-/path=1
api-rlimits-rate-GET/path=1
```

### **api-rlimits-map-(.+)**
 Rate limiter parameters for Token Bucket algorithm. set all at once   
##### Type: map   
##### Example:
```
api-rlimits-map-/url=rate:1,interval:2000
api-rlimits-map-GET/url=rate:10
```

### **api-(query|header|upload)-limit**
 Max size for query/headers/uploads, bytes   
##### Type: number   
### **api-(files|fields)-limit**
 Max number of files or fields in uploads   
##### Type: number   
### **api-limiter-cache**
 Name of a cache for API rate limiting   
##### Default: "local"   
### **api-response-headers**
 An JSON object with list of regexps to match against the location and set response headers defined as a ist of pairs name, value...   
##### Type: regexpmap   
##### Default: []   
##### Example:
```
api-response-headers={ "^/": ["x-frame-options","sameorigin","x-xss-protection","1; mode=block"] }
```

### **api-cleanup-rules-(.+)**
 Rules for the cleanupResult per table, ex. api-cleanup-rules-bk_user=email:0,phone:1   
##### Type: map   
### **api-cleanup-strict**
 Default mode for cleanup results   
##### Type: bool   
### **api-request-cleanup**
 List of fields to explicitely cleanup on request end   
##### Type: list   
##### Default: ["options","user","signature","body","raw_body","trace"]   
### **api-query-defaults-([a-z0-9_]+)-(.+)**
 Global query defaults for getQuery, can be path specific   
##### Example:
```
-api-query-defaults-max-name 128 -api-query-defaults-max-/endpoint-name 255
```

### **api-delays-(.+)**
 Delays in ms by status and code, useful for delaying error responses to slow down brute force attacks   
##### Type: int   
##### Example:
```
-api-delays-401 1000 -api-delays-403:DENY -1
```

### **api-compressed-([^/]+)**
 Match static paths to be returned compressed, files must exist and be pre-compressed with the given extention   
##### Type: regexp   
##### Example:
```
-api-compress-bundle.js gz
```

### **api-restart-hours**
 List of hours when to restart api workers, only done once for each hour   
##### Type: list   
### **api-trace-options**
 Options for tracing, host where to send if not local, path:regexp for URLs to be traced, interval:Interval in ms how often to trace requests, must be > 0 to enable tracing   
##### Type: map   
##### Default: {}   
### **api-exit-on-error**
 Exit on uncaught exception in the route handler   
##### Type: bool   
### **api-restart**
 On address in use error condition restart the specified servers, this assumes an external monitor like monit to handle restarts   
##### Default: "server,web,process"   
### **api-proxy-(.+)**
 Proxy matched requests by path to given host   
##### Type: regexp   
# <a name="api.access">api.access</a>
See {@link module:api.access}
### **api-access-err-(.+)**
 Error messages for various cases   
### **api-access-disabled**
 Disable default security middleware   
##### Type: bool   
# <a name="api.acl">api.acl</a>
See {@link module:api.acl}
### **api-acl-err-(.+)**
 Error messages for various cases   
### **api-acl-add-([a-z0-9_]+)**
 Add URLs to the named ACL which can be used in allow/deny rules per role   
##### Type: regexpobj   
##### Default: {"list":["^/$","\\.htm$","\\.html$","\\.ico$","\\.gif$","\\.png$","\\.jpg$","\\.jpeg$","\\.svg$","\\.ttf$","\\.eot$","\\.woff$","\\.woff2$","\\.js$","\\.css$","^/js/","^/css/","^/img","^/webfonts/","^/public/","^/ping","^/counter"],"rx":{}}   
##### Example:
```
-api-acl-add-admins ^/admin
```

### **api-acl-deny-([a-z0-9_]+)**
 Match all regexps from the specified acls to deny access for the specified role   
##### Type: list   
##### Example:
```
-api-acl-deny-user admins,billing
```

### **api-acl-allow-([a-z0-9_]+)**
 Match all regexps from the specified acls for allow access for the specified role   
##### Type: list   
##### Example:
```
-api-acl-allow-staff admins,support,-billing
```

### **api-acl-public**
 Match all regexps from the specified acls for public access   
##### Type: list   
##### Default: ["public"]   
##### Example:
```
-api-acl-public pub,docs,-intdocs
```

### **api-acl-anonymous**
 Match all regexps from the specified acls to allow access with or without authentication   
##### Type: list   
##### Example:
```
-api-acl-anonymous pub,docs
```

### **api-acl-authenticated**
 Match all regexps from the specified acls to allow access only with authentication any role   
##### Type: list   
##### Example:
```
-api-acl-authenticated stats,profile
```

### **api-acl-reset**
 Reset all rules   
##### Type: callback   
# <a name="api.csrf">api.csrf</a>
See {@link module:api.csrf}
### **api-csrf-err-(.+)**
 Error messages for various cases   
### **api-csrf-set-path**
 Regexp for URLs to set CSRF token for all methods, token type(user|pub) is based on the current session   
##### Type: regexpobj   
##### Default: {}   
### **api-csrf-pub-path**
 Regexp for URLs to set public CSRF token only if no valid CSRF token detected   
##### Type: regexpobj   
### **api-csrf-check-path**
 Regexp for URLs to set CSRF token for skip methods and verify for others   
##### Type: regexpobj   
##### Default: {}   
### **api-csrf-skip-method**
 Do not check for CSRF token for specified methods   
##### Type: regexp   
##### Default: {}   
### **api-csrf-skip-status**
 Do not return CSRF token for specified status codes   
##### Type: regexp   
##### Default: {}   
### **api-csrf-header**
 Name for the CSRF header   
##### Default: "bk-csrf"   
### **api-csrf-secret**
 Secret for encryption   
### **api-csrf-age**
 CSRF token age in milliseconds   
##### Type: int   
##### Default: 3600000   
### **api-csrf-same-site**
 Session SameSite option, for cookie based authentication   
##### Default: "strict"   
### **api-csrf-secure**
 Set cookie Secure flag   
##### Type: bool   
##### Default: true   
# <a name="api.files">api.files</a>
See {@link module:api.files}
### **api-files-raw**
 Return raw urls for the files, requires files-url to be configured. The path will reflect the actual 2 level structure and user id in the file name   
##### Type: bool   
### **api-files-url**
 URL where files are stored, for cases of central file server(s), must be full URL with optional path   
### **api-files-s3**
 S3 bucket name where to store files uploaded with the File API   
### **api-files-path**
 Path to store files   
# <a name="api.images">api.images</a>
See {@link module:api.images}
### **api-images-url**
 URL where images are stored, for cases of central image server(s), must be full URL with optional path   
### **api-images-s3**
 S3 bucket name where to store and retrieve images   
### **api-images-raw**
 Return raw urls for the images, requires images-url to be configured. The path will reflect the actual 2 level structure and user id in the image name   
##### Type: bool   
### **api-images-s3-options**
 S3 options to sign images urls, may have expires:, key:, secret: properties   
##### Type: json   
### **api-images-ext**
 Default image extension to use when saving images   
##### Default: "jpg"   
### **api-images-mod**
 Images scaling module, sharp   
### **api-images-path**
 Path to store images   
# <a name="api.passkeys">api.passkeys</a>
See {@link module:api.passkeys}
### **api-passkeys-err-(.+)**
 Error messages for various cases   
### **api-passkeys-cap-(.+)**
 Capability parameters   
##### Type: int   
### **api-passkeys-path**
 Cookies path   
##### Default: "/passkey/"   
### **api-passkeys-secret**
 Cookies secret   
### **api-passkeys-cache**
 Cache for challenges   
### **api-passkeys-domain**
 Explicit domain to use instead of host   
# <a name="api.redirect">api.redirect</a>
See {@link module:api.redirect}
### **api-redirect-err-(.+)**
 Error messages for various cases   
### **api-redirect-url**
 Add to the list a JSON object with property name defining a location regexp to be matched early against in order to redirect using the value of the property, if the regexp starts with !, that means it must be removed from the list, variables can be used for substitution: @HOST@, @PATH@, @URL@, @BASE@, @DIR@, @QUERY@, status code can be prepended to the location   
##### Type: regexpmap   
##### Example:
```
{ '^[^/]+/path/$': '/path2/index.html', '.+/$': '301:@PATH@/index.html' }
```

### **api-redirect-login-(.+)**
 Define a location where to redirect if no login is provided, same format and placeholders as in redirect-url   
##### Type: regexpobj   
##### Example:
```
api-redirect-login-^/admin/=/login.html
```

### **api-redirect-reset**
 Reset all rules   
##### Type: callback   
# <a name="api.routing">api.routing</a>
See {@link module:api.routing}
### **api-routing-err-(.+)**
 Error messages for various cases   
### **api-routing-path-(.+)**
 Locations to be re-routed to other path, this is done inside the server at the beginning, only the path is replaced, same format and placeholders as in redirect-url, use ! in front of regexp to remove particular redirect from the list   
##### Type: regexpobj   
##### Example:
```
-api-routing-path-^/user/get /user/read
```

### **api-routing-auth-(.+)**
 URL path to be re-routed to other path after the authentication is successful, this is done inside the server, only the path is replaced, same format and placeholders as in redirect-url   
##### Type: regexpobj   
##### Example:
```
-api-routing-auth-^/user/get /user/read
```

### **api-routing-reset**
 Reset all rules   
##### Type: callback   
# <a name="api.session">api.session</a>
See {@link module:api.session}
### **api-session-disabled**
 Disable cookie session support, all requests must be signed for Web clients   
##### Type: bool   
### **api-session-cache**
 Cache name for session control   
### **api-session-age**
 Session age in milliseconds, for cookie based authentication   
##### Type: int   
##### Default: 1209600000   
### **api-session-same-site**
 Session SameSite option, for cookie based authentication   
##### Default: "strict"   
### **api-session-secure**
 Set cookie Secure flag   
##### Type: bool   
##### Default: true   
### **api-session-cookie-(.+)**
 Cookie values for requests that match beginning of the path   
##### Type: map   
##### Example:
```
-api-session-cookie-/testing secure:false,sameSite:None
```

# <a name="api.signature">api.signature</a>
See {@link module:api.signature}
### **api-signature-header**
 Header name to sotee signature   
##### Default: "bk-signature"   
### **api-signature-age**
 Max age for request signature in milliseconds, how old the API signature can be to be considered valid, the 'expires' field in the signature must be less than current time plus this age, this is to support time drifts   
##### Type: int   
### **api-signature-max-length**
 Max login and tag length   
##### Type: int   
##### Default: 140   
# <a name="api.users">api.users</a>
See {@link module:api.users}
### **api-users-table**
 Table to use for users   
##### Default: "bk_user"   
### **api-users-err-(.+)**
 Error messages for various cases   
### **api-users-cap-(.+)**
 Capability parameters   
##### Type: int   
### **api-users-max-length**
 Max login and name length   
##### Type: int   
##### Default: 140   
### **api-users-users**
 An object with users   
##### Type: json   
##### Default: {}   
### **api-users-file**
 A JSON file with users   
# <a name="api.ws">api.ws</a>
See {@link module:api.ws}
### **api-ws-port**
 Port to listen for WebSocket server, it can be the same as HTTP/S ports to co-exist on existing web servers   
##### Type: number   
### **api-ws-bind**
 Bind to this address only for WebSocket, if not specified listen on all interfaces, only when the port is different from existing web ports   
##### Default: "0.0.0.0"   
### **api-ws-ping**
 How often to ping Websocket connections   
##### Type: number   
##### Default: 30000   
### **api-ws-path**
 Websockets will be accepted only if request matches this pattern   
##### Type: regexp   
### **api-ws-origin**
 Websockets will be accepted only if request Origin: header maches the pattern   
##### Type: regexp   
### **api-ws-queue**
 A queue where to publish messages for websockets, API process will listen for messages and proxy it to all macthing connected websockets    
# <a name="app">app</a>
See {@link module:app}
### **app-log**
 Set debugging level to any of DEV,DEBUG,INFO,LOG,WARN,ERROR,NONE   
##### Type: callback   
### **app-log-options**
 Update logger options, the format is a map: name:val,...   
##### Type: map   
### **app-log-file**
 Log to a file, if not specified used default logfile, disables syslog   
##### Type: callback   
### **app-log-ignore**
 Regexp with property names which must not be exposed in the log when using custom logger inspector   
##### Type: regexp   
### **app-log-inspect**
 Install custom secure logger inspection instead of util.inspect   
##### Type: callback   
##### Default: {"depth":7,"count":200,"keys":50,"func":0,"keepempty":1,"length":1024,"replace":{" ":{}},"ignore":{}}   
### **app-log-inspect-map**
 Properties for the custom log inspect via objDescr   
##### Type: map   
### **app-log-filter**
 Enable debug filters, format is: label,... to enable, and !label,... to disable. Only first argument is used for label in logger.debug   
##### Type: callback   
### **app-no-log-filter**
 Clear all log filters   
##### Type: bool   
### **app-syslog**
 Log messages to syslog, pass 0 to disable, 1 or url (tcp|udp|unix):[//host:port][/path]?[facility=F][&tag=T][&retryCount=N][&bsd=1][&rfc5424=1][&rfc3164=1]...   
##### Type: callback   
### **app-console**
 All logging goes to the console resetting all previous log related settings, this is used in the development mode mostly   
##### Type: callback   
### **app-home**
 Specify home directory for the server, the server will try to chdir there or exit if it is not possible, the directory must exist   
##### Type: callback   
##### Default: "/Users/vlad/src/backendjs"   
### **app-config**
 Name of the config file to be loaded, can be relative or absolute path   
##### Type: path   
##### Default: "bkjs.conf"   
### **app-tmp-dir**
 Path where to keep temp files   
##### Type: path   
##### Default: "/tmp"   
### **app-path-web**
 Add a path where to keep web pages and other static files to be served by the web servers   
##### Type: path   
### **app-path-views**
 Add a path where to keep Express render templates and virtual hosts web pages, every subdirectory name is a host name to match with Host: header, www. is always stripped before matching vhost directory   
##### Type: path   
### **app-path-modules**
 Add a path from where to load modules, these are the backendjs modules but in the same format and same conventions as regular node.js modules. The modules can load any other files or directories, this is just an entry point   
##### Type: path   
### **app-role**
 Override primary server role   
##### Type: callback   
##### Default: "shell"   
### **app-salt**
 Set random or specific salt value to be used for consistent suuid generation   
##### Type: callback   
### **app-version**
 Set app name/version explicitely and skip reading it from the package.json   
##### Default: "bkjs/0.0"   
### **app-instance-([a-z0-9_-]+)**
 Set instance properties explicitly: tag, region, zone, roles   
### **app-run-mode**
 Running mode for the app, used to separate different running environment and configurations   
##### Default: "dev"   
### **app-daemon**
 Daemonize the process, go to the background, can be specified only in the command line   
##### Type: none   
### **app-shell**
 Run command line shell, load the backend into the memory and prompt for the commands, can be specified only in the command line   
##### Type: none   
### **app-server**
 Start the server server, can be specified only in the command line, this process handles job schedules and starts Web server in separate process, keeps track of failed processes and restarts them   
##### Type: none   
### **app-worker**
 Set this process as a worker even it is actually a primary, this skips some initializations   
##### Type: bool   
### **app-no**
 List of subsystems to disable instead of using many inidividual -no-NNN parameters   
##### Type: callback   
### **app-no-([a-z]+)**
 Do not start or disbale a service, server, web, jobs, ipc, db, dbconf, watch, modules, packages, configure   
##### Type: callback   
### **app-ok-(.+)**
 Enable disabled service, opposite of -no   
##### Type: callback   
### **app-repl-port-([a-z]+)$**
 Base REPL port for process role (server, web, worker), if specified it initializes REPL in the processes, for workers the port is computed by adding a worker id to the base port, for example if specified `-repl-port-web 2090` then a web worker will use any available 2091,2092...   
##### Type: number   
### **app-repl-([a-z]+)**
 REPL settings: listen, file, size   
##### Type: auto   
### **app-import-packages**
 NPM packages to load on startup, the modules, views, web subfolders from the package will be added automatically to the system paths, modules will be loaded if present, the bkjs.conf will be parsed if present   
##### Type: list   
##### Default: []   
### **app-include-modules**
 Modules to load, the whole path is checked   
##### Type: regexp   
### **app-exclude-modules**
 Modules not to load, the whole path is checked   
##### Type: regexp   
### **app-depth-modules**
 How deep to go looking for modules, it uses lib.findFileSync to locate all .js files   
##### Type: int   
##### Default: 3   
### **app-host-name**
 Hostname/domain to use for communications, default is current domain of the host machine   
##### Type: callback   
### **app-stop-on-error**
 Exit the process on any error when loading modules, for dev purposes   
##### Type: bool   
### **app-allow-methods-(.+)**
 Modules that allowed to run methods by name, useful to restrict configure methods   
##### Type: regexp   
##### Example:
```
-allow-methods-configureWeb app
```

### **app-workers**
 Max number of web processes to launch, -1 disables workers, 0 means launch as many as the CPUs available`   
##### Type: int   
##### Default: 1   
### **app-worker-cpu-factor**
 A number to multiply the number of CPUs available to make the total number of workers to launch, only used if `workers` is 0   
##### Type: real   
##### Default: 2   
### **app-worker-args**
 Node arguments for workers, job and web processes, for passing v8 options, use %20 for spaces   
##### Type: list   
##### Default: []   
### **app-worker-delay**
 Delay in milliseconds for a web worker before it will start accepting requests, for cases when other dependencies may take some time to start   
##### Type: int   
### **app-no-restart**
 Do not restart any workers   
##### Type: bool   
### **app-exit-on-empty**
 Duration in ms to exit the server process after last worker terminated   
##### Type: int   
### **app-pid-file**
 server process pid file   
### **app-err-file**
 Server error log file in daemon mode   
# <a name="aws">aws</a>
See {@link module:aws}
### **aws-key**
 AWS access key   
### **aws-secret**
 AWS access secret   
### **aws-token**
 AWS security token   
### **aws-region**
 AWS region   
### **aws-zone**
 AWS availability zone   
### **aws-meta**
 Retrieve instance metadata, 0 to disable   
##### Type: bool   
##### Default: 1   
### **aws-sdk-profile**
 AWS SDK profile to use when reading credentials file   
### **aws-sns-app-arn**
 SNS Platform application ARN to be used for push notifications   
### **aws-key-name**
 AWS instance keypair name for remote job instances or other AWS commands   
### **aws-target-group**
 AWS ELB target group to be registered with on start up or other AWS commands   
### **aws-elastic-ip**
 AWS Elastic IP to be associated on start   
### **aws-host-name**
 List of hosts to update in Route54 zone with the current private IP address, hosts must be in FQDN format, supports @..@ app.instance placeholders   
##### Type: list   
### **aws-iam-profile**
 IAM instance profile name for instances or commands   
### **aws-image-id**
 AWS image id to be used for instances or commands   
### **aws-subnet-id**
 AWS subnet id to be used for instances or commands   
### **aws-vpc-id**
 AWS VPC id to be used for instances or commands   
### **aws-group-id**
 AWS security group(s) to be used for instances or commands   
### **aws-public-ip**
 AWS public IP option for instances or commands   
##### Type: bool   
### **aws-ecs-cluster**
 AWS ECS cluster to use as default   
### **aws-instance-type**
 AWS instance type to launch on demand   
### **aws-metadata-options**
 Default instance metadata options   
##### Type: list   
### **aws-account-id**
 AWS account id if not running on an instance   
### **aws-eni-id**
 AWS Elastic Network Interfaces to attach on start, format is: eni[:index],eni...   
##### Type: list   
### **aws-config-parameters**
 Prefix for AWS Config Parameters Store to load and parse as config before initializing the database pools   
##### Example:
```
/bkjs/config/
```

### **aws-set-parameters**
 AWS Config Parameters Store to set on start, supports @..@ app.instance placeholders: format is: path:value,....   
##### Type: list   
### **aws-conf-file**
 S3 url for config file to download on start   
### **aws-conf-file-interval**
 Load S3 config file every specified interval in minites   
##### Type: int   
# <a name="cache">cache</a>
See {@link module:cache}
### **cache-config**
 An object with driver configs, an object with at least url or an url string   
##### Type: json   
##### Example:
```
-cache-config {"redis":{"url":redis://localhost","count":1},"nats":"nats://localhost:4222"}
```

### **cache-([a-z0-9]+)-options$**
 Additional parameters for clients, specific to each implementation   
##### Type: map   
##### Example:
```
-cache-redis-options count:10,interval:100
```

### **cache-([a-z0-9]+)-options-(.+)**
 Additional parameters for clients, specific to each implementation   
##### Example:
```
-cache-default-options-count 10
```

### **cache-([a-z0-9]+)**
 An URL that points to a cache server in the format `PROTO://HOST[:PORT]?PARAMS`, multiple clients can be defined with unique names, all params starting with `bk-` will be copied into the options without the prefix and removed from the url, the rest of params will be left in the url   
##### Example:
```
-cache-redis redis://localhost?bk-count=3&bk-ttl=3000
```

# <a name="db">db</a>
See {@link module:db}
### **db-cap-(.+)**
 Capability parameters   
##### Type: int   
### **db-none**
 disable all db pools   
##### Type: bool   
### **db-pool**
 Default pool to be used for db access without explicit pool specified   
##### Default: "sqlite"   
### **db-name**
 Default database name to be used for default connections in cases when no db is specified in the connection url   
##### Default: "db"   
### **db-create-tables**
 Create tables in the database or perform table upgrades for new columns in all pools, only shell or server process can perform this operation   
##### Type: bool   
##### Default: true   
### **db-create-tables-roles**
 Only processes with these roles can create tables   
##### Type: list   
##### Default: ["web"]   
### **db-cache-tables**
 List of tables that can be cached: bk_user, bk_counter. This list defines which DB calls will cache data with currently configured cache. This is global for all db pools.   
##### Type: list   
##### Default: []   
### **db-skip-tables**
 List of tables that will not be created or modified, this is global for all pools   
##### Type: list   
### **db-skip-pools**
 List of pools to be skipped during initialization   
##### Type: list   
### **db-cache-pools**
 List of pools which trigger cache flushes on update.   
##### Type: list   
##### Default: []   
### **db-cache-sync**
 List of tables that perform synchronized cache updates before returning from a DB call, by default cache updates are done in the background   
##### Type: list   
##### Default: []   
### **db-cache-keys-([a-z0-9_]+)-(.+)**
 List of columns to be used for the table cache, all update operations will flush the cache if the cache key can be created from the record columns. This is for ad-hoc and caches to be used for custom selects which specified the cache key.   
##### Type: list   
### **db-describe-tables**
 A JSON object with table descriptions to be merged with the existing definitions   
##### Type: callback   
### **db-cache-ttl-(.+)**
 TTL in milliseconds for each individual table being cached, use * as default for all tables   
##### Type: int   
### **db-cache-name-(.+)**
 Cache client name to use for cache reading and writing for each table instead of the default in order to split cache usage for different tables, it can be just a table name or `pool.table`, use `*` to set default cache for all tables   
### **db-cache-update-(.+)**
 Cache client name to use for updating only for each table instead of the default in order to split cache usage for different tables, it can be just a table name or `pool.table` or `*`. This cache takes precedence for updating cache over `cache-name` parameter   
### **db-cache2-max**
 Max number of items to keep in the LRU Level 2 cache   
##### Type: int   
### **db-cache2-(.+)**
 Tables with TTL for level2 cache, i.e. in the local process LRU memory. It works before the primary cache and keeps records in the local LRU cache for the given amount of time, the TTL is in ms and must be greater than zero for level 2 cache to work   
##### Type: int   
### **db-custom-column-([a-zA-Z0-9_]+)-(.+)**
 A column that is allowed to be used in any table, the name is a column name regexp with the value to be a type   
##### Example:
```
-db-custom-column-bk_user-^stats=counter
```

### **db-describe-column-([a-z0-9_]+)-([a-zA-Z0-9_]+)**
 Describe a table column properties, can be a new or existing column, overrides existing property   
##### Type: map   
##### Example:
```
-db-describe-column-bk_user-name max:255
```

### **db-config**
 Configuration database pool to be used to retrieve config parameters from the database, must be defined to use remote db for config parameters, set to `default` to use current default pool   
### **db-config-map**
 Config options: `.interval` between loading configuration from the database configured with -db-config, in minutes, 0 disables refreshing config from the db, `.count` max records to load in one select, see the docs about `.top`, `.main`, `.other` config parameters   
##### Type: map   
##### Default: {"count":1000,"interval":1440,"top":"runMode","main":"role,roles,tag","other":"role"}   
### **db-skip-drop**
 A pattern of table names which will skipp in db.drop operations to prevent accidental table deletion   
##### Type: regexpobj   
### **db-aliases-(.+)**
 Table aliases to be used instead of the requested table name, only high level db operations will use it, al low level utilities use the real table names   
### **db-concurrency**
 How many simultaneous tasks to run at the same time inside one process   
##### Type: number   
##### Default: 2   
### **db-([a-z0-9]+)-pool**
 A database pool name, depending on the driver it can be an URL, name or pathname   
##### Default: "counter"   
##### Example:
```
`-db-pg-pool`
`-db-dynamodb-pool`
url format: `protocol://[user:password@]hostname[:port]/dbname`
`default`
```

### **db-([a-z0-9]+)-pool-(disabled)**
 Disable the specified pool but keep the configuration   
##### Type: bool   
### **db-([a-z0-9]+)-pool-(max)**
 Max number of open connections for a pool, default is Infinity   
##### Type: number   
### **db-([a-z0-9]+)-pool-(min)**
 Min number of open connections for a pool   
##### Type: number   
### **db-([a-z0-9]+)-pool-(idle)**
 Number of ms for a db pool connection to be idle before being destroyed   
##### Type: number   
### **db-([a-z0-9]+)-pool-(tables)**
 Tables to be created only in this pool, to prevent creating all tables in every pool   
##### Type: list   
### **db-([a-z0-9]+)-pool-connect**
 Connect options for a DB pool driver for new connection, driver specific   
##### Type: map   
### **db-([a-z0-9]+)-pool-options**
 General options for a DB pool, a simple map case   
##### Type: map   
### **db-([a-z0-9]+)-pool-options-([a-zA-Z0-9_.-]+)$**
 General options for a DB pool by name with specific type   
### **db-([a-z0-9]+)-pool-table-map**
 Table mapping, aliases   
##### Type: map   
### **db-([a-z0-9]+)-pool-(create-tables)**
 Create tables for this pool on startup   
##### Type: bool   
### **db-([a-z0-9]+)-pool-(skip-tables)**
 Tables not to be created in this pool   
##### Type: list   
### **db-([a-z0-9]+)-pool-(metrics-tables)**
 Tables to collect metrics in this pool   
##### Type: list   
### **db-([a-z0-9]+)-pool-cache2-(.+)**
 Level 2 cache TTL for the specified pool and table, data is JSON strings in the LRU cache   
##### Type: int   
### **db-([a-z0-9]+)-pool-alias**
 Pool alias to refer by an alternative name   
# <a name="events">events</a>
See {@link module:events}
### **events-worker-queue-(.+)**
 Queues to subscribe for workers, same queues can be used at the same time with different functions and channels and consumers, event queue format is `queue#channel@consumer`   
##### Type: list   
##### Example:
```
-events-worker-queue-ticket ticket.processEvents, -events-worker-queue-ticket#inbox@staff ticket.processInboxEvents, -events-worker-queue-ticket@staff ticket.processStaffEvents
```

### **events-worker-options-(.+)**
 Custom parameters by queue name, passed to `queue.listen` on worker start, useful with channels   
##### Type: map   
##### Example:
```
-events-worker-options-ticket count:3,raw:1
```

### **events-worker-delay**
 Delay in milliseconds for a worker before it will start accepting jobs, for cases when other dependencies may take some time to start   
##### Type: int   
### **events-max-runtime**
 Max number of seconds an event processing can run before being killed   
##### Type: int   
##### Default: 60   
### **events-routing**
 Routing map by event subject or type   
##### Type: map   
##### Default: {}   
##### Example:
```
-events-routing redis:local.+,nats:.+,sqs:billing.+
```

### **events-routing-options-(.+)**
 Routing options by queue name, used by `putEvent` to merge with passed queue options   
##### Type: map   
##### Example:
```
-events-routing-options-sqs groupKey:id
```

### **events-shutdown-timeout**
 Max number of milliseconds to wait for the graceful shutdown sequence to finish, after this timeout the process just exits   
##### Type: int   
##### Default: 50   
# <a name="ipc">ipc</a>
See {@link module:ipc}
### **ipc-ping**
 Keep alive pings for workers: interval:ms how oftern do pings, kill:ms kill worker after this period   
##### Type: map   
##### Default: {}   
### **ipc-system-queue**
 System queue name to send broadcast control messages, this is a PUB/SUB queue to process system messages like restart, re-init config,...   
# <a name="jobs">jobs</a>
See {@link module:jobs}
### **jobs-cap-(.+)**
 Capability parameters   
##### Type: int   
### **jobs-workers**
 How many worker processes to launch to process the job queue, -1 disables jobs, 0 means launch as many as the CPUs available   
##### Type: number   
##### Default: -1   
### **jobs-worker-cpu-factor**
 A number to multiply the number of CPUs available to make the total number of workers to launch, only used if `workers` is 0   
##### Type: real   
##### Default: 2   
### **jobs-worker-env**
 Environment to be passed to the worker via fork, see `cluster.fork`   
##### Type: map   
##### Default: {}   
### **jobs-worker-settings**
 Worker fork setting, see cluster.setupPrimary   
##### Type: json   
### **jobs-worker-delay**
 Delay in milliseconds for a worker before it will start accepting jobs, for cases when other dependencies may take some time to start   
##### Type: int   
##### Default: 50   
### **jobs-worker-queue**
 Queue(s) to subscribe for workers, multiple queues can be processes at the same time, i.e. more than one job can run from different queues   
##### Type: list   
##### Default: []   
### **jobs-worker-options-(.+)**
 Custom parameters by queue name, passed to `queue.subscribeQueue` on worker start, useful with channels   
##### Type: json   
##### Example:
```
-jobs-worker-options-nats#events {"count":10}
```

### **jobs-max-runtime**
 Max number of seconds a job can run before being killed   
##### Type: int   
##### Default: 900   
### **jobs-max-lifetime**
 Max number of seconds a worker can live, after that amount of time it will exit once all the jobs are finished, 0 means indefinitely   
##### Type: int   
##### Default: 43200   
### **jobs-shutdown-timeout**
 Max number of milliseconds to wait for the graceful shutdown sequence to finish, after this timeout the process just exits   
##### Type: int   
##### Default: 50   
### **jobs-cron-queue**
 Default queue to use for cron jobs   
##### Type: list   
### **jobs-global-queue**
 Default queue for all jobs, the queueName is ignored   
##### Type: list   
### **jobs-global-ignore**
 Queue names which ignore the global setting, the queueName is used as usual, local and worker are ignored by default   
##### Type: list   
##### Default: ["local","worker"]   
### **jobs-cron**
 Allow cron jobs to be executed from the local etc/crontab file or via config parameter   
##### Type: bool   
### **jobs-cron-file**
 File with cron jobs in JSON format   
### **jobs-schedule**
 Cron jobs to be scheduled, the JSON must be in the same format as crontab file, cron format by https://croner.56k.guru   
##### Type: json   
### **jobs-unique-cache**
 Default cache name to use for keeping track of unique jobs   
### **jobs-unique-ignore**
 Ignore all unique parameters if a job's uniqueKey matches   
##### Type: regexp   
### **jobs-unique-set-ttl-([0-9]+)**
 Override unique TTL to a new value if matches the unique key   
##### Type: regexp   
##### Example:
```
-jobs-unique-ttl-100 KEY
```

### **jobs-unique-logger**
 Log level for unique error conditions   
### **jobs-retry-visibility-timeout**
 Visibility timeout by error code >= 500 for queues that support it   
##### Type: map   
### **jobs-task-ignore**
 Ignore matched tasks   
##### Type: regexp   
# <a name="logwatcher">logwatcher</a>
See {@link module:logwatcher}
### **logwatcher-pool**
 DB pool to keep track of positions for log files, default is local   
### **logwatcher-table**
 DB table to keep positions, must have name and value columns   
### **logwatcher-from**
 Email address to send logwatcher notifications from, for cases with strict mail servers accepting only from known addresses   
### **logwatcher-subject**
 Email subject template, all placeholders have access to the core module only   
##### Default: "logwatcher: @counter@ @type@s: @hostname@/@ipaddr@/@instance.id@/@instance.tag@/@runMode@/@instance.region@"   
### **logwatcher-interval**
 How often to check for errors in the log files in seconds, 0 to disable   
##### Type: number   
### **logwatcher-any-range**
 Number of lines for matched channel `any` to be attached to the previous matched channel, if more than this number use the channel `any` on its own   
##### Type: number   
##### Default: 5   
### **logwatcher-matches-[a-z]+**
 Regexp patterns that match conditions for logwatcher notifications, this is in addition to default backend logger patterns, suffix defines the log channel to use, like error, warning.... Special channel `any` is reserved to send matched lines to the previously matched channel if within configured range. Example: `-logwatcher-match-error=^failed:` `-match-any=line:[0-9]+`   
### **logwatcher-send-[a-z]+**
 Email address or other supported transport for the logwatcher notifications, the monitor process scans system and backend log files for errors and sends them to this email address, if not specified no log watching will happen, each channel must define a transport separately, one of error, warning, info, all. Supported transports: table://TABLE, http://URL, sns://ARN, ses://EMAIL, email@addr. Example: `-logwatcher-send-error=help@error.com`   
### **logwatcher-ignore-[a-z]+**
 Regexp with patterns that need to be ignored by the logwatcher process, it is added to the list of existing patterns for each specified channel separately   
### **logwatcher-once-[a-z0-9]+**
 Regexp with patterns that need to be included only once by the logwatcher process, it is added to the list of existng patterns by tag to keep track each pattern separately, example: -logwatcher-once-restart 'restarting.+' -logwatcher-once-recon 'reconnecting:.+'   
### **logwatcher-files(-[a-z]+)?**
 Add a file to be watched by the logwatcher, it will use all configured match patterns   
##### Type: callback   
### **logwatcher-local**
 Save matched lines in local file, ex. file:filename, size:maxsize, ext:ext   
##### Type: map   
##### Default: {"newline":1,"size":104857600}   
### **logwatcher-cw-run**
 Run AWS Cloudwatch logwatcher   
##### Type: bool   
### **logwatcher-cw-filter**
 AWS Cloudwatch Logs filter pattern, only matched events will be returned and analyzed the the core logwatcher regexps   
### **logwatcher-cw-groups**
 List of AWS Cloudwatch Logs groups to watch for errors, format is: name:type,...   
##### Type: map   
##### Default: {}   
### **logwatcher-cw-filters-(.+)**
 AWS Cloudwatch Logs filter pattern by group, overrides the global filter   
### **logwatcher-cw-matches-(.+)**
 Logwatcher line regexp patterns by group, overrides default regexp patterns   
##### Type: regexp   
# <a name="push">push</a>
See {@link module:push}
### **push-config**
 An object with client configs", example: "-push-config {"wp":{"type":"wp",key":XXX","pubkey":"XXXX"}}   
##### Type: json   
### **push-([a-z0-9]+)**
 A client parameters   
##### Type: map   
##### Example:
```
-push-wp type:wp,key:K,pubkey:PK,email:XXX
```

# <a name="queue">queue</a>
See {@link module:queue}
### **queue-config**
 An object with driver configs, an object with at least url or an url string   
##### Type: json   
##### Example:
```
-queue-config {"redis":{"url":redis://localhost","count":1},"nats":"nats://localhost:4222"}
```

### **queue-([a-z0-9]+)-options$**
 Additional parameters for drivers, specific to each implementation   
##### Type: map   
##### Example:
```
-queue-redis-options count:10,interval:100
```

### **queue-([a-z0-9]+)-options-(.+)**
 Additional parameters for drivers, specific to each implementation   
##### Example:
```
-queue-default-options-count 10
```

### **queue-([a-z0-9]+)**
 An URL that points to a server in the format `PROTO://HOST[:PORT]?PARAMS`, multiple clients can be defined with unique names, all params starting with `bk-` will be copied into the options without the prefix and removed from the url, the rest of params will be left in the url   
##### Example:
```
-queue-redis redis://localhost?bk-count=3&bk-ttl=3000
```

# <a name="sendmail">sendmail</a>
See {@link module:sendmail}
### **sendmail-from**
 Email address to be used when sending emails from the backend   
### **sendmail-transport**
 Send emails via supported transports: ses:, sendgrid://?key=SG, if not set default SMTP settings are used   
### **sendmail-sendgrid-key**
 SendGrid API key   
### **sendmail-smtp**
 SMTP server parameters, user, password, host, ssl, tls...see nodemailer for details   
##### Type: map   
# <a name="sql">sql</a>
See {@link module:sql}
### **sql-config-(.+)**
 Common SQL config parameters   
##### Type: map   
# <a name="stats">stats</a>
See {@link module:stats}
### **stats-flags**
 Feature flags   
##### Type: list   
### **stats-interval**
 Interval for process stats collection in ms   
##### Type: int   
### **stats-target**
 Target options, one of file, url, log...   
##### Type: json   
### **stats-roles**
 Process roles that report stats only   
##### Type: list   
##### Default: []   
### **stats-filter**
 For each metric prefix provide regexp to keep only matched stats   
##### Type: map   
##### Example:
```
-stats-filter db:dynamodb
```

