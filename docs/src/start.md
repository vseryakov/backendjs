# Getting Started

## Overview

This tutorial will show how to set up a basic backendjs server that displays "Hello World!" in your browser.

## Installing backendjs

Create a new directory myproject, and from there run:

```
cd myproject
npm install vseryakov/backendjs --save
```

this will install the latest version of backendjs as a dependency in your package.json.

## Creating a Web Server

A very basic backendjs Web server looks like the following:

```js
const { app, api } = require('backendjs');
app.start({ api: 1 });
console.log('Server running on http://%s:%s', api.bind, api.port);
```

First, you require backendjs. Then you start the server with default settings and log that it's running, the **api** property
tells to start Express web server, i.e. the api mode. There are more server modes available.

Run `node` and then paste the three lines above into it.

Now visit _http://localhost:8000_ in your browser, you'll see the text 'Hello, World!'.

This is default empty index.html bundled with the server.

## Creating a module

Now let's create a simple module that will increase a counter every time you refresh the page and persist it in the Sqlite database.

Save the lines below as **index.js**

```js
const { app, api, db } = require('backendjs');

const counter = {
    name: "counter",

    tables: {
        counter: {
            id: { type: "int", primary: 1 },
            value: { type: "counter" },
            mtime: { type: "now" },
        }
    },

    configureWeb(options, callback)
    {
        api.app.get("/counter", (req, res) => {

            db.incr("counter", { id: 1, value: 1 }, { returning: "*", first: 1 }, (err, row) => {
                if (err) {
                    return api.sendReply(res, err);
                }
                api.sendJSON(req, row);
            });
        });
        callback();
    }

}
app.addModule(counter);

app.start({ api: 1 });
```

Then save the following lines as **bkjs.conf**

```
api-acl-add-public=^/counter
db-sqlite-pool=counter
db-pool=sqlite
```

Now run the command

```
node index.js -db-create-tables
```

Go to _http://localhost:8000/counter_ in your browser, you'll see the current counter value, refresh it and see the counter incrementing.

## Next steps

**backendjs** has many, many other capabilities, please explore the documentation and
examples on https://github.com/vseryakov/backendjs/examples



