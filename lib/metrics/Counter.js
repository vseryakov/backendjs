

module.exports = class Counter {

    /**
    * Counter that resets itself after each read
    * @param {object} [options]
    * @class Counter
    */
    constructor(options) {
        this.count = 0;
    }

    toJSON() {
        const n = this.count;
        this.count = 0;
        return n;
    }

    incr(count) {
        this.count += typeof count == "number" ? count : 1;
        return this.count;
    }
}
