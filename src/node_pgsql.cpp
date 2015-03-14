//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  April 2013
//

#include "node_backend.h"

#ifdef USE_PGSQL
#include "libpq-fe.h"

#define EXCEPTION(name, result) \
        Local<Value> name = Local<Value>::New(Null()); \
        const char *name ##_msg = result ? PQresultErrorField(result, PG_DIAG_MESSAGE_PRIMARY) : NULL; \
        if (name ##_msg) { \
            Local<Object> name ##_obj = Local<Object>::Cast(Exception::Error(Local<String>::New(String::New(name ##_msg)))); \
            for (int i = 0; errnames[i]; i++) { \
                name ##_msg = PQresultErrorField(result, errcodes[i]); \
                if (name ##_msg) name ##_obj->Set(String::NewSymbol(errnames[i]), Local<String>::New(String::New(name ##_msg))); \
            } \
            name = name ##_obj; \
        }

#define ERROR(db, cb, err) \
    if (err && !cb.IsEmpty() && cb->IsFunction()) { \
        Local<Value> argv[1] = { Exception::Error(Local<String>::New(String::New(err))) }; \
        TRY_CATCH_CALL(db->handle_, cb, 1, argv); \
    }

static const char *errnames[] = { "severity", "code", "detail", "hint", "position", "internalPosition", "internalQuery", "where", "file", "line", "routine", NULL };
static const char errcodes[] = { PG_DIAG_SEVERITY, PG_DIAG_SQLSTATE, PG_DIAG_MESSAGE_DETAIL, PG_DIAG_MESSAGE_HINT, PG_DIAG_STATEMENT_POSITION, PG_DIAG_INTERNAL_POSITION, PG_DIAG_INTERNAL_QUERY, PG_DIAG_CONTEXT, PG_DIAG_SOURCE_FILE, PG_DIAG_SOURCE_LINE, PG_DIAG_SOURCE_FUNCTION, 0 };
static map<void *,bool> _batons;

class PgSQLDatabase: public ObjectWrap {
public:

    static Persistent<FunctionTemplate> constructor_template;

    class Baton {
    public:
        PgSQLDatabase* db;
        Persistent<Function> callback;
        string text;

        Baton(PgSQLDatabase* db_, Handle<Function> cb_, string text_): db(db_), text(text_)  {
            db->Ref();
            if (!cb_.IsEmpty()) callback = Persistent < Function > ::New(cb_);
            LogDev("%p: %p, cb=%d, %s", this, db, !callback.IsEmpty(), text.c_str());
            _batons[this] = 0;
        }
        void Call(const char *err = 0, PGresult* result = 0) {
            HandleScope scope;
            LogDev("%p: %p, err=%s, res=%p, cb=%d, %s", this, db, err, result, !callback.IsEmpty(), text.c_str());
            if (callback.IsEmpty() || !callback->IsFunction()) return;
            EXCEPTION(exp, result);
            Local < Value > argv[2] = { err ? Exception::Error(Local<String>::New(String::New(err))) : exp,
                                        result ? db->getResult(result) : Local<Array>::New(Array::New(0))  };
            TRY_CATCH_CALL(db->handle_, callback, 2, argv);
            callback.Dispose();
            callback.Clear();
        }
        virtual ~Baton() {
            LogDev("%p: %p, cb=%d, %s", this, db, !callback.IsEmpty(), text.c_str());
            if (!callback.IsEmpty()) callback.Dispose();
            db->Unref();
            _batons.erase(this);
        }
    };

    PgSQLDatabase(const char *info = 0): ObjectWrap(), fd(-1), events(-1), handle(NULL), inserted_oid(0) {
        if (info) conninfo = info;
        uv_timer_init(uv_default_loop(), &timer);
        timer.data = this;
        poll.data = NULL;
        LogDev("%p: %s", this, info);
    }

    virtual ~PgSQLDatabase() {
        LogDev("%p: %p, fd=%d", this, handle, fd);
        Close();
    }

    void StopPoll() {
        if (!poll.data) return;
        LogTest("%p: %p, fd=%d, batons=%d", this, handle, fd, batons.size());
        uv_poll_stop(&poll);
        poll.data = NULL;
        events = -1;
    }

    void StartPoll(int mode, uv_poll_cb cb, Handle<Function> callback, string text) {
        Baton *baton = new Baton(this, callback, text);
        batons.push_back(baton);
        events = mode;
        uv_poll_start(&poll, mode, cb);
        poll.data = this;
        LogTest("%p: %p, fd=%d, batons=%d", this, handle, fd, batons.size());
    }

    void StartPoll(int mode, uv_poll_cb cb) {
        events = mode;
        uv_poll_start(&poll, mode, cb);
        poll.data = this;
        LogTest("%p: fd=%d, batons=%d", this, fd, batons.size());
    }

    void Emit(const char *err = 0, PGresult* result = 0) {
        LogDev("%p: %p, %s, res=%p, batons=%d", this, handle, err, result, batons.size());
        if (!batons.size()) return;
        Baton *b = batons.front();
        batons.pop_front();
        b->Call(err, result);
        delete b;
    }

    void Close() {
        LogDev("%p: %p, fd=%d, batons=%d", this, handle, fd, batons.size());
        StopPoll();
        Finish();
        Clear();
        if (!notify.IsEmpty()) notify.Dispose();
        notify.Clear();
    }

    void StartClose(Handle<Function> callback) {
        StopPoll();
        Baton *baton = new Baton(this, callback, "");
        batons.push_back(baton);
        uv_work_t *req = new uv_work_t;
        req->data = this;
        uv_queue_work(uv_default_loop(), req, Work_Close, Work_AfterClose);
    }

    void Finish() {
        LogDev("%p: %p, fd=%d, batons=%d", this, handle, fd, batons.size());
        if (handle) PQfinish(handle);
        handle = NULL;
        fd = -1;
    }

    void Clear() {
        for (uint i = 0; i < results.size(); i++) {
            PQclear(results[i]);
        }
        results.clear();
    }

    const char *Error() {
        const char *msg = handle ? PQerrorMessage(handle) : NULL;
        return msg ? msg : "Unknown error";
    }

    Local<Array> getResult(PGresult* result);

    static void Init(Handle<Object> target);
    static Handle<Value> New(const Arguments& args);
    static Handle<Value> OpenGetter(Local<String> str, const AccessorInfo& accessor);
    static Handle<Value> NameGetter(Local<String> str, const AccessorInfo& accessor);
    static Handle<Value> InsertedOidGetter(Local<String> str, const AccessorInfo& accessor);
    static Handle<Value> AffectedRowsGetter(Local<String> str, const AccessorInfo& accessor);

    static void Handle_Timeout(uv_timer_t* req, int status);
    static void Handle_Connect(uv_poll_t* w, int status, int revents);
    static void Handle_Notice(void *arg, const char *message);
    static void Handle_Cleanup(uv_timer_t* req, int status);
    static void Handle_Poll(uv_poll_t* w, int status, int revents);

    static Handle<Value> Connect(const Arguments& args);
    static Handle<Value> Query(const Arguments& args);
    static Handle<Value> QuerySync(const Arguments& args);
    static Handle<Value> SetNotify(const Arguments& args);
    static Handle<Value> SetNonblocking(const Arguments& args);
    static Handle<Value> Close(const Arguments& args);
    static void Work_Close(uv_work_t* req);
    static void Work_AfterClose(uv_work_t* req, int status);

    int fd;
    int events;
    PGconn *handle;
    uv_poll_t poll;
    uv_timer_t timer;
    string conninfo;
    Oid inserted_oid;
    string affected_rows;
    Persistent<Function> notify;
    vector<PGresult*> results;
    list<Baton*> batons;
};

Persistent<FunctionTemplate> PgSQLDatabase::constructor_template;

static Handle<Value> listBatons(const Arguments& args)
{
    HandleScope scope;

    Local<Array> keys = Array::New();
    map<void*,bool>::const_iterator it = _batons.begin();
    int i = 0;
    while (it != _batons.end()) {
        PgSQLDatabase::Baton *baton = (PgSQLDatabase::Baton*)it->first;
        keys->Set(Integer::New(i), Local<String>::New(String::New(baton->text.c_str())));
        it++;
        i++;
    }
    return scope.Close(keys);
}

void PgSQLInit(Handle<Object> target)
{
    HandleScope scope;
    PQinitOpenSSL(0, 0);
    PgSQLDatabase::Init(target);
    NODE_SET_METHOD(target, "pgsqlStats", listBatons);
}

void PgSQLDatabase::Init(Handle<Object> target)
{
    HandleScope scope;
    Local < FunctionTemplate > t = FunctionTemplate::New(New);
    constructor_template = Persistent < FunctionTemplate > ::New(t);
    constructor_template->InstanceTemplate()->SetInternalFieldCount(1);
    constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("open"), OpenGetter);
    constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("name"), NameGetter);
    constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("inserted_oid"), InsertedOidGetter);
    constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("affected_rows"), AffectedRowsGetter);
    constructor_template->SetClassName(String::NewSymbol("PgSQLDatabase"));

    NODE_SET_PROTOTYPE_METHOD(t, "setNonblocking", SetNonblocking);
    NODE_SET_PROTOTYPE_METHOD(t, "setNotify", SetNotify);
    NODE_SET_PROTOTYPE_METHOD(t, "connect", Connect);
    NODE_SET_PROTOTYPE_METHOD(t, "query", Query);
    NODE_SET_PROTOTYPE_METHOD(t, "querySync", QuerySync);
    NODE_SET_PROTOTYPE_METHOD(t, "close", Close);
    target->Set(String::NewSymbol("PgSQLDatabase"), constructor_template->GetFunction());
}

