//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  April 2013
//

#include "node_backend.h"

#include <lmdb.h>

#define EXCEPTION(msg, errno, name) \
        Local<Value> name = Exception::Error(String::New(msg)); \
        Local<Object> name ##_obj = name->ToObject(); \
        name ##_obj->Set(NODE_PSYMBOL("code"), Integer::New(errno));

#define GETOPT_INT(obj,name) { Local<String> vname(String::New(#name)); if (obj->Has(vname))  name = obj->Get(vname)->ToInt32()->Value(); }
#define GETOPT_STR(obj,name) { Local<String> vname(String::New(#name)); if (obj->Has(vname) && obj->Get(vname)->IsString()) { String::Utf8Value vstr(obj->Get(vname)->ToString()); name = *vstr; } }

#define FLAG_BEGINS_WITH        128
#define FLAG_DESCENDING         256

class LMDB_ENV: public ObjectWrap {
public:

    static Persistent<FunctionTemplate> constructor_template;
    static inline bool HasInstance(Handle<Value> val) { return constructor_template->HasInstance(val); }
    static void Init(Handle<Object> target) {
        HandleScope scope;
        Local < FunctionTemplate > t = FunctionTemplate::New(New);
        constructor_template = Persistent < FunctionTemplate > ::New(t);
        constructor_template->InstanceTemplate()->SetInternalFieldCount(1);
        constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("path"), PathGetter);
        constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("flags"), FlagsGetter);
        constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("mapsize"), SizeGetter);
        constructor_template->SetClassName(String::NewSymbol("LMDBEnv"));
        NODE_SET_PROTOTYPE_METHOD(constructor_template, "readerCheck", ReaderCheck);
        NODE_SET_PROTOTYPE_METHOD(constructor_template, "sync", Sync);
        target->Set(String::NewSymbol("LMDBEnv"), constructor_template->GetFunction());
    }
    static Handle<Value> New(const Arguments& args) {
        HandleScope scope;
        if (!args.IsConstructCall()) return ThrowException(Exception::TypeError(String::New("Use the new operator to create new LMDBENV objects")));
        REQUIRE_ARGUMENT_OBJECT(0, obj);

        string path = "var";
        int64_t rc, flags = 0, mapsize = 0, dbs = 0, readers = 0;

        GETOPT_STR(obj, path);
        GETOPT_INT(obj, flags);
        GETOPT_INT(obj, mapsize);
        GETOPT_INT(obj, dbs);
        GETOPT_INT(obj, readers);

        MDB_env *env;
        rc = mdb_env_create(&env);
        if (!rc && mapsize) rc = mdb_env_set_mapsize(env, mapsize);
        if (!rc && dbs) rc = mdb_env_set_maxdbs(env, dbs);
        if (!rc && readers) rc = mdb_env_set_maxreaders(env, readers);
        if (!rc) rc = mdb_env_open(env, path.c_str(), flags, 0664);
        if (rc != 0) {
            mdb_env_close(env);
            env = NULL;
            return ThrowException(Exception::Error(String::New(mdb_strerror(rc))));
        }
        LMDB_ENV* db = new LMDB_ENV(env);
        db->Wrap(args.This());
        return args.This();
    }

    static Handle<Value> ReaderCheck(const Arguments& args) {
            HandleScope scope;
            LMDB_ENV *env = ObjectWrap::Unwrap < LMDB_ENV > (args.This());
            int dead;
            return scope.Close(Integer::New(mdb_reader_check(env->env, &dead)));
    }
    static Handle<Value> Sync(const Arguments& args) {
        HandleScope scope;
        OPTIONAL_ARGUMENT_INT(0, force);
        LMDB_ENV *env = ObjectWrap::Unwrap < LMDB_ENV > (args.This());
        return scope.Close(Integer::New(mdb_env_sync(env->env, force)));
    }
    static Handle<Value> PathGetter(Local<String> str, const AccessorInfo& accessor) {
        HandleScope scope;
        LMDB_ENV* env = ObjectWrap::Unwrap < LMDB_ENV > (accessor.This());
        const char *path = "";
        mdb_env_get_path(env->env, &path);
        return scope.Close(String::New(path));
    }

    static Handle<Value> SizeGetter(Local<String> str, const AccessorInfo& accessor) {
        HandleScope scope;
        LMDB_ENV* env = ObjectWrap::Unwrap < LMDB_ENV > (accessor.This());
        MDB_envinfo info;
        mdb_env_info(env->env, &info);
        return scope.Close(Integer::New(info.me_mapsize));
    }

    static Handle<Value> FlagsGetter(Local<String> str, const AccessorInfo& accessor) {
        HandleScope scope;
        LMDB_ENV* env = ObjectWrap::Unwrap < LMDB_ENV > (accessor.This());
        unsigned int flags = 0;
        mdb_env_get_flags(env->env, &flags);
        return scope.Close(Integer::New(flags));
    }

    LMDB_ENV(MDB_env *e) : ObjectWrap(), env(e) {}
    ~LMDB_ENV() { if (env) mdb_env_close(env); }

    MDB_env *env;
};

