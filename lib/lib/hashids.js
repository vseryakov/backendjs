//
// Copyright (c) 2012-2021 Bazyli Brzóska & Ivan Akimov
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the
// Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Soft
// ware, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
// PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTI
// ON OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//
// See https://github.com/niieani/hashids.js
//

const lib = require(__dirname + '/../lib');

/**
 * Return cached Hashids instance for the given configuration,
 * see https://github.com/niieani/hashids.js for docs,
 * NOTE: only .encode and .decode methods are implemented.
 * Properties:
 * @param {object} [options]
 * @param {string} [options.salt] - hashid salt, default is lib.salt
 * @param {int} [options.min] - minimum size of a hashid
 * @param {string} [options.alphabet] - chars allowed in hashids, default is lib.base32
 * @param {string} [options.separators] - hashid separator characters
 * @param {int} [options.counter] - max counter value to wrap back to 1, default is 65535
 * @return {string} hashids instance
 * @memberof module:lib
 * @method getHashid
 */
lib.getHashid = function(options)
{
    var min = options?.min || 0;
    var salt = options?.salt || this.salt;
    var alphabet = options?.alphabet || this.base62;
    var separators = options?.separators || "";
    var key = salt + min + alphabet + separators;
    if (!this.hashids[key]) {
        this.hashids[key] = new Hashids(salt, lib.toNumber(min), alphabet, separators);
        this.hashids[key]._counter = lib.randomShort();
    }
    if (++this.hashids[key]._counter > (options?.counter || 65535)) {
        this.hashids[key]._counter = 1;
    }
    return this.hashids[key];
}

const SEPARATOR_DIV = 3.5;
const GUARD_DIV = 12;
const MODULO_PART = 100;
const DFLT_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
const DFLT_SEPS = 'cfhistuCFHISTU';

class Hashids {
    constructor(salt = '', minLength = 0, alphabet = DFLT_ALPHABET, seps = DFLT_SEPS) {
        this.minLength = typeof minLength == "number" ? minLength : 0;

        const saltChars = Array.from(typeof salt == "string" ? salt : "");
        this.salt = saltChars;

        const alphabetChars = Array.from(typeof alphabet == "string" && alphabet || DFLT_ALPHABET);
        const sepsChars = Array.from(typeof seps == "string" && seps || DFLT_SEPS);

        const uniqueAlphabet = [ ...new Set(alphabetChars)];

        /// alphabet` should not contains `seps`
        this.alphabet = uniqueAlphabet.filter((char) => !sepsChars.includes(char));

        /// `seps` should contain only characters present in `alphabet`
        const filteredSeps = sepsChars.filter((char) => uniqueAlphabet.includes(char));

        this.seps = shuffle(filteredSeps, saltChars);

        if (this.seps.length === 0 || this.alphabet.length / this.seps.length > SEPARATOR_DIV) {
            const sepsLength = Math.ceil(this.alphabet.length / SEPARATOR_DIV);
            if (sepsLength > this.seps.length) {
                const diff = sepsLength - this.seps.length;
                this.seps.push(...this.alphabet.slice(0, diff));
                this.alphabet = this.alphabet.slice(diff);
            }
        }

        this.alphabet = shuffle(this.alphabet, saltChars);
        const guardCount = Math.ceil(this.alphabet.length / GUARD_DIV);
        if (this.alphabet.length < 3) {
            this.guards = this.seps.slice(0, guardCount);
            this.seps = this.seps.slice(guardCount);
        } else {
            this.guards = this.alphabet.slice(0, guardCount);
            this.alphabet = this.alphabet.slice(guardCount);
        }
        this.guardsRegExp = makeAnyOfCharsRegExp(this.guards);
        this.sepsRegExp = makeAnyOfCharsRegExp(this.seps);
        this.allowedCharsRegExp = makeAtLeastSomeCharRegExp([ ...this.alphabet, ...this.guards, ...this.seps ]);
    }

    encode(first, ...inputNumbers) {
        let numbers = Array.isArray(first) ? first : [...(first != null ? [first] : []), ...inputNumbers];
        if (numbers.length === 0) return "";
        numbers = numbers.map((n) => (typeof n == 'bigint' || typeof n == 'number' ? n : lib.toNumber(n, { bigint: 1 })));
        return this._encode(numbers).join('');
    }

    decode(id) {
        if (typeof id !== 'string' || id?.length === 0) return [];
        return this._decode(id);
    }

