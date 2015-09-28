//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  April 2013
//

#ifdef USE_LEVELDB

#include "node_backend.h"

#include "leveldb/db.h"
#include "leveldb/cache.h"
#include "leveldb/db.h"
#include "leveldb/env.h"
#include "leveldb/write_batch.h"
#include "leveldb/filter_policy.h"

#define BATON_ERROR(baton) if (!baton->status.ok()) { string err(baton->status.ToString()); delete baton; Nan::ThrowError(err.c_str()); }

class LevelDB: public Nan::ObjectWrap {
public:

    static Nan::Persistent<v8::Function> constructor;
    static void Init(Handle<Object> target);

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
            Nan::HandleScope scope;
            readOptions.snapshot = db->_snapshot;
            NAN_GETOPTS_BOOL(obj, readOptions, fill_cache);
            NAN_GETOPTS_BOOL(obj, readOptions, verify_checksums);
        }
        void GetWriteOptions(Handle<Object> obj) {
            GETOPTS_BOOL(obj, writeOptions, sync);
        }
        void GetBatchOptions(Handle<Array> items) {
            Nan::HandleScope scope;
            for (uint i = 0; i < items->Length(); i++) {
                Local<Value> item = items->Get(i);
                if (item->IsString()) {
                    Nan::Utf8String del(item);
                    list.push_back(pair<string,string>(*del, ""));
                } else
                if (item->IsArray()) {
                    Local<Array> put = Local<Array>::Cast(item);
                    if (put->Length() != 2) continue;
                    Nan::Utf8String key(put->Get(0));
                    Nan::Utf8String val(put->Get(1));
                    list.push_back(pair<string,string>(*key, *val));
                }
            }
        }
    };

    LevelDB(string file_) : Nan::ObjectWrap(), _file(file_), _handle(NULL), _snapshot(NULL) {}
    ~LevelDB() { Close(); }

    void Close() {
        if (_handle) delete _handle;
        _handle = NULL;
    }

    static leveldb::Options GetOptions(Handle<Object> obj) {
        Nan::HandleScope scope;

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

    static NAN_METHOD(New);
    static NAN_GETTER(OpenGetter1);
    static Handle<Value> OpenGetter(Local<String> str, const AccessorInfo& accessor);

    static void Work_Open(uv_work_t* req);
    static void Work_After(uv_work_t* req);

    static NAN_METHOD(Select);
    static void Work_Select(uv_work_t* req);
    static NAN_METHOD(Get);
    static void Work_Get(uv_work_t* req);
    static NAN_METHOD(Put);
    static void Work_Put(uv_work_t* req);
    static NAN_METHOD(Close);
    static void Work_Close(uv_work_t* req);
    static NAN_METHOD(Del);
    static void Work_Del(uv_work_t* req);
    static NAN_METHOD(Batch);
    static void Work_Batch(uv_work_t* req);
    static NAN_METHOD(Incr);
    static void Work_Incr(uv_work_t* req);

    static NAN_METHOD(GetProperty);
    static NAN_METHOD(GetSnapshot);
    static NAN_METHOD(ReleaseSnapshot);

    static NAN_METHOD(ServerStart);
    static NAN_METHOD(ServerStop);

    string _file;
    leveldb::DB *_handle;
    const leveldb::Snapshot *_snapshot;
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

Nan::Persistent<v8::Function> LevelDB::constructor;

NAN_GETTER(LevelDB::OpenGetter1)
{
    LevelDB* db = ObjectWrap::Unwrap < LevelDB > (info.Holder());
    NAN_RETURN(Nan::New(db->_handle != NULL));
}

Handle<Value> LevelDB::OpenGetter(Local<String> str, const AccessorInfo& accessor)
{
    HandleScope scope;
    LevelDB* db = ObjectWrap::Unwrap < LevelDB > (accessor.This());
    return scope.Close(Boolean::New(db->_handle != NULL));
}

NAN_METHOD(LevelDB::GetProperty)
{
    Nan::HandleScope scope;
    LevelDB* db = ObjectWrap::Unwrap < LevelDB > (info.Holder());

    NAN_REQUIRE_ARGUMENT_STRING(0, name);
    string val;
    db->_handle->GetProperty(*name, &val);
    NAN_RETURN(Nan::New(val.c_str()).ToLocalChecked());
}

NAN_METHOD(LevelDB::GetSnapshot)
{
    Nan::HandleScope scope;
    LevelDB* db = ObjectWrap::Unwrap < LevelDB > (info.Holder());

    if (db->_snapshot) db->_handle->ReleaseSnapshot(db->_snapshot);
    db->_snapshot = db->_handle->GetSnapshot();
}

NAN_METHOD(LevelDB::ReleaseSnapshot)
{
    Nan::HandleScope scope;
    LevelDB* db = ObjectWrap::Unwrap < LevelDB > (info.Holder());

    if (db->_snapshot) db->_handle->ReleaseSnapshot(db->_snapshot);
    db->_snapshot = NULL;
}

NAN_METHOD(LevelDB::New)
{
    Nan::HandleScope scope;

    if (!info.IsConstructCall()) return Nan::ThrowError("Use the new operator to create new Database objects");

    NAN_REQUIRE_ARGUMENT_STRING(0, filename);
    NAN_OPTIONAL_ARGUMENT_OBJECT(1, opts);
    NAN_OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

    LevelDB* db = new LevelDB(*filename);
    db->Wrap(info.This());
    info.This()->Set(Nan::New("filename").ToLocalChecked(), info[0]->ToString(), ReadOnly);
    leveldb::Options options = GetOptions(opts);

    if (!callback.IsEmpty()) {
        LDBBaton* baton = new LDBBaton(db, callback);
        baton->options = options;
        uv_queue_work(uv_default_loop(), &baton->request, Work_Open, (uv_after_work_cb)Work_After);
    } else {
        leveldb::Status status = leveldb::DB::Open(options, *filename, &db->_handle);
        if (!status.ok()) {
            db->Close();
            Nan::ThrowError(status.ToString().c_str());
        }
    }
    NAN_RETURN(info.This());
}

void LevelDB::Work_Open(uv_work_t* req)
{
    LDBBaton* baton = static_cast<LDBBaton*>(req->data);

    baton->status = leveldb::DB::Open(baton->options, baton->db->_file, &baton->db->_handle);
    if (!baton->status.ok()) baton->db->Close();
}

void LevelDB::Work_After(uv_work_t* req)
{
    Nan::HandleScope scope;
    LDBBaton* baton = static_cast<LDBBaton*>(req->data);

    if (!baton->callback.IsEmpty() && baton->callback->IsFunction()) {
        Local<Value> argv[2] = { Local<Value>::New(Null()), Local<Value>::New(Null()) };
        if (!baton->status.ok()) argv[0] = Nan::Error(baton->status.ToString().c_str());
        if (baton->value.size()) {
            argv[1] = Nan::New(baton->value.c_str()).ToLocalChecked();
        } else
        if (baton->list.size() || baton->opts.select) {
            argv[1] = Local<Value>::New(toArray(baton->list));
        } else {
            argv[1] = Nan::New((double)baton->num);
        }
        NAN_TRY_CATCH_CALL(baton->db->handle(), baton->callback, 2, argv);
    } else
    if (!baton->status.ok()) {
        LogError("%s", baton->status.ToString().c_str());
    }
    delete baton;
}

NAN_METHOD(LevelDB::Close)
{
    Nan::HandleScope scope;
    LevelDB* db = ObjectWrap::Unwrap < LevelDB > (info.Holder());

    NAN_EXPECT_ARGUMENT_FUNCTION(0, callback);

    if (callback.IsEmpty()) {
        db->Close();
    } else {
        LDBBaton* baton = new LDBBaton(db, callback);
        uv_queue_work(uv_default_loop(), &baton->request, Work_Close, (uv_after_work_cb)Work_After);
    }
}

void LevelDB::Work_Close(uv_work_t* req)
{
    LDBBaton* baton = static_cast<LDBBaton*>(req->data);

    baton->db->Close();
}

NAN_METHOD(LevelDB::Get)
{
    Nan::HandleScope scope;
    LevelDB* db = ObjectWrap::Unwrap < LevelDB > (info.Holder());

    NAN_REQUIRE_ARGUMENT_STRING(0, key);
    NAN_OPTIONAL_ARGUMENT_OBJECT(1, opts);
    NAN_OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

    LDBBaton* baton = new LDBBaton(db, callback);
    baton->GetReadOptions(opts);
    baton->key = *key;
    if (callback.IsEmpty()) {
        Work_Get(&baton->request);
        BATON_ERROR(baton);
        string value = baton->value;
        delete baton;
        NAN_RETURN(Nan::New(value.c_str()).ToLocalChecked());
    } else {
        uv_queue_work(uv_default_loop(), &baton->request, Work_Get, (uv_after_work_cb)Work_After);
    }
}

void LevelDB::Work_Get(uv_work_t* req)
{
    LDBBaton* baton = static_cast<LDBBaton*>(req->data);

    baton->status = baton->db->_handle->Get(baton->readOptions, baton->key, &baton->value);
    if (!baton->status.ok() && baton->status.IsNotFound()) baton->status = leveldb::Status::OK();
}

NAN_METHOD(LevelDB::Select)
{
    Nan::HandleScope scope;
    LevelDB* db = ObjectWrap::Unwrap < LevelDB > (info.Holder());

    NAN_REQUIRE_ARGUMENT_STRING(0, start);
    NAN_REQUIRE_ARGUMENT_STRING(1, end);
    NAN_OPTIONAL_ARGUMENT_OBJECT(2, opts);
    NAN_OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

    LDBBaton* baton = new LDBBaton(db, callback);
    baton->GetReadOptions(opts);
    baton->key = *start;
    baton->end = *end;
    baton->opts.select = 1;
    NAN_GETOPTS_BOOL(opts, baton->opts, desc);
    NAN_GETOPTS_BOOL(opts, baton->opts, begins_with);
    NAN_GETOPTS_INT(opts, baton->opts, count);
    if (callback.IsEmpty()) {
        Work_Select(&baton->request);
        BATON_ERROR(baton);
        Local<Value> rc = toArray(baton->list);
        delete baton;
        NAN_RETURN(rc);
    } else {
        uv_queue_work(uv_default_loop(), &baton->request, Work_Select, (uv_after_work_cb)Work_After);
    }
}

void LevelDB::Work_Select(uv_work_t* req)
{
    LDBBaton* baton = static_cast<LDBBaton*>(req->data);

    leveldb::Iterator* it = baton->db->_handle->NewIterator(baton->readOptions);
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

NAN_METHOD(LevelDB::Put)
{
    Nan::HandleScope scope;
    LevelDB* db = ObjectWrap::Unwrap < LevelDB > (info.Holder());

    NAN_REQUIRE_ARGUMENT_STRING(0, key);
    NAN_REQUIRE_ARGUMENT_STRING(1, value);
    NAN_OPTIONAL_ARGUMENT_OBJECT(2, opts);
    NAN_OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

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
}

void LevelDB::Work_Put(uv_work_t* req)
{
    LDBBaton* baton = static_cast<LDBBaton*>(req->data);

    baton->status = baton->db->_handle->Put(baton->writeOptions, baton->key, baton->value);
}

NAN_METHOD(LevelDB::Incr)
{
    Nan::HandleScope scope;
    LevelDB* db = ObjectWrap::Unwrap < LevelDB > (info.Holder());

    NAN_REQUIRE_ARGUMENT_STRING(0, key);
    NAN_REQUIRE_ARGUMENT_NUMBER(1, n);
    NAN_OPTIONAL_ARGUMENT_OBJECT(2, opts);
    NAN_OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

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
}

void LevelDB::Work_Incr(uv_work_t* req)
{
    LDBBaton* baton = static_cast<LDBBaton*>(req->data);

    baton->status = baton->db->_handle->Get(baton->readOptions, baton->key, &baton->value);
    if (!baton->status.ok() && baton->status.IsNotFound()) baton->status = leveldb::Status::OK();
    if (baton->status.ok()) {
        baton->value = bkFmtStr("%lld", atoll(baton->value.c_str()) + baton->num);
        baton->status = baton->db->_handle->Put(baton->writeOptions, baton->key, baton->value);
        if (baton->status.ok()) baton->num = atoll(baton->value.c_str());
    }
}

NAN_METHOD(LevelDB::Del)
{
    Nan::HandleScope scope;
    LevelDB* db = ObjectWrap::Unwrap < LevelDB > (info.Holder());

    NAN_REQUIRE_ARGUMENT_STRING(0, key);
    NAN_OPTIONAL_ARGUMENT_OBJECT(2, opts);
    NAN_OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

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
}

void LevelDB::Work_Del(uv_work_t* req)
{
    LDBBaton* baton = static_cast<LDBBaton*>(req->data);

    baton->status = baton->db->_handle->Delete(baton->writeOptions, baton->key);
}

NAN_METHOD(LevelDB::Batch)
{
    Nan::HandleScope scope;
    LevelDB* db = ObjectWrap::Unwrap < LevelDB > (info.Holder());

    NAN_REQUIRE_ARGUMENT_ARRAY(0, list);
    NAN_OPTIONAL_ARGUMENT_OBJECT(1, opts);
    NAN_OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

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
    baton->status = baton->db->_handle->Write(baton->writeOptions, &batch);
}

static void Work_After(uv_work_t* req)
{
    Nan::HandleScope scope;
    LDBBaton* baton = static_cast<LDBBaton*>(req->data);

    if (!baton->callback.IsEmpty() && baton->callback->IsFunction()) {
        Local <Value> argv[1] = { Nan::Null() };
        if (!baton->status.ok()) argv[0] = Nan::Error(baton->status.ToString().c_str());
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

static NAN_METHOD(destroyDB)
{
    Nan::HandleScope scope;

    NAN_REQUIRE_ARGUMENT_STRING(0, name);
    NAN_OPTIONAL_ARGUMENT_OBJECT(1, opts);
    NAN_OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

    LDBBaton* baton = new LDBBaton(callback);
    baton->options = LevelDB::GetOptions(opts);

    uv_queue_work(uv_default_loop(), &baton->request, Work_Destroy, (uv_after_work_cb)Work_After);
}

static void Work_Repair(uv_work_t* req)
{
    LDBBaton* baton = static_cast<LDBBaton*>(req->data);

    leveldb::RepairDB(baton->key, baton->options);
}

static NAN_METHOD(repairDB)
{
    Nan::HandleScope scope;

    NAN_REQUIRE_ARGUMENT_STRING(0, name);
    NAN_OPTIONAL_ARGUMENT_OBJECT(1, opts);
    NAN_OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

    LDBBaton* baton = new LDBBaton(callback);
    baton->options = LevelDB::GetOptions(opts);

    uv_queue_work(uv_default_loop(), &baton->request, Work_Repair, (uv_after_work_cb)Work_After);
}

void LevelDB::Init(Handle<Object> target)
{
    Nan::HandleScope scope;

    v8::Local<v8::FunctionTemplate> t = Nan::New<v8::FunctionTemplate>(New);
    t->SetClassName(Nan::New("LevelDB").ToLocalChecked());
    t->InstanceTemplate()->SetInternalFieldCount(1);
    t->InstanceTemplate()->SetAccessor(Nan::New("open").ToLocalChecked(), OpenGetter);

    Nan::SetPrototypeMethod(t, "close", Close);
    Nan::SetPrototypeMethod(t, "get", Get);
    Nan::SetPrototypeMethod(t, "put", Put);
    Nan::SetPrototypeMethod(t, "incr", Incr);
    Nan::SetPrototypeMethod(t, "del", Del);
    Nan::SetPrototypeMethod(t, "select", Select);
    Nan::SetPrototypeMethod(t, "batch", Batch);
    Nan::SetPrototypeMethod(t, "getProperty", GetProperty);
    Nan::SetPrototypeMethod(t, "getSnapshot", GetSnapshot);
    Nan::SetPrototypeMethod(t, "releaseSnapshot", ReleaseSnapshot);

    constructor.Reset(t->GetFunction());
    target->Set(Nan::New("LevelDB").ToLocalChecked(), t->GetFunction());
}

void LevelDBInit(Handle<Object> target)
{
    Nan::HandleScope scope;

    LevelDB::Init(target);

    NAN_EXPORT(target, destroyDB);
    NAN_EXPORT(target, repairDB);
}

#endif