class LMDB_DB: public ObjectWrap {
public:
    LMDB_DB(MDB_env *e, string n, int f) : ObjectWrap(), name(n), flags(f), env(e), db(0), txn(0), cursor(0), open(0) {}
    ~LMDB_DB() { Close(); }

    void Close() {
        mdb_txn_abort(txn);
        mdb_cursor_close(cursor);
        if (open) mdb_dbi_close(env, db);
        open = 0;
    }
    int Open() {
        int rc = mdb_txn_begin(env, NULL, 0, &txn);
        if (!rc) rc = mdb_dbi_open(txn, name.size() ? name.c_str() : NULL, flags, &db);
        if (!rc) rc = mdb_txn_commit(txn);
        if (!rc) open = 1;
        txn = NULL;
        return rc;
    }
    int Drop() {
        if (!open) return EINVAL;
        int rc = mdb_txn_begin(env, NULL, 0, &txn);
        if (!rc) mdb_drop(txn, db, 0);
        if (!rc) rc = mdb_txn_commit(txn); else mdb_txn_abort(txn);
        txn = NULL;
        return rc;
    }
    int Get(const char *key, size_t klen, string *data) {
        if (!open || !klen) return EINVAL;
        MDB_val k, v;
        k.mv_size = klen;
        k.mv_data = (void*)key;
        int rc = mdb_txn_begin(env, NULL, 0, &txn);
        if (!rc) rc = mdb_get(txn, db, &k, &v);
        if (!rc) data->assign((const char*)v.mv_data, v.mv_size);
        if (rc == MDB_NOTFOUND) rc = 0;
        mdb_txn_abort(txn);
        txn = NULL;
        return rc;
    }
    int Put(const char *key, size_t klen, const char *data, size_t dlen, int flags) {
        if (!open || !klen) return EINVAL;
        MDB_val k, v;
        k.mv_size = klen;
        k.mv_data = (void*)key;
        v.mv_size = dlen;
        v.mv_data = (void*)data;
        int rc = mdb_txn_begin(env, NULL, 0, &txn);
        if (!rc) rc = mdb_put(txn, db, &k, &v, flags);
        if (!rc) rc = mdb_txn_commit(txn); else mdb_txn_abort(txn);
        txn = NULL;
        return rc;
    }
    int Incr(const char *key, size_t klen, int64_t *num, int flags) {
        if (!open || !klen) return EINVAL;
        MDB_val k, v;
        char n[32] = "";
        k.mv_size = klen;
        k.mv_data = (void*)key;
        int rc = mdb_txn_begin(env, NULL, 0, &txn);
        if (!rc) rc = mdb_get(txn, db, &k, &v);
        if (rc == MDB_NOTFOUND) {
            rc = 0;
        } else {
            snprintf(n, sizeof(n), "%.*s", (int)v.mv_size, (char*)v.mv_data);
        }
        if (!rc) {
            snprintf(n, sizeof(n), "%lld", atoll(n) + *num);
            v.mv_size = strlen(n);
            v.mv_data = (void*)n;
            rc = mdb_put(txn, db, &k, &v, flags);
        }
        if (!rc) *num = atoll(n);
        if (!rc) rc = mdb_txn_commit(txn); else mdb_txn_abort(txn);
        txn = NULL;
        return rc;
    }
    int Del(const char *key, size_t klen, const char *data, size_t dlen) {
        if (!open || !klen) return EINVAL;
        MDB_val k, v;
        k.mv_size = klen;
        k.mv_data = (void*)key;
        v.mv_size = dlen;
        v.mv_data = (void*)data;
        int rc = mdb_txn_begin(env, NULL, 0, &txn);
        if (!rc) rc = mdb_del(txn, db, &k, dlen ? &v : NULL);
        if (rc == MDB_NOTFOUND) rc = 0;
        if (!rc) rc = mdb_txn_commit(txn); else mdb_txn_abort(txn);
        txn = NULL;
        return rc;
    }
    int OpenCursor() {
        int rc = mdb_txn_begin(env, NULL, 0, &txn);
        if (!rc) rc = mdb_cursor_open(txn, db, &cursor);
        if (rc) mdb_txn_abort(txn), txn = NULL;
        return rc;
    }
    void CloseCursor() {
        mdb_cursor_close(cursor);
        mdb_txn_commit(txn);
        txn = NULL;
        cursor = NULL;
    }
    int GetAll(const char *start, size_t slen, const char *end, size_t elen, uint flags, uint count, vector<pair<string,string> >*list) {
        MDB_val k, v, e, b;
        k.mv_size = slen;
        k.mv_data = (void*)start;
        e.mv_size = elen;
        e.mv_data = (void*)end;
        int rc = OpenCursor();
        rc = mdb_cursor_get(cursor, &k, &v, slen ? MDB_SET_RANGE : MDB_FIRST);
        while (rc == 0) {
            if (elen) {
                if (flags & FLAG_DESCENDING) {
                    if (mdb_cmp(txn, db, &k, &e) < 0) break;
                } else
                if (flags & FLAG_BEGINS_WITH) {
                    b.mv_data = k.mv_data;
                    b.mv_size = elen;
                    if (mdb_cmp(txn, db, &b, &e)) break;
                } else
                if (mdb_cmp(txn, db, &k, &e) > 0) break;
            }
            list->push_back(pair<string,string>(string((const char*)k.mv_data, k.mv_size), string((const char*)v.mv_data, v.mv_size)));
            if (count > 0 && list->size() >= count) break;
            rc = mdb_cursor_get(cursor, &k, &v, flags & FLAG_DESCENDING ? MDB_PREV : MDB_NEXT);
        }
        CloseCursor();
        return rc;
    }

