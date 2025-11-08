# Backend library for Node.js

A Node.js library to create Web backends with minimal dependencies.

## Features:

* API access is served by Express framework.
* Database operations like Get, Put, Del, Update, Select for supported databases (SQLite, PostreSQL, DynamoDB, ElasticSearch) using the same DB API,
  a simple layer, not a full ORM, SQL can be used directly if needed.
* Authentication is based on signed requests using API key and secret, similar to Amazon AWS signing requests.
* Supports Web sessions with CSRF protection, Webauthn/Passkeys
* Runs web server as separate processes to utilize multiple CPU cores.
* Supports WebSockets connections and process them with the same Express routes as HTTP requests
* Supports cron and on-demand jobs running in separate worker processes.
* Supports cache/rate-limiter using Redis.
* Supports PUB/SUB modes of operations using Redis, NATS.
* Supports async jobs processing using several work queue implementations on top of SQS, Redis, NATS.
* REPL (command line) interface for debugging and looking into server internals.
* Supports push notifications via Webpush.
* Can be used with any MVC, MVVC or other types of frameworks that work on top of, or with the included Express server.
* AWS support is very well integrated but light, includes EC2, ECS, S3, DynamoDB, SQS, CloudWatch and more, not using AWS SDK.
* Includes simple log watcher to monitor the log files including system errors.
* Supports runtime metrics about the timing on database, requests, cache, memory and request rate limit control, AWS X-Ray spans.

## Documentation

Visit the [Docs](https://vseryakov.github.io/backendjs/docs/web/index.html)

## Installation

    npm install backendjs

or clone the repo

    git clone https://github.com/vseryakov/backendjs.git

## License
   [MIT](/LICENSE)

## Author
  Vlad Seryakov

