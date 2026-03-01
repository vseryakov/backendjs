# Getting Started

## Overview

This tutorial will show how to set up a basic backendjs server that displays "Hello World!" in your browser.

## Installing backendjs

Create a new directory myproject, and from there run:

```shell
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

const mod = {
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
        api.app.get("/counter", this.getCounter);

        callback();
    },

    getCounter(req, res)
    {
        db.incr("counter", { id: 1, value: 1 }, { returning: "*", first: 1 }, (err, row) => {
            api.sendJSON(req, err, row);
        });
    }

}
app.addModule(mod);

app.start({ api: 1 });
console.log('Server running on http://%s:%s', api.bind, api.port);
```

Then save the following lines as **bkjs.conf**

```
api-acl-add-public=^/counter
db-sqlite-pool=counter
db-pool=sqlite
```

Now run the command

```shell
node index.js -shell -db-create-tables
```

Go to _http://localhost:8000/counter_ in your browser, you'll see the current counter value,
refresh it and see the counter value incrementing with mtime timestamp in milliseconds.

Explanation about this example:

- the __counter__ module is just an object with a name, here we created it inside the same index.js but
  modules usually placed in its own separate files
- the __tables__ object describes SQL table "counter" with 3 columns
- the __configureWeb__ method is called by the server on start, this method is reserved for adding your Express routes,
  it is called only in the "api" mode where __api.app__ is the Express application.
- we just created a single GET route __/counter__ using Express middleware syntax, inside we directly increment
  the counter in the record with id=1, it is created automatically on first call
- then return the whole record back as JSON, it is ok to do it for such a silly example.
- the __bkjs.conf__ file is created for convenience, we could pass all params via the command-line
- the config defines Sqlite database pool with file named "counter" and adds our __/counter__ endpoint to the
  public access list, by default all endpoints require some kind of access permissions
- and lastly we pass __-db-create-tables__ to the node to initialize the database, this is usually need only once or every time
  the schema changes, so next time it is fine to just run the demo as `node index.js`

This example is in the repository at [starter](https://github.com/vseryakov/backendjs/tree/master/examples/starter).

Another simple way to create a demo example is using command:

```
npm install vseryakov/backendjs --save
node_modules/.bin/bkjs demo myapp
```

it will create a folder `myapp` with files similar to the example above.

## Next steps

**backendjs** has many, many other capabilities like {@link module:api}, {@link module:db}, {@link module:jobs},
{@link module:cache}, {@link module:queue}, {@link module:aws}.

Please explore the documentation and examples at [examples](https://github.com/vseryakov/backendjs/tree/master/examples).