    string name;
    int flags;
    MDB_env *env;
    MDB_dbi db;
    MDB_txn *txn;
    MDB_cursor *cursor;
    bool open;

    class Baton {
    public:
        Baton(LMDB_DB *db_, Handle<Function> cb_): db(db_), num(0), status(0), flags(0), count(0) {
            db->Ref();
            req.data = this;
            callback = Persistent < Function > ::New(cb_);
        }
        ~Baton() {
            db->Unref();
            callback.Dispose();
        }
        Persistent<Function> callback;
        LMDB_DB *db;
        uv_work_t req;
        string message;
        string op;
        string key;
        string data;
        int64_t num;
        vector<pair<string,string> > list;
        int status;
        int flags;
        int count;
    };

    static Persistent<FunctionTemplate> constructor_template;
    static inline bool HasInstance(Handle<Value> val) { return constructor_template->HasInstance(val); }
    static void Init(Handle<Object> target) {
        HandleScope scope;
        Local < FunctionTemplate > t = FunctionTemplate::New(New);
        constructor_template = Persistent < FunctionTemplate > ::New(t);
        constructor_template->InstanceTemplate()->SetInternalFieldCount(1);
        constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("open"), OpenGetter);
        constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("name"), NameGetter);
        constructor_template->SetClassName(String::NewSymbol("LMDB"));
        NODE_SET_PROTOTYPE_METHOD(constructor_template, "close", Close);
        NODE_SET_PROTOTYPE_METHOD(constructor_template, "drop", Drop);
        NODE_SET_PROTOTYPE_METHOD(constructor_template, "get", Get);
        NODE_SET_PROTOTYPE_METHOD(constructor_template, "put", Put);
        NODE_SET_PROTOTYPE_METHOD(constructor_template, "incr", Incr);
        NODE_SET_PROTOTYPE_METHOD(constructor_template, "del", Del);
        NODE_SET_PROTOTYPE_METHOD(constructor_template, "all", All);
