# ![logo](https://vseryakov.github.io/backendjs/web/img/logo.png) Backend library for Node.js

A Node.js library to create Web apps with minimal dependencies.

## Features:

* Express 5 is used for the API access.
* Authentication is based on signed requests using API key and secret, similar to Amazon AWS signing requests.
* Web sessions with CSRF protection, Webauthn/Passkeys.
* Web server runs in separate processes to utilize multiple CPU cores.
* WebSocket connections are processed by the same Express routes.
* Rate limiter based on TokenBucket algorithm can be run in-process or in Redis.
* PUB/SUB modes of operations using Redis, NATS.
* Async jobs processing using queue implementation on top of SQS, Redis, NATS, jobs can be scheduled or run on-demand in separate processes.
* REPL (command line) interface for debugging and looking into server internals.
* Push notifications via Webpush.
* Can be used with any MVC, MVVC or other types of frameworks that work on top of, or with the included Express server.
* Simple DB layer for CRUD operations like Get/Select/Put/Del/Update for supported databases (SQLite, PostreSQL, DynamoDB, ElasticSearch).
* AWS support is very well integrated by using APIs directly without AWS SDK, includes EC2, ECS, S3, DynamoDB, SQS, CloudWatch and more.
* Includes a simple log watcher to monitor the log files and CloudWatch logs.
* Runtime metrics about CPU, DB, requests, cache, memory, rate limits, AWS X-Ray spans.
* The backend process can be used directly in Docker containers without shim init.

## NOTE: work in progress, major refactor, the NPM version is stable

## Documentation

Visit the [documentation](https://vseryakov.github.io/backendjs/docs/web/index.html).

## Installation

    npm install backendjs --save

or clone the repo

    git clone https://github.com/vseryakov/backendjs.git

## License
   [MIT](/LICENSE)

## Author
  Vlad Seryakov

