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

#define BATON_ERROR(baton) if (!baton->status.ok()) { string err(baton->status.ToString()); delete baton; return ThrowException(Exception::Error(String::New(err.c_str()))); }

class LevelDB: public ObjectWrap {
public:

    static Persistent<FunctionTemplate> constructor_template;
    static void Init(Handle<Object> target);
    static inline bool HasInstance(Handle<Value> val) { return constructor_template->HasInstance(val); }

    struct Options {
        Options(): count(0), desc(0), begins_with(0), select(0) {}
        int count;
        bool desc;
        bool begins_with;
        bool select;
    };

    struct LDBBaton {
        uv_work_t request;
        LevelDB* db;
        string key;
        string value;
        string end;
        int64_t num;
        Options opts;
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
            GETOPTS_BOOL(obj, readOptions, fill_cache);
            GETOPTS_BOOL(obj, readOptions, verify_checksums);
        }
        void GetWriteOptions(Handle<Object> obj) {
            GETOPTS_BOOL(obj, writeOptions, sync);
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
        GETOPTS_BOOL(obj, options, paranoid_checks);
        GETOPTS_BOOL(obj, options, create_if_missing);
        GETOPTS_BOOL(obj, options, error_if_exists);
        GETOPTS_INT(obj, options, write_buffer_size);
        GETOPTS_INT(obj, options, max_open_files);
        GETOPTS_INT(obj, options, block_size);
        GETOPTS_INTVAL(obj, options, compression, !val ? leveldb::kNoCompression : leveldb::kSnappyCompression);
        GETOPTS_INTVAL(obj, options, block_cache, leveldb::NewLRUCache(val));
        GETOPTS_INTVAL(obj, options, filter_policy, leveldb::NewBloomFilterPolicy(val));
        return options;
    }

    static Handle<Value> New(const Arguments& args);
    static Handle<Value> OpenGetter(Local<String> str, const AccessorInfo& accessor);

    static void Work_Open(uv_work_t* req);
    static void Work_After(uv_work_t* req);

    static Handle<Value> Select(const Arguments& args);
    static void Work_Select(uv_work_t* req);
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

    if (!args.IsConstructCall()) return ThrowException(Exception::TypeError(String::NewSymbol("Use the new operator to create new Database objects")));

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
        if (baton->value.size()) {
            argv[1] = Local<Value>::New(String::New(baton->value.c_str()));
        } else
        if (baton->list.size() || baton->opts.select) {
            argv[1] = Local<Value>::New(toArray(baton->list));
        } else {
            argv[1] = Local<Number>::New(Number::New(baton->num));
        }
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

Handle<Value> LevelDB::Select(const Arguments& args)
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
    baton->opts.select = 1;
    GETOPTS_BOOL(opts, baton->opts, desc);
    GETOPTS_BOOL(opts, baton->opts, begins_with);
    GETOPTS_INT(opts, baton->opts, count);
    if (callback.IsEmpty()) {
        Work_Select(&baton->request);
        BATON_ERROR(baton);
        Handle<Value> rc = toArray(baton->list);
        delete baton;
        return scope.Close(rc);
    } else {
        uv_queue_work(uv_default_loop(), &baton->request, Work_Select, (uv_after_work_cb)Work_After);
    }
    return args.This();
}

void LevelDB::Work_Select(uv_work_t* req)
{
    LDBBaton* baton = static_cast<LDBBaton*>(req->data);

    leveldb::Iterator* it = baton->db->handle->NewIterator(baton->readOptions);
    if (baton->key.size()) it->Seek(baton->key); else it->SeekToFirst();
    while (it->Valid()) {
        const string &key = it->key().ToString();
        if (baton->end.size()) {
            if (baton->opts.desc) {
                if (key < baton->end) break;
            } else
            if (baton->opts.begins_with) {
                if (strncmp(key.c_str(), baton->end.c_str(), baton->end.size())) break;
            } else {
                if (key > baton->end) break;
            }
        }
        baton->list.push_back(pair<string,string>(key, it->value().ToString()));
        if (baton->opts.count > 0 && (int)baton->list.size() >= baton->opts.count) break;
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
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "select", Select);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "batch", Batch);

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