#ifdef USE_NANOMSG
        NODE_SET_PROTOTYPE_METHOD(constructor_template, "startServer", ServerStart);
        NODE_SET_PROTOTYPE_METHOD(constructor_template, "stopServer", ServerStop);
#endif
        target->Set(String::NewSymbol("LMDB"), constructor_template->GetFunction());

        target->Set(String::NewSymbol("LMDB_BEGINS_WITH"), Integer::New(FLAG_BEGINS_WITH), static_cast<PropertyAttribute>(ReadOnly | DontDelete) );
        target->Set(String::NewSymbol("LMDB_DESCENDING"), Integer::New(FLAG_DESCENDING), static_cast<PropertyAttribute>(ReadOnly | DontDelete) );
    }

    static Handle<Value> OpenGetter(Local<String> str, const AccessorInfo& accessor) {
        HandleScope scope;
        LMDB_DB *db = ObjectWrap::Unwrap < LMDB_DB > (accessor.This());
        return scope.Close(Integer::New(db->open));
    }

    static Handle<Value> NameGetter(Local<String> str, const AccessorInfo& accessor) {
        HandleScope scope;
        LMDB_DB *db = ObjectWrap::Unwrap < LMDB_DB > (accessor.This());
        return scope.Close(String::New(db->name.c_str()));
    }

    static Handle<Value> New(const Arguments& args) {
        HandleScope scope;
        if (!args.IsConstructCall()) return ThrowException(Exception::TypeError(String::New("Use the new operator to create new LMDB objects")));
        REQUIRE_ARGUMENT_OBJECT(0, obj);
        if (!LMDB_ENV::HasInstance(obj)) return ThrowException(Exception::TypeError(String::New("First arg must be LMDBENV instance")));
        LMDB_ENV *env = ObjectWrap::Unwrap < LMDB_ENV > (obj);
        REQUIRE_ARGUMENT_OBJECT(1, opts);
        OPTIONAL_ARGUMENT_FUNCTION(-1, cb);

        string name;
        int flags = 0;
        GETOPT_STR(opts, name);
        GETOPT_INT(opts, flags);

        LMDB_DB* db = new LMDB_DB(env->env, name, flags);
        db->Wrap(args.This());

        if (cb.IsEmpty()) {
            int status = db->Open();
            if (status) return ThrowException(Exception::Error(String::New(mdb_strerror(status))));
        } else {
            Baton *d = new Baton(db, cb);
            uv_queue_work(uv_default_loop(), &d->req, Work_Open, Work_After);
        }
        return args.This();
    }

    static Handle<Value> Close(const Arguments& args) {
        HandleScope scope;
        LMDB_DB *db = ObjectWrap::Unwrap < LMDB_DB > (args.This());
        db->Close();
        return Undefined();
    }

    static Handle<Value> Drop(const Arguments& args) {
        HandleScope scope;
        LMDB_DB *db = ObjectWrap::Unwrap < LMDB_DB > (args.This());
        db->Drop();
        return Undefined();
    }

    static void Work_After(uv_work_t* req, int status) {
        HandleScope scope;
        Baton* d = static_cast<Baton*>(req->data);

        if (!d->callback.IsEmpty() && d->callback->IsFunction()) {
            Local < Value > argv[2];
            if (d->status != 0) {
                EXCEPTION(d->message.c_str(), d->status, exception);
                argv[0] = exception;
                TRY_CATCH_CALL(d->db->handle_, d->callback, 1, argv);
            } else {
                argv[0] = Local < Value > ::New(Null());
                if (d->op == "all") {
                    argv[1] = Local<Value>::New(toArray(d->list));
                } else
                if (d->data.size()) {
                    argv[1] = Local < Value > ::New(String::New(d->data.c_str(), d->data.size()));
                } else {
                    argv[1] = Local < Value > ::New(Number::New(d->num));
                }
                TRY_CATCH_CALL(d->db->handle_, d->callback, 2, argv);
            }
        }
        delete d;
    }

    static void Work_Open(uv_work_t* req) {
        Baton* d = static_cast<Baton*>(req->data);
        d->status = d->db->Open();
        if (d->status) d->message = mdb_strerror(d->status);
    }

    static Handle<Value> Get(const Arguments& args) {
        HandleScope scope;
        LMDB_DB *db = ObjectWrap::Unwrap < LMDB_DB > (args.This());

        REQUIRE_ARGUMENT_STRING(0, key);
        OPTIONAL_ARGUMENT_FUNCTION(-1, cb);

        if (cb.IsEmpty()) {
            string data;
            int status = db->Get(*key, key.length(), &data);
            if (status) return ThrowException(Exception::Error(String::New(mdb_strerror(status))));
            return scope.Close(Local<String>::New(String::New(data.c_str(), data.size())));
        } else {
            Baton *d = new Baton(db, cb);
            d->key = string(*key, key.length());
            uv_queue_work(uv_default_loop(), &d->req, Work_Get, Work_After);
        }
        return args.This();
    }

    static void Work_Get(uv_work_t* req) {
        Baton* d = static_cast<Baton*>(req->data);
        d->status = d->db->Get(d->key.c_str(), d->key.size(), &d->data);
        if (d->status) d->message = mdb_strerror(d->status);
    }

    static Handle<Value> Put(const Arguments& args) {
        HandleScope scope;
        LMDB_DB *db = ObjectWrap::Unwrap < LMDB_DB > (args.This());

        REQUIRE_ARGUMENT_STRING(0, key);
        REQUIRE_ARGUMENT_STRING(1, data);
        OPTIONAL_ARGUMENT_INT(3, flags);
        OPTIONAL_ARGUMENT_FUNCTION(-1, cb);

        if (cb.IsEmpty()) {
            int status = db->Put(*key, key.length(), *data, data.length(), flags);
            if (status) return ThrowException(Exception::Error(String::New(mdb_strerror(status))));
        } else {
            Baton *d = new Baton(db, cb);
            d->flags = flags;
            d->key = string(*key, key.length());
            d->data = string(*data, data.length());
            uv_queue_work(uv_default_loop(), &d->req, Work_Put, Work_After);
        }
        return args.This();
    }

    static void Work_Put(uv_work_t* req) {
        Baton* d = static_cast<Baton*>(req->data);
        d->status = d->db->Put(d->key.c_str(), d->key.size(), d->data.c_str(), d->data.size(), d->flags);
        if (d->status) d->message = mdb_strerror(d->status);
        d->data.clear();
    }

    static Handle<Value> Incr(const Arguments& args) {
        HandleScope scope;
        LMDB_DB *db = ObjectWrap::Unwrap < LMDB_DB > (args.This());

        REQUIRE_ARGUMENT_STRING(0, key);
        REQUIRE_ARGUMENT_INT64(1, num);
        OPTIONAL_ARGUMENT_INT(3, flags);
        OPTIONAL_ARGUMENT_FUNCTION(-1, cb);

        if (cb.IsEmpty()) {
            int status = db->Incr(*key, key.length(), &num, flags);
            if (status) return ThrowException(Exception::Error(String::New(mdb_strerror(status))));
            return scope.Close(Local<Number>::New(Number::New(num)));
        } else {
            Baton *d = new Baton(db, cb);
            d->flags = flags;
            d->num = num;
            d->key = string(*key, key.length());
            uv_queue_work(uv_default_loop(), &d->req, Work_Incr, Work_After);
        }
        return args.This();
    }

    static void Work_Incr(uv_work_t* req) {
        Baton* d = static_cast<Baton*>(req->data);
        d->status = d->db->Incr(d->key.c_str(), d->key.size(), &d->num, d->flags);
        if (d->status) d->message = mdb_strerror(d->status);
        d->data.clear();
    }

    static Handle<Value> Del(const Arguments& args) {
        HandleScope scope;
        LMDB_DB *db = ObjectWrap::Unwrap < LMDB_DB > (args.This());

        REQUIRE_ARGUMENT_STRING(0, key);
        OPTIONAL_ARGUMENT_STRING(1, data);
        OPTIONAL_ARGUMENT_FUNCTION(-1, cb);

        if (cb.IsEmpty()) {
            int status = db->Del(*key, key.length(), *data, data.length());
            if (status) return ThrowException(Exception::Error(String::New(mdb_strerror(status))));
        } else {
            Baton *d = new Baton(db, cb);
            d->key = string(*key, key.length());
            d->data = string(*data, data.length());
            uv_queue_work(uv_default_loop(), &d->req, Work_Del, Work_After);
        }
        return args.This();
    }

    static void Work_Del(uv_work_t* req) {
        Baton* d = static_cast<Baton*>(req->data);
        d->status = d->db->Del(d->key.c_str(), d->key.size(), d->data.c_str(), d->data.size());
        if (d->status) d->message = mdb_strerror(d->status);
        d->data.clear();
    }

    static Handle<Value> All(const Arguments& args) {
        HandleScope scope;
        LMDB_DB *db = ObjectWrap::Unwrap < LMDB_DB > (args.This());

        REQUIRE_ARGUMENT_STRING(0, start);
        REQUIRE_ARGUMENT_STRING(1, end);
        OPTIONAL_ARGUMENT_INT(2, flags);
        OPTIONAL_ARGUMENT_INT(3, count);
        OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

        Baton* d = new Baton(db, callback);
        d->key = *start;
        d->data = *end;
        d->op = "all";
        d->flags = flags;
        d->count = count;
        if (callback.IsEmpty()) {
            Work_All(&d->req);
            Handle<Value> rc = Local<Value>::New(toArray(d->list));
            delete d;
            return scope.Close(rc);
        } else {
            uv_queue_work(uv_default_loop(), &d->req, Work_All, Work_After);
        }
        return args.This();
    }

    static void Work_All(uv_work_t* req) {
        Baton* d = static_cast<Baton*>(req->data);
        d->db->GetAll(d->key.c_str(), d->key.size(), d->data.c_str(), d->data.size(), d->flags, d->count, &d->list);
        if (d->status) d->message = mdb_strerror(d->status);
        d->data.clear();
    }

     static void ServerProcess(NNServer *server, const char *buf, int len, void *data) {
        LMDB_DB *db = (LMDB_DB*)data;
        jsonValue *json = jsonParse(buf, len, NULL);
        string op = jsonGetStr(json, "op");
        string key = jsonGetStr(json, "name");
        string value = jsonGetStr(json, "value");
        int status = -1, flags = 0;

        if (op == "put" || op == "add" || op == "update") {
            status = db->Put(key.c_str(), key.size(), value.c_str(), value.size(), flags);
            value.clear();
        } else
        if (op == "select") {
            vector<pair<string,string> > list;
            status = db->GetAll(key.c_str(), key.size(), value.c_str(), value.size(), 0, 0, &list);
            if (!status) {
                jsonValue *val = new jsonValue(JSON_ARRAY, "value");
                for (uint i = 0; i < list.size(); i++) {
                    jsonValue *item = new jsonValue(JSON_OBJECT);
                    jsonSet(item, JSON_STRING, "name", list[i].first);
                    jsonSet(item, JSON_STRING, "value", list[i].second);
                    jsonAppend(val, item);
                }
                jsonSet(json, val);
                value = jsonStringify(json);
                server->Send(value.c_str(), value.size());
            }
        } else
        if (op == "get") {
            status = db->Get(key.c_str(), key.size(), &value);
            if (!status) {
                jsonSet(json, JSON_STRING, "value", value);
                value = jsonStringify(json);
            }
        } else
        if (op == "del") {
            status = db->Del(key.c_str(), key.size(), value.c_str(), value.size());
            value.clear();
        } else
        if (op == "incr") {
            int64_t num = atoll(value.c_str());
            status = db->Incr(key.c_str(), key.size(), &num, flags);
            value.clear();
        }
        jsonFree(json);
     }

