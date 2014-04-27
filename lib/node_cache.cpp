//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  April 2013
//

#include "node_backend.h"

#ifdef USE_NANOMSG
#include <nanomsg/nn.h>
#endif

struct lruSocket {
	int sock1;
	int sock2;
	int type;
};

struct LRUStringCache {
    typedef map<string, pair<string, list<string>::iterator> > LRUStringItems;
    size_t size;
    size_t max;
    list<string> lru;
    LRUStringItems items;
    // stats
    size_t hits, misses, cleans, ins, dels;

    LRUStringCache(int m = 1000): max(m) { clear(); }
    ~LRUStringCache() { clear(); }
    string get(const string& k) {
        const LRUStringItems::iterator it = items.find(k);
        if (it == items.end()) {
        	misses++;
        	return string();
        }
        hits++;
        lru.splice(lru.end(), lru, it->second.second);
        return it->second.first;
    }
    void set(const string& k, const string& v) {
        if (items.size() >= max) clean();
        const LRUStringItems::iterator it = items.find(k);
        if (it == items.end()) {
        	list<string>::iterator it = lru.insert(lru.end(), k);
        	items.insert(std::make_pair(k, std::make_pair(v, it)));
        	size += k.size() + v.size();
        	ins++;
        } else {
        	lru.splice(lru.end(), lru, it->second.second);
        }
    }
    void incr(const string& k, const string& v) {
    	string o = get(k);
    	set(k, vFmtStr("%lld", atoll(o.c_str()) + atoll(v.c_str())));
    }
    void del(const string &k) {
        const LRUStringItems::iterator it = items.find(k);
        if (it == items.end()) return;
        size -= k.size() + it->second.first.size();
        lru.erase(it->second.second);
        items.erase(it);
        dels++;
    }
    void clean() {
        const LRUStringItems::iterator it = items.find(lru.front());
        if (it == items.end()) return;
        size -= it->first.size() + it->first.size();
        items.erase(it);
        lru.pop_front();
        cleans++;
    }
    void clear() {
        items.clear();
        lru.clear();
        size = ins = dels = cleans = hits = misses = 0;
    }
};

struct StringCache {
    string_map items;
    string_map::const_iterator nextIt;
    Persistent<Function> nextCb;
    Persistent<Function> completed;

    StringCache() { nextIt = items.end(); }
    ~StringCache() { clear(); }
    string get(string key) {
        string_map::iterator it = items.find(key);
        if (it != items.end()) return it->second;
        return string();
    }
    void set(string key, string val) {
        string_map::iterator it = items.find(key);
        if (it != items.end()) {
            V8::AdjustAmountOfExternalAllocatedMemory(-it->second.size());
            it->second = val;
            V8::AdjustAmountOfExternalAllocatedMemory(it->second.size());
        } else {
            items[key] = val;
            V8::AdjustAmountOfExternalAllocatedMemory(key.size() + val.size());
        }
    }
    void del(string key) {
        string_map::iterator it = items.find(key);
        if (it != items.end()) {
            V8::AdjustAmountOfExternalAllocatedMemory(-(it->first.size() + it->second.size()));
            items.erase(it);
        }
    }
    void clear() {
        string_map::iterator it;
        int n = 0;
        for (it = items.begin(); it != items.end(); ++it) {
            n += it->first.size() + it->second.size();
        }
        items.clear();
        nextIt = items.end();
        V8::AdjustAmountOfExternalAllocatedMemory(-n);
        if (!nextCb.IsEmpty()) nextCb.Dispose();
        if (!completed.IsEmpty()) completed.Dispose();
        nextCb.Clear();
        completed.Clear();
    }

