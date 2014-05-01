//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  April 2013
//

#include "node_backend.h"

#include "leveldb/db.h"
#include "leveldb/cache.h"
#include "leveldb/db.h"
#include "leveldb/env.h"
#include "leveldb/write_batch.h"
#include "leveldb/filter_policy.h"

#define GETOPT_BOOL(obj,opts,name) if (!obj.IsEmpty()) { Local<String> name(String::New(#name)); if (obj->Has(name)) opts.name = obj->Get(name)->BooleanValue(); }
#define GETOPT_INT(obj,opts,name) if (!obj.IsEmpty()) { Local<String> name(String::New(#name)); if (obj->Has(name)) opts.name = obj->Get(name)->ToInt32()->Value(); }
#define GETOPT_INTVAL(obj,opts,name,expr) if (!obj.IsEmpty()) { Local<String> name(String::New(#name)); if (obj->Has(name)) { int val = obj->Get(name)->ToInt32()->Value(); opts.name = (expr); }}

#define BATON_ERROR(baton) if (!baton->status.ok()) { string err(baton->status.ToString()); delete baton; return ThrowException(Exception::Error(String::New(err.c_str()))); }

class LevelDB: public ObjectWrap {
public:

    static Persistent<FunctionTemplate> constructor_template;
    static void Init(Handle<Object> target);
    static inline bool HasInstance(Handle<Value> val) { return constructor_template->HasInstance(val); }

    struct LDBBaton {
        uv_work_t request;
        LevelDB* db;
        string key;
        string value;
        string end;
        int64_t num;
        vector<pair<string,string> > list;
        Persistent<Function> callback;
        leveldb::Status status;
        leveldb::Options options;
        leveldb::ReadOptions readOptions;
        leveldb::WriteOptions writeOptions;

        LDBBaton(LevelDB* db_, Handle<Function> cb_ = Handle<Function>()): db(db_), num(0) {
            db->Ref();
            request.data = this;
            callback = Persistent<Function>::New(cb_);
        }
        virtual ~LDBBaton() {
            db->Unref();
            callback.Dispose();
        }
        void GetReadOptions(Handle<Object> obj) {
            HandleScope scope;
            readOptions.snapshot = db->snapshot;
            GETOPT_BOOL(obj, readOptions, fill_cache);
            GETOPT_BOOL(obj, readOptions, verify_checksums);
        }
        void GetWriteOptions(Handle<Object> obj) {
            GETOPT_BOOL(obj, writeOptions, sync);
        }
        void GetBatchOptions(Handle<Array> items) {
            HandleScope scope;
            for (uint i = 0; i < items->Length(); i++) {
                Local<Value> item = items->Get(i);
                if (item->IsString()) {
                    String::Utf8Value del(item);
                    list.push_back(pair<string,string>(*del, ""));
                } else
                if (item->IsArray()) {
                    Local<Array> put = Local<Array>::Cast(item);
                    if (put->Length() != 2) continue;
                    String::Utf8Value key(put->Get(0));
                    String::Utf8Value val(put->Get(1));
                    list.push_back(pair<string,string>(*key, *val));
                }
            }
        }
    };

    LevelDB(string file_) : ObjectWrap(), file(file_), handle(NULL), snapshot(NULL) {}
    ~LevelDB() { Close(); }

    void Close() {
        if (handle) delete handle;
        handle = NULL;
    }

    static leveldb::Options GetOptions(Handle<Object> obj) {
        HandleScope scope;

        leveldb::Options options;
        GETOPT_BOOL(obj, options, paranoid_checks);
        GETOPT_BOOL(obj, options, create_if_missing);
        GETOPT_BOOL(obj, options, error_if_exists);
        GETOPT_INT(obj, options, write_buffer_size);
        GETOPT_INT(obj, options, max_open_files);
        GETOPT_INT(obj, options, block_size);
        GETOPT_INTVAL(obj, options, compression, !val ? leveldb::kNoCompression : leveldb::kSnappyCompression);
        GETOPT_INTVAL(obj, options, block_cache, leveldb::NewLRUCache(val));
        GETOPT_INTVAL(obj, options, filter_policy, leveldb::NewBloomFilterPolicy(val));
        return options;
    }

    static Handle<Value> New(const Arguments& args);
    static Handle<Value> OpenGetter(Local<String> str, const AccessorInfo& accessor);

    static void Work_Open(uv_work_t* req);
    static void Work_After(uv_work_t* req);

