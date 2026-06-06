/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const util = require("node:util")
const lib = require(__dirname + '/../lib');
const logger = require(__dirname + '/../logger');

/**
 * Simple Trie (Prefix Tree) router uses a trie data structure to store routes and handlers.
 *
 * ## Middleware
 *
 * A middleware is a function `(context, next)` or an object with method `handle(context, next)`.
 *
 * When matched the handler can process the request and send back results or skip and pass the control to the next middleware by calling the
 * `next` function.
 *
 * When parameter or wildcard captured the `context.params` will be an object with captured values, named parameter will be a property
 * with the same name but wildcards will be captured as array-like indexed values starting with '0'.
 *
 * ## Routing Basics
 *
 * The router matches an incoming request (e.g., `GET /posts/123`) against a set of registered routes
 * defined using `router.add(method, path_pattern, handler_data)` or any shortcuts like `get, post, put, patch, delete`.
 *
 * The router executes matches in the order routes are added. When multiple registered paths can satisfy an incoming request,
 * all matching results are returned in the sequence they were added to the `Router` instance.
 *
 * **Examples**
 *
 * | Request Path | Route Registered | Matching Criteria | Notes |
 * | :--- | :--- | :--- | :--- |
 * | `/users/123` (GET)     | `/users/:username`| Matches the literal structure, capturing `username`. | Parameter handling. |
 * | `/api/posts/123` (GET) | `/api/:type/*`    | Wildcard matches the path structure (`/api/../...`), captures the `:path` parameter. | Wildcard usage. |
 *
 *
 * ```js
 * router.get("/users/:user", middleware1);
 * router.get("/book/:slug", "middleware2)
 * router.get("/api/:type/*", middleware3);
 *
 * router.find("get", "/users/123")
 * { route: { .. handler: middleware1 }, params: { user: "123" }}
 *
 * router.find("get", "/book/999")
 * { route: { .. handler: middleware2 }, params: { slug: "999" }}
 *
 * router.find("get", "/api/endpoint/123")
 * { route: { .. handler: middleware3 }, params: { '0': "123", 'type': "endpoint" }}
 *
 * ```
 * ---
 *
 * ## Path Parameters (`:param_name`)
 *
 * Parameters allow parts of a URL to be dynamic variables. The router captures these segments into a `params` object on the matching route.
 *
 *  **Example:**
 *
 * ```javascript
 * router.get("/entry/:id/comment/:comment_id", (context, next) => { ... });
 *
 * const res = router.find('get', '/entry/789/comment/123');
 *
 * // Result will contain a match where params are { id: '789', comment_id: '123' }
 * ```
 *
 * ## Wildcards (`*`)
 *
 * The wildcard character (`*`) is used to catch any path segment.
 * It can be placed anywhere in the route definition but the segment must exist even if the '*' is at the end.
 *
 * | Pattern | Match Type | Effect | Example Matches |
 * | :--- | :--- | :--- | :--- |
 * | `/api/*` | Two-level Wildcard | Matches the segment immediately after `/api/...` but not just `/api` | `/api/posts`, `/api/users/a` |
 * | `*`      | Catch All          | Matches any request path, acting as a fallback or middleware layer if defined early in the router setup. | `/any/path`, `/`
 * |
 *
 * **Example:**
 *
 * ```javascript
 * router.get("/entry/:id/*", (context, next) => { ... });
 *
 * const res = router.find('get', '/entry/789/123');
 *
 * // Result will contain a match where params are { id: '789', '0': '123' }
 * ```
 *
 *
 * @memberof module:api
 */
class Router {
    #count = 0
    #handler
    #params

    /**
     * Create a new router with default fallback handler
     * @param {function} [handler]
     */
    constructor(handler) {
        this.#handler = handler ?? this.onFinish;
    }

    /**
     * Add a route or midleware handlers
     * @param {string} [method='']
     * @param {string} [path=*]
     * @param {function|object} ..handlers - middleware handlers, if an object it must have method `.handle(context, next)`
     * @example
     * router.use(middleware1, middleware2)
     * router.use("GET", "/api", midleware1)
     * router.use("/api", midleware1)
     */
    use(method, path, ...handlers) {
        logger.dev("use:", "router", method, path, handlers);

        if (lib.isFunc(method) || lib.isFunc(method?.handle)) {
            handlers.unshift(method, path), method = "", path = "*";
        }
        if (lib.isFunc(path) || lib.isFunc(path?.handle)) {
            handlers.unshift(path), path = method, method = "";
        }

        handlers = handlers.filter(x => (lib.isFunc(x) || lib.isFunc(x?.handle)));

        if (typeof path != "string" || !handlers.length) {
            logger.trace("use:", "router", "invalid:", { method, path, handlers });
            return this;
        }

        for (let handler of handlers) {
            if (lib.isFunc(handler.handle)) {
                handler = handler.handle.bind(handler);
            }
            this.add(method, path, handler);
        }
        return this;
    }

    /**
     * Add q route to all methods
     * @param {string} path
     * @param {function} ...handlers
     * @example
     * router.all("/api/info", middleware1)
     */
    all(path, ...handlers) {
        return this.use("", path, ...handlers);
    }