    bool begin(Handle<Function> cb1 = Handle<Function>(), Handle<Function> cb2 = Handle<Function>()) {
        if (!nextCb.IsEmpty()) nextCb.Dispose();
        if (!completed.IsEmpty()) completed.Dispose();
        nextCb = Persistent<Function>::New(cb1);
        completed = Persistent<Function>::New(cb2);
        nextIt = items.begin();
        return true;
    }
    Handle<Value> next() {
        HandleScope scope;
        if (nextIt == items.end()) return scope.Close(Undefined());
        Local<Array> obj(Array::New());
        obj->Set(Integer::New(0), String::New(nextIt->first.c_str()));
        obj->Set(Integer::New(1), String::New(nextIt->second.c_str()));
        nextIt++;
        return scope.Close(obj);
    }
    void each(Handle<Function> cb) {
        string_map::const_iterator it = items.begin();
        while (it != items.end()) {
            HandleScope scope;
            Local<Value> argv[2];
            argv[0] = String::New(it->first.c_str());
            argv[1] = String::New(it->second.c_str());
            TRY_CATCH_CALL(Context::GetCurrent()->Global(), cb, 2, argv);
            it++;
        }
    }
    bool timer() {
        if (nextIt != items.end()) {
            uv_work_t *req = new uv_work_t;
            req->data = this;
            uv_queue_work(uv_default_loop(), req, WorkTimer, (uv_after_work_cb)AfterTimer);
            return true;
        } else {
            uv_timer_t *req = new uv_timer_t;
            uv_timer_init(uv_default_loop(), req);
            req->data = this;
            uv_timer_start(req, CompletedTimer, 0, 0);
            return false;
        }
    }
    static void WorkTimer(uv_work_t *req) {}
    static void AfterTimer(uv_work_t *req, int status) {
        HandleScope scope;
        StringCache *cache = (StringCache *)req->data;
        Local<Value> argv[2];
        if (cache->nextIt != cache->items.end()) {
            argv[0] = String::New(cache->nextIt->first.c_str());
            argv[1] = String::New(cache->nextIt->second.c_str());
            cache->nextIt++;
            TRY_CATCH_CALL(Context::GetCurrent()->Global(), cache->nextCb, 2, argv);
        }
        delete req;
    }
    static void CompletedTimer(uv_timer_t *req, int status) {
        HandleScope scope;
        StringCache *cache = (StringCache *)req->data;
        Local<Value> argv[1];
        TRY_CATCH_CALL(Context::GetCurrent()->Global(), cache->completed, 0, argv);
        delete req;
    }
};

typedef map<string, StringCache> Cache;

static Cache _cache;
static LRUStringCache _lru;

static Handle<Value> cacheClear(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_AS_STRING(0, name);

    Cache::iterator itc = _cache.find(*name);
    if (itc != _cache.end()) {
        itc->second.clear();
        _cache.erase(*name);
    }
    return scope.Close(Undefined());
}

static Handle<Value> cacheSet(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_AS_STRING(0, name);
    REQUIRE_ARGUMENT_AS_STRING(1, key);
    REQUIRE_ARGUMENT_AS_STRING(2, val);

    Cache::iterator itc = _cache.find(*name);
    if (itc == _cache.end()) {
        _cache[*name] = StringCache();
        itc = _cache.find(*name);
    }
    itc->second.set(*key, *val);
    return scope.Close(Undefined());
}

static Handle<Value> cacheDel(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_AS_STRING(0, name);
    REQUIRE_ARGUMENT_AS_STRING(1, key);

    Cache::iterator itc = _cache.find(*name);
    if (itc != _cache.end()) itc->second.del(*key);

    return scope.Close(Undefined());
}

static Handle<Value> cacheGet(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_AS_STRING(0, name);
    REQUIRE_ARGUMENT_AS_STRING(1, key);

    Cache::iterator itc = _cache.find(*name);
    if (itc != _cache.end()) {
        return scope.Close(String::New(itc->second.get(*key).c_str()));
    }

    return scope.Close(Undefined());
}

