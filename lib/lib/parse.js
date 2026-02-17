/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const fxp = require("fast-xml-parser");

/**
 * Parse data as config format name=value per line
 *
 * ## Including other files:
 * - The format is: `include filename`
 *   the contents of the given file will be included in place and parsed. File name may contain placeholders
 *   formatted as @name@ where name can refer to any property inside the `options`.
 *
 * ## Section with filters:
 * - The format is: `[name=value,...]` or `[name!=value,...]` or [name=]
 *   where name is a property name with optional value(s).
 * - if the value is empty then it just checks if the property is empty.
 * - `!=` denotes negative condition, i.e. not matching or NOT empty
 * - section names may refer deep into objects passed like `instance.tag`
 *
 * Sections work like a filter, only if a property matches it is used otherwise skipped completely, it uses `lib.isTrue` for matching
 * so checking an item in an array will work as well.
 *
 * The [global] section can appear anytime to return to the global mode
 *
 * @memberof module:lib
 * @param {string|string[]} data - a string or array with config lines, a string will be split by newline
 * @param {object} [options] - options with context, all properties from the options can be used in the sections
 * @param {boolean} [options.obj] - return as an object by { key1: value, key2: value }
 * @param {boolean} [options.list] - return as an array of [key1, value]
 * @returns {string[]} an array of config keys and values as [-key1, val1, -key2, val2,...]
 * @method configParse
 * @example
 * include bkjs-@production@.conf
 * [tag=service]
 * [runMode=dev]
 * [role=worker]
 * [roles=role1,role2]
 * [instance.tag=ec2]
 * [instance.roles=dev]
 * [env.NAME=V]
 */
lib.configParse = function(data, options)
{
    if (!data || typeof data != "string") return [];
    options = options || this.empty;
    var argv = [], lines = lib.split(data, "\n"), section;
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();

        if (line.startsWith("include ")) {
            const file = lib.toTemplate(line.substr(8), [options, options.modules]).trim();
            logger.debug("configParse:", "INCLUDE:", line, "FILE:", file)
            var incl = lib.readFileSync(file, { list: "\n" });
            lines.splice(i, 1, ...incl);
            continue;
        } else

        if (line.startsWith("[") && line.endsWith("]")) {
            var key = line.slice(1, -1).trim();
            if (key == "global") {
                section = null;
            } else {
                key = lib.split(key, /[=,]/);
                section = { name: key[0], op: "", value: "" };
                if (section.name.endsWith("!")) {
                    section.op = "not_";
                    section.name = section.name.slice(0, -1);
                }
                if (section.name.includes(".")) {
                    section.name = section.name.split(".");
                }
                if (key[1] !== undefined) section.value = key.slice(1);
                if (!section.value) section.op += "null";
                logger.debug("configParse:", "SECTION:", section)
            }
            continue;
        }
        if (!/^([a-z0-9_-]+)/.test(line)) continue;
        if (section) {
            const obj = lib.objGet(options, section.name);
            const rc = obj === null || obj === undefined || !lib.isTrue(obj, section.value, section.op, section.type);
            logger.debug("configParse:", "LINE:", line, "SECTION:", section, "OBJ:", obj, typeof obj, "SKIP:", rc);
            if (rc) continue;
        }
        line = line.split("=");
        if (options?.obj) {
            if (line[0]) argv[line[0].trim()] = line.slice(1).join('=').trim();
        } else
        if (options?.list) {
            if (line[0]) argv.push([line[0].trim(), line.slice(1).join('=').trim()]);
        } else {
            if (line[0]) argv.push('-' + line[0].trim());
            if (line[1]) argv.push(line.slice(1).join('=').trim());
        }
    }
    return argv;
}

/**
 * Silent JSON parse, returns null on error, no exceptions raised.
 *
 * @memberof module:lib
 * @param {string} data - data to be parsed, non string will be returned as is
 * @param {object} [options] - additional properties
 * @param {string} [options.datatype] - make sure the result is returned as type: obj, list, str
 * @param {string} [options.dflt] - return this in case of error
 * @param {string} [options.empty] - if true silent about empty input, no logging
 * @param {string} [options.logger] - report in the log with the specified level, log, debug, ...
 * @returns {object|array} Javascript native object
 * @method jsonParse
 */