    static Handle<Value> All(const Arguments& args);
    static void Work_All(uv_work_t* req);
    static void Work_AfterAll(uv_work_t* req);
    static Handle<Value> Get(const Arguments& args);
    static void Work_Get(uv_work_t* req);
    static Handle<Value> Put(const Arguments& args);
    static void Work_Put(uv_work_t* req);
    static Handle<Value> Close(const Arguments& args);
    static void Work_Close(uv_work_t* req);
    static Handle<Value> Del(const Arguments& args);
    static void Work_Del(uv_work_t* req);
    static Handle<Value> Batch(const Arguments& args);
    static void Work_Batch(uv_work_t* req);
    static Handle<Value> Incr(const Arguments& args);
    static void Work_Incr(uv_work_t* req);

    static Handle<Value> GetProperty(const Arguments& args);
    static Handle<Value> GetSnapshot(const Arguments& args);
    static Handle<Value> ReleaseSnapshot(const Arguments& args);

    static Handle<Value> ServerStart(const Arguments& args);
    static Handle<Value> ServerStop(const Arguments& args);

    string file;
    leveldb::DB *handle;
    const leveldb::Snapshot *snapshot;
    NNServer server;
};

struct LDBBaton {
    uv_work_t request;
    string key;
    string value;
    Persistent<Function> callback;
    leveldb::Status status;
    leveldb::Options options;

    LDBBaton(Handle<Function> cb_) {
        request.data = this;
        callback = Persistent<Function>::New(cb_);
    }
    virtual ~LDBBaton() {
        callback.Dispose();
    }
};

Persistent<FunctionTemplate> LevelDB::constructor_template;

Handle<Value> LevelDB::OpenGetter(Local<String> str, const AccessorInfo& accessor)
{
    HandleScope scope;
    LevelDB* db = ObjectWrap::Unwrap < LevelDB > (accessor.This());
    return Boolean::New(db->handle != NULL);
}

Handle<Value> LevelDB::GetProperty(const Arguments& args)
{
    HandleScope scope;
    LevelDB* db = ObjectWrap::Unwrap < LevelDB > (args.This());

    REQUIRE_ARGUMENT_STRING(0, name);
    string val;
    db->handle->GetProperty(*name, &val);
    return scope.Close(String::New(val.c_str()));
}

Handle<Value> LevelDB::GetSnapshot(const Arguments& args)
{
    HandleScope scope;
    LevelDB* db = ObjectWrap::Unwrap < LevelDB > (args.This());

    if (db->snapshot) db->handle->ReleaseSnapshot(db->snapshot);
    db->snapshot = db->handle->GetSnapshot();
    return args.This();
}

Handle<Value> LevelDB::ReleaseSnapshot(const Arguments& args)
{
    HandleScope scope;
    LevelDB* db = ObjectWrap::Unwrap < LevelDB > (args.This());

    if (db->snapshot) db->handle->ReleaseSnapshot(db->snapshot);
    db->snapshot = NULL;
    return args.This();
}

Handle<Value> LevelDB::New(const Arguments& args)
{
    HandleScope scope;

    if (!args.IsConstructCall()) return ThrowException(Exception::TypeError(String::New("Use the new operator to create new Database objects")));

    REQUIRE_ARGUMENT_STRING(0, filename);
    OPTIONAL_ARGUMENT_OBJECT(1, opts);
    OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

    LevelDB* db = new LevelDB(*filename);
    db->Wrap(args.This());
    args.This()->Set(String::NewSymbol("filename"), args[0]->ToString(), ReadOnly);
    leveldb::Options options = GetOptions(opts);

    if (!callback.IsEmpty()) {
        LDBBaton* baton = new LDBBaton(db, callback);
        baton->options = options;
        uv_queue_work(uv_default_loop(), &baton->request, Work_Open, (uv_after_work_cb)Work_After);
    } else {
        leveldb::Status status = leveldb::DB::Open(options, *filename, &db->handle);
        if (!status.ok()) {
            db->Close();
            return ThrowException(Exception::Error(String::New(status.ToString().c_str())));
        }
    }
    return args.This();
}

void LevelDB::Work_Open(uv_work_t* req)
{
    LDBBaton* baton = static_cast<LDBBaton*>(req->data);

    baton->status = leveldb::DB::Open(baton->options, baton->db->file, &baton->db->handle);
    if (!baton->status.ok()) baton->db->Close();
}

