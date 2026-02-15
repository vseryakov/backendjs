# ![logo](https://vseryakov.github.io/backendjs/web/img/logo.png) Backend library for Node.js

The `backendjs` provides a comprehensive set of modules and utilities for
building scalable, distributed applications with features like database management, caching, job queues, event processing, and more.

---

## **Core Features**

1. **Modular Architecture**
   - The framework is built around a modular design, where each module (e.g., `db`, `cache`, `queue`, `api`) can be loaded independently.
   - Modules can be configured via command-line arguments or configuration files.

2. **Database Abstraction**
   - Supports multiple databases: **SQLite, PostgreSQL, DynamoDB, Elasticsearch**.
   - Provides a unified API for CRUD operations, caching, and transactions.
   - Supports **primary keys, indexes, and schema migrations**.

3. **Caching**
   - Built-in caching with support for **Redis, NATS, and local memory caches**.
   - Features like **LRU (Least Recently Used) caching**, **token bucket rate limiting**, and **locking mechanisms**.

4. **Job Queue & Event Processing**
   - Supports **SQS, NATS, and Redis queues** for job processing.
   - Workers can be spawned to handle jobs asynchronously.
   - Event-based architecture for real-time processing.

5. **API Layer**
   - Built on **Express.js** with middleware for authentication, rate limiting, and logging.
   - Supports **RESTful APIs** with JSON responses.
   - Includes **WebSocket support** for real-time communication.

6. **AWS Integration**
   - Supports **AWS services** like **S3, SQS, SNS, DynamoDB, and EC2**.
   - Automated instance metadata retrieval and configuration.

7. **Logging & Monitoring**
   - Advanced logging with **syslog, file, and console support**.
   - Metrics collection for **CPU, memory, network, and API performance**.
   - Integration with **Elasticsearch** for log aggregation.

8. **Push Notifications**
   - Supports **WebPush, FCM (Firebase Cloud Messaging), and APNs (Apple Push Notification Service)**.

9. **Configuration Management**
   - Supports **remote configuration** via databases or files.
   - Dynamic reloading of configurations without restarting the server.

10. **Security**
    - **CSRF protection**, **signature verification**, and **rate limiting**.
    - **JWT (JSON Web Tokens)** support for authentication.

---

## **Key Modules**

| Module       | Description                                                                       |
|--------------|-----------------------------------------------------------------------------------|
| `app`       | Core application module for initialization, configuration, and process management. |
| `db`        | Database abstraction layer for SQLite, PostgreSQL, DynamoDB, and Elasticsearch.    |
| `cache`     | Caching layer with Redis, NATS, and local memory support.                          |
| `queue`     | Job queue and event processing with SQS, NATS, and Redis.                          |
| `api`       | HTTP API layer built on Express.js with middleware for auth, logging, etc.         |
| `aws`       | AWS SDK integration for S3, SQS, SNS, DynamoDB, and EC2.                           |
| `jobs`      | Job processing with worker pools and cron-like scheduling.                         |
| `events`    | Event-based messaging and subscriptions.                                           |
| `push`      | Push notifications for mobile and web clients.                                     |
| `stats`     | Metrics collection and reporting.                                                  |
| `logger`    | Advanced logging with syslog, file, and console support.                           |

---

### **Architecture Overview**

1. **Server Process**
   - Manages worker processes, job queues, and event subscriptions.
   - Handles configuration and dynamic reloading.

2. **Worker Processes**
   - Execute jobs and process events.
   - Can be spawned dynamically based on workload.

3. **API Workers**
   - Handle HTTP requests and WebSocket connections.
   - Use Express.js middleware for routing and authentication.

4. **Database Pools**
   - Maintain connections to databases (SQLite, PostgreSQL, DynamoDB, Elasticsearch).
   - Support for **connection pooling** and **schema migrations**.

5. **Caching Layer**
   - Distributed caching with Redis/NATS.
   - Local LRU caching for performance.

6. **Job Queue**
   - Supports **SQS, NATS, and Redis** for job processing.
   - Workers pull jobs from queues and execute them.

7. **Event System**
   - Pub/Sub model for real-time event processing.
   - Supports **Redis, NATS, and SQS** for event distribution.

---

## **Use Cases**

1. **Microservices**
   - Deploy multiple services with shared databases and caching.

2. **Real-Time Applications**
   - Use WebSockets and event processing for live updates.

3. **Batch Processing**
   - Schedule jobs via cron or SQS for background tasks.

4. **Serverless & Cloud Deployments**
   - Integrate with AWS Lambda, ECS, and EC2 for scalable deployments.

5. **Data Processing**
   - Use DynamoDB/Elasticsearch for NoSQL data storage and search.

---

## **Configuration**

The library is configured via:

- **Command-line arguments** (e.g., `-db-pg-pool pg://localhost/dbname`).
- **Configuration files** (e.g., `bkjs.conf`).
- **Environment variables** (e.g., `BKJS_DB_POOL=pg://localhost/dbname`).
- **Database** (e. g. `-db-config dynamodb`)
- **AWS Secrets Manager** (e. g. `-aws-config-secrets production-worker`)
- **AWS S3 file** (e. g. `-aws-config-s3-file mybucjet/config`)
- **AWS Config Parameters Store** (e. g. `-aws-config-parameters /my-config`)

---

## **Deployment**

- **Docker**: Can be containerized for easy deployment.
- **Kubernetes**: Supports scaling via Kubernetes deployments.
- **AWS ECS/EC2**: Can be deployed on AWS for cloud scalability.

---

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

(summary is generated by local LLM with manual edits)