lib.jsonParse = function(data, options)
{
    return _parse("json", data, options);
}

/**
 * Same arguments as for {@link module:lib.jsonParse}
 * @memberof module:lib
 * @method xmlParse
 */

lib.xmlParse = function(data, options)
{
    return _parse("xml", data, options);
}

// Combined parser with type validation
function _parse(type, obj, options)
{
    if (!obj && !options?.empty) {
        return _checkResult(type, lib.newError("empty " + type), obj, options);
    }
    try {
        obj = _parseResult(type, obj, options);
    } catch (err) {
        obj = _checkResult(type, err, obj, options);
    }
    return obj;
}

var _xmlParser;

function _parseResult(type, obj, options)
{
    if (typeof obj == "string" && obj.length) {
        switch (type) {
        case "json":
            obj = JSON.parse(obj);
            break;

        case "xml":
            if (!_xmlParser) {
                _xmlParser = new fxp.XMLParser({
                    attributeNamePrefix: "",
                    htmlEntities: true,
                    ignoreAttributes: false,
                    ignoreDeclaration: true,
                    parseTagValue: false,
                    trimValues: true,
                });
            }
            obj = _xmlParser.parse(obj, true);
            break;
        }
    }
    switch (options?.datatype) {
    case "object":
        if (typeof obj != "object" || !obj) return options.dflt || {};
        break;
    case "obj":
        if (lib.typeName(obj) != "object") return options.dflt || {};
        break;
    case "list":
        if (lib.typeName(obj) != "array") return options.dflt || [];
        break;
    case "str":
        if (lib.typeName(obj) != "string") return options.dflt || "";
        break;
    }
    return obj;
}

// Perform validation of the result type, make sure we return what is expected, this is a helper that is used by other conversion routines
function _checkResult(type, err, obj, options)
{
    if (!options) return null;
    if (options.logger) logger.logger(options.logger, 'parse:', type, options, lib.traceError(err), obj);
    if (options.errnull) return null;
    if (options.dflt) return options.dflt;
    if (options.datatype == "object" || options.datatype == "obj") return {};
    if (options.datatype == "list") return [];
    if (options.datatype == "str") return "";
    return null;
}

/**
 * Parse a cookie header.
 *
 * Parse the given cookie header string into an object
 * The object has the various cookies as keys(names) => values
 * Borrowed from https://github.com/jshttp/cookie
 * @param {string} header - Cookie header
 * @return {object}
 * @memberof module:lib
 * @method parseCookies
 */
lib.parseCookies = function(header)
{
    const obj = {};
    const len = typeof header == "string" ? header.length : 0;
    // RFC 6265 sec 4.1.1, RFC 2616 2.2 defines a cookie name consists of one char minimum, plus '='.
    if (len < 2) return obj;
    let index = 0;
    do {
        const eqIdx = header.indexOf("=", index);
        if (eqIdx === -1) break;
        const colonIdx = header.indexOf(";", index);
        const endIdx = colonIdx === -1 ? len : colonIdx;
        if (eqIdx > endIdx) {
            // backtrack on prior semicolon
            index = header.lastIndexOf(";", eqIdx - 1) + 1;
            continue;
        }
        const keyStartIdx = startIndex(header, index, eqIdx);
        const keyEndIdx = endIndex(header, eqIdx, keyStartIdx);
        const key = header.slice(keyStartIdx, keyEndIdx);
        if (obj[key] === undefined) {
            const valStartIdx = startIndex(header, eqIdx + 1, endIdx);
            const valEndIdx = endIndex(header, endIdx, valStartIdx);
            let value = header.slice(valStartIdx, valEndIdx)
            if (value.includes("%")) {
                try {
                    value = decodeURIComponent(value);
                } catch (e) {}
            }
            obj[key] = value;
        }
        index = endIdx + 1;
    } while (index < len);
    return obj;
}
function startIndex(str, index, max)
{
    do {
        const code = str.charCodeAt(index);
        if (code !== 0x20 && code !== 0x09) return index;
    } while (++index < max);
    return max;
}
function endIndex(str, index, min)
{
    while (index > min) {
        const code = str.charCodeAt(--index);
        if (code !== 0x20 && code !== 0x09) return index + 1;
    }
    return min;
}
