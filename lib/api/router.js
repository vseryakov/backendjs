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
 * ## Routing Basics
 *
 * The router matches an incoming request (e.g., `GET /posts/123`) against a set of registered routes
 * (defined using `router.add(method, path_pattern, handler_data)`).
 *
 * ### Key Concepts:
 *   **Method:** Defines the HTTP method (`get`, `post`, `put`, etc.). A wildcard `*` can be used for all methods.
 *   **Path Pattern:** The pattern to match (e.g., `/users/:id`).
 *   **Result Retrieval:** Use `router.find(method, path)` to get an array of matching routes.
 *
 * ### Examples:
 *
 * | Request Path | Route Registered | Matching Criteria | Notes |
 * | :--- | :--- | :--- | :--- |
 * | `/users/123` (GET) | `/users/:username`| Matches the literal structure, capturing `username`. | Parameter handling. |
 * | `/book/a` (GET)    | `/book/:slug` | Captures the path segment into the `:slug` parameter. | Basic parameter match. |
 * | `/api/posts/123` (GET) | `/api/:type/*` | Wildcard matches the path structure (`/api/../...`). | Wildcard usage. |
 *
 *
 * ```js
 * router.add("get", "/users/:user", "user");
 * router.add("get", "/book/:slug", "slug")
 * router.add("get", "/api/:type/*", "api");
 *
 * router.find("get", "/users/123")
 * { route: { .. data: "user" }, params: { user: "123" }}
 *
 * router.find("get", "/book/999")
 * { route: { .. data: "slug" }, params: { slug: "999" }}
 *
 * router.find("get", "/api/endpoint/1")
 * { route: { .. data: "api" }, params: { '0': "1", 'type': "endpoint" }}
 *
 * ```
 * ---
 *
 * ## Advanced Matching Features
 *
 * ### Path Parameters (`:param_name`)
 *
 * Parameters allow parts of a URL to be dynamic variables. The router captures these segments into a `params` object on the matching route.
 *
 *  **Example:**
 * ```javascript
 * router.get("/entry/:id/comment/:comment_id", (context, next) => { ... });
 * const res = router.find('get', '/entry/789/comment/123');
 * // Result will contain a match where params are { id: '789', comment_id: '123' }
 * ```
 *
 * ### Wildcards (`*`)
 *
 * The wildcard character (`*`) is used to catch any path segment.
 * It can be placed anywhere in the route definition but the segment must exist even if the '*' is at the end.
 *
 * | Pattern | Match Type | Effect | Example Matches |
 * | :--- | :--- | :--- | :--- |
 * | `/api/*` | Two-level Wildcard | Matches the segment immediately after `/api/...` but not /api. Used for generic API structures. | `/api/posts`, `/api/users/a` |
 * | `*` (standalone) | Catch All | Matches any request path, acting as a fallback or middleware layer if defined early in the router setup. | `/any/path`, `/`
 * |
 *
 * **Example (Wildcard Priority):**
 *
 * If routes are registered as:
 * 1.  `GET /api/*`
 * 2.  `GET /api/posts/:id`
 *
 * Requesting `/api/posts/123` will match both, and the order of results determines which handler is executed first.
 *
 * ---
 *
 * ## Routing Priority
 *
 * The router executes matches in the order routes are added. When multiple registered paths can satisfy an incoming request,
 * all matching results are returned in the sequence they were added to the `Router` instance.
 *
 * ### Best Practices:
 * 1.  **Specific Routes First:** Always register highly specific paths (like `/api/posts/:id`) *before* generic wildcard paths (`/api/*`).
 * 2.  **Wildcard Fallbacks Last:** Global fallbacks (`*`) should be placed at the end of logical blocks to ensure more
 * granular matches are attempted first.
 *
 * ### Example: Specific vs. Wildcard
 *
 * If you register:
 * 1. `GET /posts/:id`, 'Specific Post Handler'
 * 2. `GET /posts/*`, 'Generic Posts Catch-All'
 *
 * Requesting `/posts/abc` will match **both**. The first registered route (`/posts/:id`) is prioritized if the specific
 * rule is intended to be run before the generic one.
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
     * Add a route or midleware handlers, for objects the route handle is function .handle(context, next)
     * @param {string} [method='']
     * @param {string} [path=*]
     * @param {function|object} ..handlers - middleware handlers
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

        for (let arg of handlers) {
            if (lib.isFunc(arg.handle)) {
                arg = arg.handle.bind(arg);
            }
            this.add(method, path, arg);
        }
        return this;
    }

    /**
     * Add q route to all methods
     * @param {string} path
     * @param {function} ...handlers
     */
    all(path, ...handlers) {
        return this.use("", path, ...handlers);
    }

    /**
     * Add GET route
     * @param {string} path
     * @param {function} handler
     */
    get(path, ...handlers) {
        return this.use("GET", path, ...handlers);
    }

    /**
     * Add POST route
     * @param {string} path
     * @param {function} handler
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
