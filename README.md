# ![logo](https://vseryakov.github.io/backendjs/web/img/logo.png) Backend library for Node.js

A Node.js library to create Web apps with minimal dependencies.

## Features:

* Express 5 is used for the API access.
* Web sessions with CSRF protection, Webauthn/Passkeys.
* Web server runs in separate processes to utilize multiple CPU cores.
* WebSocket connections are processed by the same Express routes.
* Rate limiter based on TokenBucket algorithm can be run in-process or in Redis.
* PUB/SUB modes of operations using Redis, NATS.
* Async jobs processing using queue implementation on top of SQS, Redis, NATS, jobs can be scheduled with croner or run on-demand in separate processes.
* REPL (command line) interface for debugging and looking into server internals.
* Push notifications via Webpush.
* Can be used with any MVC, MVVC or other types of frameworks that work on top of, or with the included Express server.
* Simple DB layer for CRUD operations like Get/Select/Put/Del/Update for supported databases (SQLite, PostreSQL, DynamoDB, ElasticSearch).
* AWS support is very well integrated by using APIs directly without AWS SDK, includes EC2, ECS, S3, DynamoDB, SQS, CloudWatch and more.
* Includes a simple log watcher to monitor the log files and CloudWatch logs.
* Runtime metrics about CPU, DB, requests, cache, memory, rate limits, AWS X-Ray spans.
* The backend process can be used directly in Docker containers without shim init.

## NOTE: work in progress, major refactor, the NPM version 0.x is deprecated.

## Getting started

Visit the [tutorial](https://vseryakov.github.io/backendjs/docs/web/tutorial-start.html).

## Full documentation

Visit the [documentation](https://vseryakov.github.io/backendjs/docs/web/index.html).


## Documentation

Visit the [documentation](https://vseryakov.github.io/backendjs/docs/web/index.html).

## License
   [MIT](/LICENSE)

## Author
  Vlad Seryakov

