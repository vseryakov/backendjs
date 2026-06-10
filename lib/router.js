/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const util = require("node:util")
const lib = require(__dirname + '/lib');
const logger = require(__dirname + '/logger');

/**
 * Simple Trie (Prefix Tree) router uses a trie data structure to store routes and handlers.
 *
 * ## Middleware
 *
 * A handler is a function `(context, next)` or an object with method `handle(context, next)`.
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
 * Method parameter may contain explicit order ID in the form `#ID` where ID is a number, it will be used in
 * sorting instead of auto generated sequence id.
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
 * [{ route: { .. handler: middleware1 }, params: { user: "123" }}]
 *
 * router.find("get", "/book/999")
 * [{ route: { .. handler: middleware2 }, params: { slug: "999" }}]
 *
 * router.find("get", "/api/endpoint/123")
 * [{ route: { .. handler: middleware3 }, params: { '0': "123", 'type': "endpoint" }}]
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

    /**
     * Create a new router with default fallback handler
     * @param {function} [handler]
     */
    constructor(handler) {
        this.#handler = handler ?? this.onFinish;
    }

    /**
     * Clear and reset
     */
    reset() {
        this.#count = 0
        delete this.children;
    }

    /**
     * Add a route or midleware handlers
     * @param {string} [method=''] - empty for all, or a valid HTTP method. Optional order Id can be appended as `#ID`, it will be used
     * as is instead of default sequential id. This is to allow manual sorting of routes and no depend on order of definition.
     * @param {string} [path=*]
     * @param {function|object} ..handlers - middleware handlers, if an object it must have method `.handle(context, next)`
     * @example
     * router.use(middleware1, middleware2)
     * router.use("GET", "/api", midleware1)
     * router.use("/api", midleware1)
     *
     * // This will be the first route even if added last
     * router.use("GET#0", /api", midleware5)
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
                const bound = handler;
                handler = handler.handle.bind(handler);
                Object.defineProperty(handler, "boundThis", { value: bound });
            }
            this.add(method, path, handler);
        }
        return this;
    }

    /**
     * Remove route handlers by explicit method, path and handlers, must match all exactly
     * @param {string} method
     * @param {string} path
     * @param {function|object} ..handlers
     */
    unuse(method, path, ...handlers) {
        logger.dev("unuse:", "router", method, path, handlers);

        for (const handler of handlers) {
            this.del(method, path, handler);
        }
        return this;
    }

    /**
     * Add a route to all methods
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

        let routes = this.find(method, context.path), restarts = 0;

        const iterator = (err) => {
            logger.dev("iterator:", "router", err, context);

            // Routing change, start over
            if (err === "restart") {
                if (restarts++ < 3) {
                    routes = this.find(method, context.path);
                    return iterator()
                }
                err = { status: 508 }
            } else

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
     * @param {string} method to handle, optional order ID can be set as `#ID`
     * @param {string} path to handle
     * @param {any} handler associated data
     * @example
     * router.add("GET", "/api/info", middleware1)
     * router.add("*", "/api/", middleware2)
     */
    add(method, path, handler) {
        const paths = this.split(path);

        let node = this, id;

        for (let i = 0; i < paths.length; i++) {
            const name = paths[i];
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

        method = lib.isString(method).toUpperCase().replaceAll("*", "");
        const i = method.indexOf("#");
        if (i > -1) {
            id = lib.toNumber(method.substr(i + 1));
            method = method.substr(0, i);
        } else {
            id = ++this.#count;
        }

        // Skip if already exists, exact explicit match only
        if (node.handlers) {
            if (node.handlers.find(x => (x.handler === handler && (!x.method || x.method === method)))) return this;
        } else {
            node.handlers = [];
        }

        logger.dev("add:", "router", method, path, handler, node.handlers.length);

        node.handlers.push({
            id,
            method,
            path,
            paths,
            params: paths.reduce((a, part, i) => {
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
        const rc = this.#find(method, path, this.#findHandlers);

        if (rc.length > 1) {
            rc.sort((a, b) => a.route.id - b.route.id);
        }
        return rc;
    }

    #find(method, path, callback) {
        const paths = this.split(path);
        method = lib.isString(method).toUpperCase();

        const result = [];
        const types = ["", ":", "*"];
        let nodes = [this];

        for (let i = 0; i < paths.length; i++) {
            const stack = [];
            const end = i == paths.length - 1;
            types[0] = paths[i];

            for (const node of nodes) {
                for (const type of types) {
                    const next = node.children?.[type];
                    if (!next) continue;

                    // End of the path
                    if (end) {
                        if (next.handlers) {
                            callback(result, method, paths, next);
                        }
                    } else {
                        // Wildcard end node, matches the rest of the path
                        if (type == "*" && next.handlers) {
                            callback(result, method, paths, next);
                        }
                        stack.push(next);
                    }
                }
            }
            nodes = stack;
        }
        return result;
    }

    #findHandlers(result, method, paths, node) {
        for (const route of node.handlers.filter(x => (!x.method || x.method === method))) {
            if (route.params) {
                let index = 0;
                const params = Object.create(null);
                route.params.forEach((part, i) => {
                    params[part == "*" ? index++ : part] = paths[i];
                });
                result.push({ route, params });
            } else {
                result.push({ route });
            }
        }
    }

    /**
     * Delete a handler from the Trie, must match explicitly by method, path with optional handler
     * @param {string} method to handle
     * @param {string} path to handle
     * @param {any} [handler] - associated data, if missing all handlers will be deleted
     * @returns {object[]} - deleted routes
     * @example
     * router.del("GET", "/api/info", middleware1)
     * router.del("*", "/api/")
     */
    del(method, path, handler) {
        return this.#find(method, path, (result, method, paths, node) => {
            const rc = [];
            for (const route of node.handlers) {
                if ((!handler || route.handler === handler) &&
                    route.path === path &&
                    (!route.method || route.method === method)) {
                    result.push(route);
                    delete route.handler.boundThis;
                } else {
                    rc.push(route);
                }
            }
            node.handlers = rc.length ? rc : undefined;
        });
    }

    /**
     * Walk the trie non-recursively, call the callback for each leaf node
     * @param {function} callback
     */
    walk(callback) {
        const nodes = [this];

        while (nodes.length) {
            const node = nodes.shift();

            if (node.handlers) {
                callback(node);
            }

            for (const p in node.children) {
                nodes.push(node.children[p]);
            }
        }
    }

    dump(node) {
        this.walk(node => {
            console.log(" ".repeat(node.index || 0), lib.inspect(node))
        });
    }

}

module.exports = Router;
