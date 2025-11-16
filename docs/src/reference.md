# Reference

# Cache configurations

Database layer support caching of the responses using `db.getCached` call, it retrieves exactly one record from the configured cache, if no record exists it
will pull it from the database and on success will store it in the cache before returning to the client. When dealing with cached records, there is a special option
that must be passed to all put/update/del database methods in order to clear local cache, so next time the record will be retrieved with new changes from the database
and refresh the cache, that is `{ cached: true }` can be passed in the options parameter for the db methods that may modify records with cached contents. In any case
it is required to clear cache manually there is `db.clearCache` method for that.

Also there is a configuration option `-db-caching` to make any table automatically cached for all requests.

## Local
If no cache is configured the local driver is used, it keeps the cache on the master process in the LRU pool and any worker or Web process
communicate with it via internal messaging provided by the `cluster` module. This works only for a single server.

## Redis
Set `cache-NAME=redis://HOST[:PORT]` that points to the server running Redis server.

The config option `max_attempts` defines maximum number of times to reconnect before giving up. Any other `node-redis` module parameter can be passed as well in
the options or url, the system supports special parameters that start with `bk-`, it will extract them into options automatically.

For example:

    cache-default=redis://host1?bk-max_attempts=3
    cache-backup=redis://host2
    cache-backup-options-max_attempts=3


# PUB/SUB or Queue configurations

## Redis system bus

If configured all processes subscribe to it and listen for system messages, it must support PUB/SUB and does not need to be reliable. Websockets
in the API server also use the system bus to send broadcasts between multiple api instances.

    queue-system=redis://
    ipc-system-queue=system


## Redis Queue
To configure the backend to use Redis for job processing set `cache-redis=redis://HOST` where HOST is IP address or hostname of the single Redis server.
This driver implements reliable Redis queue, with `visibilityTimeout` config option works similar to AWS SQS.

Once configured, then all calls to `jobs.submitJob` will push jobs to be executed to the Redis queue, starting somewhere a backend master
process with `-jobs-workers 2` will launch 2 worker processes which will start pulling jobs from the queue and execute.

The naming convention is that any function defined as `function(options, callback)` can be used as a job to be executed in one of the worker processes.

An example of how to perform jobs in the API routes:

```javascript

    app.describeArgs('app', [
        { name: "queue", descr: "Queue for jobs" },
    ]);
    app.queue = "somequeue";

    app.processUsers = function(options, callback) {
        db.select("bk_user", { type: options.type || "user" }, (err, rows) => {
          ...
          callback();
        });
    }

    api.all("/process/users", (req, res) => {
        jobs.submitJob({ job: { "app.processUsers": { type: req.query.type } } }, { queueName: app.queue }, (err) => {
            api.sendReply(res, err);
        });
    });

```

## SQS
To use AWS SQS for job processing set `cache-default=https://sqs.amazonaws.com....`, this queue system will poll SQS for new messages on a worker
and after successful execution will delete the message. For long running jobs it will automatically extend visibility timeout if it is configured.

## Local
The local queue run in the process.