#ifdef USE_NANOMSG
     NNServer server;
     static Handle<Value> ServerStart(const Arguments& args) {
         HandleScope scope;
         LMDB_DB* db = ObjectWrap::Unwrap < LMDB_DB > (args.This());
         REQUIRE_ARGUMENT_INT(0, rsock);
         REQUIRE_ARGUMENT_INT(1, wsock);
         OPTIONAL_ARGUMENT_INT(2, queue);
         db->server.Start(rsock, wsock, queue, ServerProcess, db, NULL);
         return scope.Close(Undefined());
     }

     static Handle<Value> ServerStop(const Arguments& args) {
         HandleScope scope;
         LMDB_DB* db = ObjectWrap::Unwrap < LMDB_DB > (args.This());
         db->server.Stop();
         return scope.Close(Undefined());
     }
#endif
};

Persistent<FunctionTemplate> LMDB_DB::constructor_template;
Persistent<FunctionTemplate> LMDB_ENV::constructor_template;

void LMDBInit(Handle<Object> target)
{
    HandleScope scope;

    LMDB_ENV::Init(target);
    LMDB_DB::Init(target);

    DEFINE_CONSTANT_INTEGER(target, MDB_FIXEDMAP, MDB_FIXEDMAP);
    DEFINE_CONSTANT_INTEGER(target, MDB_NOSUBDIR, MDB_NOSUBDIR);
    DEFINE_CONSTANT_INTEGER(target, MDB_NOSYNC, MDB_NOSYNC);
    DEFINE_CONSTANT_INTEGER(target, MDB_RDONLY, MDB_RDONLY);
    DEFINE_CONSTANT_INTEGER(target, MDB_NOMETASYNC, MDB_NOMETASYNC);
    DEFINE_CONSTANT_INTEGER(target, MDB_WRITEMAP, MDB_WRITEMAP);
    DEFINE_CONSTANT_INTEGER(target, MDB_MAPASYNC, MDB_MAPASYNC);
    DEFINE_CONSTANT_INTEGER(target, MDB_NOTLS, MDB_NOTLS);
    DEFINE_CONSTANT_INTEGER(target, MDB_NOLOCK, MDB_NOLOCK);
    DEFINE_CONSTANT_INTEGER(target, MDB_NORDAHEAD, MDB_NORDAHEAD);
    DEFINE_CONSTANT_INTEGER(target, MDB_NOMEMINIT, MDB_NOMEMINIT);
    DEFINE_CONSTANT_INTEGER(target, MDB_REVERSEKEY, MDB_REVERSEKEY);
    DEFINE_CONSTANT_INTEGER(target, MDB_DUPSORT, MDB_DUPSORT);
    DEFINE_CONSTANT_INTEGER(target, MDB_INTEGERKEY, MDB_INTEGERKEY);
    DEFINE_CONSTANT_INTEGER(target, MDB_DUPFIXED, MDB_DUPFIXED);
    DEFINE_CONSTANT_INTEGER(target, MDB_INTEGERDUP, MDB_INTEGERDUP);
    DEFINE_CONSTANT_INTEGER(target, MDB_REVERSEDUP, MDB_REVERSEDUP);
    DEFINE_CONSTANT_INTEGER(target, MDB_CREATE, MDB_CREATE);
    DEFINE_CONSTANT_INTEGER(target, MDB_NOOVERWRITE, MDB_NOOVERWRITE);
    DEFINE_CONSTANT_INTEGER(target, MDB_NODUPDATA, MDB_NODUPDATA);
    DEFINE_CONSTANT_INTEGER(target, MDB_CURRENT, MDB_CURRENT);
    DEFINE_CONSTANT_INTEGER(target, MDB_RESERVE, MDB_RESERVE);
    DEFINE_CONSTANT_INTEGER(target, MDB_APPEND, MDB_APPEND);
    DEFINE_CONSTANT_INTEGER(target, MDB_APPENDDUP, MDB_APPENDDUP);
    DEFINE_CONSTANT_INTEGER(target, MDB_MULTIPLE, MDB_MULTIPLE);

}

