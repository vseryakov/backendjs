
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { api, aws, middleware } = require("../");
const { astop } = require("./utils");

// Base event objects to reduce duplication
const baseV1Event = {
    version: '1.0',
    resource: '/my/path',
    path: '/my/path',
    httpMethod: 'GET',
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: {},
    requestContext: {
        accountId: '123456789012',
        apiId: 'id',
        authorizer: { claims: null, scopes: null },
        domainName: 'id.execute-api.us-east-1.amazonaws.com',
        domainPrefix: 'id',
        extendedRequestId: 'request-id',
        httpMethod: 'GET',
        identity: {
            sourceIp: '192.0.2.1',
            userAgent: 'user-agent',
            clientCert: {
                clientCertPem: 'CERT_CONTENT',
                subjectDN: 'www.example.com',
                issuerDN: 'Example issuer',
                serialNumber: 'a1:a1:a1:a1:a1:a1:a1:a1:a1:a1:a1:a1:a1:a1:a1:a1',
                validity: {
                    notBefore: 'May 28 12:30:02 2019 GMT',
                    notAfter: 'Aug  5 09:36:04 2021 GMT',
                },
            },
        },
        path: '/my/path',
        protocol: 'HTTP/1.1',
        requestId: 'id=',
        requestTime: '04/Mar/2020:19:15:17 +0000',
        requestTimeEpoch: 1583349317135,
        resourcePath: '/my/path',
        stage: '$default',
    },
    pathParameters: {},
    stageVariables: {},
    body: null,
    isBase64Encoded: false,
};
const baseV2Event = {
    version: '2.0',
    routeKey: '$default',
    rawPath: '/my/path',
    rawQueryString: '',
    cookies: [],
    headers: {},
    queryStringParameters: {},
    requestContext: {
        accountId: '123456789012',
        apiId: 'api-id',
        authentication: null,
        authorizer: {},
        domainName: 'id.execute-api.us-east-1.amazonaws.com',
        domainPrefix: 'id',
        http: {
            method: 'POST',
            path: '/my/path',
            protocol: 'HTTP/1.1',
            sourceIp: '192.0.2.1',
            userAgent: 'agent',
        },
        requestId: 'id',
        routeKey: '$default',
        stage: '$default',
        time: '12/Mar/2020:19:03:58 +0000',
        timeEpoch: 1583348638390,
    },
    body: null,
    pathParameters: {},
    isBase64Encoded: false,
    stageVariables: {},
};

