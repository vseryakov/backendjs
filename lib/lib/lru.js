//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const lib = require(__dirname + '/../lib');

// Simple LRU cache in memory, supports get,put,del operations only, TTL can be specified in milliseconds as future time
lib.LRUCache = function(max)
{
    this.max = max || 10000;
    this.map = new Map();
    this.head = {};
    this.tail = this.head.next = { prev: this.head };
}

lib.LRUCache.prototype.get = function(key)
{
    const node = this.map.get(key);
    if (node == undefined) return;
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

lib.LRUCache.prototype.put = function(key, value, ttl)
{
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

lib.LRUCache.prototype.del = function(key)
{
    const node = this.map.get(key);
    if (node == undefined) return false;
    node.prev.next = node.next;
    node.next.prev = node.prev;
    if (node == this.head) this.head = node.next;
    if (node == this.tail) this.tail = node.prev;
    this.map.delete(key);
    return true;
}

lib.LRUCache.prototype.clean = function()
{
    const now = Date.now(), s = this.map.size;
    for (const [key, val] of this.map) {
        if (val.ttl && val.ttl < now) this.del(key);
    }
    return s - this.map.size;
}

