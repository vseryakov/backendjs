
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, lib, db } = require("../");
const { ainit } = require("./utils");

const roles = process.env.BKJS_ROLES || "sqlite";