Handle<Value> PgSQLDatabase::OpenGetter(Local<String> str, const AccessorInfo& accessor)
{
    HandleScope scope;
    PgSQLDatabase* db = ObjectWrap::Unwrap < PgSQLDatabase > (accessor.This());
    return Boolean::New(db->handle != NULL);
}

Handle<Value> PgSQLDatabase::NameGetter(Local<String> str, const AccessorInfo& accessor)
{
    HandleScope scope;
    PgSQLDatabase* db = ObjectWrap::Unwrap < PgSQLDatabase > (accessor.This());
    return String::New(db->handle != NULL ? PQdb(db->handle) : "");
}

Handle<Value> PgSQLDatabase::InsertedOidGetter(Local<String> str, const AccessorInfo& accessor)
{
    HandleScope scope;
    PgSQLDatabase* db = ObjectWrap::Unwrap < PgSQLDatabase > (accessor.This());
    return Integer::New(db->inserted_oid);
}

Handle<Value> PgSQLDatabase::AffectedRowsGetter(Local<String> str, const AccessorInfo& accessor)
{
    HandleScope scope;
    PgSQLDatabase* db = ObjectWrap::Unwrap < PgSQLDatabase > (accessor.This());
    return Integer::New(atoi(db->affected_rows.c_str()));
}

