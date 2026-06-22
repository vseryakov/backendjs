"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// ../../.bkjs/lib/node_modules/redis/lib/utils.js
var require_utils = __commonJS({
  "../../.bkjs/lib/node_modules/redis/lib/utils.js"(exports2, module2) {
    "use strict";
    function replyToObject(reply) {
      if (reply.length === 0 || !(reply instanceof Array)) {
        return null;
      }
      var obj = {};
      for (var i = 0; i < reply.length; i += 2) {
        obj[reply[i].toString("binary")] = reply[i + 1];
      }
      return obj;
    }
    function replyToStrings(reply) {
      if (reply instanceof Buffer) {
        return reply.toString();
      }
      if (reply instanceof Array) {
        var res = new Array(reply.length);
        for (var i = 0; i < reply.length; i++) {
          res[i] = replyToStrings(reply[i]);
        }
        return res;
      }
      return reply;
    }
    function print(err, reply) {
      if (err) {
        console.log(err.toString());
      } else {
        console.log("Reply: " + reply);
      }
    }
    var camelCase;
    function clone(obj) {
      var copy;
      if (Array.isArray(obj)) {
        copy = new Array(obj.length);
        for (var i = 0; i < obj.length; i++) {
          copy[i] = clone(obj[i]);
        }
        return copy;
      }
      if (Object.prototype.toString.call(obj) === "[object Object]") {
        copy = {};
        var elems = Object.keys(obj);
        var elem;
        while (elem = elems.pop()) {
          if (elem === "tls") {
            copy[elem] = obj[elem];
            continue;
          }
          var snake_case = elem.replace(/[A-Z][^A-Z]/g, "_$&").toLowerCase();
          if (snake_case !== elem.toLowerCase()) {
            camelCase = true;
          }
          copy[snake_case] = clone(obj[elem]);
        }
        return copy;
      }
      return obj;
    }
    function convenienceClone(obj) {
      camelCase = false;
      obj = clone(obj) || {};
      if (camelCase) {
        obj.camel_case = true;
      }
      return obj;
    }
    function callbackOrEmit(self, callback, err, res) {
      if (callback) {
        callback(err, res);
      } else if (err) {
        self.emit("error", err);
      }
    }
    function replyInOrder(self, callback, err, res, queue) {
      var command_obj;
      if (queue) {
        command_obj = queue.peekBack();
      } else {
        command_obj = self.offline_queue.peekBack() || self.command_queue.peekBack();
      }
      if (!command_obj) {
        process.nextTick(function() {
          callbackOrEmit(self, callback, err, res);
        });
      } else {
        var tmp = command_obj.callback;
        command_obj.callback = tmp ? function(e, r) {
          tmp(e, r);
          callbackOrEmit(self, callback, err, res);
        } : function(e, r) {
          if (e) {
            self.emit("error", e);
          }
          callbackOrEmit(self, callback, err, res);
        };
      }
    }
    module2.exports = {
      reply_to_strings: replyToStrings,
      reply_to_object: replyToObject,
      print,
      err_code: /^([A-Z]+)\s+(.+)$/,
      monitor_regex: /^[0-9]{10,11}\.[0-9]+ \[[0-9]+ .+\].*"$/,
      clone: convenienceClone,
      callback_or_emit: callbackOrEmit,
      reply_in_order: replyInOrder
    };
  }
});

// ../../.bkjs/lib/node_modules/redis/lib/command.js
var require_command = __commonJS({
  "../../.bkjs/lib/node_modules/redis/lib/command.js"(exports2, module2) {
    "use strict";
    var betterStackTraces = /development/i.test(process.env.NODE_ENV) || /\bredis\b/i.test(process.env.NODE_DEBUG);
    function Command(command, args, callback, call_on_write) {
      this.command = command;
      this.args = args;
      this.buffer_args = false;
      this.callback = callback;
      this.call_on_write = call_on_write;
      if (betterStackTraces) {
        this.error = new Error();
      }
    }
    module2.exports = Command;
  }
});

// ../../.bkjs/lib/node_modules/redis/node_modules/denque/index.js
var require_denque = __commonJS({
  "../../.bkjs/lib/node_modules/redis/node_modules/denque/index.js"(exports2, module2) {
    "use strict";
    function Denque(array, options) {
      var options = options || {};
      this._head = 0;
      this._tail = 0;
      this._capacity = options.capacity;
      this._capacityMask = 3;
      this._list = new Array(4);
      if (Array.isArray(array)) {
        this._fromArray(array);
      }
    }
    Denque.prototype.peekAt = function peekAt(index) {
      var i = index;
      if (i !== (i | 0)) {
        return void 0;
      }
      var len = this.size();
      if (i >= len || i < -len) return void 0;
      if (i < 0) i += len;
      i = this._head + i & this._capacityMask;
      return this._list[i];
    };
    Denque.prototype.get = function get(i) {
      return this.peekAt(i);
    };
    Denque.prototype.peek = function peek() {
      if (this._head === this._tail) return void 0;
      return this._list[this._head];
    };
    Denque.prototype.peekFront = function peekFront() {
      return this.peek();
    };
    Denque.prototype.peekBack = function peekBack() {
      return this.peekAt(-1);
    };
    Object.defineProperty(Denque.prototype, "length", {
      get: function length() {
        return this.size();
      }
    });
    Denque.prototype.size = function size() {
      if (this._head === this._tail) return 0;
      if (this._head < this._tail) return this._tail - this._head;
      else return this._capacityMask + 1 - (this._head - this._tail);
    };
    Denque.prototype.unshift = function unshift(item) {
      if (item === void 0) return this.size();
      var len = this._list.length;
      this._head = this._head - 1 + len & this._capacityMask;
      this._list[this._head] = item;
      if (this._tail === this._head) this._growArray();
      if (this._capacity && this.size() > this._capacity) this.pop();
      if (this._head < this._tail) return this._tail - this._head;
      else return this._capacityMask + 1 - (this._head - this._tail);
    };
    Denque.prototype.shift = function shift() {
      var head = this._head;
      if (head === this._tail) return void 0;
      var item = this._list[head];
      this._list[head] = void 0;
      this._head = head + 1 & this._capacityMask;
      if (head < 2 && this._tail > 1e4 && this._tail <= this._list.length >>> 2) this._shrinkArray();
      return item;
    };
    Denque.prototype.push = function push(item) {
      if (item === void 0) return this.size();
      var tail = this._tail;
      this._list[tail] = item;
      this._tail = tail + 1 & this._capacityMask;
      if (this._tail === this._head) {
        this._growArray();
      }
      if (this._capacity && this.size() > this._capacity) {
        this.shift();
      }
      if (this._head < this._tail) return this._tail - this._head;
      else return this._capacityMask + 1 - (this._head - this._tail);
    };
    Denque.prototype.pop = function pop() {
      var tail = this._tail;
      if (tail === this._head) return void 0;
      var len = this._list.length;
      this._tail = tail - 1 + len & this._capacityMask;
      var item = this._list[this._tail];
      this._list[this._tail] = void 0;
      if (this._head < 2 && tail > 1e4 && tail <= len >>> 2) this._shrinkArray();
      return item;
    };
    Denque.prototype.removeOne = function removeOne(index) {
      var i = index;
      if (i !== (i | 0)) {
        return void 0;
      }
      if (this._head === this._tail) return void 0;
      var size = this.size();
      var len = this._list.length;
      if (i >= size || i < -size) return void 0;
      if (i < 0) i += size;
      i = this._head + i & this._capacityMask;
      var item = this._list[i];
      var k;
      if (index < size / 2) {
        for (k = index; k > 0; k--) {
          this._list[i] = this._list[i = i - 1 + len & this._capacityMask];
        }
        this._list[i] = void 0;
        this._head = this._head + 1 + len & this._capacityMask;
      } else {
        for (k = size - 1 - index; k > 0; k--) {
          this._list[i] = this._list[i = i + 1 + len & this._capacityMask];
        }
        this._list[i] = void 0;
        this._tail = this._tail - 1 + len & this._capacityMask;
      }
      return item;
    };
    Denque.prototype.remove = function remove(index, count) {
      var i = index;
      var removed;
      var del_count = count;
      if (i !== (i | 0)) {
        return void 0;
      }
      if (this._head === this._tail) return void 0;
      var size = this.size();
      var len = this._list.length;
      if (i >= size || i < -size || count < 1) return void 0;
      if (i < 0) i += size;
      if (count === 1 || !count) {
        removed = new Array(1);
        removed[0] = this.removeOne(i);
        return removed;
      }
      if (i === 0 && i + count >= size) {
        removed = this.toArray();
        this.clear();
        return removed;
      }
      if (i + count > size) count = size - i;
      var k;
      removed = new Array(count);
      for (k = 0; k < count; k++) {
        removed[k] = this._list[this._head + i + k & this._capacityMask];
      }
      i = this._head + i & this._capacityMask;
      if (index + count === size) {
        this._tail = this._tail - count + len & this._capacityMask;
        for (k = count; k > 0; k--) {
          this._list[i = i + 1 + len & this._capacityMask] = void 0;
        }
        return removed;
      }
      if (index === 0) {
        this._head = this._head + count + len & this._capacityMask;
        for (k = count - 1; k > 0; k--) {
          this._list[i = i + 1 + len & this._capacityMask] = void 0;
        }
        return removed;
      }
      if (i < size / 2) {
        this._head = this._head + index + count + len & this._capacityMask;
        for (k = index; k > 0; k--) {
          this.unshift(this._list[i = i - 1 + len & this._capacityMask]);
        }
        i = this._head - 1 + len & this._capacityMask;
        while (del_count > 0) {
          this._list[i = i - 1 + len & this._capacityMask] = void 0;
          del_count--;
        }
        if (index < 0) this._tail = i;
      } else {
        this._tail = i;
        i = i + count + len & this._capacityMask;
        for (k = size - (count + index); k > 0; k--) {
          this.push(this._list[i++]);
        }
        i = this._tail;
        while (del_count > 0) {
          this._list[i = i + 1 + len & this._capacityMask] = void 0;
          del_count--;
        }
      }
      if (this._head < 2 && this._tail > 1e4 && this._tail <= len >>> 2) this._shrinkArray();
      return removed;
    };
    Denque.prototype.splice = function splice(index, count) {
      var i = index;
      if (i !== (i | 0)) {
        return void 0;
      }
      var size = this.size();
      if (i < 0) i += size;
      if (i > size) return void 0;
      if (arguments.length > 2) {
        var k;
        var temp;
        var removed;
        var arg_len = arguments.length;
        var len = this._list.length;
        var arguments_index = 2;
        if (!size || i < size / 2) {
          temp = new Array(i);
          for (k = 0; k < i; k++) {
            temp[k] = this._list[this._head + k & this._capacityMask];
          }
          if (count === 0) {
            removed = [];
            if (i > 0) {
              this._head = this._head + i + len & this._capacityMask;
            }
          } else {
            removed = this.remove(i, count);
            this._head = this._head + i + len & this._capacityMask;
          }
          while (arg_len > arguments_index) {
            this.unshift(arguments[--arg_len]);
          }
          for (k = i; k > 0; k--) {
            this.unshift(temp[k - 1]);
          }
        } else {
          temp = new Array(size - (i + count));
          var leng = temp.length;
          for (k = 0; k < leng; k++) {
            temp[k] = this._list[this._head + i + count + k & this._capacityMask];
          }
          if (count === 0) {
            removed = [];
            if (i != size) {
              this._tail = this._head + i + len & this._capacityMask;
            }
          } else {
            removed = this.remove(i, count);
            this._tail = this._tail - leng + len & this._capacityMask;
          }
          while (arguments_index < arg_len) {
            this.push(arguments[arguments_index++]);
          }
          for (k = 0; k < leng; k++) {
            this.push(temp[k]);
          }
        }
        return removed;
      } else {
        return this.remove(i, count);
      }
    };
    Denque.prototype.clear = function clear() {
      this._head = 0;
      this._tail = 0;
    };
    Denque.prototype.isEmpty = function isEmpty() {
      return this._head === this._tail;
    };
    Denque.prototype.toArray = function toArray() {
      return this._copyArray(false);
    };
    Denque.prototype._fromArray = function _fromArray(array) {
      for (var i = 0; i < array.length; i++) this.push(array[i]);
    };
    Denque.prototype._copyArray = function _copyArray(fullCopy) {
      var newArray = [];
      var list = this._list;
      var len = list.length;
      var i;
      if (fullCopy || this._head > this._tail) {
        for (i = this._head; i < len; i++) newArray.push(list[i]);
        for (i = 0; i < this._tail; i++) newArray.push(list[i]);
      } else {
        for (i = this._head; i < this._tail; i++) newArray.push(list[i]);
      }
      return newArray;
    };
    Denque.prototype._growArray = function _growArray() {
      if (this._head) {
        this._list = this._copyArray(true);
        this._head = 0;
      }
      this._tail = this._list.length;
      this._list.length <<= 1;
      this._capacityMask = this._capacityMask << 1 | 1;
    };
    Denque.prototype._shrinkArray = function _shrinkArray() {
      this._list.length >>>= 1;
      this._capacityMask >>>= 1;
    };
    module2.exports = Denque;
  }
});

// ../../.bkjs/lib/node_modules/redis/node_modules/redis-errors/lib/old.js
var require_old = __commonJS({
  "../../.bkjs/lib/node_modules/redis/node_modules/redis-errors/lib/old.js"(exports2, module2) {
    "use strict";
    var assert = require("assert");
    var util = require("util");
    function RedisError(message) {
      Object.defineProperty(this, "message", {
        value: message || "",
        configurable: true,
        writable: true
      });
      Error.captureStackTrace(this, this.constructor);
    }
    util.inherits(RedisError, Error);
    Object.defineProperty(RedisError.prototype, "name", {
      value: "RedisError",
      configurable: true,
      writable: true
    });
    function ParserError(message, buffer, offset) {
      assert(buffer);
      assert.strictEqual(typeof offset, "number");
      Object.defineProperty(this, "message", {
        value: message || "",
        configurable: true,
        writable: true
      });
      const tmp = Error.stackTraceLimit;
      Error.stackTraceLimit = 2;
      Error.captureStackTrace(this, this.constructor);
      Error.stackTraceLimit = tmp;
      this.offset = offset;
      this.buffer = buffer;
    }
    util.inherits(ParserError, RedisError);
    Object.defineProperty(ParserError.prototype, "name", {
      value: "ParserError",
      configurable: true,
      writable: true
    });
    function ReplyError(message) {
      Object.defineProperty(this, "message", {
        value: message || "",
        configurable: true,
        writable: true
      });
      const tmp = Error.stackTraceLimit;
      Error.stackTraceLimit = 2;
      Error.captureStackTrace(this, this.constructor);
      Error.stackTraceLimit = tmp;
    }
    util.inherits(ReplyError, RedisError);
    Object.defineProperty(ReplyError.prototype, "name", {
      value: "ReplyError",
      configurable: true,
      writable: true
    });
    function AbortError(message) {
      Object.defineProperty(this, "message", {
        value: message || "",
        configurable: true,
        writable: true
      });
      Error.captureStackTrace(this, this.constructor);
    }
    util.inherits(AbortError, RedisError);
    Object.defineProperty(AbortError.prototype, "name", {
      value: "AbortError",
      configurable: true,
      writable: true
    });
    function InterruptError(message) {
      Object.defineProperty(this, "message", {
        value: message || "",
        configurable: true,
        writable: true
      });
      Error.captureStackTrace(this, this.constructor);
    }
    util.inherits(InterruptError, AbortError);
    Object.defineProperty(InterruptError.prototype, "name", {
      value: "InterruptError",
      configurable: true,
      writable: true
    });
    module2.exports = {
      RedisError,
      ParserError,
      ReplyError,
      AbortError,
      InterruptError
    };
  }
});