    _encode(numbers) {
        let alphabet = this.alphabet;
        const numbersIdInt = numbers.reduce((last, number, i) => last +
              (typeof number === 'bigint' ? Number(number % BigInt(i + MODULO_PART)) : number % (i + MODULO_PART)), 0);
        let ret = [alphabet[numbersIdInt % alphabet.length]];
        const lottery = [...ret];
        numbers.forEach((number, i) => {
            const buffer = lottery.concat(this.salt, alphabet);
            alphabet = shuffle(alphabet, buffer);
            const last = toAlphabet(number, alphabet);
            ret.push(...last);
            if (i + 1 < numbers.length) {
                const charCode = last[0].codePointAt(0) + i;
                const extraNumber = typeof number === 'bigint' ? Number(number % BigInt(charCode)) : number % charCode;
                ret.push(this.seps[extraNumber % this.seps.length]);
            }
        });
        if (ret.length < this.minLength) {
            const prefixGuardIndex = (numbersIdInt + ret[0].codePointAt(0)) % this.guards.length;
            ret.unshift(this.guards[prefixGuardIndex]);
            if (ret.length < this.minLength) {
                const suffixGuardIndex = (numbersIdInt + ret[2].codePointAt(0)) % this.guards.length;
                ret.push(this.guards[suffixGuardIndex]);
            }
        }
        const halfLength = Math.floor(alphabet.length / 2);
        while (ret.length < this.minLength) {
            alphabet = shuffle(alphabet, alphabet);
            ret.unshift(...alphabet.slice(halfLength));
            ret.push(...alphabet.slice(0, halfLength));
            const excess = ret.length - this.minLength;
            if (excess > 0) {
                const halfOfExcess = excess / 2;
                ret = ret.slice(halfOfExcess, halfOfExcess + this.minLength);
            }
        }
        return ret;
    }

    _decode(id) {
        if (!this.allowedCharsRegExp.test(id)) return [];
        const idGuardsArray = id.split(this.guardsRegExp);
        const splitIndex = idGuardsArray.length === 3 || idGuardsArray.length === 2 ? 1 : 0;
        const idBreakdown = idGuardsArray[splitIndex];
        if (idBreakdown.length === 0) return [];
        const lotteryChar = idBreakdown[Symbol.iterator]().next().value;
        const idArray = idBreakdown.slice(lotteryChar.length).split(this.sepsRegExp);
        let lastAlphabet = this.alphabet;
        const result = [];
        for (const subId of idArray) {
            const buffer = [lotteryChar, ...this.salt, ...lastAlphabet];
            const nextAlphabet = shuffle(lastAlphabet, buffer.slice(0, lastAlphabet.length));
            result.push(fromAlphabet(Array.from(subId), nextAlphabet));
            lastAlphabet = nextAlphabet;
        }
        // if the result is different from what we'd expect, we return an empty result (malformed input):
        if (this._encode(result).join('') !== id) return [];
        return result;
    }
}

function shuffle(alphabetChars, saltChars) {
    if (saltChars.length === 0) return alphabetChars;
    let code;
    const transformed = [...alphabetChars];
    for (let i = transformed.length - 1, v = 0, p = 0; i > 0; i--, v++) {
        v %= saltChars.length;
        p += (code = saltChars[v].codePointAt(0));
        const j = (code + v + p) % i;
        const a = transformed[i];
        const b = transformed[j];
        transformed[j] = a;
        transformed[i] = b;
    }
    return transformed;
};

const toAlphabet = (input, alphabetChars) => {
    const id = [];
    let value = input;
    if (typeof value === 'bigint') {
        const alphabetLength = BigInt(alphabetChars.length);
        do {
            id.unshift(alphabetChars[Number(value % alphabetLength)]);
            value /= alphabetLength;
        } while (value > BigInt(0));
    } else {
        do {
            id.unshift(alphabetChars[value % alphabetChars.length]);
            value = Math.floor(value / alphabetChars.length);
        } while (value > 0);
    }
    return id;
};

const fromAlphabet = (inputChars, alphabetChars) => inputChars.reduce((carry, item) => {
    const index = alphabetChars.indexOf(item);
    if (index === -1) return 0;
    if (typeof carry === 'bigint') {
        return carry * BigInt(alphabetChars.length) + BigInt(index);
    }
    const value = carry * alphabetChars.length + index;
    return Number.isSafeInteger(value) ? value : BigInt(carry) * BigInt(alphabetChars.length) + BigInt(index);
}, 0);

// we need to sort these from longest to shortest,
// as they may contain multibyte unicode characters (these should come first)
const escapeRegExp = (text) => text.replace(/[\s#$()*+,.?[\\\]^{|}-]/g, '\\$&');
const makeAnyOfCharsRegExp = (chars) => new RegExp(chars.map((char) => escapeRegExp(char)).sort((a, b) => b.length - a.length).join('|'));
const makeAtLeastSomeCharRegExp = (chars) => new RegExp(`^[${chars.map((char) => escapeRegExp(char)).sort((a, b) => b.length - a.length).join('')}]+$`);
