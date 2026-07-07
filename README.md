
# ![logo](https://vseryakov.github.io/backendjs/web/img/logo.png) Backend library for Node.js

The `backendjs` provides a set of modules and utilities for building scalable, distributed applications with features
like api routing, database management, caching, job queues, event processing, and more.

Visit the [tutorial](https://vseryakov.github.io/backendjs/docs/web/tutorial-start.html) or
[all docs](https://vseryakov.github.io/backendjs/docs/web/index.html).

---

```js
const { app, api, logger } = require('backendjs');

app.start({ api: true });

api.app.get("/", (context) => { context.send(200, "Hello, World!") });

logger.log(`Server running on http://${api.bind}:${api.port}`, app.env);
```

## **Features**

1. **Modular Architecture**
   - The framework is built around a modular design, where each module can be configured via command-line arguments or configuration files.
   - Minimum external dependencies, extensive library of useful utilities, functions and algorithms included like text conversions, crypto wrappers, process management and more
   - Essential dependencies like `redis`, `pg`, `ws`, `croner`, `nodemailer` are bundled in the package inside the dist/ folder to minimize dependency on npm install.

2. **Database Abstraction**
   - Supports multiple databases: **SQLite, Rqlite, PostgreSQL-wire compatible (PostgreSQL, DSQL, CockroachDB), DynamoDB, Elasticsearch**.
   - Provides a unified API for CRUD operations, caching, and transactions, access to native engine allows to send raw SQL or JSON directy.
   - Supports **primary keys, indexes, and schema migrations**.

3. **Caching**
   - Built-in caching with support for **Redis, NATS, and local memory caches**.
   - Features like **LRU (Least Recently Used) caching**, **token bucket rate limiting**, and **locking mechanisms**.

4. **Job Queue & Event Processing**
   - Supports **SQS, NATS, DB and Redis queues** for job processing.
   - Workers can be spawned to handle jobs asynchronously.
   - Event-based architecture for real-time processing.

5. **API Layer**
   - Trie router kind of similar to **Express/Hono** with middleware for authentication, rate limiting, static, logging and basic user management.
   - Includes **WebSocket support** for real-time communication using the same API routes and authentication.
   - Includes simple but powerful input validation via declarative schemas.

6. **AWS Integration**
   - Supports **AWS services** like **S3, SQS, SNS, DynamoDB, and EC2**, the AWS signatire V4 is implemented internally and the
   rest of AWS API is used directly, no aws-sdk involved.
   - Automated instance/containers metadata retrieval and configuration.

7. **Logging & Monitoring**
   - Advanced logging with **syslog, file, and console support**.
   - Metrics collection for **CPU, memory, network, and API performance**.
   - Integration with **Elasticsearch** for log aggregation.

8. **Push Notifications**
   - Supports **WebPush, FCM (Firebase Cloud Messaging), and APNs (Apple Push Notification Service)**.

9. **Configuration Management**
   - Supports **remote configuration** via databases, AWS Secrets manager  or files.
   - Dynamic reloading of configurations without restarting the server.

10. **Security**
    - **CSRF protection**, **cookie sessions**, **API tokens** and **rate limiting**.
    - **JWT (JSON Web Tokens)** support for authentication.
    - **ACL** base authorization.

## **Optional Modules**

1. Log watcher, notify about errors by parsing log files

2. Image composing with Sharp.js from JSON schema, supports avatars, shadows, outline fonts, wrapping, padding

3. Web scraping with Puppeteer

---

## **Configuration**

The runtime can be configured via:

- **Command-line arguments** (e.g., `-db-pg-pool pg://localhost/dbname`).
- **Configuration files** (e.g., `bkjs.conf`).
- **Environment variables** (e.g., `BKJS_DB_POOL=pg://localhost/dbname`).
- **Database** (e. g. `-db-config dynamodb`)
- **AWS Secrets Manager** (e. g. `-aws-config-secrets production-worker`)
- **AWS S3 file** (e. g. `-aws-config-s3-file mybucket/config`)
- **AWS Config Parameters Store** (e. g. `-aws-config-parameters /my-config`)

---

## **Deployment**

- **Docker**: Can be containerized for easy deployment, no init-shim required.
- **AWS ECS/EC2**: Can be deployed on AWS for cloud scalability.

---

## Getting started

Visit the [tutorial](https://vseryakov.github.io/backendjs/docs/web/tutorial-start.html).

Check out [examples](https://github.com/vseryakov/backendjs/tree/master/examples).

## Full documentation

Visit the [docs](https://vseryakov.github.io/backendjs/docs/web/index.html).

## License
   [MIT](/LICENSE)

## Author
  Vlad Seryakov