void LevelDB::Work_After(uv_work_t* req)
{
    HandleScope scope;
    LDBBaton* baton = static_cast<LDBBaton*>(req->data);

    if (!baton->callback.IsEmpty() && baton->callback->IsFunction()) {
        Local<Value> argv[2] = { Local<Value>::New(Null()), Local<Value>::New(Null()) };
        if (!baton->status.ok()) argv[0] = Local<Value>::New(Exception::Error(String::New(baton->status.ToString().c_str())));
        if (baton->value.size()) argv[1] = Local<Value>::New(String::New(baton->value.c_str())); else
        if (baton->list.size()) argv[1] = Local<Value>::New(toArray(baton->list)); else
            argv[1] = Local<Number>::New(Number::New(baton->num));
        TRY_CATCH_CALL(baton->db->handle_, baton->callback, 2, argv);
    } else
    if (!baton->status.ok()) {
        LogError("%s", baton->status.ToString().c_str());
    }
    delete baton;
}

Handle<Value> LevelDB::Close(const Arguments& args)
{
    HandleScope scope;
    LevelDB* db = ObjectWrap::Unwrap < LevelDB > (args.This());

    EXPECT_ARGUMENT_FUNCTION(0, callback);

    if (callback.IsEmpty()) {
        db->Close();
    } else {
        LDBBaton* baton = new LDBBaton(db, callback);
        uv_queue_work(uv_default_loop(), &baton->request, Work_Close, (uv_after_work_cb)Work_After);
    }
    return args.This();
}

void LevelDB::Work_Close(uv_work_t* req)
{
    LDBBaton* baton = static_cast<LDBBaton*>(req->data);

    baton->db->Close();
}

Handle<Value> LevelDB::Get(const Arguments& args)
{
    HandleScope scope;
    LevelDB* db = ObjectWrap::Unwrap < LevelDB > (args.This());

    REQUIRE_ARGUMENT_STRING(0, key);
    OPTIONAL_ARGUMENT_OBJECT(1, opts);
    OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

    LDBBaton* baton = new LDBBaton(db, callback);
    baton->GetReadOptions(opts);
    baton->key = *key;
    if (callback.IsEmpty()) {
        Work_Get(&baton->request);
        BATON_ERROR(baton);
        string value = baton->value;
        delete baton;
        return scope.Close(String::New(value.c_str()));
    } else {
        uv_queue_work(uv_default_loop(), &baton->request, Work_Get, (uv_after_work_cb)Work_After);
    }

    return args.This();
}

void LevelDB::Work_Get(uv_work_t* req)
{
    LDBBaton* baton = static_cast<LDBBaton*>(req->data);

    baton->status = baton->db->handle->Get(baton->readOptions, baton->key, &baton->value);
    if (!baton->status.ok() && baton->status.IsNotFound()) baton->status = leveldb::Status::OK();
}

Handle<Value> LevelDB::All(const Arguments& args)
{
    HandleScope scope;
    LevelDB* db = ObjectWrap::Unwrap < LevelDB > (args.This());

    REQUIRE_ARGUMENT_STRING(0, start);
    REQUIRE_ARGUMENT_STRING(1, end);
    OPTIONAL_ARGUMENT_OBJECT(2, opts);
    OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

    LDBBaton* baton = new LDBBaton(db, callback);
    baton->GetReadOptions(opts);
    baton->key = *start;
    baton->end = *end;
    if (callback.IsEmpty()) {
        Work_All(&baton->request);
        BATON_ERROR(baton);
        Handle<Value> rc = toArray(baton->list);
        delete baton;
        return scope.Close(rc);
    } else {
        uv_queue_work(uv_default_loop(), &baton->request, Work_All, (uv_after_work_cb)Work_After);
    }
    return args.This();
}

void LevelDB::Work_All(uv_work_t* req)
{
    LDBBaton* baton = static_cast<LDBBaton*>(req->data);

    leveldb::Iterator* it = baton->db->handle->NewIterator(baton->readOptions);
    if (baton->key.size()) it->Seek(baton->key); else it->SeekToFirst();
    while (it->Valid()) {
        if (baton->end.size() && it->key().ToString() >= baton->end) break;
        baton->list.push_back(pair<string,string>(it->key().ToString(), it->value().ToString()));
        it->Next();
    }
    baton->status = it->status();
    delete it;
}

Handle<Value> LevelDB::Put(const Arguments& args)
{
    HandleScope scope;
    LevelDB* db = ObjectWrap::Unwrap < LevelDB > (args.This());

    REQUIRE_ARGUMENT_STRING(0, key);
    REQUIRE_ARGUMENT_STRING(1, value);
    OPTIONAL_ARGUMENT_OBJECT(2, opts);
    OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

    LDBBaton* baton = new LDBBaton(db, callback);
    baton->GetWriteOptions(opts);
    baton->key = *key;
    baton->value = *value;

    if (callback.IsEmpty()) {
        Work_Put(&baton->request);
        BATON_ERROR(baton);
        delete baton;
    } else {
        uv_queue_work(uv_default_loop(), &baton->request, Work_Put, (uv_after_work_cb)Work_After);
    }
    return args.This();
}

