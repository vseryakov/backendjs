//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const logger = require(__dirname + '/../logger');
const lib = require(__dirname + '/../lib');
const xml2json = require("xml2json");

// Parse data as config format name=value per line,
// return an array of arguments in command line format ["-name", value,....]
//
// Supports sections:
// - The format is: `[name=value,...]` or `[name!=value,...]`
//   where name is a property name with optional value(s).
// - if the value is empty then it just checks if the property is empty.
// - `!=` denotes negative condition, i.e. not matching or NOT empty
// - section names may refer deep into objects like `aws.region` or `instance.tag`,
//   all modules will be checked inside `options.modules` object only,
//   all other names are checked in the top level options.
//
// Sections work like a filter, only if a property matches it is used otherwise skipped completely, it uses `lib.isTrue` for matching
// so checking an item in an array will work as well.
// The [global] section can appear anytime to return to global mode
lib.configParse = function(data, options)
{
    if (!data || typeof data != "string") return [];
    options = options || this.empty;
    var argv = [], lines = data.split("\n"), section;
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.startsWith("[") && line.endsWith("]")) {
            var key = line.slice(1, -1).trim();
            if (key == "global") {
                section = null;
            } else {
                key = lib.strSplit(key, /[=,]/);
                section = { name: key[0], op: "", value: "" };
                if (section.name.endsWith("!")) {
                    section.op = "not_";
                    section.name = section.name.slice(0, -1);
                }
                if (section.name.includes(".")) {
                    section.name = section.name.split(".");
                    if (options.modules && options.modules[section.name[0]]) {
                        section.name.unshift("modules");
                    }
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

// Silent JSON parse, returns null on error, no exceptions raised.
//
// options can specify the following properties:
//  - datatype - make sure the result is returned as type: obj, list, str
//  - dflt - return this in case of error
//  - empty - if true silent about empty input, no logging
//  - logger - report in the log with the specified level, log, debug, ...
lib.jsonParse = function(obj, options)
{
    return _parse("json", obj, options);
}

// Same arguments as for `jsonParse`
lib.xmlParse = function(obj, options)
{
    return _parse("xml", obj, options);
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

function _parseResult(type, obj, options)
{
    if (typeof obj == "string" && obj.length) {
        switch (type) {
        case "json":
            obj = JSON.parse(obj);
            break;
        case "xml":
            var opts = { object: true };
            for (const p in options) {
                if (["trim","coerce","sanitize","arrayNotation","reversible"].indexOf(p) > -1) opts[p] = options[p];
            }
            obj = xml2json.toJson(obj, opts);
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