static Handle<Value> cacheKeys(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_AS_STRING(0, name);

    Local<Array> keys = Array::New();
    Cache::iterator itc = _cache.find(*name);
    if (itc != _cache.end()) {
        string_map::const_iterator it = itc->second.items.begin();
        int i = 0;
        while (it != itc->second.items.end()) {
            keys->Set(Integer::New(i), String::New(it->first.c_str()));
            it++;
            i++;
        }
    }
    return scope.Close(keys);
}

static Handle<Value> cacheNames(const Arguments& args)
{
    HandleScope scope;

    Local<Array> keys = Array::New();
    Cache::const_iterator it = _cache.begin();
    int i = 0;
    while (it != _cache.end()) {
        Local<String> str = String::New(it->first.c_str());
        keys->Set(Integer::New(i), str);
        it++;
        i++;
    }
    return scope.Close(keys);
}

static Handle<Value> cacheSize(const Arguments& args)
{
    HandleScope scope;
    REQUIRE_ARGUMENT_AS_STRING(0, name);
    int count = 0;
    Cache::iterator itc = _cache.find(*name);
    if (itc != _cache.end()) count = itc->second.items.size();

    return scope.Close(Integer::New(count));
}

static Handle<Value> cacheEach(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_AS_STRING(0, name);
    REQUIRE_ARGUMENT_FUNCTION(1, cb);

    Cache::iterator itc = _cache.find(*name);
    if (itc != _cache.end()) itc->second.each(cb);

    return scope.Close(Undefined());
}

static Handle<Value> cacheBegin(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_AS_STRING(0, name);
    Cache::iterator itc = _cache.find(*name);
    if (itc != _cache.end()) return scope.Close(Boolean::New(itc->second.begin()));
    return scope.Close(Boolean::New(false));
}

static Handle<Value> cacheNext(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_AS_STRING(0, name);
    Cache::iterator itc = _cache.find(*name);
    if (itc != _cache.end()) return scope.Close(itc->second.next());
    return scope.Close(Undefined());
}

static Handle<Value> cacheForEachNext(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_AS_STRING(0, name);
    Cache::iterator itc = _cache.find(*name);
    if (itc != _cache.end()) return scope.Close(Boolean::New(itc->second.timer()));
    return scope.Close(Boolean::New(false));
}

static Handle<Value> cacheForEach(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_AS_STRING(0, name);
    REQUIRE_ARGUMENT_FUNCTION(1, cb);
    REQUIRE_ARGUMENT_FUNCTION(2, complete);

    Cache::iterator itc = _cache.find(*name);
    if (itc != _cache.end()) {
        itc->second.begin(cb, complete);
        return scope.Close(Boolean::New(itc->second.timer()));
    }

    Local<Value> argv[1];
    TryCatch try_catch;
    complete->Call(Context::GetCurrent()->Global(), 0, argv);
    if (try_catch.HasCaught()) FatalException(try_catch);

    return scope.Close(Boolean::New(false));
}

static Handle<Value> cacheSave(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_AS_STRING(0, name);
    REQUIRE_ARGUMENT_AS_STRING(1, file);
    REQUIRE_ARGUMENT_AS_STRING(2, sep);

    FILE *fp = fopen(*file, "w");
    if (!fp) ThrowException(Exception::Error(String::New("Cannot create file")));

    Cache::iterator itc = _cache.find(*name);
    if (itc != _cache.end()) {
        string_map::const_iterator it = itc->second.items.begin();
        while (it != itc->second.items.end()) {
            fprintf(fp, "%s%s%s\n", it->first.c_str(), *sep, it->second.c_str());
            it++;
        }
        fclose(fp);
    }
    return scope.Close(Undefined());
}

static Handle<Value> lruInit(const Arguments& args)
{
    HandleScope scope;
    REQUIRE_ARGUMENT_INT(0, max);
    _lru.max = max;
    return scope.Close(Undefined());
}