Handle<Value> PgSQLDatabase::SetNotify(const Arguments& args)
{
    HandleScope scope;
    PgSQLDatabase *db = ObjectWrap::Unwrap<PgSQLDatabase>(args.This());

    EXPECT_ARGUMENT_FUNCTION(0, cb);
    if (!db->notify.IsEmpty()) db->notify.Dispose();
    db->notify.Clear();
    if (!cb.IsEmpty()) db->notify = Persistent < Function > ::New(cb);
    return args.This();
}

Handle<Value> PgSQLDatabase::SetNonblocking(const Arguments& args)
{
    HandleScope scope;
    PgSQLDatabase *db = ObjectWrap::Unwrap<PgSQLDatabase>(args.This());

    REQUIRE_ARGUMENT_INT(0, blocking);
    db->StopPoll();
    PQsetnonblocking(db->handle, blocking);
    return args.This();
}

Handle<Value> PgSQLDatabase::New(const Arguments& args)
{
    HandleScope scope;

    if (!args.IsConstructCall()) return ThrowException(Exception::TypeError(String::NewSymbol("Use the new operator to create new Database objects")));
    REQUIRE_ARGUMENT_STRING(0, info);

    PgSQLDatabase* db = new PgSQLDatabase(*info);
    db->Wrap(args.This());
    return args.This();
}

