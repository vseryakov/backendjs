'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { lib } = require('../');

describe('LRUCache', () => {
    it('stores and returns values by key', () => {
        const lru = new lib.LRUCache(10);

        lru.put('a', 1);
        lru.put('b', { ok: true });

        assert.equal(lru.get('a'), 1);
        assert.deepEqual(lru.get('b'), { ok: true });
        assert.equal(lru.get('missing'), undefined);
    });

    it('updates an existing key', () => {
        const lru = new lib.LRUCache(10);

        lru.put('a', 1);
        lru.put('a', 2);

        assert.equal(lru.get('a'), 2);
        assert.equal(lru.map.size, 1);
    });

    it('evicts the least recently used item when max size is reached', () => {
        const lru = new lib.LRUCache(2);

        lru.put('a', 1);
        lru.put('b', 2);

        assert.equal(lru.get('a'), 1);

        lru.put('c', 3);

        assert.equal(lru.get('b'), undefined);
        assert.equal(lru.get('a'), 1);
        assert.equal(lru.get('c'), 3);
        assert.equal(lru.map.size, 2);
    });

    it('deletes an existing key', () => {
        const lru = new lib.LRUCache(10);

        lru.put('a', 1);

        assert.equal(lru.del('a'), true);
        assert.equal(lru.get('a'), undefined);
        assert.equal(lru.map.size, 0);
    });

    it('returns false when deleting a missing key', () => {
        const lru = new lib.LRUCache(10);

        assert.equal(lru.del('missing'), false);
    });

    it('expires items with past ttl on get', () => {
        const lru = new lib.LRUCache(10);

        lru.put('a', 1, Date.now() - 1000);

        assert.equal(lru.get('a'), undefined);
        assert.equal(lru.map.size, 0);
    });

    it('keeps items with future ttl', () => {
        const lru = new lib.LRUCache(10);

        lru.put('a', 1, Date.now() + 60000);

        assert.equal(lru.get('a'), 1);
        assert.equal(lru.map.size, 1);
    });

    it('cleans expired items and returns removed count', () => {
        const lru = new lib.LRUCache(10);

        lru.put('expired1', 1, Date.now() - 1000);
        lru.put('expired2', 2, Date.now() - 500);
        lru.put('valid', 3, Date.now() + 60000);
        lru.put('plain', 4);

        assert.equal(lru.clean(), 2);
        assert.equal(lru.get('expired1'), undefined);
        assert.equal(lru.get('expired2'), undefined);
        assert.equal(lru.get('valid'), 3);
        assert.equal(lru.get('plain'), 4);
        assert.equal(lru.map.size, 2);
    });
});