// ../../.bkjs/lib/node_modules/redis/node_modules/redis-errors/lib/modern.js
var require_modern = __commonJS({
  "../../.bkjs/lib/node_modules/redis/node_modules/redis-errors/lib/modern.js"(exports2, module2) {
    "use strict";
    var assert = require("assert");
    var RedisError = class extends Error {
      get name() {
        return this.constructor.name;
      }
    };
    var ParserError = class extends RedisError {
      constructor(message, buffer, offset) {
        assert(buffer);
        assert.strictEqual(typeof offset, "number");
        const tmp = Error.stackTraceLimit;
        Error.stackTraceLimit = 2;
        super(message);
        Error.stackTraceLimit = tmp;
        this.offset = offset;
        this.buffer = buffer;
      }
      get name() {
        return this.constructor.name;
      }
    };
    var ReplyError = class extends RedisError {
      constructor(message) {
        const tmp = Error.stackTraceLimit;
        Error.stackTraceLimit = 2;
        super(message);
        Error.stackTraceLimit = tmp;
      }
      get name() {
        return this.constructor.name;
      }
    };
    var AbortError = class extends RedisError {
      get name() {
        return this.constructor.name;
      }
    };
    var InterruptError = class extends AbortError {
      get name() {
        return this.constructor.name;
      }
    };
    module2.exports = {
      RedisError,
      ParserError,
      ReplyError,
      AbortError,
      InterruptError
    };
  }
});

// ../../.bkjs/lib/node_modules/redis/node_modules/redis-errors/index.js
var require_redis_errors = __commonJS({
  "../../.bkjs/lib/node_modules/redis/node_modules/redis-errors/index.js"(exports2, module2) {
    "use strict";
    var Errors = process.version.charCodeAt(1) < 55 && process.version.charCodeAt(2) === 46 ? require_old() : require_modern();
    module2.exports = Errors;
  }
});

// ../../.bkjs/lib/node_modules/redis/lib/customErrors.js
var require_customErrors = __commonJS({
  "../../.bkjs/lib/node_modules/redis/lib/customErrors.js"(exports2, module2) {
    "use strict";
    var util = require("util");
    var assert = require("assert");
    var RedisError = require_redis_errors().RedisError;
    var ADD_STACKTRACE = false;
    function AbortError(obj, stack) {
      assert(obj, "The options argument is required");
      assert.strictEqual(typeof obj, "object", "The options argument has to be of type object");
      Object.defineProperty(this, "message", {
        value: obj.message || "",
        configurable: true,
        writable: true
      });
      if (stack || stack === void 0) {
        Error.captureStackTrace(this, AbortError);
      }
      for (var keys = Object.keys(obj), key = keys.pop(); key; key = keys.pop()) {
        this[key] = obj[key];
      }
    }
    function AggregateError(obj) {
      assert(obj, "The options argument is required");
      assert.strictEqual(typeof obj, "object", "The options argument has to be of type object");
      AbortError.call(this, obj, ADD_STACKTRACE);
      Object.defineProperty(this, "message", {
        value: obj.message || "",
        configurable: true,
        writable: true
      });
      Error.captureStackTrace(this, AggregateError);
      for (var keys = Object.keys(obj), key = keys.pop(); key; key = keys.pop()) {
        this[key] = obj[key];
      }
    }
    util.inherits(AbortError, RedisError);
    util.inherits(AggregateError, AbortError);
    Object.defineProperty(AbortError.prototype, "name", {
      value: "AbortError",
      configurable: true,
      writable: true
    });
    Object.defineProperty(AggregateError.prototype, "name", {
      value: "AggregateError",
      configurable: true,
      writable: true
    });
    module2.exports = {
      AbortError,
      AggregateError
    };
  }
});

// ../../.bkjs/lib/node_modules/redis/node_modules/redis-parser/lib/parser.js
var require_parser = __commonJS({
  "../../.bkjs/lib/node_modules/redis/node_modules/redis-parser/lib/parser.js"(exports2, module2) {
    "use strict";
    var Buffer2 = require("buffer").Buffer;
    var StringDecoder = require("string_decoder").StringDecoder;
    var decoder = new StringDecoder();
    var errors = require_redis_errors();
    var ReplyError = errors.ReplyError;
    var ParserError = errors.ParserError;
    var bufferPool = Buffer2.allocUnsafe(32 * 1024);
    var bufferOffset = 0;
    var interval = null;
    var counter = 0;
    var notDecreased = 0;
    function parseSimpleNumbers(parser) {
      const length = parser.buffer.length - 1;
      var offset = parser.offset;
      var number = 0;
      var sign = 1;
      if (parser.buffer[offset] === 45) {
        sign = -1;
        offset++;
      }
      while (offset < length) {
        const c1 = parser.buffer[offset++];
        if (c1 === 13) {
          parser.offset = offset + 1;
          return sign * number;
        }
        number = number * 10 + (c1 - 48);
      }
    }
    function parseStringNumbers(parser) {
      const length = parser.buffer.length - 1;
      var offset = parser.offset;
      var number = 0;
      var res = "";
      if (parser.buffer[offset] === 45) {
        res += "-";
        offset++;
      }
      while (offset < length) {
        var c1 = parser.buffer[offset++];
        if (c1 === 13) {
          parser.offset = offset + 1;
          if (number !== 0) {
            res += number;
          }
          return res;
        } else if (number > 429496728) {
          res += number * 10 + (c1 - 48);
          number = 0;
        } else if (c1 === 48 && number === 0) {
          res += 0;
        } else {
          number = number * 10 + (c1 - 48);
        }
      }
    }
    function parseSimpleString(parser) {
      const start = parser.offset;
      const buffer = parser.buffer;
      const length = buffer.length - 1;
      var offset = start;
      while (offset < length) {
        if (buffer[offset++] === 13) {
          parser.offset = offset + 1;
          if (parser.optionReturnBuffers === true) {
            return parser.buffer.slice(start, offset - 1);
          }
          return parser.buffer.toString("utf8", start, offset - 1);
        }
      }
    }
    function parseLength(parser) {
      const length = parser.buffer.length - 1;
      var offset = parser.offset;
      var number = 0;
      while (offset < length) {
        const c1 = parser.buffer[offset++];
        if (c1 === 13) {
          parser.offset = offset + 1;
          return number;
        }
        number = number * 10 + (c1 - 48);
      }
    }
    function parseInteger(parser) {
      if (parser.optionStringNumbers === true) {
        return parseStringNumbers(parser);
      }
      return parseSimpleNumbers(parser);
    }
    function parseBulkString(parser) {
      const length = parseLength(parser);
      if (length === void 0) {
        return;
      }
      if (length < 0) {
        return null;
      }
      const offset = parser.offset + length;
      if (offset + 2 > parser.buffer.length) {
        parser.bigStrSize = offset + 2;
        parser.totalChunkSize = parser.buffer.length;
        parser.bufferCache.push(parser.buffer);
        return;
      }
      const start = parser.offset;
      parser.offset = offset + 2;
      if (parser.optionReturnBuffers === true) {
        return parser.buffer.slice(start, offset);
      }
      return parser.buffer.toString("utf8", start, offset);
    }
    function parseError(parser) {
      var string = parseSimpleString(parser);
      if (string !== void 0) {
        if (parser.optionReturnBuffers === true) {
          string = string.toString();
        }
        return new ReplyError(string);
      }
    }
    function handleError(parser, type) {
      const err = new ParserError(
        "Protocol error, got " + JSON.stringify(String.fromCharCode(type)) + " as reply type byte",
        JSON.stringify(parser.buffer),
        parser.offset
      );
      parser.buffer = null;
      parser.returnFatalError(err);
    }
    function parseArray(parser) {
      const length = parseLength(parser);
      if (length === void 0) {
        return;
      }
      if (length < 0) {
        return null;
      }
      const responses = new Array(length);
      return parseArrayElements(parser, responses, 0);
    }
    function pushArrayCache(parser, array, pos) {
      parser.arrayCache.push(array);
      parser.arrayPos.push(pos);
    }
    function parseArrayChunks(parser) {
      const tmp = parser.arrayCache.pop();
      var pos = parser.arrayPos.pop();
      if (parser.arrayCache.length) {
        const res = parseArrayChunks(parser);
        if (res === void 0) {
          pushArrayCache(parser, tmp, pos);
          return;
        }
        tmp[pos++] = res;
      }
      return parseArrayElements(parser, tmp, pos);
    }
    function parseArrayElements(parser, responses, i) {
      const bufferLength = parser.buffer.length;
      while (i < responses.length) {
        const offset = parser.offset;
        if (parser.offset >= bufferLength) {
          pushArrayCache(parser, responses, i);
          return;
        }
        const response = parseType(parser, parser.buffer[parser.offset++]);
        if (response === void 0) {
          if (!(parser.arrayCache.length || parser.bufferCache.length)) {
            parser.offset = offset;
          }
          pushArrayCache(parser, responses, i);
          return;
        }
        responses[i] = response;
        i++;
      }
      return responses;
    }
    function parseType(parser, type) {
      switch (type) {
        case 36:
          return parseBulkString(parser);
        case 43:
          return parseSimpleString(parser);
        case 42:
          return parseArray(parser);
        case 58:
          return parseInteger(parser);
        case 45:
          return parseError(parser);
        default:
          return handleError(parser, type);
      }
    }
    function decreaseBufferPool() {
      if (bufferPool.length > 50 * 1024) {
        if (counter === 1 || notDecreased > counter * 2) {
          const minSliceLen = Math.floor(bufferPool.length / 10);
          const sliceLength = minSliceLen < bufferOffset ? bufferOffset : minSliceLen;
          bufferOffset = 0;
          bufferPool = bufferPool.slice(sliceLength, bufferPool.length);
        } else {
          notDecreased++;
          counter--;
        }
      } else {
        clearInterval(interval);
        counter = 0;
        notDecreased = 0;
        interval = null;
      }
    }
    function resizeBuffer(length) {
      if (bufferPool.length < length + bufferOffset) {
        const multiplier = length > 1024 * 1024 * 75 ? 2 : 3;
        if (bufferOffset > 1024 * 1024 * 111) {
          bufferOffset = 1024 * 1024 * 50;
        }
        bufferPool = Buffer2.allocUnsafe(length * multiplier + bufferOffset);
        bufferOffset = 0;
        counter++;
        if (interval === null) {
          interval = setInterval(decreaseBufferPool, 50);
        }
      }
    }
    function concatBulkString(parser) {
      const list = parser.bufferCache;
      const oldOffset = parser.offset;
      var chunks = list.length;
      var offset = parser.bigStrSize - parser.totalChunkSize;
      parser.offset = offset;
      if (offset <= 2) {
        if (chunks === 2) {
          return list[0].toString("utf8", oldOffset, list[0].length + offset - 2);
        }
        chunks--;
        offset = list[list.length - 2].length + offset;
      }
      var res = decoder.write(list[0].slice(oldOffset));
      for (var i = 1; i < chunks - 1; i++) {
        res += decoder.write(list[i]);
      }
      res += decoder.end(list[i].slice(0, offset - 2));
      return res;
    }
    function concatBulkBuffer(parser) {
      const list = parser.bufferCache;
      const oldOffset = parser.offset;
      const length = parser.bigStrSize - oldOffset - 2;
      var chunks = list.length;
      var offset = parser.bigStrSize - parser.totalChunkSize;
      parser.offset = offset;
      if (offset <= 2) {
        if (chunks === 2) {
          return list[0].slice(oldOffset, list[0].length + offset - 2);
        }
        chunks--;
        offset = list[list.length - 2].length + offset;
      }
      resizeBuffer(length);
      const start = bufferOffset;
      list[0].copy(bufferPool, start, oldOffset, list[0].length);
      bufferOffset += list[0].length - oldOffset;
      for (var i = 1; i < chunks - 1; i++) {
        list[i].copy(bufferPool, bufferOffset);
        bufferOffset += list[i].length;
      }
      list[i].copy(bufferPool, bufferOffset, 0, offset - 2);
      bufferOffset += offset - 2;
      return bufferPool.slice(start, bufferOffset);
    }
    var JavascriptRedisParser = class {
      /**
       * Javascript Redis Parser constructor
       * @param {{returnError: Function, returnReply: Function, returnFatalError?: Function, returnBuffers: boolean, stringNumbers: boolean }} options
       * @constructor
       */
      constructor(options) {
        if (!options) {
          throw new TypeError("Options are mandatory.");
        }
        if (typeof options.returnError !== "function" || typeof options.returnReply !== "function") {
          throw new TypeError("The returnReply and returnError options have to be functions.");
        }
        this.setReturnBuffers(!!options.returnBuffers);
        this.setStringNumbers(!!options.stringNumbers);
        this.returnError = options.returnError;
        this.returnFatalError = options.returnFatalError || options.returnError;
        this.returnReply = options.returnReply;
        this.reset();
      }
      /**
       * Reset the parser values to the initial state
       *
       * @returns {undefined}
       */
      reset() {
        this.offset = 0;
        this.buffer = null;
        this.bigStrSize = 0;
        this.totalChunkSize = 0;
        this.bufferCache = [];
        this.arrayCache = [];
        this.arrayPos = [];
      }
      /**
       * Set the returnBuffers option
       *
       * @param {boolean} returnBuffers
       * @returns {undefined}
       */
      setReturnBuffers(returnBuffers) {
        if (typeof returnBuffers !== "boolean") {
          throw new TypeError("The returnBuffers argument has to be a boolean");
        }
        this.optionReturnBuffers = returnBuffers;
      }
      /**
       * Set the stringNumbers option
       *
       * @param {boolean} stringNumbers
       * @returns {undefined}
       */
      setStringNumbers(stringNumbers) {
        if (typeof stringNumbers !== "boolean") {
          throw new TypeError("The stringNumbers argument has to be a boolean");
        }
        this.optionStringNumbers = stringNumbers;
      }
      /**
       * Parse the redis buffer
       * @param {Buffer} buffer
       * @returns {undefined}
       */
      execute(buffer) {
        if (this.buffer === null) {
          this.buffer = buffer;
          this.offset = 0;
        } else if (this.bigStrSize === 0) {
          const oldLength = this.buffer.length;
          const remainingLength = oldLength - this.offset;
          const newBuffer = Buffer2.allocUnsafe(remainingLength + buffer.length);
          this.buffer.copy(newBuffer, 0, this.offset, oldLength);
          buffer.copy(newBuffer, remainingLength, 0, buffer.length);
          this.buffer = newBuffer;
          this.offset = 0;
          if (this.arrayCache.length) {
            const arr = parseArrayChunks(this);
            if (arr === void 0) {
              return;
            }
            this.returnReply(arr);
          }
        } else if (this.totalChunkSize + buffer.length >= this.bigStrSize) {
          this.bufferCache.push(buffer);
          var tmp = this.optionReturnBuffers ? concatBulkBuffer(this) : concatBulkString(this);
          this.bigStrSize = 0;
          this.bufferCache = [];
          this.buffer = buffer;
          if (this.arrayCache.length) {
            this.arrayCache[0][this.arrayPos[0]++] = tmp;
            tmp = parseArrayChunks(this);
            if (tmp === void 0) {
              return;
            }
          }
          this.returnReply(tmp);
        } else {
          this.bufferCache.push(buffer);
          this.totalChunkSize += buffer.length;
          return;
        }
        while (this.offset < this.buffer.length) {
          const offset = this.offset;
          const type = this.buffer[this.offset++];
          const response = parseType(this, type);
          if (response === void 0) {
            if (!(this.arrayCache.length || this.bufferCache.length)) {
              this.offset = offset;
            }
            return;
          }
          if (type === 45) {
            this.returnError(response);
          } else {
            this.returnReply(response);
          }
        }
        this.buffer = null;
      }
    };
    module2.exports = JavascriptRedisParser;
  }
});