void PgSQLDatabase::Handle_Notice(void *arg, const char *msg)
{
    PgSQLDatabase *db = (PgSQLDatabase *)arg;
    if (!msg || db->notify.IsEmpty() || !db->notify->IsFunction()) return;
    Local<Value> argv[1] = { Local<String>::New(String::New(msg)) };
    TRY_CATCH_CALL(db->handle_, db->notify, 1, argv);
}

void PgSQLDatabase::Handle_Timeout(uv_timer_t* req, int status)
{
    PgSQLDatabase *db = (PgSQLDatabase *)req->data;
    LogDev("%p: %p, fd=%d", db, db->handle, db->fd);
    db->Close();
    db->Emit("Connection timeout");
}

void PgSQLDatabase::Handle_Connect(uv_poll_t* w, int status, int revents)
{
    if (status == -1) return;
    PgSQLDatabase *db = static_cast<PgSQLDatabase*>(w->data);
    uv_timer_stop(&db->timer);
    PostgresPollingStatusType rc = PQconnectPoll(db->handle);

    LogTest("%p: %p, fd=%d, status=%d, revents=%d", db, db->handle, db->fd, rc, revents);
    switch (rc) {
    case PGRES_POLLING_READING:
        if (db->events == UV_READABLE) break;
        db->StartPoll(UV_READABLE, Handle_Connect);
        break;

    case PGRES_POLLING_WRITING:
        if (db->events == UV_WRITABLE) break;
        db->StartPoll(UV_WRITABLE, Handle_Connect);
        break;

    case PGRES_POLLING_OK:
        db->StartPoll(UV_READABLE, Handle_Poll);
        db->Emit();
        break;

    case PGRES_POLLING_FAILED: {
        string err = db->Error();
        db->Close();
        db->Emit(err.c_str());
        break;
    }

    default:
        LogError("status=%d", rc);
    }
}

void PgSQLDatabase::Handle_Poll(uv_poll_t* w, int status, int revents)
{
    if (status == -1) return;
    PgSQLDatabase *db = static_cast<PgSQLDatabase*>(w->data);
    if (!db || !db->handle) return;
    LogTest("%p: %p, fd=%d, status=%d, revents=%d, batons=%d", db, db->handle, db->fd, status, revents, db->batons.size());

    if (revents & UV_READABLE) {
        if (!PQconsumeInput(db->handle)) {
            db->Emit(db->Error());
            return;
        }

        // Read all results until we get NULL, this is required by libpq
        if (!PQisBusy(db->handle)) {
            PGresult *result;
            while ((result = PQgetResult(db->handle))) {
                ExecStatusType status = PQresultStatus(result);

                switch (status) {
                case PGRES_TUPLES_OK:
                case PGRES_SINGLE_TUPLE:
                    db->results.push_back(result);
                    break;

                case PGRES_FATAL_ERROR:
                    db->results.push_back(result);
                    break;

                case PGRES_COMMAND_OK:
                    db->affected_rows = PQcmdTuples(result);
                    break;

                case PGRES_EMPTY_QUERY:
                    LogError("empty query");
                    break;

                default:
                    LogError("Unrecogized query status: %s", PQresStatus(status));
                    break;
                }
            }
            db->Emit(0, db->results.size() ? db->results[0] : 0);
            db->Clear();
        }

        if (db->handle) {
            PGnotify *notify;
            while ((notify = PQnotifies(db->handle))) {
                if (!db->notify.IsEmpty()) {
                    db->Handle_Notice(db, vFmtStr("%s: %s", notify->relname, notify->extra).c_str());
                }
                PQfreemem(notify);
            }
        }
    }

    if (db->handle) {
        if (revents & UV_WRITABLE) {
            if (!PQflush(db->handle)) {
                db->StartPoll(UV_READABLE, Handle_Poll);
            }
        }
    }
}

