'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Readable } = require('node:stream');
const { app, aws, lib, api } = require('../');

const now = new Date('2013-05-24T00:00:00Z');
const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

// This requires AWS S3 example keys and secret published online set in bkjs.conf.local as
// [roles=s3]
// aws-key =
// aws-secret =

const headerSignature = 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41';

const signedOptions = (extra) => ({ now, region: 'us-east-1', ...extra });

function checkWireSignature(record)
{
    const names = record.headers.authorization?.match(/SignedHeaders=([^, ]+)/)?.[1];
    assert.ok(names, 'wire request must be signed');
    const headers = lib.objCreate();
    for (const name of names.split(';')) headers[name] = record.headers[name];
    aws.signQuery('us-east-1', 's3', record.headers.host, record.method,
        record.url, headers["content-length"] ? record.body : '', headers, null, { now, no_escape: true });
    assert.equal(record.headers.authorization, headers.Authorization, 'signature must match the bytes sent by fetch');
    if (record.headers['x-amz-content-sha256'] !== 'UNSIGNED-PAYLOAD') {
        assert.equal(record.headers['x-amz-content-sha256'], lib.hash(record.body, 'sha256', 'hex'));
    }
}

app.env.roles = ["s3"];
app.parseConfig(lib.readFileSync(__dirname + "/bkjs.conf"));