static Handle<Value> lruSize(const Arguments& args)
{
    HandleScope scope;
    return scope.Close(Integer::New(_lru.size));
}

static Handle<Value> lruCount(const Arguments& args)
{
    HandleScope scope;
    return scope.Close(Integer::New(_lru.items.size()));
}

static Handle<Value> lruClear(const Arguments& args)
{
    HandleScope scope;

    _lru.clear();
    return scope.Close(Undefined());
}

static Handle<Value> lruSet(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_AS_STRING(0, key);
    REQUIRE_ARGUMENT_AS_STRING(1, val);

    _lru.set(*key, *val);
    return scope.Close(Undefined());
}

static Handle<Value> lruIncr(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_AS_STRING(0, key);
    REQUIRE_ARGUMENT_AS_STRING(1, val);

    _lru.set(*key, *val);
    return scope.Close(Undefined());
}

static Handle<Value> lruDel(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_AS_STRING(0, key);
    _lru.del(*key);
    return scope.Close(Undefined());
}

static Handle<Value> lruGet(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_AS_STRING(0, key);
    string str = _lru.get(*key);
    return scope.Close(String::New(str.c_str()));
}

static Handle<Value> lruKeys(const Arguments& args)
{
    HandleScope scope;

    Local<Array> keys = Array::New();
    int i = 0;
    list<string>::iterator it = _lru.lru.begin();
    while (it != _lru.lru.end()) {
    	Local<String> str = String::New(it->c_str());
    	keys->Set(Integer::New(i), str);
    	it++;
    	i++;
    }
    return scope.Close(keys);
}

static Handle<Value> lruStats(const Arguments& args)
{
    HandleScope scope;

    Local<Object> obj = Object::New();
    obj->Set(String::NewSymbol("inserted"), Integer::New(_lru.ins));
    obj->Set(String::NewSymbol("deleted"), Integer::New(_lru.dels));
    obj->Set(String::NewSymbol("cleanups"), Integer::New(_lru.cleans));
    obj->Set(String::NewSymbol("hits"), Integer::New(_lru.hits));
    obj->Set(String::NewSymbol("misses"), Integer::New(_lru.misses));
    obj->Set(String::NewSymbol("max"), Integer::New(_lru.max));
    obj->Set(String::NewSymbol("size"), Integer::New(_lru.size));
    obj->Set(String::NewSymbol("count"), Integer::New(_lru.items.size()));
    return scope.Close(obj);
}

#ifdef USE_NANOMSG
static void lruHandleRead(uv_poll_t *w, int status, int revents)
{
	if (status == -1 || !(revents & UV_READABLE)) return;
	lruSocket *d = (lruSocket*)w->data;

	string str;
	char *buf, *val;
	int rc = nn_recv(d->sock1, (void*)&buf, NN_MSG, NN_DONTWAIT);
	if (rc == -1) {
		LogError("%d: %d: recv: %s", d->type, d->sock1, nn_strerror(nn_errno()));
		return;
	}
	LogDebug("type=%d, sock=%d, %s", d->type, d->sock1, buf);

	switch (d->type) {
	case 0:
		// Update/delete/increment an item in the cache
		val = strpbrk(buf, "\1\2");
		if (!val) {
			_lru.del(buf);
		} else
		if (!val[1]) {
			_lru.del(string(buf, val - buf));
		} else {
			if (*val == '\2') {
				_lru.incr(buf, val + 1);
			} else {
				_lru.set(buf, val + 1);
			}
		}
		// Send to another hop or broadcast to all servers, depends on the socket type
		if (d->sock2 >= 0) {
			rc = nn_send(d->sock2, &buf, NN_MSG, NN_DONTWAIT);
			if (rc == -1) LogError("%d: %d: send: %s", d->type, d->sock2, nn_strerror(nn_errno()));
			break;
		}
		nn_freemsg(buf);
		break;

	case 1:
		// Respond to get requests, never use second socket
		str = _lru.get(buf);
		rc = nn_send(d->sock1, str.c_str(), str.size() + 1, NN_DONTWAIT);
		if (rc == -1) LogError("%d: %d: send: %s", d->type, d->sock1, nn_strerror(nn_errno()));
		nn_freemsg(buf);
		break;

	default:
		LogError("unknown request type: %d", d->type);
		nn_freemsg(buf);
	}
}
#endif