Handle<Value> PgSQLDatabase::Connect(const Arguments& args)
{
    HandleScope scope;
    PgSQLDatabase *db = ObjectWrap::Unwrap<PgSQLDatabase>(args.This());

    REQUIRE_ARGUMENT_FUNCTION(0, cb);

    db->handle = PQconnectStart(db->conninfo.c_str());
    if (!db->handle || PQstatus(db->handle) == CONNECTION_BAD || (db->fd = PQsocket(db->handle)) < 0) {
        ERROR(db, cb, "connect error");
        db->Close();
        return args.This();
    }
    PQsetnonblocking(db->handle, 1);
    PQsetNoticeProcessor(db->handle, Handle_Notice, db);

    uv_poll_init(uv_default_loop(), &db->poll, db->fd);
    db->StartPoll(UV_WRITABLE, Handle_Connect, cb, "connect");

    // Start connection timer for timeouts
    if (db->conninfo.find("connect_timeout") == string::npos) {
        uv_timer_start(&db->timer, Handle_Timeout, 5000, 0);
    }
    return args.This();
}

Handle<Value> PgSQLDatabase::Close(const Arguments& args)
{
    HandleScope scope;
    PgSQLDatabase *db = ObjectWrap::Unwrap<PgSQLDatabase>(args.This());

    OPTIONAL_ARGUMENT_FUNCTION(-1, cb);

    if (cb.IsEmpty()) {
        db->Close();
        db->Emit();
    } else {
        db->StartClose(cb);
    }
    return args.This();
}

void PgSQLDatabase::Work_Close(uv_work_t* req)
{
    PgSQLDatabase* db = static_cast<PgSQLDatabase*>(req->data);
    db->Finish();
}

void PgSQLDatabase::Work_AfterClose(uv_work_t* req, int status)
{
    PgSQLDatabase* db = static_cast<PgSQLDatabase*>(req->data);
    db->Close();
    db->Emit();
    delete req;
}

Handle<Value> PgSQLDatabase::Query(const Arguments& args)
{
    HandleScope scope;
    PgSQLDatabase *db = ObjectWrap::Unwrap<PgSQLDatabase>(args.This());
    int rc, nparams = 0;
    REQUIRE_ARGUMENT_STRING(0, sql);
    OPTIONAL_ARGUMENT_ARRAY(1, params);
    OPTIONAL_ARGUMENT_FUNCTION(-1, cb);
    if (!db->handle)  {
        ERROR(db, cb, "not connected");
        return args.This();
    }

    db->StopPoll();
    db->Clear();

    if (!params.IsEmpty()) nparams = params->Length();
    if (nparams) {
        int nvalues = nparams;
        char* values[nvalues];
        for (int i = 0; i < nparams; i++) {
            Local<Value> val = params->Get(i);
            if (!val->IsNull()) {
                String::Utf8Value str(val->ToString());
                values[i] = strdup(*str);
            } else {
                values[i] = NULL;
            }
        }
        rc = PQsendQueryParams(db->handle, *sql, nvalues, NULL, values, NULL, NULL, 0);
        for (int i = 0; i < nvalues; i++) free(values[i]);
    } else {
        rc = PQsendQuery(db->handle, *sql);
    }
    if (rc) {
        db->StartPoll(UV_WRITABLE, Handle_Poll, cb, *sql);
    } else {
        ERROR(db, cb, db->Error());
    }
    return args.This();
}

