//
// Backend app
// Created by vlad on Mon Oct 23 13:35:55 EDT 2017
//
var bkjs = require('backendjs');
var api = bkjs.api;
var app = bkjs.app;
var logger = bkjs.logger;
var auth = bkjs.user;
var lib = bkjs.lib;

var srp = {
    hexN: 'AC6BDB41324A9A9BF166DE5E1389582FAF72B6651987EE07FC3192943DB56050A37329CBB4A099ED8193E0757767A13DD52312AB4B03310D' +
          'CD7F48A9DA04FD50E8083969EDB767B0CF6095179A163AB3661A05FBD5FAAAE82918A9962F0B93B855F97993EC975EEAA80D740ADBF4FF74' +
          '7359D041D5C33EA71D281E446B14773BCA97B43A23FB801676BD207A436C6481F1D2B9078717461A5B9D32E688F87748544523B524B0D57D' +
          '5EA77A2775D2ECFA032CFBDBF52FB3786160279004E57AE6AF874E7303CE53299CCC041C7BC308D82A5698F3A8D0C38271AE35F8E9DBFBB6' +
          '94B5C803D89F7AE435DE236D525F54759B65E372FCD68EF20FA7111F9E4AFF73',
    hexG: '02',
};

srp.init = function()
{
    if (!this._) {
        this.BigInteger = require("jsbn").BigInteger;
        this.N = this.toInt(this.hexN);
        this.g = this.toInt(this.hexG);
        this.k = this.hash(this.N, this.g);
        this._ = 1;
    }
}

srp.toInt = function(n)
{
    return n instanceof this.BigInteger ? n : typeof n == "string" ? new this.BigInteger(n, 16) : this.rand();
}

srp.hash = function(...args)
{
    const h = crypto.createHash('sha256');
    for (const i in args) {
        if (args[i] instanceof this.BigInteger) {
            h.update(Buffer.from(args[i].toString(16).padStart(512, "0"), "hex"));
        } else {
            h.update(args[i]);
        }
    }
    return new this.BigInteger(h.digest("hex"), 16);
}

srp.rand = function()
{
    return new this.BigInteger(crypto.randomBytes(32).toString('hex'), 16);
}

srp.x = function(user, secret, salt)
{
    return this.hash(Buffer.from(this.toInt(salt).toString(16).padStart(64, "0"), "hex"), crypto.createHash('sha256').update(user).update(":").update(secret).digest());
}

srp.verifier = function(user, secret, salt)
{
    this.init();
    const s = this.toInt(salt);
    const x = this.x(user, secret, s);
    const v = this.g.modPow(x, this.N);
    return [s.toString(16), v.toString(16), x.toString(16)];
}

srp.client1 = function(salt)
{
    this.init();
    const a = this.toInt(salt);
    const A = this.g.modPow(a, this.N);
    return [a.toString(16), A.toString(16)];
}

srp.client2 = function(user, secret, salt, a, B)
{
    this.init();
    B = this.toInt(B);
    if (B.mod(this.N).toString() == "0") return null;
    a = this.toInt(a);
    const x = this.x(user, secret, salt);
    const A = this.g.modPow(a, this.N);
    const u = this.hash(A, B);
    const S = B.subtract(this.k.multiply(this.g.modPow(x, this.N))).modPow(a.add(u.multiply(x)), this.N).mod(this.N);
    const K = this.hash(S);
    const M = this.hash(A, B, S);
    return [K.toString(16), M.toString(16), S.toString(16), u.toString(16), x.toString(16), A.toString(16)];
}

srp.client3 = function(A, M1, K, M2)
{
    const M = this.hash(this.toInt(A), this.toInt(M1), this.toInt(K));
    return [M.equals(this.toInt(M2)), M.toString(16)];
}

srp.server1 = function(verifier, salt)
{
    this.init();
    const b = this.toInt(salt);
    const v = this.toInt(verifier);
    const B = this.k.multiply(v).add(this.g.modPow(b, this.N)).mod(this.N);
    return [b.toString(16), B.toString(16)];
}

srp.server2 = function(user, verifier, b, A, M1)
{
    this.init();
    A = this.toInt(A);
    if (A.mod(this.N).toString() == '0') return [];

    b = this.toInt(b);
    const v = this.toInt(verifier);
    const B = this.k.multiply(v).add(this.g.modPow(b, this.N)).mod(this.N);
    if (B.mod(this.N).toString() == '0') return [];

    M1 = this.toInt(M1);
    const u = this.hash(A, B);
    const S = A.multiply(v.modPow(u, this.N)).modPow(b, this.N).mod(this.N);
    const M = this.hash(A, B, S);
    if (!M.equals(M1)) return [];
    const K = this.hash(S);
    const M2 = this.hash(A, M1, K);
    return [M2.toString(16), S.toString(16), u.toString(16)];
}


// Create API endpoints and routes
app.configureWeb = function(options, callback)
{
    lib.toRegexpObj(api.allow, "^/srp");

    app.srp = {};
    api.app.all(/^\/srp\/register/, function(req, res) {
        if (!req.query.user || !req.query.salt || !req.query.verifier) return api.sendReply(res, { status: 400, message: "user, salt and verifier required" });
        app.srp[req.query.user] = { salt: req.query.salt, verifier: req.query.verifier };
        logger.log(req.path, req.query);
        api.sendReply(res);
    });
    api.app.all(/^\/srp\/login1/, function(req, res) {
        if (!req.query.A || !req.query.user) return api.sendRepy(res, { status: 400, message: "user and A required" });
        var user = app.srp[req.query.user];
        if (!user) return api.sendReply(res, 404, "invalid user");
        var s1 = srp.server1(user.verifier);
        user.b = s1[0];
        user.A = req.query.A;
        logger.log(req.path, user);
        api.sendJSON(req, null, { salt: user.salt, B: s1[1] });
    });
    api.app.all(/^\/srp\/login2/, function(req, res) {
        if (!req.query.M1 || !req.query.user) return api.sendRepy(res, { status: 400, message: "user and M1 required" });
        var user = app.srp[req.query.user];
        if (!user) return api.sendReply(res, 404, "invalid user");
        var s2 = srp.server2(req.query.user, user.verifier, user.b, user.A, req.query.M1);
        user.M1 = req.query.M1;
        user.M2 = s2[0];
        logger.log(req.path, user);
        api.sendJSON(req, null, { M2: user.M2 });
    });
    callback()
};

bkjs.server.start();