// ../../.bkjs/lib/node_modules/redis/node_modules/redis-parser/index.js
var require_redis_parser = __commonJS({
  "../../.bkjs/lib/node_modules/redis/node_modules/redis-parser/index.js"(exports2, module2) {
    "use strict";
    module2.exports = require_parser();
  }
});

// ../../.bkjs/lib/node_modules/redis/node_modules/redis-commands/commands.json
var require_commands = __commonJS({
  "../../.bkjs/lib/node_modules/redis/node_modules/redis-commands/commands.json"(exports2, module2) {
    module2.exports = {
      acl: {
        arity: -2,
        flags: [
          "admin",
          "noscript",
          "loading",
          "stale",
          "skip_slowlog"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      append: {
        arity: 3,
        flags: [
          "write",
          "denyoom",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      asking: {
        arity: 1,
        flags: [
          "fast"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      auth: {
        arity: -2,
        flags: [
          "noscript",
          "loading",
          "stale",
          "skip_monitor",
          "skip_slowlog",
          "fast",
          "no_auth"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      bgrewriteaof: {
        arity: 1,
        flags: [
          "admin",
          "noscript"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      bgsave: {
        arity: -1,
        flags: [
          "admin",
          "noscript"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      bitcount: {
        arity: -2,
        flags: [
          "readonly"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      bitfield: {
        arity: -2,
        flags: [
          "write",
          "denyoom"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      bitfield_ro: {
        arity: -2,
        flags: [
          "readonly",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      bitop: {
        arity: -4,
        flags: [
          "write",
          "denyoom"
        ],
        keyStart: 2,
        keyStop: -1,
        step: 1
      },
      bitpos: {
        arity: -3,
        flags: [
          "readonly"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      blmove: {
        arity: 6,
        flags: [
          "write",
          "denyoom",
          "noscript"
        ],
        keyStart: 1,
        keyStop: 2,
        step: 1
      },
      blpop: {
        arity: -3,
        flags: [
          "write",
          "noscript"
        ],
        keyStart: 1,
        keyStop: -2,
        step: 1
      },
      brpop: {
        arity: -3,
        flags: [
          "write",
          "noscript"
        ],
        keyStart: 1,
        keyStop: -2,
        step: 1
      },
      brpoplpush: {
        arity: 4,
        flags: [
          "write",
          "denyoom",
          "noscript"
        ],
        keyStart: 1,
        keyStop: 2,
        step: 1
      },
      bzpopmax: {
        arity: -3,
        flags: [
          "write",
          "noscript",
          "fast"
        ],
        keyStart: 1,
        keyStop: -2,
        step: 1
      },
      bzpopmin: {
        arity: -3,
        flags: [
          "write",
          "noscript",
          "fast"
        ],
        keyStart: 1,
        keyStop: -2,
        step: 1
      },
      client: {
        arity: -2,
        flags: [
          "admin",
          "noscript",
          "random",
          "loading",
          "stale"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      cluster: {
        arity: -2,
        flags: [
          "admin",
          "random",
          "stale"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      command: {
        arity: -1,
        flags: [
          "random",
          "loading",
          "stale"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      config: {
        arity: -2,
        flags: [
          "admin",
          "noscript",
          "loading",
          "stale"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      copy: {
        arity: -3,
        flags: [
          "write",
          "denyoom"
        ],
        keyStart: 1,
        keyStop: 2,
        step: 1
      },
      dbsize: {
        arity: 1,
        flags: [
          "readonly",
          "fast"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      debug: {
        arity: -2,
        flags: [
          "admin",
          "noscript",
          "loading",
          "stale"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      decr: {
        arity: 2,
        flags: [
          "write",
          "denyoom",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      decrby: {
        arity: 3,
        flags: [
          "write",
          "denyoom",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      del: {
        arity: -2,
        flags: [
          "write"
        ],
        keyStart: 1,
        keyStop: -1,
        step: 1
      },
      discard: {
        arity: 1,
        flags: [
          "noscript",
          "loading",
          "stale",
          "fast"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      dump: {
        arity: 2,
        flags: [
          "readonly",
          "random"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      echo: {
        arity: 2,
        flags: [
          "fast"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      eval: {
        arity: -3,
        flags: [
          "noscript",
          "may_replicate",
          "movablekeys"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      evalsha: {
        arity: -3,
        flags: [
          "noscript",
          "may_replicate",
          "movablekeys"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      exec: {
        arity: 1,
        flags: [
          "noscript",
          "loading",
          "stale",
          "skip_monitor",
          "skip_slowlog"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      exists: {
        arity: -2,
        flags: [
          "readonly",
          "fast"
        ],
        keyStart: 1,
        keyStop: -1,
        step: 1
      },
      expire: {
        arity: 3,
        flags: [
          "write",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      expireat: {
        arity: 3,
        flags: [
          "write",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      failover: {
        arity: -1,
        flags: [
          "admin",
          "noscript",
          "stale"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      flushall: {
        arity: -1,
        flags: [
          "write"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      flushdb: {
        arity: -1,
        flags: [
          "write"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      geoadd: {
        arity: -5,
        flags: [
          "write",
          "denyoom"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      geodist: {
        arity: -4,
        flags: [
          "readonly"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      geohash: {
        arity: -2,
        flags: [
          "readonly"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      geopos: {
        arity: -2,
        flags: [
          "readonly"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      georadius: {
        arity: -6,
        flags: [
          "write",
          "denyoom",
          "movablekeys"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      georadius_ro: {
        arity: -6,
        flags: [
          "readonly"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      georadiusbymember: {
        arity: -5,
        flags: [
          "write",
          "denyoom",
          "movablekeys"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      georadiusbymember_ro: {
        arity: -5,
        flags: [
          "readonly"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      geosearch: {
        arity: -7,
        flags: [
          "readonly"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      geosearchstore: {
        arity: -8,
        flags: [
          "write",
          "denyoom"
        ],
        keyStart: 1,
        keyStop: 2,
        step: 1
      },
      get: {
        arity: 2,
        flags: [
          "readonly",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      getbit: {
        arity: 3,
        flags: [
          "readonly",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      getdel: {
        arity: 2,
        flags: [
          "write",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      getex: {
        arity: -2,
        flags: [
          "write",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      getrange: {
        arity: 4,
        flags: [
          "readonly"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      getset: {
        arity: 3,
        flags: [
          "write",
          "denyoom",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      hdel: {
        arity: -3,
        flags: [
          "write",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      hello: {
        arity: -1,
        flags: [
          "noscript",
          "loading",
          "stale",
          "skip_monitor",
          "skip_slowlog",
          "fast",
          "no_auth"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      hexists: {
        arity: 3,
        flags: [
          "readonly",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      hget: {
        arity: 3,
        flags: [
          "readonly",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      hgetall: {
        arity: 2,
        flags: [
          "readonly",
          "random"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      hincrby: {
        arity: 4,
        flags: [
          "write",
          "denyoom",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      hincrbyfloat: {
        arity: 4,
        flags: [
          "write",
          "denyoom",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      hkeys: {
        arity: 2,
        flags: [
          "readonly",
          "sort_for_script"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      hlen: {
        arity: 2,
        flags: [
          "readonly",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      hmget: {
        arity: -3,
        flags: [
          "readonly",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      hmset: {
        arity: -4,
        flags: [
          "write",
          "denyoom",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      "host:": {
        arity: -1,
        flags: [
          "readonly",
          "loading",
          "stale"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      hrandfield: {
        arity: -2,
        flags: [
          "readonly",
          "random"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      hscan: {
        arity: -3,
        flags: [
          "readonly",
          "random"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      hset: {
        arity: -4,
        flags: [
          "write",
          "denyoom",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      hsetnx: {
        arity: 4,
        flags: [
          "write",
          "denyoom",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      hstrlen: {
        arity: 3,
        flags: [
          "readonly",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      hvals: {
        arity: 2,
        flags: [
          "readonly",
          "sort_for_script"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      incr: {
        arity: 2,
        flags: [
          "write",
          "denyoom",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      incrby: {
        arity: 3,
        flags: [
          "write",
          "denyoom",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      incrbyfloat: {
        arity: 3,
        flags: [
          "write",
          "denyoom",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      info: {
        arity: -1,
        flags: [
          "random",
          "loading",
          "stale"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      keys: {
        arity: 2,
        flags: [
          "readonly",
          "sort_for_script"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      lastsave: {
        arity: 1,
        flags: [
          "random",
          "loading",
          "stale",
          "fast"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      latency: {
        arity: -2,
        flags: [
          "admin",
          "noscript",
          "loading",
          "stale"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      lindex: {
        arity: 3,
        flags: [
          "readonly"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      linsert: {
        arity: 5,
        flags: [
          "write",
          "denyoom"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      llen: {
        arity: 2,
        flags: [
          "readonly",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      lmove: {
        arity: 5,
        flags: [
          "write",
          "denyoom"
        ],
        keyStart: 1,
        keyStop: 2,
        step: 1
      },
      lolwut: {
        arity: -1,
        flags: [
          "readonly",
          "fast"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      lpop: {
        arity: -2,
        flags: [
          "write",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      lpos: {
        arity: -3,
        flags: [
          "readonly"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      lpush: {
        arity: -3,
        flags: [
          "write",
          "denyoom",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      lpushx: {
        arity: -3,
        flags: [
          "write",
          "denyoom",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      lrange: {
        arity: 4,
        flags: [
          "readonly"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      lrem: {
        arity: 4,
        flags: [
          "write"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      lset: {
        arity: 4,
        flags: [
          "write",
          "denyoom"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      ltrim: {
        arity: 4,
        flags: [
          "write"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      memory: {
        arity: -2,
        flags: [
          "readonly",
          "random",
          "movablekeys"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      mget: {
        arity: -2,
        flags: [
          "readonly",
          "fast"
        ],
        keyStart: 1,
        keyStop: -1,
        step: 1
      },
      migrate: {
        arity: -6,
        flags: [
          "write",
          "random",
          "movablekeys"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      module: {
        arity: -2,
        flags: [
          "admin",
          "noscript"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      monitor: {
        arity: 1,
        flags: [
          "admin",
          "noscript",
          "loading",
          "stale"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      move: {
        arity: 3,
        flags: [
          "write",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      mset: {
        arity: -3,
        flags: [
          "write",
          "denyoom"
        ],
        keyStart: 1,
        keyStop: -1,
        step: 2
      },
      msetnx: {
        arity: -3,
        flags: [
          "write",
          "denyoom"
        ],
        keyStart: 1,
        keyStop: -1,
        step: 2
      },
      multi: {
        arity: 1,
        flags: [
          "noscript",
          "loading",
          "stale",
          "fast"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      object: {
        arity: -2,
        flags: [
          "readonly",
          "random"
        ],
        keyStart: 2,
        keyStop: 2,
        step: 1
      },
      persist: {
        arity: 2,
        flags: [
          "write",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      pexpire: {
        arity: 3,
        flags: [
          "write",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      pexpireat: {
        arity: 3,
        flags: [
          "write",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      pfadd: {
        arity: -2,
        flags: [
          "write",
          "denyoom",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      pfcount: {
        arity: -2,
        flags: [
          "readonly",
          "may_replicate"
        ],
        keyStart: 1,
        keyStop: -1,
        step: 1
      },
      pfdebug: {
        arity: -3,
        flags: [
          "write",
          "denyoom",
          "admin"
        ],
        keyStart: 2,
        keyStop: 2,
        step: 1
      },
      pfmerge: {
        arity: -2,
        flags: [
          "write",
          "denyoom"
        ],
        keyStart: 1,
        keyStop: -1,
        step: 1
      },
      pfselftest: {
        arity: 1,
        flags: [
          "admin"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      ping: {
        arity: -1,
        flags: [
          "stale",
          "fast"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      post: {
        arity: -1,
        flags: [
          "readonly",
          "loading",
          "stale"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      psetex: {
        arity: 4,
        flags: [
          "write",
          "denyoom"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      psubscribe: {
        arity: -2,
        flags: [
          "pubsub",
          "noscript",
          "loading",
          "stale"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      psync: {
        arity: -3,
        flags: [
          "admin",
          "noscript"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      pttl: {
        arity: 2,
        flags: [
          "readonly",
          "random",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      publish: {
        arity: 3,
        flags: [
          "pubsub",
          "loading",
          "stale",
          "fast",
          "may_replicate"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      pubsub: {
        arity: -2,
        flags: [
          "pubsub",
          "random",
          "loading",
          "stale"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      punsubscribe: {
        arity: -1,
        flags: [
          "pubsub",
          "noscript",
          "loading",
          "stale"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      quit: {
        arity: 1,
        flags: [
          "loading",
          "stale",
          "readonly"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      randomkey: {
        arity: 1,
        flags: [
          "readonly",
          "random"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      readonly: {
        arity: 1,
        flags: [
          "fast"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      readwrite: {
        arity: 1,
        flags: [
          "fast"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      rename: {
        arity: 3,
        flags: [
          "write"
        ],
        keyStart: 1,
        keyStop: 2,
        step: 1
      },
      renamenx: {
        arity: 3,
        flags: [
          "write",
          "fast"
        ],
        keyStart: 1,
        keyStop: 2,
        step: 1
      },
      replconf: {
        arity: -1,
        flags: [
          "admin",
          "noscript",
          "loading",
          "stale"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      replicaof: {
        arity: 3,
        flags: [
          "admin",
          "noscript",
          "stale"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      reset: {
        arity: 1,
        flags: [
          "noscript",
          "loading",
          "stale",
          "fast"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      restore: {
        arity: -4,
        flags: [
          "write",
          "denyoom"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      "restore-asking": {
        arity: -4,
        flags: [
          "write",
          "denyoom",
          "asking"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      role: {
        arity: 1,
        flags: [
          "noscript",
          "loading",
          "stale",
          "fast"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      rpop: {
        arity: -2,
        flags: [
          "write",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      rpoplpush: {
        arity: 3,
        flags: [
          "write",
          "denyoom"
        ],
        keyStart: 1,
        keyStop: 2,
        step: 1
      },
      rpush: {
        arity: -3,
        flags: [
          "write",
          "denyoom",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      rpushx: {
        arity: -3,
        flags: [
          "write",
          "denyoom",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      sadd: {
        arity: -3,
        flags: [
          "write",
          "denyoom",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      save: {
        arity: 1,
        flags: [
          "admin",
          "noscript"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      scan: {
        arity: -2,
        flags: [
          "readonly",
          "random"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      scard: {
        arity: 2,
        flags: [
          "readonly",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      script: {
        arity: -2,
        flags: [
          "noscript",
          "may_replicate"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      sdiff: {
        arity: -2,
        flags: [
          "readonly",
          "sort_for_script"
        ],
        keyStart: 1,
        keyStop: -1,
        step: 1
      },
      sdiffstore: {
        arity: -3,
        flags: [
          "write",
          "denyoom"
        ],
        keyStart: 1,
        keyStop: -1,
        step: 1
      },
      select: {
        arity: 2,
        flags: [
          "loading",
          "stale",
          "fast"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      set: {
        arity: -3,
        flags: [
          "write",
          "denyoom"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      setbit: {
        arity: 4,
        flags: [
          "write",
          "denyoom"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      setex: {
        arity: 4,
        flags: [
          "write",
          "denyoom"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      setnx: {
        arity: 3,
        flags: [
          "write",
          "denyoom",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      setrange: {
        arity: 4,
        flags: [
          "write",
          "denyoom"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      shutdown: {
        arity: -1,
        flags: [
          "admin",
          "noscript",
          "loading",
          "stale"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      sinter: {
        arity: -2,
        flags: [
          "readonly",
          "sort_for_script"
        ],
        keyStart: 1,
        keyStop: -1,
        step: 1
      },
      sinterstore: {
        arity: -3,
        flags: [
          "write",
          "denyoom"
        ],
        keyStart: 1,
        keyStop: -1,
        step: 1
      },
      sismember: {
        arity: 3,
        flags: [
          "readonly",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      slaveof: {
        arity: 3,
        flags: [
          "admin",
          "noscript",
          "stale"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      slowlog: {
        arity: -2,
        flags: [
          "admin",
          "random",
          "loading",
          "stale"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      smembers: {
        arity: 2,
        flags: [
          "readonly",
          "sort_for_script"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      smismember: {
        arity: -3,
        flags: [
          "readonly",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      smove: {
        arity: 4,
        flags: [
          "write",
          "fast"
        ],
        keyStart: 1,
        keyStop: 2,
        step: 1
      },
      sort: {
        arity: -2,
        flags: [
          "write",
          "denyoom",
          "movablekeys"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      spop: {
        arity: -2,
        flags: [
          "write",
          "random",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      srandmember: {
        arity: -2,
        flags: [
          "readonly",
          "random"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      srem: {
        arity: -3,
        flags: [
          "write",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      sscan: {
        arity: -3,
        flags: [
          "readonly",
          "random"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      stralgo: {
        arity: -2,
        flags: [
          "readonly",
          "movablekeys"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      strlen: {
        arity: 2,
        flags: [
          "readonly",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      subscribe: {
        arity: -2,
        flags: [
          "pubsub",
          "noscript",
          "loading",
          "stale"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      substr: {
        arity: 4,
        flags: [
          "readonly"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      sunion: {
        arity: -2,
        flags: [
          "readonly",
          "sort_for_script"
        ],
        keyStart: 1,
        keyStop: -1,
        step: 1
      },
      sunionstore: {
        arity: -3,
        flags: [
          "write",
          "denyoom"
        ],
        keyStart: 1,
        keyStop: -1,
        step: 1
      },
      swapdb: {
        arity: 3,
        flags: [
          "write",
          "fast"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      sync: {
        arity: 1,
        flags: [
          "admin",
          "noscript"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      time: {
        arity: 1,
        flags: [
          "random",
          "loading",
          "stale",
          "fast"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      touch: {
        arity: -2,
        flags: [
          "readonly",
          "fast"
        ],
        keyStart: 1,
        keyStop: -1,
        step: 1
      },
      ttl: {
        arity: 2,
        flags: [
          "readonly",
          "random",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      type: {
        arity: 2,
        flags: [
          "readonly",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      unlink: {
        arity: -2,
        flags: [
          "write",
          "fast"
        ],
        keyStart: 1,
        keyStop: -1,
        step: 1
      },
      unsubscribe: {
        arity: -1,
        flags: [
          "pubsub",
          "noscript",
          "loading",
          "stale"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      unwatch: {
        arity: 1,
        flags: [
          "noscript",
          "loading",
          "stale",
          "fast"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      wait: {
        arity: 3,
        flags: [
          "noscript"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      watch: {
        arity: -2,
        flags: [
          "noscript",
          "loading",
          "stale",
          "fast"
        ],
        keyStart: 1,
        keyStop: -1,
        step: 1
      },
      xack: {
        arity: -4,
        flags: [
          "write",
          "random",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      xadd: {
        arity: -5,
        flags: [
          "write",
          "denyoom",
          "random",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      xautoclaim: {
        arity: -6,
        flags: [
          "write",
          "random",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      xclaim: {
        arity: -6,
        flags: [
          "write",
          "random",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      xdel: {
        arity: -3,
        flags: [
          "write",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      xgroup: {
        arity: -2,
        flags: [
          "write",
          "denyoom"
        ],
        keyStart: 2,
        keyStop: 2,
        step: 1
      },
      xinfo: {
        arity: -2,
        flags: [
          "readonly",
          "random"
        ],
        keyStart: 2,
        keyStop: 2,
        step: 1
      },
      xlen: {
        arity: 2,
        flags: [
          "readonly",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      xpending: {
        arity: -3,
        flags: [
          "readonly",
          "random"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      xrange: {
        arity: -4,
        flags: [
          "readonly"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      xread: {
        arity: -4,
        flags: [
          "readonly",
          "movablekeys"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      xreadgroup: {
        arity: -7,
        flags: [
          "write",
          "movablekeys"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      xrevrange: {
        arity: -4,
        flags: [
          "readonly"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      xsetid: {
        arity: 3,
        flags: [
          "write",
          "denyoom",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      xtrim: {
        arity: -2,
        flags: [
          "write",
          "random"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      zadd: {
        arity: -4,
        flags: [
          "write",
          "denyoom",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      zcard: {
        arity: 2,
        flags: [
          "readonly",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      zcount: {
        arity: 4,
        flags: [
          "readonly",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      zdiff: {
        arity: -3,
        flags: [
          "readonly",
          "movablekeys"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      zdiffstore: {
        arity: -4,
        flags: [
          "write",
          "denyoom",
          "movablekeys"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      zincrby: {
        arity: 4,
        flags: [
          "write",
          "denyoom",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      zinter: {
        arity: -3,
        flags: [
          "readonly",
          "movablekeys"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      zinterstore: {
        arity: -4,
        flags: [
          "write",
          "denyoom",
          "movablekeys"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      zlexcount: {
        arity: 4,
        flags: [
          "readonly",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      zmscore: {
        arity: -3,
        flags: [
          "readonly",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      zpopmax: {
        arity: -2,
        flags: [
          "write",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      zpopmin: {
        arity: -2,
        flags: [
          "write",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      zrandmember: {
        arity: -2,
        flags: [
          "readonly",
          "random"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      zrange: {
        arity: -4,
        flags: [
          "readonly"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      zrangebylex: {
        arity: -4,
        flags: [
          "readonly"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      zrangebyscore: {
        arity: -4,
        flags: [
          "readonly"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      zrangestore: {
        arity: -5,
        flags: [
          "write",
          "denyoom"
        ],
        keyStart: 1,
        keyStop: 2,
        step: 1
      },
      zrank: {
        arity: 3,
        flags: [
          "readonly",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      zrem: {
        arity: -3,
        flags: [
          "write",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      zremrangebylex: {
        arity: 4,
        flags: [
          "write"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      zremrangebyrank: {
        arity: 4,
        flags: [
          "write"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      zremrangebyscore: {
        arity: 4,
        flags: [
          "write"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      zrevrange: {
        arity: -4,
        flags: [
          "readonly"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      zrevrangebylex: {
        arity: -4,
        flags: [
          "readonly"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      zrevrangebyscore: {
        arity: -4,
        flags: [
          "readonly"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      zrevrank: {
        arity: 3,
        flags: [
          "readonly",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      zscan: {
        arity: -3,
        flags: [
          "readonly",
          "random"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      zscore: {
        arity: 3,
        flags: [
          "readonly",
          "fast"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      },
      zunion: {
        arity: -3,
        flags: [
          "readonly",
          "movablekeys"
        ],
        keyStart: 0,
        keyStop: 0,
        step: 0
      },
      zunionstore: {
        arity: -4,
        flags: [
          "write",
          "denyoom",
          "movablekeys"
        ],
        keyStart: 1,
        keyStop: 1,
        step: 1
      }
    };
  }
});

// ../../.bkjs/lib/node_modules/redis/node_modules/redis-commands/index.js
var require_redis_commands = __commonJS({
  "../../.bkjs/lib/node_modules/redis/node_modules/redis-commands/index.js"(exports2) {
    "use strict";
    var commands = require_commands();
    exports2.list = Object.keys(commands);
    var flags = {};
    exports2.list.forEach(function(commandName) {
      flags[commandName] = commands[commandName].flags.reduce(function(flags2, flag) {
        flags2[flag] = true;
        return flags2;
      }, {});
    });
    exports2.exists = function(commandName) {
      return Boolean(commands[commandName]);
    };
    exports2.hasFlag = function(commandName, flag) {
      if (!flags[commandName]) {
        throw new Error("Unknown command " + commandName);
      }
      return Boolean(flags[commandName][flag]);
    };
    exports2.getKeyIndexes = function(commandName, args, options) {
      var command = commands[commandName];
      if (!command) {
        throw new Error("Unknown command " + commandName);
      }
      if (!Array.isArray(args)) {
        throw new Error("Expect args to be an array");
      }
      var keys = [];
      var i, keyStart, keyStop, parseExternalKey;
      switch (commandName) {
        case "zunionstore":
        case "zinterstore":
          keys.push(0);
        // fall through
        case "eval":
        case "evalsha":
          keyStop = Number(args[1]) + 2;
          for (i = 2; i < keyStop; i++) {
            keys.push(i);
          }
          break;
        case "sort":
          parseExternalKey = options && options.parseExternalKey;
          keys.push(0);
          for (i = 1; i < args.length - 1; i++) {
            if (typeof args[i] !== "string") {
              continue;
            }
            var directive = args[i].toUpperCase();
            if (directive === "GET") {
              i += 1;
              if (args[i] !== "#") {
                if (parseExternalKey) {
                  keys.push([i, getExternalKeyNameLength(args[i])]);
                } else {
                  keys.push(i);
                }
              }
            } else if (directive === "BY") {
              i += 1;
              if (parseExternalKey) {
                keys.push([i, getExternalKeyNameLength(args[i])]);
              } else {
                keys.push(i);
              }
            } else if (directive === "STORE") {
              i += 1;
              keys.push(i);
            }
          }
          break;
        case "migrate":
          if (args[2] === "") {
            for (i = 5; i < args.length - 1; i++) {
              if (args[i].toUpperCase() === "KEYS") {
                for (var j = i + 1; j < args.length; j++) {
                  keys.push(j);
                }
                break;
              }
            }
          } else {
            keys.push(2);
          }
          break;
        case "xreadgroup":
        case "xread":
          for (i = commandName === "xread" ? 0 : 3; i < args.length - 1; i++) {
            if (String(args[i]).toUpperCase() === "STREAMS") {
              for (j = i + 1; j <= i + (args.length - 1 - i) / 2; j++) {
                keys.push(j);
              }
              break;
            }
          }
          break;
        default:
          if (command.step > 0) {
            keyStart = command.keyStart - 1;
            keyStop = command.keyStop > 0 ? command.keyStop : args.length + command.keyStop + 1;
            for (i = keyStart; i < keyStop; i += command.step) {
              keys.push(i);
            }
          }
          break;
      }
      return keys;
    };
    function getExternalKeyNameLength(key) {
      if (typeof key !== "string") {
        key = String(key);
      }
      var hashPos = key.indexOf("->");
      return hashPos === -1 ? key.length : hashPos;
    }
  }
});

// ../../.bkjs/lib/node_modules/redis/lib/debug.js
var require_debug = __commonJS({
  "../../.bkjs/lib/node_modules/redis/lib/debug.js"(exports2, module2) {
    "use strict";
    var index = require_index();
    function debug() {
      if (index.debug_mode) {
        var data = Array.prototype.slice.call(arguments);
        data.unshift((/* @__PURE__ */ new Date()).toISOString());
        console.error.apply(null, data);
      }
    }
    module2.exports = debug;
  }
});

// ../../.bkjs/lib/node_modules/redis/lib/createClient.js
var require_createClient = __commonJS({
  "../../.bkjs/lib/node_modules/redis/lib/createClient.js"(exports2, module2) {
    "use strict";
    var utils = require_utils();
    var URL = require("url");
    module2.exports = function createClient(port_arg, host_arg, options) {
      if (typeof port_arg === "number" || typeof port_arg === "string" && /^\d+$/.test(port_arg)) {
        var host;
        if (typeof host_arg === "string") {
          host = host_arg;
        } else {
          if (options && host_arg) {
            throw new TypeError("Unknown type of connection in createClient()");
          }
          options = options || host_arg;
        }
        options = utils.clone(options);
        options.host = host || options.host;
        options.port = port_arg;
      } else if (typeof port_arg === "string" || port_arg && port_arg.url) {
        options = utils.clone(port_arg.url ? port_arg : host_arg || options);
        var url = port_arg.url || port_arg;
        var parsed = URL.parse(url, true, true);
        if (parsed.slashes) {
          if (parsed.auth) {
            var columnIndex = parsed.auth.indexOf(":");
            options.password = parsed.auth.slice(columnIndex + 1);
            if (columnIndex > 0) {
              options.user = parsed.auth.slice(0, columnIndex);
            }
          }
          if (parsed.protocol) {
            if (parsed.protocol === "rediss:") {
              options.tls = options.tls || {};
            } else if (parsed.protocol !== "redis:") {
              console.warn('node_redis: WARNING: You passed "' + parsed.protocol.substring(0, parsed.protocol.length - 1) + '" as protocol instead of the "redis" protocol!');
            }
          }
          if (parsed.pathname && parsed.pathname !== "/") {
            options.db = parsed.pathname.substr(1);
          }
          if (parsed.hostname) {
            options.host = parsed.hostname;
          }
          if (parsed.port) {
            options.port = parsed.port;
          }
          if (parsed.search !== "") {
            var elem;
            for (elem in parsed.query) {
              if (elem in options) {
                if (options[elem] === parsed.query[elem]) {
                  console.warn("node_redis: WARNING: You passed the " + elem + " option twice!");
                } else {
                  throw new RangeError("The " + elem + " option is added twice and does not match");
                }
              }
              options[elem] = parsed.query[elem];
            }
          }
        } else if (parsed.hostname) {
          throw new RangeError('The redis url must begin with slashes "//" or contain slashes after the redis protocol');
        } else {
          options.path = url;
        }
      } else if (typeof port_arg === "object" || port_arg === void 0) {
        options = utils.clone(port_arg || options);
        options.host = options.host || host_arg;
        if (port_arg && arguments.length !== 1) {
          throw new TypeError("Too many arguments passed to createClient. Please only pass the options object");
        }
      }
      if (!options) {
        throw new TypeError("Unknown type of connection in createClient()");
      }
      return options;
    };
  }
});

// ../../.bkjs/lib/node_modules/redis/lib/multi.js
var require_multi = __commonJS({
  "../../.bkjs/lib/node_modules/redis/lib/multi.js"(exports2, module2) {
    "use strict";
    var Queue = require_denque();
    var utils = require_utils();
    var Command = require_command();
    function Multi(client, args) {
      this._client = client;
      this.queue = new Queue();
      var command, tmp_args;
      if (args) {
        for (var i = 0; i < args.length; i++) {
          command = args[i][0];
          tmp_args = args[i].slice(1);
          if (Array.isArray(command)) {
            this[command[0]].apply(this, command.slice(1).concat(tmp_args));
          } else {
            this[command].apply(this, tmp_args);
          }
        }
      }
    }
    function pipeline_transaction_command(self, command_obj, index) {
      var tmp = command_obj.callback;
      command_obj.callback = function(err, reply) {
        if (err && index !== -1) {
          if (tmp) {
            tmp(err);
          }
          err.position = index;
          self.errors.push(err);
        }
        self.wants_buffers[index] = command_obj.buffer_args;
        command_obj.callback = tmp;
      };
      self._client.internal_send_command(command_obj);
    }
    Multi.prototype.exec_atomic = Multi.prototype.EXEC_ATOMIC = Multi.prototype.execAtomic = function exec_atomic(callback) {
      if (this.queue.length < 2) {
        return this.exec_batch(callback);
      }
      return this.exec(callback);
    };
    function multi_callback(self, err, replies) {
      var i = 0, command_obj;
      if (err) {
        err.errors = self.errors;
        if (self.callback) {
          self.callback(err);
        } else if (err.code !== "CONNECTION_BROKEN") {
          self._client.emit("error", err);
        }
        return;
      }
      if (replies) {
        while (command_obj = self.queue.shift()) {
          if (replies[i] instanceof Error) {
            var match = replies[i].message.match(utils.err_code);
            if (match) {
              replies[i].code = match[1];
            }
            replies[i].command = command_obj.command.toUpperCase();
            if (typeof command_obj.callback === "function") {
              command_obj.callback(replies[i]);
            }
          } else {
            replies[i] = self._client.handle_reply(replies[i], command_obj.command, self.wants_buffers[i]);
            if (typeof command_obj.callback === "function") {
              command_obj.callback(null, replies[i]);
            }
          }
          i++;
        }
      }
      if (self.callback) {
        self.callback(null, replies);
      }
    }
    Multi.prototype.exec_transaction = function exec_transaction(callback) {
      if (this.monitoring || this._client.monitoring) {
        var err = new RangeError(
          "Using transaction with a client that is in monitor mode does not work due to faulty return values of Redis."
        );
        err.command = "EXEC";
        err.code = "EXECABORT";
        return utils.reply_in_order(this._client, callback, err);
      }
      var self = this;
      var len = self.queue.length;
      self.errors = [];
      self.callback = callback;
      self._client.cork();
      self.wants_buffers = new Array(len);
      pipeline_transaction_command(self, new Command("multi", []), -1);
      for (var index = 0; index < len; index++) {
        pipeline_transaction_command(self, self.queue.get(index), index);
      }
      self._client.internal_send_command(new Command("exec", [], function(err2, replies) {
        multi_callback(self, err2, replies);
      }));
      self._client.uncork();
      return !self._client.should_buffer;
    };
    function batch_callback(self, cb, i) {
      return function batch_callback2(err, res) {
        if (err) {
          self.results[i] = err;
          self.results[i].position = i;
        } else {
          self.results[i] = res;
        }
        cb(err, res);
      };
    }
    Multi.prototype.exec = Multi.prototype.EXEC = Multi.prototype.exec_batch = function exec_batch(callback) {
      var self = this;
      var len = self.queue.length;
      var index = 0;
      var command_obj;
      if (len === 0) {
        utils.reply_in_order(self._client, callback, null, []);
        return !self._client.should_buffer;
      }
      self._client.cork();
      if (!callback) {
        while (command_obj = self.queue.shift()) {
          self._client.internal_send_command(command_obj);
        }
        self._client.uncork();
        return !self._client.should_buffer;
      }
      var callback_without_own_cb = function(err, res) {
        if (err) {
          self.results.push(err);
          var i = self.results.length - 1;
          self.results[i].position = i;
        } else {
          self.results.push(res);
        }
      };
      var last_callback = function(cb) {
        return function(err, res) {
          cb(err, res);
          callback(null, self.results);
        };
      };
      self.results = [];
      while (command_obj = self.queue.shift()) {
        if (typeof command_obj.callback === "function") {
          command_obj.callback = batch_callback(self, command_obj.callback, index);
        } else {
          command_obj.callback = callback_without_own_cb;
        }
        if (typeof callback === "function" && index === len - 1) {
          command_obj.callback = last_callback(command_obj.callback);
        }
        this._client.internal_send_command(command_obj);
        index++;
      }
      self._client.uncork();
      return !self._client.should_buffer;
    };
    module2.exports = Multi;
  }
});

// ../../.bkjs/lib/node_modules/redis/lib/individualCommands.js
var require_individualCommands = __commonJS({
  "../../.bkjs/lib/node_modules/redis/lib/individualCommands.js"() {
    "use strict";
    var utils = require_utils();
    var debug = require_debug();
    var Multi = require_multi();
    var Command = require_command();
    var no_password_is_set = /no password is set|called without any password configured/;
    var loading = /LOADING/;
    var RedisClient = require_index().RedisClient;
    RedisClient.prototype.multi = RedisClient.prototype.MULTI = function multi(args) {
      var multi2 = new Multi(this, args);
      multi2.exec = multi2.EXEC = multi2.exec_transaction;
      return multi2;
    };
    RedisClient.prototype.batch = RedisClient.prototype.BATCH = function batch(args) {
      return new Multi(this, args);
    };
    function select_callback(self, db, callback) {
      return function(err, res) {
        if (err === null) {
          self.selected_db = db;
        }
        utils.callback_or_emit(self, callback, err, res);
      };
    }
    RedisClient.prototype.select = RedisClient.prototype.SELECT = function select(db, callback) {
      return this.internal_send_command(new Command("select", [db], select_callback(this, db, callback)));
    };
    Multi.prototype.select = Multi.prototype.SELECT = function select(db, callback) {
      this.queue.push(new Command("select", [db], select_callback(this._client, db, callback)));
      return this;
    };
    RedisClient.prototype.monitor = RedisClient.prototype.MONITOR = function monitor(callback) {
      var self = this;
      var call_on_write = function() {
        self.monitoring = true;
      };
      return this.internal_send_command(new Command("monitor", [], callback, call_on_write));
    };
    Multi.prototype.monitor = Multi.prototype.MONITOR = function monitor(callback) {
      if (this.exec !== this.exec_transaction) {
        var self = this;
        var call_on_write = function() {
          self._client.monitoring = true;
        };
        this.queue.push(new Command("monitor", [], callback, call_on_write));
        return this;
      }
      this.monitoring = true;
      return this;
    };
    function quit_callback(self, callback) {
      return function(err, res) {
        if (err && err.code === "NR_CLOSED") {
          err = null;
          res = "OK";
        }
        utils.callback_or_emit(self, callback, err, res);
        if (self.stream.writable) {
          self.stream.destroy();
        }
      };
    }
    RedisClient.prototype.QUIT = RedisClient.prototype.quit = function quit(callback) {
      var backpressure_indicator = this.internal_send_command(new Command("quit", [], quit_callback(this, callback)));
      this.closing = true;
      this.ready = false;
      return backpressure_indicator;
    };
    Multi.prototype.QUIT = Multi.prototype.quit = function quit(callback) {
      var self = this._client;
      var call_on_write = function() {
        self.closing = true;
        self.ready = false;
      };
      this.queue.push(new Command("quit", [], quit_callback(self, callback), call_on_write));
      return this;
    };
    function info_callback(self, callback) {
      return function(err, res) {
        if (res) {
          var obj = {};
          var lines = res.toString().split("\r\n");
          var line, parts, sub_parts;
          for (var i = 0; i < lines.length; i++) {
            parts = lines[i].split(":");
            if (parts[1]) {
              if (parts[0].indexOf("db") === 0) {
                sub_parts = parts[1].split(",");
                obj[parts[0]] = {};
                while (line = sub_parts.pop()) {
                  line = line.split("=");
                  obj[parts[0]][line[0]] = +line[1];
                }
              } else {
                obj[parts[0]] = parts[1];
              }
            }
          }
          obj.versions = [];
          if (obj.redis_version) {
            obj.redis_version.split(".").forEach(function(num) {
              obj.versions.push(+num);
            });
          }
          self.server_info = obj;
        } else {
          self.server_info = {};
        }
        utils.callback_or_emit(self, callback, err, res);
      };
    }
    RedisClient.prototype.info = RedisClient.prototype.INFO = function info(section, callback) {
      var args = [];
      if (typeof section === "function") {
        callback = section;
      } else if (section !== void 0) {
        args = Array.isArray(section) ? section : [section];
      }
      return this.internal_send_command(new Command("info", args, info_callback(this, callback)));
    };
    Multi.prototype.info = Multi.prototype.INFO = function info(section, callback) {
      var args = [];
      if (typeof section === "function") {
        callback = section;
      } else if (section !== void 0) {
        args = Array.isArray(section) ? section : [section];
      }
      this.queue.push(new Command("info", args, info_callback(this._client, callback)));
      return this;
    };
    function auth_callback(self, pass, user, callback) {
      return function(err, res) {
        if (err) {
          if (no_password_is_set.test(err.message)) {
            self.warn("Warning: Redis server does not require a password, but a password was supplied.");
            err = null;
            res = "OK";
          } else if (loading.test(err.message)) {
            debug("Redis still loading, trying to authenticate later");
            setTimeout(function() {
              self.auth(pass, user, callback);
            }, 100);
            return;
          }
        }
        utils.callback_or_emit(self, callback, err, res);
      };
    }
    RedisClient.prototype.auth = RedisClient.prototype.AUTH = function auth(pass, user, callback) {
      debug("Sending auth to " + this.address + " id " + this.connection_id);
      if (user instanceof Function) {
        callback = user;
        user = null;
      }
      this.auth_pass = pass;
      this.auth_user = user;
      var ready = this.ready;
      this.ready = ready || this.offline_queue.length === 0;
      var tmp = this.internal_send_command(new Command("auth", user ? [user, pass] : [pass], auth_callback(this, pass, user, callback)));
      this.ready = ready;
      return tmp;
    };
    Multi.prototype.auth = Multi.prototype.AUTH = function auth(pass, user, callback) {
      debug("Sending auth to " + this.address + " id " + this.connection_id);
      if (user instanceof Function) {
        callback = user;
        user = null;
      }
      this.auth_pass = pass;
      this.auth_user = user;
      this.queue.push(new Command("auth", user ? [user, pass] : [pass], auth_callback(this._client, pass, user, callback)));
      return this;
    };
    RedisClient.prototype.client = RedisClient.prototype.CLIENT = function client() {
      var arr, len = arguments.length, callback, i = 0;
      if (Array.isArray(arguments[0])) {
        arr = arguments[0];
        callback = arguments[1];
      } else if (Array.isArray(arguments[1])) {
        if (len === 3) {
          callback = arguments[2];
        }
        len = arguments[1].length;
        arr = new Array(len + 1);
        arr[0] = arguments[0];
        for (; i < len; i += 1) {
          arr[i + 1] = arguments[1][i];
        }
      } else {
        len = arguments.length;
        if (len !== 0 && (typeof arguments[len - 1] === "function" || typeof arguments[len - 1] === "undefined")) {
          len--;
          callback = arguments[len];
        }
        arr = new Array(len);
        for (; i < len; i += 1) {
          arr[i] = arguments[i];
        }
      }
      var self = this;
      var call_on_write = void 0;
      if (arr.length === 2 && arr[0].toString().toUpperCase() === "REPLY") {
        var reply_on_off = arr[1].toString().toUpperCase();
        if (reply_on_off === "ON" || reply_on_off === "OFF" || reply_on_off === "SKIP") {
          call_on_write = function() {
            self.reply = reply_on_off;
          };
        }
      }
      return this.internal_send_command(new Command("client", arr, callback, call_on_write));
    };
    Multi.prototype.client = Multi.prototype.CLIENT = function client() {
      var arr, len = arguments.length, callback, i = 0;
      if (Array.isArray(arguments[0])) {
        arr = arguments[0];
        callback = arguments[1];
      } else if (Array.isArray(arguments[1])) {
        if (len === 3) {
          callback = arguments[2];
        }
        len = arguments[1].length;
        arr = new Array(len + 1);
        arr[0] = arguments[0];
        for (; i < len; i += 1) {
          arr[i + 1] = arguments[1][i];
        }
      } else {
        len = arguments.length;
        if (len !== 0 && (typeof arguments[len - 1] === "function" || typeof arguments[len - 1] === "undefined")) {
          len--;
          callback = arguments[len];
        }
        arr = new Array(len);
        for (; i < len; i += 1) {
          arr[i] = arguments[i];
        }
      }
      var self = this._client;
      var call_on_write = void 0;
      if (arr.length === 2 && arr[0].toString().toUpperCase() === "REPLY") {
        var reply_on_off = arr[1].toString().toUpperCase();
        if (reply_on_off === "ON" || reply_on_off === "OFF" || reply_on_off === "SKIP") {
          call_on_write = function() {
            self.reply = reply_on_off;
          };
        }
      }
      this.queue.push(new Command("client", arr, callback, call_on_write));
      return this;
    };
    RedisClient.prototype.hmset = RedisClient.prototype.HMSET = function hmset() {
      var arr, len = arguments.length, callback, i = 0;
      if (Array.isArray(arguments[0])) {
        arr = arguments[0];
        callback = arguments[1];
      } else if (Array.isArray(arguments[1])) {
        if (len === 3) {
          callback = arguments[2];
        }
        len = arguments[1].length;
        arr = new Array(len + 1);
        arr[0] = arguments[0];
        for (; i < len; i += 1) {
          arr[i + 1] = arguments[1][i];
        }
      } else if (typeof arguments[1] === "object" && (arguments.length === 2 || arguments.length === 3 && (typeof arguments[2] === "function" || typeof arguments[2] === "undefined"))) {
        arr = [arguments[0]];
        for (var field in arguments[1]) {
          arr.push(field, arguments[1][field]);
        }
        callback = arguments[2];
      } else {
        len = arguments.length;
        if (len !== 0 && (typeof arguments[len - 1] === "function" || typeof arguments[len - 1] === "undefined")) {
          len--;
          callback = arguments[len];
        }
        arr = new Array(len);
        for (; i < len; i += 1) {
          arr[i] = arguments[i];
        }
      }
      return this.internal_send_command(new Command("hmset", arr, callback));
    };
    Multi.prototype.hmset = Multi.prototype.HMSET = function hmset() {
      var arr, len = arguments.length, callback, i = 0;
      if (Array.isArray(arguments[0])) {
        arr = arguments[0];
        callback = arguments[1];
      } else if (Array.isArray(arguments[1])) {
        if (len === 3) {
          callback = arguments[2];
        }
        len = arguments[1].length;
        arr = new Array(len + 1);
        arr[0] = arguments[0];
        for (; i < len; i += 1) {
          arr[i + 1] = arguments[1][i];
        }
      } else if (typeof arguments[1] === "object" && (arguments.length === 2 || arguments.length === 3 && (typeof arguments[2] === "function" || typeof arguments[2] === "undefined"))) {
        arr = [arguments[0]];
        for (var field in arguments[1]) {
          arr.push(field, arguments[1][field]);
        }
        callback = arguments[2];
      } else {
        len = arguments.length;
        if (len !== 0 && (typeof arguments[len - 1] === "function" || typeof arguments[len - 1] === "undefined")) {
          len--;
          callback = arguments[len];
        }
        arr = new Array(len);
        for (; i < len; i += 1) {
          arr[i] = arguments[i];
        }
      }
      this.queue.push(new Command("hmset", arr, callback));
      return this;
    };
    RedisClient.prototype.subscribe = RedisClient.prototype.SUBSCRIBE = function subscribe() {
      var arr, len = arguments.length, callback, i = 0;
      if (Array.isArray(arguments[0])) {
        arr = arguments[0].slice(0);
        callback = arguments[1];
      } else {
        len = arguments.length;
        if (len !== 0 && (typeof arguments[len - 1] === "function" || typeof arguments[len - 1] === "undefined")) {
          len--;
          callback = arguments[len];
        }
        arr = new Array(len);
        for (; i < len; i += 1) {
          arr[i] = arguments[i];
        }
      }
      var self = this;
      var call_on_write = function() {
        self.pub_sub_mode = self.pub_sub_mode || self.command_queue.length + 1;
      };
      return this.internal_send_command(new Command("subscribe", arr, callback, call_on_write));
    };
    Multi.prototype.subscribe = Multi.prototype.SUBSCRIBE = function subscribe() {
      var arr, len = arguments.length, callback, i = 0;
      if (Array.isArray(arguments[0])) {
        arr = arguments[0].slice(0);
        callback = arguments[1];
      } else {
        len = arguments.length;
        if (len !== 0 && (typeof arguments[len - 1] === "function" || typeof arguments[len - 1] === "undefined")) {
          len--;
          callback = arguments[len];
        }
        arr = new Array(len);
        for (; i < len; i += 1) {
          arr[i] = arguments[i];
        }
      }
      var self = this._client;
      var call_on_write = function() {
        self.pub_sub_mode = self.pub_sub_mode || self.command_queue.length + 1;
      };
      this.queue.push(new Command("subscribe", arr, callback, call_on_write));
      return this;
    };
    RedisClient.prototype.unsubscribe = RedisClient.prototype.UNSUBSCRIBE = function unsubscribe() {
      var arr, len = arguments.length, callback, i = 0;
      if (Array.isArray(arguments[0])) {
        arr = arguments[0].slice(0);
        callback = arguments[1];
      } else {
        len = arguments.length;
        if (len !== 0 && (typeof arguments[len - 1] === "function" || typeof arguments[len - 1] === "undefined")) {
          len--;
          callback = arguments[len];
        }
        arr = new Array(len);
        for (; i < len; i += 1) {
          arr[i] = arguments[i];
        }
      }
      var self = this;
      var call_on_write = function() {
        self.pub_sub_mode = self.pub_sub_mode || self.command_queue.length + 1;
      };
      return this.internal_send_command(new Command("unsubscribe", arr, callback, call_on_write));
    };
    Multi.prototype.unsubscribe = Multi.prototype.UNSUBSCRIBE = function unsubscribe() {
      var arr, len = arguments.length, callback, i = 0;
      if (Array.isArray(arguments[0])) {
        arr = arguments[0].slice(0);
        callback = arguments[1];
      } else {
        len = arguments.length;
        if (len !== 0 && (typeof arguments[len - 1] === "function" || typeof arguments[len - 1] === "undefined")) {
          len--;
          callback = arguments[len];
        }
        arr = new Array(len);
        for (; i < len; i += 1) {
          arr[i] = arguments[i];
        }
      }
      var self = this._client;
      var call_on_write = function() {
        self.pub_sub_mode = self.pub_sub_mode || self.command_queue.length + 1;
      };
      this.queue.push(new Command("unsubscribe", arr, callback, call_on_write));
      return this;
    };
    RedisClient.prototype.psubscribe = RedisClient.prototype.PSUBSCRIBE = function psubscribe() {
      var arr, len = arguments.length, callback, i = 0;
      if (Array.isArray(arguments[0])) {
        arr = arguments[0].slice(0);
        callback = arguments[1];
      } else {
        len = arguments.length;
        if (len !== 0 && (typeof arguments[len - 1] === "function" || typeof arguments[len - 1] === "undefined")) {
          len--;
          callback = arguments[len];
        }
        arr = new Array(len);
        for (; i < len; i += 1) {
          arr[i] = arguments[i];
        }
      }
      var self = this;
      var call_on_write = function() {
        self.pub_sub_mode = self.pub_sub_mode || self.command_queue.length + 1;
      };
      return this.internal_send_command(new Command("psubscribe", arr, callback, call_on_write));
    };
    Multi.prototype.psubscribe = Multi.prototype.PSUBSCRIBE = function psubscribe() {
      var arr, len = arguments.length, callback, i = 0;
      if (Array.isArray(arguments[0])) {
        arr = arguments[0].slice(0);
        callback = arguments[1];
      } else {
        len = arguments.length;
        if (len !== 0 && (typeof arguments[len - 1] === "function" || typeof arguments[len - 1] === "undefined")) {
          len--;
          callback = arguments[len];
        }
        arr = new Array(len);
        for (; i < len; i += 1) {
          arr[i] = arguments[i];
        }
      }
      var self = this._client;
      var call_on_write = function() {
        self.pub_sub_mode = self.pub_sub_mode || self.command_queue.length + 1;
      };
      this.queue.push(new Command("psubscribe", arr, callback, call_on_write));
      return this;
    };
    RedisClient.prototype.punsubscribe = RedisClient.prototype.PUNSUBSCRIBE = function punsubscribe() {
      var arr, len = arguments.length, callback, i = 0;
      if (Array.isArray(arguments[0])) {
        arr = arguments[0].slice(0);
        callback = arguments[1];
      } else {
        len = arguments.length;
        if (len !== 0 && (typeof arguments[len - 1] === "function" || typeof arguments[len - 1] === "undefined")) {
          len--;
          callback = arguments[len];
        }
        arr = new Array(len);
        for (; i < len; i += 1) {
          arr[i] = arguments[i];
        }
      }
      var self = this;
      var call_on_write = function() {
        self.pub_sub_mode = self.pub_sub_mode || self.command_queue.length + 1;
      };
      return this.internal_send_command(new Command("punsubscribe", arr, callback, call_on_write));
    };
    Multi.prototype.punsubscribe = Multi.prototype.PUNSUBSCRIBE = function punsubscribe() {
      var arr, len = arguments.length, callback, i = 0;
      if (Array.isArray(arguments[0])) {
        arr = arguments[0].slice(0);
        callback = arguments[1];
      } else {
        len = arguments.length;
        if (len !== 0 && (typeof arguments[len - 1] === "function" || typeof arguments[len - 1] === "undefined")) {
          len--;
          callback = arguments[len];
        }
        arr = new Array(len);
        for (; i < len; i += 1) {
          arr[i] = arguments[i];
        }
      }
      var self = this._client;
      var call_on_write = function() {
        self.pub_sub_mode = self.pub_sub_mode || self.command_queue.length + 1;
      };
      this.queue.push(new Command("punsubscribe", arr, callback, call_on_write));
      return this;
    };
  }
});

// ../../.bkjs/lib/node_modules/redis/lib/extendedApi.js
var require_extendedApi = __commonJS({
  "../../.bkjs/lib/node_modules/redis/lib/extendedApi.js"() {
    "use strict";
    var utils = require_utils();
    var debug = require_debug();
    var RedisClient = require_index().RedisClient;
    var Command = require_command();
    var noop = function() {
    };
    RedisClient.prototype.send_command = RedisClient.prototype.sendCommand = function(command, args, callback) {
      if (typeof command !== "string") {
        throw new TypeError('Wrong input type "' + (command !== null && command !== void 0 ? command.constructor.name : command) + '" for command name');
      }
      command = command.toLowerCase();
      if (!Array.isArray(args)) {
        if (args === void 0 || args === null) {
          args = [];
        } else if (typeof args === "function" && callback === void 0) {
          callback = args;
          args = [];
        } else {
          throw new TypeError('Wrong input type "' + args.constructor.name + '" for args');
        }
      }
      if (typeof callback !== "function" && callback !== void 0) {
        throw new TypeError('Wrong input type "' + (callback !== null ? callback.constructor.name : "null") + '" for callback function');
      }
      if (command === "multi" || typeof this[command] !== "function") {
        return this.internal_send_command(new Command(command, args, callback));
      }
      if (typeof callback === "function") {
        args = args.concat([callback]);
      }
      return this[command].apply(this, args);
    };
    RedisClient.prototype.end = function(flush) {
      if (flush) {
        this.flush_and_error({
          message: "Connection forcefully ended and command aborted.",
          code: "NR_CLOSED"
        });
      } else if (arguments.length === 0) {
        this.warn(
          "Using .end() without the flush parameter is deprecated and throws from v.3.0.0 on.\nPlease check the doku (https://github.com/NodeRedis/node_redis) and explictly use flush."
        );
      }
      if (this.retry_timer) {
        clearTimeout(this.retry_timer);
        this.retry_timer = null;
      }
      this.stream.removeAllListeners();
      this.stream.on("error", noop);
      this.connected = false;
      this.ready = false;
      this.closing = true;
      return this.stream.destroySoon();
    };
    RedisClient.prototype.unref = function() {
      if (this.connected) {
        debug("Unref'ing the socket connection");
        this.stream.unref();
      } else {
        debug("Not connected yet, will unref later");
        this.once("connect", function() {
          this.unref();
        });
      }
    };
    RedisClient.prototype.duplicate = function(options, callback) {
      if (typeof options === "function") {
        callback = options;
        options = null;
      }
      var existing_options = utils.clone(this.options);
      options = utils.clone(options);
      for (var elem in options) {
        existing_options[elem] = options[elem];
      }
      var client = new RedisClient(existing_options);
      client.selected_db = options.db || this.selected_db;
      if (typeof callback === "function") {
        var ready_listener = function() {
          callback(null, client);
          client.removeAllListeners(error_listener);
        };
        var error_listener = function(err) {
          callback(err);
          client.end(true);
        };
        client.once("ready", ready_listener);
        client.once("error", error_listener);
        return;
      }
      return client;
    };
  }
});

// ../../.bkjs/lib/node_modules/redis/lib/commands.js
var require_commands2 = __commonJS({
  "../../.bkjs/lib/node_modules/redis/lib/commands.js"(exports2, module2) {
    "use strict";
    var commands = require_redis_commands();
    var Multi = require_multi();
    var RedisClient = require_index().RedisClient;
    var Command = require_command();
    var addCommand = function(command) {
      var commandName = command.replace(/(?:^([0-9])|[^a-zA-Z0-9_$])/g, "_$1");
      if (!RedisClient.prototype[command]) {
        RedisClient.prototype[command.toUpperCase()] = RedisClient.prototype[command] = function() {
          var arr;
          var len = arguments.length;
          var callback;
          var i = 0;
          if (Array.isArray(arguments[0])) {
            arr = arguments[0];
            if (len === 2) {
              callback = arguments[1];
            }
          } else if (len > 1 && Array.isArray(arguments[1])) {
            if (len === 3) {
              callback = arguments[2];
            }
            len = arguments[1].length;
            arr = new Array(len + 1);
            arr[0] = arguments[0];
            for (; i < len; i += 1) {
              arr[i + 1] = arguments[1][i];
            }
          } else {
            if (len !== 0 && (typeof arguments[len - 1] === "function" || typeof arguments[len - 1] === "undefined")) {
              len--;
              callback = arguments[len];
            }
            arr = new Array(len);
            for (; i < len; i += 1) {
              arr[i] = arguments[i];
            }
          }
          return this.internal_send_command(new Command(command, arr, callback));
        };
        if (commandName !== command) {
          RedisClient.prototype[commandName.toUpperCase()] = RedisClient.prototype[commandName] = RedisClient.prototype[command];
        }
        Object.defineProperty(RedisClient.prototype[command], "name", {
          value: commandName
        });
      }
      if (!Multi.prototype[command]) {
        Multi.prototype[command.toUpperCase()] = Multi.prototype[command] = function() {
          var arr;
          var len = arguments.length;
          var callback;
          var i = 0;
          if (Array.isArray(arguments[0])) {
            arr = arguments[0];
            if (len === 2) {
              callback = arguments[1];
            }
          } else if (len > 1 && Array.isArray(arguments[1])) {
            if (len === 3) {
              callback = arguments[2];
            }
            len = arguments[1].length;
            arr = new Array(len + 1);
            arr[0] = arguments[0];
            for (; i < len; i += 1) {
              arr[i + 1] = arguments[1][i];
            }
          } else {
            if (len !== 0 && (typeof arguments[len - 1] === "function" || typeof arguments[len - 1] === "undefined")) {
              len--;
              callback = arguments[len];
            }
            arr = new Array(len);
            for (; i < len; i += 1) {
              arr[i] = arguments[i];
            }
          }
          this.queue.push(new Command(command, arr, callback));
          return this;
        };
        if (commandName !== command) {
          Multi.prototype[commandName.toUpperCase()] = Multi.prototype[commandName] = Multi.prototype[command];
        }
        Object.defineProperty(Multi.prototype[command], "name", {
          value: commandName
        });
      }
    };
    commands.list.forEach(addCommand);
    module2.exports = addCommand;
  }
});

// ../../.bkjs/lib/node_modules/redis/index.js
var require_index = __commonJS({
  "../../.bkjs/lib/node_modules/redis/index.js"(exports2) {
    var net = require("net");
    var tls = require("tls");
    var util = require("util");
    var utils = require_utils();
    var Command = require_command();
    var Queue = require_denque();
    var errorClasses = require_customErrors();
    var EventEmitter = require("events");
    var Parser = require_redis_parser();
    var RedisErrors = require_redis_errors();
    var commands = require_redis_commands();
    var debug = require_debug();
    var unifyOptions = require_createClient();
    var SUBSCRIBE_COMMANDS = {
      subscribe: true,
      unsubscribe: true,
      psubscribe: true,
      punsubscribe: true
    };
    function noop() {
    }
    function handle_detect_buffers_reply(reply, command, buffer_args) {
      if (buffer_args === false || this.message_buffers) {
        reply = utils.reply_to_strings(reply);
      }
      if (command === "hgetall") {
        reply = utils.reply_to_object(reply);
      }
      return reply;
    }
    exports2.debug_mode = /\bredis\b/i.test(process.env.NODE_DEBUG);
    function RedisClient(options, stream) {
      options = utils.clone(options);
      EventEmitter.call(this);
      var cnx_options = {};
      var self = this;
      for (var tls_option in options.tls) {
        cnx_options[tls_option] = options.tls[tls_option];
        if (tls_option === "port" || tls_option === "host" || tls_option === "path" || tls_option === "family") {
          options[tls_option] = options.tls[tls_option];
        }
      }
      if (stream) {
        options.stream = stream;
        this.address = '"Private stream"';
      } else if (options.path) {
        cnx_options.path = options.path;
        this.address = options.path;
      } else {
        cnx_options.port = +options.port || 6379;
        cnx_options.host = options.host || "127.0.0.1";
        cnx_options.family = !options.family && net.isIP(cnx_options.host) || (options.family === "IPv6" ? 6 : 4);
        this.address = cnx_options.host + ":" + cnx_options.port;
      }
      this.connection_options = cnx_options;
      this.connection_id = RedisClient.connection_id++;
      this.connected = false;
      this.ready = false;
      if (options.socket_keepalive === void 0) {
        options.socket_keepalive = true;
      }
      if (options.socket_initial_delay === void 0) {
        options.socket_initial_delay = 0;
      }
      for (var command in options.rename_commands) {
        options.rename_commands[command.toLowerCase()] = options.rename_commands[command];
      }
      options.return_buffers = !!options.return_buffers;
      options.detect_buffers = !!options.detect_buffers;
      if (options.return_buffers && options.detect_buffers) {
        self.warn("WARNING: You activated return_buffers and detect_buffers at the same time. The return value is always going to be a buffer.");
        options.detect_buffers = false;
      }
      if (options.detect_buffers) {
        this.handle_reply = handle_detect_buffers_reply;
      }
      this.should_buffer = false;
      this.command_queue = new Queue();
      this.offline_queue = new Queue();
      this.pipeline_queue = new Queue();
      this.connect_timeout = +options.connect_timeout || 36e5;
      this.enable_offline_queue = options.enable_offline_queue === false ? false : true;
      this.initialize_retry_vars();
      this.pub_sub_mode = 0;
      this.subscription_set = {};
      this.monitoring = false;
      this.message_buffers = false;
      this.closing = false;
      this.server_info = {};
      this.auth_pass = options.auth_pass || options.password;
      this.auth_user = options.auth_user || options.user;
      this.selected_db = options.db;
      this.fire_strings = true;
      this.pipeline = false;
      this.sub_commands_left = 0;
      this.times_connected = 0;
      this.buffers = options.return_buffers || options.detect_buffers;
      this.options = options;
      this.reply = "ON";
      this.create_stream();
      this.on("newListener", function(event) {
        if ((event === "message_buffer" || event === "pmessage_buffer" || event === "messageBuffer" || event === "pmessageBuffer") && !this.buffers && !this.message_buffers) {
          this.reply_parser.optionReturnBuffers = true;
          this.message_buffers = true;
          this.handle_reply = handle_detect_buffers_reply;
        }
      });
    }
    util.inherits(RedisClient, EventEmitter);
    RedisClient.connection_id = 0;
    function create_parser(self) {
      return new Parser({
        returnReply: function(data) {
          self.return_reply(data);
        },
        returnError: function(err) {
          self.return_error(err);
        },
        returnFatalError: function(err) {
          err.message += ". Please report this.";
          self.ready = false;
          self.flush_and_error({
            message: "Fatal error encountered. Command aborted.",
            code: "NR_FATAL"
          }, {
            error: err,
            queues: ["command_queue"]
          });
          self.emit("error", err);
          self.create_stream();
        },
        returnBuffers: self.buffers || self.message_buffers,
        stringNumbers: self.options.string_numbers || false
      });
    }
    RedisClient.prototype.create_stream = function() {
      var self = this;
      this.reply_parser = create_parser(this);
      if (this.options.stream) {
        if (this.stream) {
          return;
        }
        this.stream = this.options.stream;
      } else {
        if (this.stream) {
          this.stream.removeAllListeners();
          this.stream.destroy();
        }
        if (this.options.tls) {
          this.stream = tls.connect(this.connection_options);
        } else {
          this.stream = net.createConnection(this.connection_options);
        }
      }
      if (this.options.connect_timeout) {
        this.stream.setTimeout(this.connect_timeout, function() {
          self.retry_totaltime = self.connect_timeout;
          self.connection_gone("timeout");
        });
      }
      var connect_event = this.options.tls ? "secureConnect" : "connect";
      this.stream.once(connect_event, function() {
        this.removeAllListeners("timeout");
        self.times_connected++;
        self.on_connect();
      });
      this.stream.on("data", function(buffer_from_socket) {
        debug("Net read " + self.address + " id " + self.connection_id);
        self.reply_parser.execute(buffer_from_socket);
      });
      this.stream.on("error", function(err) {
        self.on_error(err);
      });
      this.stream.once("close", function(hadError) {
        self.connection_gone("close");
      });
      this.stream.once("end", function() {
        self.connection_gone("end");
      });
      this.stream.on("drain", function() {
        self.drain();
      });
      this.stream.setNoDelay();
      if (this.auth_pass !== void 0) {
        this.ready = true;
        this.auth(this.auth_pass, this.auth_user, function(err) {
          if (err && err.code !== "UNCERTAIN_STATE") {
            self.emit("error", err);
          }
        });
        this.ready = false;
      }
    };
    RedisClient.prototype.handle_reply = function(reply, command) {
      if (command === "hgetall") {
        reply = utils.reply_to_object(reply);
      }
      return reply;
    };
    RedisClient.prototype.cork = noop;
    RedisClient.prototype.uncork = noop;
    RedisClient.prototype.initialize_retry_vars = function() {
      this.retry_timer = null;
      this.retry_totaltime = 0;
      this.retry_delay = 200;
      this.retry_backoff = 1.7;
      this.attempts = 1;
    };
    RedisClient.prototype.warn = function(msg) {
      var self = this;
      process.nextTick(function() {
        if (self.listeners("warning").length !== 0) {
          self.emit("warning", msg);
        } else {
          console.warn("node_redis:", msg);
        }
      });
    };
    RedisClient.prototype.flush_and_error = function(error_attributes, options) {
      options = options || {};
      var aggregated_errors = [];
      var queue_names = options.queues || ["command_queue", "offline_queue"];
      for (var i = 0; i < queue_names.length; i++) {
        if (queue_names[i] === "command_queue") {
          error_attributes.message += " It might have been processed.";
        } else {
          error_attributes.message = error_attributes.message.replace(" It might have been processed.", "");
        }
        for (var command_obj = this[queue_names[i]].shift(); command_obj; command_obj = this[queue_names[i]].shift()) {
          var err = new errorClasses.AbortError(error_attributes);
          if (command_obj.error) {
            err.stack = err.stack + command_obj.error.stack.replace(/^Error.*?\n/, "\n");
          }
          err.command = command_obj.command.toUpperCase();
          if (command_obj.args && command_obj.args.length) {
            err.args = command_obj.args;
          }
          if (options.error) {
            err.origin = options.error;
          }
          if (typeof command_obj.callback === "function") {
            command_obj.callback(err);
          } else {
            aggregated_errors.push(err);
          }
        }
      }
      if (exports2.debug_mode && aggregated_errors.length) {
        var error;
        if (aggregated_errors.length === 1) {
          error = aggregated_errors[0];
        } else {
          error_attributes.message = error_attributes.message.replace("It", "They").replace(/command/i, "$&s");
          error = new errorClasses.AggregateError(error_attributes);
          error.errors = aggregated_errors;
        }
        this.emit("error", error);
      }
    };
    RedisClient.prototype.on_error = function(err) {
      if (this.closing) {
        return;
      }
      err.message = "Redis connection to " + this.address + " failed - " + err.message;
      debug(err.message);
      this.connected = false;
      this.ready = false;
      if (!this.options.retry_strategy) {
        this.emit("error", err);
      }
      this.connection_gone("error", err);
    };
    RedisClient.prototype.on_connect = function() {
      debug("Stream connected " + this.address + " id " + this.connection_id);
      this.connected = true;
      this.ready = false;
      this.emitted_end = false;
      this.stream.setKeepAlive(this.options.socket_keepalive, this.options.socket_initial_delay);
      this.stream.setTimeout(0);
      this.emit("connect");
      this.initialize_retry_vars();
      if (this.options.no_ready_check) {
        this.on_ready();
      } else {
        this.ready_check();
      }
    };
    RedisClient.prototype.on_ready = function() {
      var self = this;
      debug("on_ready called " + this.address + " id " + this.connection_id);
      this.ready = true;
      this.cork = function() {
        self.pipeline = true;
        if (self.stream.cork) {
          self.stream.cork();
        }
      };
      this.uncork = function() {
        if (self.fire_strings) {
          self.write_strings();
        } else {
          self.write_buffers();
        }
        self.pipeline = false;
        self.fire_strings = true;
        if (self.stream.uncork) {
          self.stream.uncork();
        }
      };
      if (this.selected_db !== void 0) {
        this.internal_send_command(new Command("select", [this.selected_db]));
      }
      if (this.monitoring) {
        this.internal_send_command(new Command("monitor", []));
      }
      var callback_count = Object.keys(this.subscription_set).length;
      if (!this.options.disable_resubscribing && callback_count) {
        var callback = function() {
          callback_count--;
          if (callback_count === 0) {
            self.emit("ready");
          }
        };
        debug("Sending pub/sub on_ready commands");
        for (var key in this.subscription_set) {
          var command = key.slice(0, key.indexOf("_"));
          var args = this.subscription_set[key];
          this[command]([args], callback);
        }
        this.send_offline_queue();
        return;
      }
      this.send_offline_queue();
      this.emit("ready");
    };
    RedisClient.prototype.on_info_cmd = function(err, res) {
      if (err) {
        if (err.message === "ERR unknown command 'info'") {
          this.on_ready();
          return;
        }
        err.message = "Ready check failed: " + err.message;
        this.emit("error", err);
        return;
      }
      if (!res) {
        debug("The info command returned without any data.");
        this.on_ready();
        return;
      }
      if (!this.server_info.loading || this.server_info.loading === "0") {
        if (this.server_info.master_link_status && this.server_info.master_link_status !== "up") {
          this.server_info.loading_eta_seconds = 0.05;
        } else {
          debug("Redis server ready.");
          this.on_ready();
          return;
        }
      }
      var retry_time = +this.server_info.loading_eta_seconds * 1e3;
      if (retry_time > 1e3) {
        retry_time = 1e3;
      }
      debug("Redis server still loading, trying again in " + retry_time);
      setTimeout(function(self) {
        self.ready_check();
      }, retry_time, this);
    };
    RedisClient.prototype.ready_check = function() {
      var self = this;
      debug("Checking server ready state...");
      this.ready = true;
      this.info(function(err, res) {
        self.on_info_cmd(err, res);
      });
      this.ready = false;
    };
    RedisClient.prototype.send_offline_queue = function() {
      for (var command_obj = this.offline_queue.shift(); command_obj; command_obj = this.offline_queue.shift()) {
        debug("Sending offline command: " + command_obj.command);
        this.internal_send_command(command_obj);
      }
      this.drain();
    };
    var retry_connection = function(self, error) {
      debug("Retrying connection...");
      var reconnect_params = {
        delay: self.retry_delay,
        attempt: self.attempts,
        error
      };
      if (self.options.camel_case) {
        reconnect_params.totalRetryTime = self.retry_totaltime;
        reconnect_params.timesConnected = self.times_connected;
      } else {
        reconnect_params.total_retry_time = self.retry_totaltime;
        reconnect_params.times_connected = self.times_connected;
      }
      self.emit("reconnecting", reconnect_params);
      self.retry_totaltime += self.retry_delay;
      self.attempts += 1;
      self.retry_delay = Math.round(self.retry_delay * self.retry_backoff);
      self.create_stream();
      self.retry_timer = null;
    };
    RedisClient.prototype.connection_gone = function(why, error) {
      if (this.retry_timer) {
        return;
      }
      error = error || null;
      debug("Redis connection is gone from " + why + " event.");
      this.connected = false;
      this.ready = false;
      this.cork = noop;
      this.uncork = noop;
      this.pipeline = false;
      this.pub_sub_mode = 0;
      if (!this.emitted_end) {
        this.emit("end");
        this.emitted_end = true;
      }
      if (this.closing) {
        debug("Connection ended by quit / end command, not retrying.");
        this.flush_and_error({
          message: "Stream connection ended and command aborted.",
          code: "NR_CLOSED"
        }, {
          error
        });
        return;
      }
      if (typeof this.options.retry_strategy === "function") {
        var retry_params = {
          attempt: this.attempts,
          error
        };
        if (this.options.camel_case) {
          retry_params.totalRetryTime = this.retry_totaltime;
          retry_params.timesConnected = this.times_connected;
        } else {
          retry_params.total_retry_time = this.retry_totaltime;
          retry_params.times_connected = this.times_connected;
        }
        this.retry_delay = this.options.retry_strategy(retry_params);
        if (typeof this.retry_delay !== "number") {
          if (this.retry_delay instanceof Error) {
            error = this.retry_delay;
          }
          var errorMessage = "Redis connection in broken state: retry aborted.";
          this.flush_and_error({
            message: errorMessage,
            code: "CONNECTION_BROKEN"
          }, {
            error
          });
          var retryError = new Error(errorMessage);
          retryError.code = "CONNECTION_BROKEN";
          if (error) {
            retryError.origin = error;
          }
          this.end(false);
          this.emit("error", retryError);
          return;
        }
      }
      if (this.retry_totaltime >= this.connect_timeout) {
        var message = "Redis connection in broken state: connection timeout exceeded.";
        this.flush_and_error({
          message,
          code: "CONNECTION_BROKEN"
        }, {
          error
        });
        var err = new Error(message);
        err.code = "CONNECTION_BROKEN";
        if (error) {
          err.origin = error;
        }
        this.end(false);
        this.emit("error", err);
        return;
      }
      if (this.options.retry_unfulfilled_commands) {
        this.offline_queue.unshift.apply(this.offline_queue, this.command_queue.toArray());
        this.command_queue.clear();
      } else if (this.command_queue.length !== 0) {
        this.flush_and_error({
          message: "Redis connection lost and command aborted.",
          code: "UNCERTAIN_STATE"
        }, {
          error,
          queues: ["command_queue"]
        });
      }
      if (this.retry_totaltime + this.retry_delay > this.connect_timeout) {
        this.retry_delay = this.connect_timeout - this.retry_totaltime;
      }
      debug("Retry connection in " + this.retry_delay + " ms");
      this.retry_timer = setTimeout(retry_connection, this.retry_delay, this, error);
    };
    RedisClient.prototype.return_error = function(err) {
      var command_obj = this.command_queue.shift();
      if (command_obj.error) {
        err.stack = command_obj.error.stack.replace(/^Error.*?\n/, "ReplyError: " + err.message + "\n");
      }
      err.command = command_obj.command.toUpperCase();
      if (command_obj.args && command_obj.args.length) {
        err.args = command_obj.args;
      }
      if (this.pub_sub_mode > 1) {
        this.pub_sub_mode--;
      }
      var match = err.message.match(utils.err_code);
      if (match) {
        err.code = match[1];
      }
      utils.callback_or_emit(this, command_obj.callback, err);
    };
    RedisClient.prototype.drain = function() {
      this.should_buffer = false;
    };
    function normal_reply(self, reply) {
      var command_obj = self.command_queue.shift();
      if (typeof command_obj.callback === "function") {
        if (command_obj.command !== "exec") {
          reply = self.handle_reply(reply, command_obj.command, command_obj.buffer_args);
        }
        command_obj.callback(null, reply);
      } else {
        debug("No callback for reply");
      }
    }
    function subscribe_unsubscribe(self, reply, type) {
      var command_obj = self.command_queue.get(0);
      var buffer = self.options.return_buffers || self.options.detect_buffers && command_obj.buffer_args;
      var channel = buffer || reply[1] === null ? reply[1] : reply[1].toString();
      var count = +reply[2];
      debug(type, channel);
      if (channel !== null) {
        self.emit(type, channel, count);
        if (type === "subscribe" || type === "psubscribe") {
          self.subscription_set[type + "_" + channel] = channel;
        } else {
          type = type === "unsubscribe" ? "subscribe" : "psubscribe";
          delete self.subscription_set[type + "_" + channel];
        }
      }
      if (command_obj.args.length === 1 || self.sub_commands_left === 1 || command_obj.args.length === 0 && (count === 0 || channel === null)) {
        if (count === 0) {
          var running_command;
          var i = 1;
          self.pub_sub_mode = 0;
          while (running_command = self.command_queue.get(i)) {
            if (SUBSCRIBE_COMMANDS[running_command.command]) {
              self.pub_sub_mode = i;
              break;
            }
            i++;
          }
        }
        self.command_queue.shift();
        if (typeof command_obj.callback === "function") {
          command_obj.callback(null, channel);
        }
        self.sub_commands_left = 0;
      } else {
        if (self.sub_commands_left !== 0) {
          self.sub_commands_left--;
        } else {
          self.sub_commands_left = command_obj.args.length ? command_obj.args.length - 1 : count;
        }
      }
    }
    function return_pub_sub(self, reply) {
      var type = reply[0].toString();
      if (type === "message") {
        if (!self.options.return_buffers || self.message_buffers) {
          self.emit("message", reply[1].toString(), reply[2].toString());
          self.emit("message_buffer", reply[1], reply[2]);
          self.emit("messageBuffer", reply[1], reply[2]);
        } else {
          self.emit("message", reply[1], reply[2]);
        }
      } else if (type === "pmessage") {
        if (!self.options.return_buffers || self.message_buffers) {
          self.emit("pmessage", reply[1].toString(), reply[2].toString(), reply[3].toString());
          self.emit("pmessage_buffer", reply[1], reply[2], reply[3]);
          self.emit("pmessageBuffer", reply[1], reply[2], reply[3]);
        } else {
          self.emit("pmessage", reply[1], reply[2], reply[3]);
        }
      } else {
        subscribe_unsubscribe(self, reply, type);
      }
    }
    RedisClient.prototype.return_reply = function(reply) {
      if (this.monitoring) {
        var replyStr;
        if (this.buffers && Buffer.isBuffer(reply)) {
          replyStr = reply.toString();
        } else {
          replyStr = reply;
        }
        if (typeof replyStr === "string" && utils.monitor_regex.test(replyStr)) {
          var timestamp = replyStr.slice(0, replyStr.indexOf(" "));
          var args = replyStr.slice(replyStr.indexOf('"') + 1, -1).split('" "').map(function(elem) {
            return elem.replace(/\\"/g, '"');
          });
          this.emit("monitor", timestamp, args, replyStr);
          return;
        }
      }
      if (this.pub_sub_mode === 0) {
        normal_reply(this, reply);
      } else if (this.pub_sub_mode !== 1) {
        this.pub_sub_mode--;
        normal_reply(this, reply);
      } else if (!(reply instanceof Array) || reply.length <= 2) {
        normal_reply(this, reply);
      } else {
        return_pub_sub(this, reply);
      }
    };
    function handle_offline_command(self, command_obj) {
      var command = command_obj.command;
      var err, msg;
      if (self.closing || !self.enable_offline_queue) {
        command = command.toUpperCase();
        if (!self.closing) {
          if (self.stream.writable) {
            msg = "The connection is not yet established and the offline queue is deactivated.";
          } else {
            msg = "Stream not writeable.";
          }
        } else {
          msg = "The connection is already closed.";
        }
        err = new errorClasses.AbortError({
          message: command + " can't be processed. " + msg,
          code: "NR_CLOSED",
          command
        });
        if (command_obj.args.length) {
          err.args = command_obj.args;
        }
        utils.reply_in_order(self, command_obj.callback, err);
      } else {
        debug("Queueing " + command + " for next server connection.");
        self.offline_queue.push(command_obj);
      }
      self.should_buffer = true;
    }
    RedisClient.prototype.internal_send_command = function(command_obj) {
      var arg, prefix_keys;
      var i = 0;
      var command_str = "";
      var args = command_obj.args;
      var command = command_obj.command;
      var len = args.length;
      var big_data = false;
      var args_copy = new Array(len);
      if (process.domain && command_obj.callback) {
        command_obj.callback = process.domain.bind(command_obj.callback);
      }
      if (this.ready === false || this.stream.writable === false) {
        handle_offline_command(this, command_obj);
        return false;
      }
      for (i = 0; i < len; i += 1) {
        if (typeof args[i] === "string") {
          if (args[i].length > 3e4) {
            big_data = true;
            args_copy[i] = Buffer.from(args[i], "utf8");
          } else {
            args_copy[i] = args[i];
          }
        } else if (typeof args[i] === "object") {
          if (args[i] instanceof Date) {
            args_copy[i] = args[i].toString();
          } else if (Buffer.isBuffer(args[i])) {
            args_copy[i] = args[i];
            command_obj.buffer_args = true;
            big_data = true;
          } else {
            var invalidArgError = new Error(
              "node_redis: The " + command.toUpperCase() + " command contains a invalid argument type.\nOnly strings, dates and buffers are accepted. Please update your code to use valid argument types."
            );
            invalidArgError.command = command_obj.command.toUpperCase();
            if (command_obj.args && command_obj.args.length) {
              invalidArgError.args = command_obj.args;
            }
            if (command_obj.callback) {
              command_obj.callback(invalidArgError);
              return false;
            }
            throw invalidArgError;
          }
        } else if (typeof args[i] === "undefined") {
          var undefinedArgError = new Error(
            "node_redis: The " + command.toUpperCase() + ' command contains a invalid argument type of "undefined".\nOnly strings, dates and buffers are accepted. Please update your code to use valid argument types.'
          );
          undefinedArgError.command = command_obj.command.toUpperCase();
          if (command_obj.args && command_obj.args.length) {
            undefinedArgError.args = command_obj.args;
          }
          command_obj.callback(undefinedArgError);
          return false;
        } else {
          args_copy[i] = "" + args[i];
        }
      }
      if (this.options.prefix) {
        prefix_keys = commands.getKeyIndexes(command, args_copy);
        for (i = prefix_keys.pop(); i !== void 0; i = prefix_keys.pop()) {
          args_copy[i] = this.options.prefix + args_copy[i];
        }
      }
      if (this.options.rename_commands && this.options.rename_commands[command]) {
        command = this.options.rename_commands[command];
      }
      command_str = "*" + (len + 1) + "\r\n$" + command.length + "\r\n" + command + "\r\n";
      if (big_data === false) {
        for (i = 0; i < len; i += 1) {
          arg = args_copy[i];
          command_str += "$" + Buffer.byteLength(arg) + "\r\n" + arg + "\r\n";
        }
        debug("Send " + this.address + " id " + this.connection_id + ": " + command_str);
        this.write(command_str);
      } else {
        debug("Send command (" + command_str + ") has Buffer arguments");
        this.fire_strings = false;
        this.write(command_str);
        for (i = 0; i < len; i += 1) {
          arg = args_copy[i];
          if (typeof arg === "string") {
            this.write("$" + Buffer.byteLength(arg) + "\r\n" + arg + "\r\n");
          } else {
            this.write("$" + arg.length + "\r\n");
            this.write(arg);
            this.write("\r\n");
          }
          debug("send_command: buffer send " + arg.length + " bytes");
        }
      }
      if (command_obj.call_on_write) {
        command_obj.call_on_write();
      }
      if (this.reply === "ON") {
        this.command_queue.push(command_obj);
      } else {
        if (command_obj.callback) {
          utils.reply_in_order(this, command_obj.callback, null, void 0, this.command_queue);
        }
        if (this.reply === "SKIP") {
          this.reply = "SKIP_ONE_MORE";
        } else if (this.reply === "SKIP_ONE_MORE") {
          this.reply = "ON";
        }
      }
      return !this.should_buffer;
    };
    RedisClient.prototype.write_strings = function() {
      var str = "";
      for (var command = this.pipeline_queue.shift(); command; command = this.pipeline_queue.shift()) {
        if (str.length + command.length > 4 * 1024 * 1024) {
          this.should_buffer = !this.stream.write(str);
          str = "";
        }
        str += command;
      }
      if (str !== "") {
        this.should_buffer = !this.stream.write(str);
      }
    };
    RedisClient.prototype.write_buffers = function() {
      for (var command = this.pipeline_queue.shift(); command; command = this.pipeline_queue.shift()) {
        this.should_buffer = !this.stream.write(command);
      }
    };
    RedisClient.prototype.write = function(data) {
      if (this.pipeline === false) {
        this.should_buffer = !this.stream.write(data);
        return;
      }
      this.pipeline_queue.push(data);
    };
    Object.defineProperty(exports2, "debugMode", {
      get: function() {
        return this.debug_mode;
      },
      set: function(val) {
        this.debug_mode = val;
      }
    });
    Object.defineProperty(RedisClient.prototype, "command_queue_length", {
      get: function() {
        return this.command_queue.length;
      }
    });
    Object.defineProperty(RedisClient.prototype, "offline_queue_length", {
      get: function() {
        return this.offline_queue.length;
      }
    });
    Object.defineProperty(RedisClient.prototype, "retryDelay", {
      get: function() {
        return this.retry_delay;
      }
    });
    Object.defineProperty(RedisClient.prototype, "retryBackoff", {
      get: function() {
        return this.retry_backoff;
      }
    });
    Object.defineProperty(RedisClient.prototype, "commandQueueLength", {
      get: function() {
        return this.command_queue.length;
      }
    });
    Object.defineProperty(RedisClient.prototype, "offlineQueueLength", {
      get: function() {
        return this.offline_queue.length;
      }
    });
    Object.defineProperty(RedisClient.prototype, "shouldBuffer", {
      get: function() {
        return this.should_buffer;
      }
    });
    Object.defineProperty(RedisClient.prototype, "connectionId", {
      get: function() {
        return this.connection_id;
      }
    });
    Object.defineProperty(RedisClient.prototype, "serverInfo", {
      get: function() {
        return this.server_info;
      }
    });
    exports2.createClient = function() {
      return new RedisClient(unifyOptions.apply(null, arguments));
    };
    exports2.RedisClient = RedisClient;
    exports2.print = utils.print;
    exports2.Multi = require_multi();
    exports2.AbortError = errorClasses.AbortError;
    exports2.RedisError = RedisErrors.RedisError;
    exports2.ParserError = RedisErrors.ParserError;
    exports2.ReplyError = RedisErrors.ReplyError;
    exports2.AggregateError = errorClasses.AggregateError;
    require_individualCommands();
    require_extendedApi();
    exports2.addCommand = exports2.add_command = require_commands2();
  }
});
module.exports = require_index();