Handle<Value> PgSQLDatabase::QuerySync(const Arguments& args)
{
    HandleScope scope;
    PgSQLDatabase *db = ObjectWrap::Unwrap<PgSQLDatabase>(args.This());
    int nparams = 0;
    PGresult *rc;

    if (!db->handle) return ThrowException(Exception::Error(String::New("not connected")));

    REQUIRE_ARGUMENT_STRING(0, sql);
    OPTIONAL_ARGUMENT_ARRAY(1, params);
    if (!params.IsEmpty()) nparams = params->Length();

    db->Clear();
    db->StopPoll();
    PQsetnonblocking(db->handle, 0);

    if (nparams) {
        int nvalues = 0;
        char* values[nvalues];
        for (int i = 0; i < nvalues; i++) {
            String::Utf8Value str(params->Get(i)->ToString());
            values[i] = strdup(*str);
        }
        rc = PQexecParams(db->handle, *sql, nvalues, NULL, values, NULL, NULL, 0);
        for (int i = 0; i < nvalues; i++) free(values[i]);
    } else {
        rc = PQexec(db->handle, *sql);
    }
    if (!rc) return ThrowException(Exception::Error(String::New(db->Error())));

    EXCEPTION(err, rc);
    if (!err->IsNull()) {
        PQclear(rc);
        return ThrowException(err);
    }

    Local<Array> rows = db->getResult(rc);
    PQclear(rc);

    return scope.Close(rows);
}

Local<Array> PgSQLDatabase::getResult(PGresult* result)
{
	HandleScope scope;
	inserted_oid = PQoidValue(result);
	affected_rows = PQcmdTuples(result);
	int rcount = PQntuples(result);
	Local<Array> rc = Local<Array>::New(Array::New(rcount));
	for (int r = 0; r < rcount; r++) {
		Local<Object> row = Local<Object>::New(Object::New());
		int ccount = PQnfields(result);
		for (int c = 0; c < ccount; c++) {
			Local<Value> value;
			vector<string> list;
			Buffer *buffer;
			char* name = PQfname(result, c);
			const char * val = PQgetvalue(result, r, c);
			int len = PQgetlength(result, r, c);
			int type = PQftype(result, c);
			if (PQgetisnull(result, r, c)) type = -1;
			switch (type) {
			case -1:
				value = Local<Value>::New(Null());
				break;

            case 17: // byteA
                buffer = Buffer::New(val, len);
                value = Local<Value>::New(buffer->handle_);
                break;

            case 20:
            case 21:
            case 23:
            case 26: // integer
                value = Local<Value>::New(Number::New(atoll(val)));
                break;

            case 16: // bool
                value = Local<Value>::New(Boolean::New(val[0] == 't' ? true : false));
                break;

            case 114: // json
                value = Local<Value>::New(parseJSON(val));
                break;

            case 700: // float32
            case 701: // float64
            case 1700: // numeric
                value = Local<Value>::New(Number::New(atof(val)));
                break;

            case 1003: // name
            case 1008: // regproc
            case 1009: // text
            case 1014: // char
            case 1015: // varchar
                list = strSplit(string(val, 1, len - 2), ",", "\"");
                value = Local<Value>::New(toArray(list));
                break;

            case 1005: // int2
            case 1007: // int4
            case 1016: // int8
                list = strSplit(string(val, 1, len - 2), ",");
                value = Local<Value>::New(toArray(list, 1));
                break;

            case 1021: // float4
            case 1022: // float8
            case 1231: // numeric
                list = strSplit(string(val, 1, len - 2), ",");
                value = Local<Value>::New(toArray(list, 2));
                break;

            case 1082: // date
            case 1114: // timestamp without timezone
            case 1184: // timestamp
            case 1186: // interval

            default:
                value = Local<Value>::New(String::New(val));
            }
            row->Set(String::NewSymbol(name), value);
        }
        rc->Set(r, row);
    }
    return scope.Close(rc);
}

#endif