## NATS
To use NATS (https://nats.io) configure a queue like cache-nats=nats://HOST:PORT, it supports broadcasts and job queues only, visibility timeout is
supported as well.

# WebSockets connections

The simplest way is to configure `api-ws-port` to the same value as the HTTP port. This will run WebSockets server along the regular Web server.

In the browser the connection config is stored in the `app.wsconf` and by default it connects to the local server on port 8000.

There are two ways to send messages via Websockets to the server from a browser:

- as urls, eg. ```app.wsSend('/project/update?id=1&name=Test2')```

  In this case the url will be parsed and checked for access and authorization before letting it pass via Express routes. This method allows to
  share the same route handlers between HTTP and Websockets requests, the handlers will use the same code and all responses will be sent back,
  only in the Websockets case the response will arrived in the message listener (see an example below)

```javascript
    app.wsConnect({ path: "/ws?id=1" });

    app.on("ws:message", (msg) => {
        switch (msg.op) {
        case "/users/update":
            app.wsSend("/ws/user");
            break;

        case "/project/update":
            for (const p in msg.project) app.project[p] = msg.project[p];
            break;

        case "/message/new":
            app.showAlert("info", `New message: ${msg.msg}`);
            break;
        }
    });
````

- as JSON objects, eg. ```app.wsSend({ op: "/project/update", project: { id: 1, name: "Test2" } })```

    In this case the server still have to check for access so it treats all JSON messages as coming from the path which was used during the connect,
    i.e. the one stored in the `app.wsconf.path`. The Express route handler for this path will receive all messages from Websocket clients, the response will be received in the event listener the same way as for the first use case.

```javascript
    // Notify all clients who is using the project being updated
    api.app.all("/project/ws", (req, res) => {
        switch (req.query.op) {
        case "/project/update":
           //  some code ....
           api.ws.notify({ query: { id: req.query.project.id } }, { op: "/project/update", project: req.query.project });
           break;
       }
       res.send("");
    });
````

In any case all Websocket messages sent from the server will arrive in the event handler and must be formatted properly in order to distinguish what is what, this is the application logic. If the server needs to send a message to all or some specific clients for example due to some updates in the DB, it must use the
`ws.notify` function.

```javascript
    // Received a new message for a user from external API service, notify all websocket clients by user id
    api.app.post("/api/message", (req, res) => {
        ....
        ... processing logic
        ....
        api.ws.notify({ user_id: req.query.uid }, { op: "/message/new", msg: req.query.msg });
    });
```

# Backend library development (Mac OS X, developers)

* `git clone https://github.com/vseryakov/backendjs.git` or `git clone git@github.com:vseryakov/backendjs.git`

* cd backendjs

* if Node.js is already installed skip to the next section

    * to install binary release run the command, it will install it into ~.bkjs/bin on Darwin

        ```
        bkjs install-node

        # To install into different path
        bkjs install-node -home ~/.local
        ```

* to run local server on port 8000 run command:

    ```./bkjs watch```

* to start the backend in command line mode, the backend environment is prepared and initialized including all database pools.
   This command line access allows you to test and run all functions from all modules of the backend without running full server
   similar to Node.js REPL functionality. All modules are accessible from the command line.

    ```
    $ ./bkjs shell
    > app.version
    '0.70.0'
    > logger.setLevel('info')
    ```

## Authentication and sessions

### Signature

All requests to the API server must be signed with user login/secret pair.

- The algorithm how to sign HTTP requests (Version 1, 2):
    * Split url to path and query parameters with "?"
    * Split query parameters with "&"
    * '''ignore parameters with empty names'''
    * '''Sort''' list of parameters alphabetically
    * Join sorted list of parameters with "&"
        - Make sure all + are encoded as %2B
    * Form canonical string to be signed as the following:
        - Line1: The signature version
        - Line2: The application tag or other opaque data
        - Line3: The login name
        - Line4: The HTTP method(GET), followed by a newline.
        - Line5: The host name, lowercase, followed by a newline.
        - Line6: The request URI (/), followed by a newline.
        - Line7: The sorted and joined query parameters as one string, followed by a newline.
        - Line8: The expiration value in milliseconds, required, followed by a newline
        - Line9: The Content-Type HTTP header, lowercase, optional, followed by a newline
        - Line10: The SHA1 checksum of the body content, optional, for JSON and other forms of requests not supported by query parameters
    * Computed HMAC-SHA1 digest from the canonical string and encode it as BASE64 string, preserve trailing = if any
    * Form the signature HTTP header as the following:
        - The header string consist of multiple fields separated by pipe |
            - Field1: Signature version:
                - version 1, obsolete, do not use first 3 lines in the canonical string
                - version 2,3 to be used in session cookies only
                - version 4
            - Field2: Application tag or other app specific data
            - Field3: user login or whatever it might be in the login column
            - Field4: HMAC-SHA digest from the canonical string, version 1 uses SHA1, other SHA256
            - Field5: expiration value in milliseconds, same as in the canonical string
            - Field6: SHA1 checksum of the body content, optional, for JSON and other forms of requests not supported by query parameters
            - Field7: empty, reserved for future use

The resulting signature is sent as HTTP header `bk-signature` or in the header specified by the `api-signature-name` config parameter.

For JSON content type, the method must be POST and no query parameters specified, instead everything should be inside the JSON object
which is placed in the body of the request. For additional safety, SHA1 checksum of the JSON payload can be calculated and passed in the signature,
this is the only way to ensure the body is not modified when not using query parameters.

See [api.js](https://github.com/vseryakov/backendjs/blob/master/api/auth.js) function `api.createSignature` for the JavaScript implementation.

### Authentication API

- `/auth`

   This API request returns the current user record from the `bk_user` table if the request is verified and the signature provided
   is valid. If no signature or it is invalid the result will be an error with the corresponding error code and message.

   By default this endpoint is secured, i.e. requires a valid signature.

   On successful login, the result contains full user record

- `/login`

   Same as the /auth but it uses secret for user authentication, this request does not need a signature, just simple
   login and secret query parameters to be sent to the backend. This must be sent over SSL.

   Parameters:

     - `login` - user login
     - `secret` - user secret

   On successful login, the result contains full user record

   Example:

```javascript
    var res = await fetch("/login", { metod: "POST", body: "login=test123&secret=test123" });
    await res.json()

    > { id: "XXXX...", name: "Test User", login: "test123", ...}
```

- `/logout`

   Logout the current user, clear session cookies if exist. For pure API access with the signature this will not do anything on the backend side.


### Health enquiry

When running with AWS load balancer there should be a url that a load balancer polls all the time and this must be very quick and lightweight request. For this
purpose there is an API endpoint `/ping` that just responds with status 200. It is open by default in the default `api-allow-path` config parameter.

