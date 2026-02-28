# **Project Overview**

A **web scraping service** that allows users to submit URLs, a job capturew full-page screenshots (including scrolling content), and stores both the rendered images and raw HTML.

The system is built with a **backendjs API** (Node.js) and a **frontend dashboard** (Alpine.js + Bootstrap).

## Getting started

1. Setup env

    npm install

2. Create tables

    npm run initdb

3. Run the app

    npm run start

4. Point browser to http://localhost:8000


## **Technical Stack**

| Component       | Technology                          |
|-----------------|-------------------------------------|
| **Backend**     | Node.js, Express, Puppeteer         |
| **Database**    | Custom ORM (`backendjs db` module)  |
| **Frontend**    | Alpine.js, Bootstrap 5, HTML/JS     |
| **File Storage**| Custom file system (`api.files`)    |
| **Job Queue**   | BackendJS `jobs` module             |
| **Logging**     | `logger` module                     |

---

## **Workflow**

1. **User submits a URL** → Job created in DB (status: `pending`).
2. **Worker processes the job**:
   - Launches Puppeteer, scrolls the page, captures screenshot/HTML.
   - Updates DB status (`done`/`error`).
3. **User views results**:
   - Screenshot thumbnail in the table.
   - Click actions to delete, resubmit, or download HTML.


# Authors
vlad