static map<int,uv_poll_t*> _socks;

static Handle<Value> lruServerStart(const Arguments& args)
{
    HandleScope scope;
#ifdef USE_NANOMSG

    REQUIRE_ARGUMENT_INT(0, type);
    REQUIRE_ARGUMENT_INT(1, sock1);
    OPTIONAL_ARGUMENT_INT2(2, sock2, -1);

    int rfd;
    size_t fdsz = sizeof(rfd);
    int rc = nn_getsockopt(sock1, NN_SOL_SOCKET, NN_RCVFD, (char*) &rfd, &fdsz);
    if (rc == -1) return ThrowException(Exception::Error(String::New(nn_strerror(nn_errno()))));

    lruSocket *d = new lruSocket;
    d->type = type;
    d->sock1 = sock1;
    d->sock2 = sock2;
    uv_poll_t *p = new uv_poll_t;
    uv_poll_init(uv_default_loop(), p, rfd);
    uv_poll_start(p, UV_READABLE, lruHandleRead);
    p->data = d;
    _socks[sock1] = p;

    LogDebug("type=%d, sock1=%d, sock2=%d, rfd=%d", type, sock1, sock2, rfd);
#else
    return ThrowException(Exception::Error(String::New("nanomsg is not compiled in")));
#endif
    return scope.Close(Undefined());
}

static Handle<Value> lruServerStop(const Arguments& args)
{
    HandleScope scope;
#ifdef USE_NANOMSG

    REQUIRE_ARGUMENT_INT(0, sock);
    _socks.erase(sock);
#endif
    return scope.Close(Undefined());
}

void CacheInit(Handle<Object> target)
{
    HandleScope scope;

    NODE_SET_METHOD(target, "cacheSave", cacheSave);
    NODE_SET_METHOD(target, "cacheSet", cacheSet);
    NODE_SET_METHOD(target, "cacheGet", cacheGet);
    NODE_SET_METHOD(target, "cacheDel", cacheDel);
    NODE_SET_METHOD(target, "cacheKeys", cacheKeys);
    NODE_SET_METHOD(target, "cacheClear", cacheClear);
    NODE_SET_METHOD(target, "cacheNames", cacheNames);
    NODE_SET_METHOD(target, "cacheSize", cacheSize);
    NODE_SET_METHOD(target, "cacheEach", cacheEach);
    NODE_SET_METHOD(target, "cacheForEach", cacheForEach);
    NODE_SET_METHOD(target, "cacheForEachNext", cacheForEachNext);
    NODE_SET_METHOD(target, "cacheBegin", cacheBegin);
    NODE_SET_METHOD(target, "cacheNext", cacheNext);

    NODE_SET_METHOD(target, "lruInit", lruInit);
    NODE_SET_METHOD(target, "lruStats", lruStats);
    NODE_SET_METHOD(target, "lruSize", lruSize);
    NODE_SET_METHOD(target, "lruCount", lruCount);
    NODE_SET_METHOD(target, "lruSet", lruSet);
    NODE_SET_METHOD(target, "lruGet", lruGet);
    NODE_SET_METHOD(target, "lruIncr", lruIncr);
    NODE_SET_METHOD(target, "lruDel", lruDel);
    NODE_SET_METHOD(target, "lruKeys", lruKeys);
    NODE_SET_METHOD(target, "lruClear", lruClear);
    NODE_SET_METHOD(target, "lruServerStart", lruServerStart);
    NODE_SET_METHOD(target, "lruServerStop", lruServerStop);
}

