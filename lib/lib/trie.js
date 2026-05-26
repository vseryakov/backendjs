/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2026
 */

const lib = require(__dirname + "/../lib");

lib.Trie = class Trie {

    count = 0;

    /**
    * Trie (Prefix Tree) class uses a trie data structure to store routes and handlers.
    */

    constructor(sep) {
        this.sep = sep ?? "/";
        this.root = { children: {} };
    }

    split(path) {
        return lib.split(path, this.sep);
    }

    /**
     * Inserts a path into the Trie.
     * @param {string} path to insert.
     * @param {any} data associated with the path
     */
    add(path, data) {
        let node = this.root;
        const parts = this.split(path);

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const key = part[0] == ":" || part == "*" ? "*" : part;
            let child = node.children[key];
            if (!child) {
                child = node.children[key] = { id: this.count++, index: i, part, path, children: {} };
                if (key == "*") {
                    child.param = part.substr(1) || (i + 1);
                }
            }
            node = child;
        }
        node.data = data;
    }

    /**
     * Retrieves all nodes that start with a given path.
     * @param {string} path  to check.
     * @returns {object[]t} matched nodes
     */
    find(path) {
        let node = this.root;
        const parts = this.split(path);

        for (const part of parts) {
            node = node.children[part] || node.children["*"];
            if (!node) return [];
        }

        return this.traverse([], node, path);
    }

    /**
      * Helper function for Depth First Search (DFS) traversal.
      * @param {array} list the current list with matched nodes
      * @param {object} node The current node in the traversal.
      * @param {string} path The accumulated path so far.
      * @return {array} list with matches added
      */
    traverse(list, node, path) {
        if (node) {
            if (node.data) {
                list.push(node);
            }
            for (const part in node.children) {
                this.traverse(list, node.children[part] || node.children["*"], path + this.sep + part);
            }
        }
        return list;
    }

    print(node, level = 0) {
        node = node || this.root;
        console.log(" ".repeat(level), node.id, node.part, node.path, node.param)
        for (const p in node.children) {
            this.print(node.children[p], level + 1)
        }
    }
}