    /**
     * Add GET route
     * @param {string} path
     * @param {function} handler
     * @example
     * router.get("/api/get", middleware1)
     */
    get(path, ...handlers) {
        return this.use("GET", path, ...handlers);
    }

    /**
     * Add POST route
     * @param {string} path
     * @param {function} handler
     * @example
     * router.post("/api/update", middleware1)
     */
    post(path, ...handlers) {
        return this.use("POST", path, ...handlers);
    }

    /**
     * Add PATCH route
     * @param {string} path
     * @param {function} handler
     */
    patch(path, ...handlers) {
        return this.use("PATCH", path, ...handlers);
    }

    /**
     * Add PUT route
     * @param {string} path
     * @param {function} ...handlers
     */
    put(path, ...handlers) {
        return this.use("PUT", path, ...handlers);
    }

    /**
     * Add DELETE route
     * @param {string} path
     * @param {function} ...handlers
     */
    delete(path, ...handlers) {
        return this.use("DELETE", path, ...handlers);
    }

    /**
     * Handle a request
     * @param {RequestContext} context
     * @param {function} next - (context, err) called after all routes processed but none returned response or error,
     * can be chained to next middleware
     */
    handle(context, next) {
        const method = context.method === "HEAD" ? "GET" : context.method;

        const routes = this.find(method, context.path);

        const iterator = (err) => {
            // Express compatibility for next router or fallback
            if (err === "router") {
                err = null;
                routes.splice(0);
            }

            if (err) {
                try {
                    return this.#handler(context, err);
                } catch (e) {
                    return this.onFinish(context, e);
                }
            }

            const route = routes.shift();
            if (!route) {
                next = lib.isFunc(next) || this.#handler;
                return next(context);
            }

            logger.dev("handle:", "router", route, context);

            try {
                context.params = route.params;
                const res = route.route.handler(context, iterator);
                if (util.types.isPromise(res)) {
                    res.then(null, iterator);
                }
            } catch (e) {
                iterator(e)
            }
        }

        iterator();
    }

    /**
     * Default handler to call if no routes matched or error detected
     */
    onFinish(context, err) {
        context.send(err ? err.status || 400 : 404, err || "not found");
    }

    /**
     * Split the path by separator, if empty return separator for explicit root match
     */
    split(path) {
        path = lib.split(path, "/");
        if (!path.length) {
            path.push("/");
        }
        return path;
    }

    /**
     * Inserts a path into the Trie.
     * @param {string} method to handle
     * @param {string} path to handle
     * @param {any} handler associated data
     * @example
     * router.add("GET", "/api/info", middleware1)
     * router.add("*", "/api/", middleware2)
     */
    add(method, path, handler) {
        path = this.split(path);

        let node = this;

        for (let i = 0; i < path.length; i++) {
            const name = path[i];
            const key = name[0] == ":" ? ":" : name == "*" ? "*" : name;
            let child = node.children?.[key];
            if (!child) {
                if (!node.children) {
                    node.children = Object.create(null, {
                        toJSON: { value: function() { return Object.keys(this).join(", ") } }
                    });
                }
                child = node.children[key] = { index: i, name };
            }
            node = child;
        }
        if (!node.methods) {
            node.methods = [];
        }

        logger.dev("add:", "router", method, path, handler, node.methods.length);

        node.methods.push({
            id: ++this.#count,
            method: lib.isString(method).toUpperCase().replaceAll("*", ""),
            path,
            params: path.reduce((a, part, i) => {
                if (part[0] == ":" || part == "*") {
                    if (!a) a = [];
                    a[i] = part == "*" ? "*" : part.substr(1);
                }
                return a;
            }, undefined),
            handler,
        });
        return this;
    }

    /**
     * Retrieves all nodes that match a path.
     * @param {string} path  to check.
     * @returns {object[]} matched routes { route, params }, ...
     */
    find(method, path) {
        path = this.split(path);
        method = lib.isString(method).toUpperCase();

        const rc = [];
        const types = ["", ":", "*"];
        let nodes = [this];

        for (let i = 0; i < path.length; i++) {
            const stack = [];
            const end = i == path.length - 1;
            types[0] = path[i];

            for (const node of nodes) {
                for (const type of types) {
                    const next = node.children?.[type];
                    if (!next) continue;

                    // End of the path
                    if (end) {
                        this.#findMethods(rc, method, path, next);
                    } else {
                        // Wildcard end node, matches the rest of the path
                        if (type == "*") {
                            this.#findMethods(rc, method, path, next);
                        }
                        stack.push(next);
                    }
                }
            }
            nodes = stack;
        }
        if (rc.length > 1) {
            rc.sort((a, b) => a.route.id - b.route.id);
        }
        return rc;
    }

    #findMethods(rc, method, path, node) {
        if (!node.methods) return;
        for (const route of node.methods.filter(x => (!x.method || x.method === method))) {
            if (route.params) {
                let index = 0;
                const params = Object.create(null);
                route.params.forEach((part, i) => {
                    params[part == "*" ? index++ : part] = path[i];
                });
                rc.push({ route, params });
            } else {
                rc.push({ route });
            }
        }
    }

    dump(node) {
        node = node || this;
        console.log(" ".repeat(node.index || 0), lib.inspect(node))
        for (const p in node.children) {
            this.dump(node.children[p])
        }
    }

}

module.exports = Router;