describe('S3 known signing cases', () => {
    it('lib.hash matches the published empty-payload hash', () => {
        assert.equal(lib.hash('', 'sha256', 'hex'), emptyHash);
    });

    it('signQuery matches the published S3 GET signature and canonical request', () => {
        const headers = { range: 'bytes=0-9', 'x-amz-content-sha256': emptyHash };
        const result = aws.signQuery('us-east-1', 's3', 'examplebucket.s3.amazonaws.com',
            'GET', '/test.txt', '', headers, null, { now });
        assert.equal(result.canonStr, [
            'GET', '/test.txt', '', 'host:examplebucket.s3.amazonaws.com', 'range:bytes=0-9',
            `x-amz-content-sha256:${emptyHash}`, 'x-amz-date:20130524T000000Z', '',
            'host;range;x-amz-content-sha256;x-amz-date', emptyHash,
        ].join('\n'));
        assert.equal(result.signature, headerSignature);
        assert.ok(headers.Authorization.endsWith('Signature=' + headerSignature));
    });

    it('signQuery canonicalizes numeric header values as strings', () => {
        const numeric = aws.signQuery('us-east-1', 's3', 'example.test', 'PUT', '/key', 'abc',
            { 'content-length': 3 }, null, { now });
        const string = aws.signQuery('us-east-1', 's3', 'example.test', 'PUT', '/key', 'abc',
            { 'content-length': '3' }, null, { now });
        assert.equal(numeric.canonStr, string.canonStr);
        assert.equal(numeric.signature, string.signature);
    });

    it('signS3 matches the published presigned GET URL', () => {
        const signed = aws.signS3('GET', 'examplebucket', 'test.txt', '', signedOptions({ presign: true, expires: 86400 }));
        const url = new URL(signed.url);
        assert.equal(url.origin + url.pathname, 'https://examplebucket.s3.amazonaws.com/test.txt');
        assert.equal(url.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
        assert.equal(url.searchParams.get('X-Amz-Credential'), aws.key + '/20130524/us-east-1/s3/aws4_request');
        assert.equal(url.searchParams.get('X-Amz-Date'), '20130524T000000Z');
        assert.equal(url.searchParams.get('X-Amz-Expires'), '86400');
    });

    it('uses a service-root slash and path style for dotted buckets', () => {
        assert.equal(new URL(aws.signS3('GET', '', '', '', signedOptions()).url).pathname, '/');
        assert.equal(aws.signS3('GET', 'my.bucket', 'key', '', signedOptions()).url, 'https://s3.amazonaws.com/my.bucket/key');
    });

    for (const expires of [undefined, 60, 604800]) {
        it(`includes presign expiration and session token (expires=${expires})`, () => {
            const token = 'session+/=token';
            const signed = aws.signS3('GET', 'bucket', 'key', '', signedOptions({
                presign: true, expires, credentials: { token },
            }));
            const params = new URL(signed.url).searchParams;
            assert.equal(params.get('X-Amz-Expires'), String(expires ?? 300));
            assert.equal(params.get('X-Amz-Security-Token'), token);
            assert.match(params.get('X-Amz-Signature'), /^[a-f0-9]{64}$/);
        });
    }
});

describe('S3 URL parsing', () => {
    for (const url of ['s3://bucket/key', 'bucket/key', 'https://example.test/bucket/key']) {
        it(`retains pathname: ${url}`, () => {
            const parsed = aws.s3ParseUrl(url);
            assert.equal(parsed.bucket, 'bucket');
            assert.equal(parsed.pathname, 'key');
        });
    }

    for (const url of ['bucket', 'bucket/', 's3://bucket', 's3://bucket/']) {
        it(`accepts bucket root: ${url}`, () => {
            assert.equal(aws.s3ParseUrl(url).bucket, 'bucket');
            assert.equal(aws.s3ParseUrl(url).pathname, '');
        });
    }

    it('preserves repeated slashes', () => {
        assert.equal(aws.s3ParseUrl('s3://bucket/a///b').pathname, 'a///b');
    });
});

describe('S3 through real fetch', { concurrency: false }, () => {
    let server, endpoint, records, respond;
    const opts = (extra) => signedOptions({
        endpoint,
        no_dns: true,
        expires: 0,
        retryCount: 0,
        errorCount: 0,
        httpTimeout: 2000,
        hardTimeout: 5000,
        quiet: true,
        ...extra
    });

    before(async () => {
        server = http.createServer(async (req, res) => {
            try {
                const chunks = [];
                for await (const chunk of req) chunks.push(chunk);
                const record = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) };
                records.push(record);
                const reply = respond(record, records.length);
                console.log(reply, record)
                res.writeHead(reply.status || 200, { 'content-type': 'application/xml', ...reply.headers });
                res.end(reply.body || '');
            } catch (err) {
                res.writeHead(500);
                res.end(String(err));
            }
        });
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        endpoint = 'http://127.0.0.1:' + server.address().port;
    });

    beforeEach(() => {
        records = [];
        respond = () => ({ body: '<Result>ok</Result>' });
    });

    after(async () => {
        if (server) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    });

    it('fetch sends the path, query and signed headers from signQuery', async () => {
        const headers = { 'x-amz-content-sha256': emptyHash };
        const signed = aws.signQuery('us-east-1', 's3', new URL(endpoint).host, 'GET',
            '/bucket/hello world?prefix=foo', '', headers, null, { now });
        const result = await lib.afetch({ url: endpoint + signed.path, method: signed.method, headers, quiet: true });
        assert.equal(result.status, 200);
        assert.equal(records[0].url, '/bucket/hello%20world?prefix=foo');
        checkWireSignature(records[0]);
    });

    it('sends a valid default S3 header signature', async () => {
        const result = await aws.aqueryS3('bucket', 'key', opts({ expires: undefined }));
        assert.ifError(result.err);
        checkWireSignature(records[0]);
    });

    for (const [key, expected] of [
        ['hello world', 'hello%20world'], ['日本語', '%E6%97%A5%E6%9C%AC%E8%AA%9E'],
        ['a#b', 'a%23b'], ['a?b', 'a%3Fb'], ['100%', '100%25'],
        ['a%20b', 'a%2520b'], ['a//b', 'a//b'], ['a/../b', 'a/../b'],
    ]) {
        it(`transmits the exact encoded object key: ${key}`, async () => {
            const signed = aws.signS3('GET', 'bucket', key, '', opts());
            delete signed.url;
            const result = await lib.afetch(signed);
            assert.equal(result.status, 200);
            assert.equal(records[0].url, '/bucket/' + expected);
            checkWireSignature(records[0]);
        });
    }

    it('retains the signed PUT method when passed directly to fetch', async () => {
        await lib.afetch(aws.signS3('PUT', 'bucket', 'key', '', opts()));
        assert.equal(records[0].method, 'PUT');
        checkWireSignature(records[0]);
    });

    for (const query of [{ prefix: 'foo' }, { 'list-type': 2, prefix: 'foo' }]) {
        it(`does not append query twice: ${lib.stringify(query)}`, async () => {
            await aws.aqueryS3('bucket', '', opts({ query }));
            const url = new URL(records[0].url, endpoint);
            for (const key in query) assert.deepEqual(url.searchParams.getAll(key), [String(query[key])]);
            checkWireSignature(records[0]);
        });
    }

    it('retains the bucket at a generic custom endpoint', async () => {
        const signed = aws.signS3("GET", 'bucket', 'key', "", opts({ no_dns: false }));
        assert.ok(signed.hostname.startsWith('bucket.'));
    });

    it('does not mutate caller query/endpoint options', async () => {
        const input = opts({ query: { prefix: 'foo' } });
        await aws.aqueryS3('bucket', '', input);
        assert.deepEqual(input.query, { prefix: 'foo' });
        assert.equal(input.endpoint, endpoint);
    });

    for (const kind of ['buffer', 'file', 'stream']) {
        it(`uploads the actual bytes from a ${kind}`, async () => {
            const source = kind === 'buffer' ? Buffer.from('render.html') :
                kind === 'file' ? "tests/render.html" : Readable.from(['render.', 'html']);
            await lib.promisify(aws.s3PutFile, 's3://bucket/key', source, opts());
            assert.equal(records[0].method, 'PUT');
            assert.equal(records[0].url, '/bucket/key');
            assert.equal(records[0].body.toString(), 'render.html');
            assert.equal(records[0].headers['x-amz-content-sha256'], kind === 'buffer' ?
                lib.hash('render.html', 'sha256', 'hex') : 'UNSIGNED-PAYLOAD');
            checkWireSignature(records[0]);
        });
    }

    it('downloads an object through s3GetFile', async () => {
        respond = () => ({ headers: { 'content-type': 'text/plain' }, body: 'download bytes' });
        const { data } = await lib.promisify(aws.s3GetFile, 's3://bucket/key', opts());
        assert.equal(data.data, 'download bytes');
        assert.equal(records[0].url, '/bucket/key');
        checkWireSignature(records[0]);
    });

    it('does not retry when retryCount and errorCount are zero', async () => {
        respond = () => ({ status: 503, body: '<Error><Code>SlowDown</Code><Message>Retry</Message></Error>' });
        const result = await aws.aqueryS3('bucket', 'key', opts());
        assert.ok(result.err);
        assert.equal(records.length, 1);
    });

    it('retries an S3 503 through fetch', async () => {
        respond = (_record, attempt) => (attempt === 1 ? { status: 503, body: '<Error><Code>SlowDown</Code></Error>' } : { body: '<Result>ok</Result>' });
        const result = await aws.aqueryS3('bucket', 'key', opts({ retryCount: 1, retryTimeout: 1 }));
        assert.ifError(result.err);
        assert.equal(records.length, 2);
    });

    it('paginates real XML responses while retaining endpoint/query state', async () => {
        respond = (_record, page) => ({ body: '<ListBucketResult>' +
            `<Contents><Key>prefix/${page}</Key></Contents>` +
            `<IsTruncated>${page === 1}</IsTruncated>` +
            (page === 1 ? '<NextContinuationToken>next+token</NextContinuationToken>' : '') +
            '</ListBucketResult>' });
        const { data } = await lib.promisify(aws.s3List, 's3://bucket/prefix', opts());
        assert.equal(data.length, 2);
        assert.equal(records.length, 2);
        for (const record of records) {
            assert.equal(new URL(record.url, endpoint).searchParams.get('prefix'), 'prefix');
            checkWireSignature(record);
        }
        assert.equal(new URL(records[1].url, endpoint).searchParams.get('continuation-token'), 'next+token');
    });

    it('uses list URL query parameters and returns relative common prefixes', async () => {
        respond = () => ({ body: '<ListBucketResult><IsTruncated>false</IsTruncated>' +
            '<CommonPrefixes><Prefix>prefix/child/</Prefix></CommonPrefixes></ListBucketResult>' });
        const { args } = await lib.promisify(aws.s3List, 's3://bucket/prefix/', opts({ query: { delimiter: "/" } }));
        assert.equal(new URL(records[0].url, endpoint).searchParams.get('delimiter'), '/');
        assert.deepEqual(args?.[0], ['child/']);
    });

    it('encodes the copy source and handles embedded HTTP-200 XML errors', async () => {
        respond = () => ({ body: '<Error><Code>AccessDenied</Code><Message>Denied</Message></Error>' });
        await lib.promisify(aws.s3CopyFile, 's3://bucket/destination', 's3://source/a b#c', opts());
        assert.equal(records[0].url, '/bucket/destination');
        assert.equal(decodeURIComponent(records[0].headers['x-amz-copy-source']).replace(/^\//, ''), 'source/a b#c');
    });

    it('proxies status, bytes, query, credentials and attachment headers through fetch', async () => {
        // A second loopback server supplies a real ServerResponse, not a mock.
        respond = () => ({ status: 206, headers: { 'content-type': 'text/plain', 'content-range': 'bytes 0-4/5' }, body: 'hello' });
        const proxy = http.createServer((_req, res) => {
            aws.s3Proxy(res, 's3://bucket/file.txt?versionId=v',
                opts({ attachment: true }), (err) => {
                    if (err) console.error(err);
                });
        });
        await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
        try {
            const result = await lib.afetch('http://127.0.0.1:' + proxy.address().port, { quiet: true, hardTimeout: 5000 });
            assert.equal(result.status, 206);
            assert.equal(result.data, 'hello');
            assert.equal(result.request.resheaders['content-disposition'], api.getContentDisposition('file.txt'));
            assert.equal(records[0].url, '/bucket/file.txt?versionId=v');
            checkWireSignature(records[0]);
        } finally {
            await new Promise((resolve) => { proxy.close(resolve); proxy.closeAllConnections(); });
        }
    });
});
