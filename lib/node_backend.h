//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  April 2007
//

#ifndef _node_backend_H
#define _node_backend_H

#include <node.h>
#include <node_object_wrap.h>
#include <node_buffer.h>
#include <node_version.h>
#include <v8.h>
#include <v8-profiler.h>
#include <uv.h>
#include "bksqlite.h"

#ifdef USE_NANOMSG
#include <nanomsg/nn.h>
#include <nanomsg/pipeline.h>
#include <nanomsg/reqrep.h>
#endif

using namespace node;
using namespace v8;
using namespace std;

#define REQUIRE_ARGUMENT(i) if (args.Length() <= i || args[i]->IsUndefined()) return ThrowException(Exception::TypeError(String::New("Argument " #i " is required")));
#define REQUIRE_ARGUMENT_STRING(i, var) if (args.Length() <= (i) || !args[i]->IsString()) return ThrowException(Exception::TypeError(String::New("Argument " #i " must be a string"))); String::Utf8Value var(args[i]->ToString());
#define REQUIRE_ARGUMENT_AS_STRING(i, var) if (args.Length() <= (i)) return ThrowException(Exception::TypeError(String::New("Argument " #i " must be a string"))); String::Utf8Value var(args[i]->ToString());
#define REQUIRE_ARGUMENT_OBJECT(i, var) if (args.Length() <= (i) || !args[i]->IsObject()) return ThrowException(Exception::TypeError(String::New("Argument " #i " must be an object"))); Local<Object> var(args[i]->ToObject());
#define REQUIRE_ARGUMENT_INT(i, var) if (args.Length() <= (i)) return ThrowException(Exception::TypeError(String::New("Argument " #i " must be an integer"))); int var = args[i]->Int32Value();
#define REQUIRE_ARGUMENT_INT64(i, var) if (args.Length() <= (i)) return ThrowException(Exception::TypeError(String::New("Argument " #i " must be an integer"))); int64_t var = args[i]->NumberValue();
#define REQUIRE_ARGUMENT_BOOL(i, var) if (args.Length() <= (i)) return ThrowException(Exception::TypeError(String::New("Argument " #i " must be a boolean"))); int var = args[i]->Int32Value();
#define REQUIRE_ARGUMENT_NUMBER(i, var) if (args.Length() <= (i)) return ThrowException(Exception::TypeError(String::New("Argument " #i " must be a number"))); double var = args[i]->NumberValue();
#define REQUIRE_ARGUMENT_ARRAY(i, var) if (args.Length() <= (i) || !args[i]->IsArray()) return ThrowException(Exception::TypeError(String::New("Argument " #i " must be an array"))); Local<Array> var = Local<Array>::Cast(args[i]);
#define REQUIRE_ARGUMENT_FUNCTION(i, var) if (args.Length() <= (i) || !args[i]->IsFunction()) return ThrowException(Exception::TypeError(String::New("Argument " #i " must be a function"))); Local<Function> var = Local<Function>::Cast(args[i]);