describe('request', () => {

    const APIGatewayRequest = aws.APIGatewayRequest;

    it('Should preserve percent-encoded values in query string for version 1.0', () => {
        const event = {
            ...baseV1Event,
            // API Gateway provides decoded values
            multiValueQueryStringParameters: {
                path: ['/book/{bookId}/'], // Originally %7BbookId%7D
                name: ['John Doe'], // Originally John%20Doe
                tag: ['日本語'], // Originally %E6%97%A5%E6%9C%AC%E8%AA%9E
            },
        };
        const req = new APIGatewayRequest(event);
        // URL should contain properly encoded values
        assert.strictEqual(req.url, '/my/path?path=%2Fbook%2F%7BbookId%7D%2F&name=John%20Doe&tag=%E6%97%A5%E6%9C%AC%E8%AA%9E');
    });

    it('Should handle special characters correctly in queryStringParameters for version 1.0', () => {
        const event = {
            ...baseV1Event,
            queryStringParameters: {
                'key with spaces': 'value with spaces',
                'special!@#$%^&*()': 'chars!@#$%^&*()',
                equals: 'a=b=c',
                ampersand: 'a&b&c',
            },
        };
        const req = new APIGatewayRequest(event);
        // Verify the URL is properly encoded
        const url = new URL("http://localhost" + req.url);
        assert.strictEqual(url.searchParams.get('key with spaces'), 'value with spaces');
        assert.strictEqual(url.searchParams.get('special!@#$%^&*()'), 'chars!@#$%^&*()');
        assert.strictEqual(url.searchParams.get('equals'), 'a=b=c');
        assert.strictEqual(url.searchParams.get('ampersand'), 'a&b&c');
    });

    it('Should preserve empty query parameters for version 1.0', () => {
        const event = {
            ...baseV1Event,
            queryStringParameters: {
                empty: '',
                present: '0',
                omitted: undefined,
            },
        };
        const req = new APIGatewayRequest(event);
        assert.strictEqual(req.url, '/my/path?empty=&present=0');
    });

    it('Should preserve empty query parameters for ALB events', () => {
        const event = {
            httpMethod: 'GET',
            path: '/my/path',
            headers: { host: 'example.test' },
            body: null,
            isBase64Encoded: false,
            queryStringParameters: {
                empty: '',
                present: '0',
                omitted: undefined,
            },
            requestContext: {
                elb: { targetGroupArn: 'arn:aws:elasticloadbalancing:...' },
            },
        };
        const req = new APIGatewayRequest(event);
        assert.strictEqual(req.url, '/my/path?empty=&present=0');
    });

    it('Should return valid Request object from version 1.0 API Gateway event', () => {
        const event = {
            ...baseV1Event,
            headers: {
                'content-type': 'application/json',
                header1: 'value1',
                header2: 'value1',
            },
            multiValueHeaders: {
                header1: ['value1'],
                header2: ['value1', 'value2', 'value3'],
            },
            // This value doesn't match multi value's content.
            // We want to assert handler is using the multi value's content when both are available.
            queryStringParameters: {
                parameter2: 'value',
            },
            multiValueQueryStringParameters: {
                parameter1: ['value1', 'value2'],
                parameter2: ['value'],
            },
        };
        const req = new APIGatewayRequest(event);
        assert.strictEqual(req.method, 'GET');
        // Note: Values are now properly encoded
        assert.strictEqual(req.url, '/my/path?parameter1=value1&parameter1=value2&parameter2=value');
        assert.deepStrictEqual(req.headers, {
            'content-length': 0,
            'content-type': 'application/json',
            header1: 'value1',
            header2: 'value1, value2, value3',
        });
    });

    it('Should preserve every repeated header value for version 1.0 API Gateway event', () => {
        const event = {
            ...baseV1Event,
            headers: {
                'x-forwarded-for': '203.0.113.10',
            },
            multiValueHeaders: {
                'x-forwarded-for': ['203.0.113.1', '203.0.113.10'],
            },
        };
        const req = new APIGatewayRequest(event);
        assert.strictEqual(req.headers['x-forwarded-for'], '203.0.113.1, 203.0.113.10');
    });

    it('Should return valid Request object from version 2.0 API Gateway event', () => {
        const event = {
            ...baseV2Event,
            rawQueryString: 'parameter1=value1&parameter1=value2&parameter2=value',
            cookies: ['cookie1', 'cookie2'],
            headers: {
                'content-type': 'application/json',
                header1: 'value1',
                header2: 'value1,value2',
            },
            queryStringParameters: {
                parameter1: 'value1,value2',
                parameter2: 'value',
            },
            body: 'Hello from Lambda',
            pathParameters: {
                parameter1: 'value1',
            },
            stageVariables: {
                stageVariable1: 'value1',
                stageVariable2: 'value2',
            },
        };
        const req = new APIGatewayRequest(event);
        assert.strictEqual(req.method, 'POST');
        assert.strictEqual(req.url, '/my/path?parameter1=value1&parameter1=value2&parameter2=value');
        assert.deepStrictEqual(req.headers, {
            'content-length': 17,
            'content-type': 'application/json',
            cookie: 'cookie1; cookie2',
            header1: 'value1',
            header2: 'value1,value2',
        });
    });

    it('Should encode non-ASCII header values with encodeURIComponent', async () => {
        const event = {
            ...baseV1Event,
            headers: {
                'x-city': '炎', // Non-ASCII character
            },
        };
        const req = new APIGatewayRequest(event);
        console.log(req.headers)
        const xCity = req.headers['x-city'] ?? '';
        assert.strictEqual(decodeURIComponent(xCity), '炎');
    });

    after(async () => {
        await astop()
    })
});