void LevelDB::Work_Put(uv_work_t* req)
{
    LDBBaton* baton = static_cast<LDBBaton*>(req->data);

    baton->status = baton->db->handle->Put(baton->writeOptions, baton->key, baton->value);
}

Handle<Value> LevelDB::Incr(const Arguments& args)
{
    HandleScope scope;
    LevelDB* db = ObjectWrap::Unwrap < LevelDB > (args.This());

    REQUIRE_ARGUMENT_STRING(0, key);
    REQUIRE_ARGUMENT_NUMBER(1, n);
    OPTIONAL_ARGUMENT_OBJECT(2, opts);
    OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

    LDBBaton* baton = new LDBBaton(db, callback);
    baton->GetWriteOptions(opts);
    baton->key = *key;
    baton->num = n;

    if (callback.IsEmpty()) {
        Work_Incr(&baton->request);
        BATON_ERROR(baton);
        delete baton;
    } else {
        uv_queue_work(uv_default_loop(), &baton->request, Work_Incr, (uv_after_work_cb)Work_After);
    }
    return args.This();
}

void LevelDB::Work_Incr(uv_work_t* req)
{
    LDBBaton* baton = static_cast<LDBBaton*>(req->data);

    baton->status = baton->db->handle->Get(baton->readOptions, baton->key, &baton->value);
    if (!baton->status.ok() && baton->status.IsNotFound()) baton->status = leveldb::Status::OK();
    if (baton->status.ok()) {
        baton->value = vFmtStr("%lld", atoll(baton->value.c_str()) + baton->num);
        baton->status = baton->db->handle->Put(baton->writeOptions, baton->key, baton->value);
        if (baton->status.ok()) baton->num = atoll(baton->value.c_str());
    }
}

Handle<Value> LevelDB::Del(const Arguments& args)
{
    HandleScope scope;
    LevelDB* db = ObjectWrap::Unwrap < LevelDB > (args.This());

    REQUIRE_ARGUMENT_STRING(0, key);
    OPTIONAL_ARGUMENT_OBJECT(2, opts);
    OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

    LDBBaton* baton = new LDBBaton(db, callback);
    baton->GetWriteOptions(opts);
    baton->key = *key;

    if (callback.IsEmpty()) {
        Work_Del(&baton->request);
        BATON_ERROR(baton);
        delete baton;
    } else {
        uv_queue_work(uv_default_loop(), &baton->request, Work_Del, (uv_after_work_cb)Work_After);
    }
    return args.This();
}

void LevelDB::Work_Del(uv_work_t* req)
{
    LDBBaton* baton = static_cast<LDBBaton*>(req->data);

    baton->status = baton->db->handle->Delete(baton->writeOptions, baton->key);
}

Handle<Value> LevelDB::Batch(const Arguments& args)
{
    HandleScope scope;
    LevelDB* db = ObjectWrap::Unwrap < LevelDB > (args.This());

    REQUIRE_ARGUMENT_ARRAY(0, list);
    OPTIONAL_ARGUMENT_OBJECT(1, opts);
    OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

    LDBBaton* baton = new LDBBaton(db, callback);
    baton->GetWriteOptions(opts);
    baton->GetBatchOptions(list);

    if (callback.IsEmpty()) {
        Work_Batch(&baton->request);
        BATON_ERROR(baton);
        delete baton;
    } else {
        uv_queue_work(uv_default_loop(), &baton->request, Work_Put, (uv_after_work_cb)Work_After);
    }
    return args.This();
}

void LevelDB::Work_Batch(uv_work_t* req)
{
    LDBBaton* baton = static_cast<LDBBaton*>(req->data);

    leveldb::WriteBatch batch;
    for (uint i = 0; i < baton->list.size(); i++) {
        if (baton->list[i].second.size()) {
            batch.Put(baton->list[i].first, baton->list[i].second);
        } else {
            batch.Delete(baton->list[i].first);
        }
    }
    baton->list.clear();
    baton->status = baton->db->handle->Write(baton->writeOptions, &batch);
}

static void Work_After(uv_work_t* req)
{
    HandleScope scope;
    LDBBaton* baton = static_cast<LDBBaton*>(req->data);

    if (!baton->callback.IsEmpty() && baton->callback->IsFunction()) {
        Local <Value> argv[1] = { Local<Value>::New(Null()) };
        if (!baton->status.ok()) argv[0] = Local<Value>::New(Exception::Error(String::New(baton->status.ToString().c_str())));
        TRY_CATCH_CALL(Context::GetCurrent()->Global(), baton->callback, 1, argv);
    } else
    if (!baton->status.ok()) {
        LogError("%s", baton->status.ToString().c_str());
    }
    delete baton;
}