#define EXPECT_ARGUMENT_FUNCTION(i, var) Local<Function> var; \
        if (args.Length() > 0 && args.Length() > (i) && !args[(i) >= 0 ? (i) : args.Length() - 1]->IsUndefined()) { \
            if (!args[(i) >= 0 ? (i) : args.Length() - 1]->IsFunction()) return ThrowException(Exception::TypeError(String::New("Argument " #i " must be a function"))); \
            var = Local<Function>::Cast(args[(i) >= 0 ? (i) : args.Length() - 1]); }

#define OPTIONAL_ARGUMENT_FUNCTION(i, var) Local<Function> var; if (args.Length() > 0 && args.Length() > (i) && args[(i) >= 0 ? (i) : args.Length() - 1]->IsFunction()) var = Local<Function>::Cast(args[(i) >= 0 ? (i) : args.Length() - 1]);
#define OPTIONAL_ARGUMENT_INT(i, var) int var = (args.Length() > (i) && args[i]->IsInt32() ? args[i]->Int32Value() : 0);
#define OPTIONAL_ARGUMENT_INT2(i, var, dflt) int var = (args.Length() > (i) && args[i]->IsInt32() ? args[i]->Int32Value() : dflt);
#define OPTIONAL_ARGUMENT_NUMBER(i, var) float var = (args.Length() > (i) && args[i]->IsNumber() ? args[i]->NumberValue() : 0);
#define OPTIONAL_ARGUMENT_STRING(i, var) String::Utf8Value var(args.Length() > (i) && args[i]->IsString() ? args[i]->ToString() : String::New(""));
#define OPTIONAL_ARGUMENT_STRING2(i, var, dflt) String::Utf8Value var(args.Length() > (i) && args[i]->IsString() ? args[i]->ToString() : dflt);
#define OPTIONAL_ARGUMENT_AS_STRING(i, var) String::Utf8Value var(args.Length() > (i) ? args[i]->ToString() : String::New(""));
#define OPTIONAL_ARGUMENT_ARRAY(i, var) Local<Array> var(args.Length() > (i) && args[i]->IsArray() ? Local<Array>::Cast(args[i]) : Local<Array>::New(Array::New()));
#define OPTIONAL_ARGUMENT_OBJECT(i, var) Local<Object> var(args.Length() > (i) && args[i]->IsObject() ? Local<Object>::Cast(args[i]) : Local<Object>::New(Object::New()));

#define DEFINE_CONSTANT_INTEGER(target, constant, name) (target)->Set(String::NewSymbol(#name),Integer::New(constant),static_cast<PropertyAttribute>(ReadOnly | DontDelete) );
#define DEFINE_CONSTANT_STRING(target, constant, name) (target)->Set(String::NewSymbol(#name),String::NewSymbol(constant),static_cast<PropertyAttribute>(ReadOnly | DontDelete));

#define TRY_CATCH_CALL(context, callback, argc, argv) { TryCatch try_catch; (callback)->Call((context), (argc), (argv)); if (try_catch.HasCaught()) FatalException(try_catch); }

void SQLiteInit(Handle<Object> target);
void SyslogInit(Handle<Object> target);
void CacheInit(Handle<Object> target);
void NanoMsgInit(Handle<Object> target);
void DebugInit(Handle<Object> target);
void SimilarInit(Handle<Object> target);
void PgSQLInit(Handle<Object> target);
void MysqlInit(Handle<Object> target);
void LevelDBInit(Handle<Object> target);
void LMDBInit(Handle<Object> target);
void WandInit(Handle<Object> target);

string exceptionString(TryCatch* try_catch);
Handle<Value> toArray(vector<string> &list, int numeric = 0);
Handle<Value> toArray(vector<pair<string,string> > &list);

Handle<Value> jsonParse(string str);
string jsonStringify(Local<Value> obj);

static const string empty;

struct LRUStringCache {
    typedef unordered_map<string, pair<string, list<string>::iterator> > LRUStringItems;
    size_t size;
    size_t max;
    list<string> lru;
    LRUStringItems items;
    // stats
    size_t hits, misses, cleans, ins, dels;

    LRUStringCache(int m = 1000): max(m) { clear(); }
    ~LRUStringCache() { clear(); }

    const string& get(const string& k) {
        const LRUStringItems::iterator it = items.find(k);
        if (it == items.end()) {
            misses++;
            return empty;
        }
        hits++;
        lru.splice(lru.end(), lru, it->second.second);
        return it->second.first;
    }
    const string& set(const string& k, const string& v) {
        if (items.size() >= max) clean();
        const LRUStringItems::iterator it = items.find(k);
        if (it == items.end()) {
            list<string>::iterator it = lru.insert(lru.end(), k);
            pair<LRUStringItems::iterator,bool> p = items.insert(std::make_pair(k, std::make_pair(v, it)));
            V8::AdjustAmountOfExternalAllocatedMemory(k.size() + v.size());
            size += k.size() + v.size();
            ins++;
            return p.first->second.first;
        } else {
            V8::AdjustAmountOfExternalAllocatedMemory(-it->second.first.size());
            it->second.first = v;
            V8::AdjustAmountOfExternalAllocatedMemory(v.size());
            lru.splice(lru.end(), lru, it->second.second);
            return it->second.first;
        }
    }
    bool exists(const string &k) {
        const LRUStringItems::iterator it = items.find(k);
        return it != items.end();
    }
    const string &incr(const string& k, const string& v) {
        const string& o = get(k);
        char val[32];
        sprintf(val, "%lld", atoll(o.c_str()) + atoll(v.c_str()));
        return set(k, val);
    }
    void del(const string &k) {
        const LRUStringItems::iterator it = items.find(k);
        if (it == items.end()) return;
        size -= k.size() + it->second.first.size();
        V8::AdjustAmountOfExternalAllocatedMemory(-(k.size() + it->second.first.size()));
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
        V8::AdjustAmountOfExternalAllocatedMemory(-size);
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
    string get(const string &key) {
        string_map::iterator it = items.find(key);
        if (it != items.end()) return it->second;
        return string();
    }
    void set(const string &key, const string &val) {
        string_map::iterator it = items.find(key);
        if (it != items.end()) {
            V8::AdjustAmountOfExternalAllocatedMemory(-it->second.size());
            it->second = val;
            V8::AdjustAmountOfExternalAllocatedMemory(val.size());
        } else {
            items[key] = val;
            V8::AdjustAmountOfExternalAllocatedMemory(key.size() + val.size());
        }
    }
    bool exists(const string &k) {
        string_map::iterator it = items.find(k);
        return it != items.end();
    }
    string incr(const string& k, const string& v) {
        string o = get(k);
        char val[32];
        sprintf(val, "%lld", atoll(o.c_str()) + atoll(v.c_str()));
        set(k, val);
        return val;
    }
    void del(const string &key) {
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

#ifdef USE_NANOMSG
class NNServer;
typedef void (NNServerCallback)(NNServer *server, const char *buf, int size, void *data);
typedef void (NNServerFree)(void *buf);

class NNServer {
public:
    NNServer();
    virtual ~NNServer();

    virtual int Start(int rfd, int wfd, bool queue, NNServerCallback *cb, void *data, NNServerFree *cbfree);
    virtual void Stop();

    virtual void Run(const char *buf, int size);
    virtual int Recv(char **buf);
    virtual int Send(const char *buf, int size);
    virtual int Forward(const char *buf, int size);
    virtual void Free(char *buf);
    virtual string error(int err);

    static void ReadRequest(uv_poll_t*, int, int);
    static void PostRequest(uv_work_t* req, int status);
    static void WorkRequest(uv_work_t* req);

    int rsock;
    int rproto;
    int rfd;
    int wsock;
    int wproto;
    int wfd;
    int err;
    int maxsize;
    bool queue;
    uv_poll_t poll;
    NNServerCallback *bkcallback;
    NNServerFree *bkfree;
    void *data;
};
#endif

#endif

