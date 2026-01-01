/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');

/**
 * @module lib/respawn
 * @description Respawn throttling
 * @property {int} interval - Minimal interval between respawns (2000)
 * @property {int} timeout - Timeout in ms between respawns (2000)
 * @property {int} delay - Delay in ms for throttling (30000)
 * @property {int} count - How many times to respawn in a row to start throttling (4)
 */
lib.respawn = {
    interval: 3000,
    timeout: 2000,
    delay: 30000,
    count: 4,
    time: null,
    events: 0,

    /**
     * If respawning too fast, delay otherwise call the callback after a short timeout
     * @param {function} callback
     * @memberof module:lib/respawn
     */
    check(callback) {
        if (this.exiting) return;
        var now = Date.now();
        logger.debug('respawn:', this, now - this.time);
        if (this.time && now - this.time < this.interval) {
            if (this.count && this.events >= this.count) {
                logger.log('respawn:', 'throttling for', this.delay, 'after', this.events, 'respawns');
                this.events = 0;
                this.time = now;
                return setTimeout(callback, this.delay);
            }
            this.events++;
        } else {
            this.events = 0;
        }
        this.time = now;
        setTimeout(callback, this.timeout);
    }
};
