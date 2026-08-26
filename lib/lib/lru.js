/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */
'use strict';

const lib = require(__dirname + "/../lib");

/**
  * Simple LRU cache in memory, supports get,put,del operations only, TTL can be specified in milliseconds as future time
  * @param {number} [max=10000] - max number of items in the cache
  * @example
  * const { lib } = require("backendjs")
  *
  * const lru = new lib.LRUCache(1000)
  *
  */

lib.LRUCache = class LRUCache {

    constructor(max) {

        /** @var {Map} - Map to hold items */
        this.map = new Map()

        /** @var {number} - Max items to keep in the map */
        this.max = 10000;

        if (max > 0) this.max = max;
    }

    /**
     * Return an item by key
     * @param {string} key
     * @return {any|undefined} an item if found
     * @memberof LRUCache
     * @method get
     */
    get(key) {
        const value = this.map.get(key);
        if (value === undefined) return;
        if (value[1] && value[1] < Date.now()) {
            this.map.delete(key);
            return;
        }
        this.map.delete(key);
        this.map.set(key, value);
        return value[0];
    }

    /**
     * Put an item into cache, if total number of items exceed the max then the oldest item is removed
     * @param {string} key
     * @param {any} value
     * @param {number} [ttl] in milliseconds
     * @return {boolean} true if added to the cache
     * @memberof LRUCache
     * @method put
     */
    put(key, value, ttl) {
        if (value === undefined) return false;
        if (this.map.size >= this.max) {
            this.map.delete(this.map.keys().next().value);
        }
        this.map.delete(key);
        this.map.set(key, [value, ttl]);
        return true;
    }

    /**
     * Remove a  item from cache
     * @param {string} key
     * @return {boolean} true if removed
     * @memberof LRUCache
     * @method del
     */
    del(key) {
        return this.map.delete(key);
    }

    /**
     * Purge expired items
     * @memberof LRUCache
     * @method clean
     */
    clean() {
        const now = Date.now(), s = this.map.size;
        for (const [key, value] of this.map) {
            if (value[1] && value[1] < now) this.map.delete(key);
        }
        return s - this.map.size;
    }
}

