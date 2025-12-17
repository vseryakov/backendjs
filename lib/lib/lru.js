/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

 const lib = require(__dirname + "/../lib");

lib.LRUCache = class LRUCache {

    /**
     * Simple LRU cache in memory, supports get,put,del operations only, TTL can be specified in milliseconds as future time
     * @param {number} [max] - max number of items in the cache
     * @class LRUCache
     * @example
     * const { lib } = require("backendjs")
     *
     * const lru = new lib.LRUCache(1000)
     *
     */
    constructor(max) {
        this.max = max || 10000;
        this.map = new Map();
        this.head = {};
        this.tail = this.head.next = { prev: this.head };
    }

    /**
     * Return an item by key
     * @param {string} key
     * @return {any|undefined} an item if found
     * @memberof LRUCache
     * @method get
     */
    get(key) {
        const node = this.map.get(key);
        if (node === undefined) return;
        if (node.ttl && node.ttl < Date.now()) {
            this.del(key);
            return;
        }
        node.prev.next = node.next;
        node.next.prev = node.prev;
        this.tail.prev.next = node;
        node.prev = this.tail.prev;
        node.next = this.tail;
        this.tail.prev = node;
        return node.value;
    }

    /**
     * Put an item into cache, if total number of items exceed the max then the oldest item is removed
     * @param {string} key
     * @param {any} value
     * @param {number} [ttl] in milliseconds
     * @memberof LRUCache
     * @method put
     */
    put(key, value, ttl) {
        if (this.get(key) !== undefined) {
            this.tail.prev.value = value;
            return true;
        }
        if (this.map.size === this.max) {
            this.map.delete(this.head.next.key);
            this.head.next = this.head.next.next;
            this.head.next.prev = this.head;
        }
        const node = { value, ttl };
        this.map.set(key, node);
        this.tail.prev.next = node;
        node.prev = this.tail.prev;
        node.next = this.tail;
        this.tail.prev = node;
    }

    /**
     * Remove a  item from cache
     * @param {string} key
     * @return {boolean} true if removed
     * @memberof LRUCache
     * @method del
     */
    del(key) {
        const node = this.map.get(key);
        if (node === undefined) return false;
        node.prev.next = node.next;
        node.next.prev = node.prev;
        if (node == this.head) this.head = node.next;
        if (node == this.tail) this.tail = node.prev;
        this.map.delete(key);
        return true;
    }

    /**
     * @memberof LRUCache
     * @method clean
     */
    clean() {
        const now = Date.now(), s = this.map.size;
        for (const [key, val] of this.map) {
            if (val.ttl && val.ttl < now) this.del(key);
        }
        return s - this.map.size;
    }
}