static void Work_Destroy(uv_work_t* req)
{
    LDBBaton* baton = static_cast<LDBBaton*>(req->data);

    leveldb::DestroyDB(baton->key, baton->options);
}

Handle<Value> DestroyDB(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_STRING(0, name);
    OPTIONAL_ARGUMENT_OBJECT(1, opts);
    OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

    LDBBaton* baton = new LDBBaton(callback);
    baton->options = LevelDB::GetOptions(opts);

    uv_queue_work(uv_default_loop(), &baton->request, Work_Destroy, (uv_after_work_cb)Work_After);

    return args.This();
}

static void Work_Repair(uv_work_t* req)
{
    LDBBaton* baton = static_cast<LDBBaton*>(req->data);

    leveldb::RepairDB(baton->key, baton->options);
}

Handle<Value> RepairDB(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_STRING(0, name);
    OPTIONAL_ARGUMENT_OBJECT(1, opts);
    OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

    LDBBaton* baton = new LDBBaton(callback);
    baton->options = LevelDB::GetOptions(opts);

    uv_queue_work(uv_default_loop(), &baton->request, Work_Repair, (uv_after_work_cb)Work_After);

    return args.This();
}

static string NNHandleRequest(char *buf, int len, void *data)
{
    LevelDB *db = (LevelDB*)data;
    leveldb::Status status;
    leveldb::ReadOptions readOptions;
    leveldb::WriteOptions writeOptions;

    jsonValue *json = jsonParse(buf, len, NULL);
    string op = jsonGetStr(json, "op");
    string key = jsonGetStr(json, "name");
    string value = jsonGetStr(json, "value");

    if (op == "put") {
        status = db->handle->Put(writeOptions, key, value);
        value.clear();
    } else
    if (op == "get") {
        status = db->handle->Get(readOptions, key, &value);
        if (status.ok()) {
            jsonSet(json, JSON_STRING, "value", value);
            value = jsonStringify(json);
        }
    } else
    if (op == "del") {
        status = db->handle->Delete(writeOptions, key);
        value.clear();
    } else
    if (op == "incr") {
        string val;
        status = db->handle->Get(readOptions, key, &val);
        if (!status.ok() && status.IsNotFound()) status = leveldb::Status::OK();
        if (status.ok()) {
            value = vFmtStr("%lld", atoll(val.c_str()) + atoll(value.c_str()));
            status = db->handle->Put(writeOptions, key, value);
        }
        value.clear();
    }
    jsonFree(json);
    return value;
}

Handle<Value> LevelDB::ServerStart(const Arguments& args)
{
    HandleScope scope;
    LevelDB* db = ObjectWrap::Unwrap < LevelDB > (args.This());
    REQUIRE_ARGUMENT_INT(0, sock);
    db->server.Start(sock, NNHandleRequest, db);
    return scope.Close(Undefined());
}

Handle<Value> LevelDB::ServerStop(const Arguments& args)
{
    HandleScope scope;
    LevelDB* db = ObjectWrap::Unwrap < LevelDB > (args.This());
    db->server.Stop();
    return scope.Close(Undefined());
}

void LevelDB::Init(Handle<Object> target)
{
    HandleScope scope;

    Local < FunctionTemplate > t = FunctionTemplate::New(New);
    constructor_template = Persistent < FunctionTemplate > ::New(t);
    constructor_template->InstanceTemplate()->SetInternalFieldCount(1);
    constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("open"), OpenGetter);
    constructor_template->SetClassName(String::NewSymbol("LevelDB"));

    NODE_SET_PROTOTYPE_METHOD(constructor_template, "close", Close);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "get", Get);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "put", Put);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "incr", Incr);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "del", Del);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "all", All);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "batch", Batch);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "startServer", ServerStart);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "stopServer", ServerStop);

    NODE_SET_PROTOTYPE_METHOD(constructor_template, "getProperty", GetProperty);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "getSnapshot", GetSnapshot);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "releaseSnapshot", ReleaseSnapshot);

    target->Set(String::NewSymbol("LevelDB"), constructor_template->GetFunction());
}

void LevelDBInit(Handle<Object> target)
{
    HandleScope scope;

    LevelDB::Init(target);

    NODE_SET_METHOD(target, "destroyDB", DestroyDB);
    NODE_SET_METHOD(target, "repairDB", RepairDB);
}