describe('handler', async () => {

    it('Should route a V1 REST event by its path even when a base path mapping adds rawPath', async () => {
        api.app.reset();
        api.app.get('/my/path', (c) => c.send(200, 'Hello'));

        // A custom domain base path mapping makes API Gateway add a `rawPath` to the
        // V1 (REST API) event, holding the path before the mapping was stripped. The
        // event is still V1: it carries `path` and a V1 request context with no `http`.
        const event = {
            ...baseV1Event,
            rawPath: '/base/my/path',
        };
        const result = await aws.lambdaAPIGatewayHandler(event);
        assert.strictEqual(result.statusCode, 200);
        assert.strictEqual(result.body, 'Hello');
    });

    it('ALB single-header: emits the first Set-Cookie intact, never comma-joined', async () => {
        api.app.reset()
        api.app.get('/multi-cookie', (c) => {
            c.setCookie('session', 'abc123', { expires: new Date('2027-06-09T00:00:00Z') });
            c.setCookie('csrf', 'xyz789', { expires: new Date('2027-06-10T00:00:00Z') });
            return c.send(200, 'ok');
        });
        const event = {
            httpMethod: 'GET',
            path: '/multi-cookie',
            headers: { host: 'app.example.com' },
            body: null,
            isBase64Encoded: false,
            requestContext: { elb: { targetGroupArn: 'arn:aws:elasticloadbalancing:...' } },
        };
        const result = await aws.lambdaAPIGatewayHandler(event);
        assert.strictEqual(result.headers['set-cookie'], 'session=abc123; Expires=Wed, 09 Jun 2027 00:00:00 GMT');
    });

    it('Should enforce body max-size when the client understates Content-Length', async () => {
        api.app.reset()
        api.app.post('/upload', middleware.body, (c) => c.json({ received: c.body?.length }));
        const event = {
            ...baseV2Event,
            rawPath: '/upload',
            headers: { 'content-type': 'text/json', 'content-length': '1' },
            body: `"${'A'.repeat(100000)}"`,
            requestContext: {
                ...baseV2Event.requestContext,
                http: {
                    method: 'POST',
                    path: '/upload',
                    protocol: 'HTTP/1.1',
                    sourceIp: '192.0.2.1',
                    userAgent: 'agent',
                },
            },
        };
        const result = await aws.lambdaAPIGatewayHandler(event);
        assert.strictEqual(result.statusCode, 413);
    });

    it('Should expose the context of a Lambda (REQUEST) authorizer', async () => {
        api.app.reset();
        api.app.get('/my/path', (context) => context.json(context.req.lambdaEvent.requestContext.authorizer.lambda));
        const event = {
            ...baseV2Event,
            requestContext: {
                ...baseV2Event.requestContext,
                http: { ...baseV2Event.requestContext.http, method: 'GET' },
                authorizer: { lambda: { userId: 'user-123', isAdmin: true } },
            },
        };
        const result = await aws.lambdaAPIGatewayHandler(event);
        assert.strictEqual(result.statusCode, 200);
        assert.deepStrictEqual(JSON.parse(result.body), { userId: 'user-123', isAdmin: true });
    });

    it('Should expose the claims and scopes of a JWT authorizer', async () => {
        api.app.reset();
        api.app.get('/my/path', (context) => context.json(context.req.lambdaEvent.requestContext.authorizer.jwt));
        const event = {
            ...baseV2Event,
            requestContext: {
                ...baseV2Event.requestContext,
                http: { ...baseV2Event.requestContext.http, method: 'GET' },
                authorizer: {
                    jwt: { claims: { sub: 'user-123', email_verified: true }, scopes: ['read'] },
                },
            },
        };
        const result = await aws.lambdaAPIGatewayHandler(event);
        assert.strictEqual(result.statusCode, 200);
        assert.deepStrictEqual(JSON.parse(result.body), {
            claims: { sub: 'user-123', email_verified: true },
            scopes: ['read'],
        });
    });

    after(async () => {
        await astop()
    })
});
