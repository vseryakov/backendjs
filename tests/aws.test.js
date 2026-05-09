
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, aws } = require("../");
const { ainit } = require("./utils");

describe("AWS tests", async () => {


    before(async () => {
        await ainit({})
    });

    after(async () => {
        await app.astop();
    });

    it("test DynamoDB format", async () => {
        var a = { a: 1, b: 2, c: "3", d: { 1: 1, 2: 2 }, e: [1,2], f: [{ 1: 1 }, { 2: 2 }], g: true, h: null, i: ["a","b"] };
        var b = aws.toDynamoDB(a);
        var c = aws.fromDynamoDB(b);
        assert.deepEqual(a, c);
    });

});
