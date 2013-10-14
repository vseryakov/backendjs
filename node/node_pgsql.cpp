//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  April 2013
//

#include "node_backend.h"
#include "libpq-fe.h"
#include <string_bytes.h>

#define POLL_STOP(poll) if (poll.data) uv_poll_stop(&poll), poll.data = NULL;
#define POLL_START(poll,mode,cb, db) poll.data = db;uv_poll_start(&poll, mode, cb);

#define EXCEPTION(name, result) \
        Local<Value> name = Local<Value>::New(Null()); \
        const char *name ##_msg = PQresultErrorField(result, PG_DIAG_MESSAGE_PRIMARY); \
        if (name ##_msg) { \
        	Local<Object> name ##_obj = Local<Object>::Cast(Exception::Error(String::New(name ##_msg))); \
        	for (int i = 0; errnames[i]; i++) { \
        		name ##_msg = PQresultErrorField(result, errcodes[i]); \
        		if (name ##_msg) name ##_obj->Set(String::NewSymbol(errnames[i]), String::New(name ##_msg)); \
        	} \
        	name = name ##_obj; \
        }


class PgSQLDatabase: public ObjectWrap {
public:

    enum { CB_CONNECT, CB_NOTIFY, CB_QUERY, CB_MAX };

    int fd;
    PGconn *handle;
    uv_poll_t poll;
    uv_timer_t timer;
    string conninfo;
    Oid inserted_oid;
    string affected_rows;
    Persistent<Function> callback[CB_MAX];
    static Persistent<FunctionTemplate> constructor_template;
    vector<PGresult*> results;

    PgSQLDatabase(): ObjectWrap(), fd(-1), handle(NULL), inserted_oid(0) {
        poll.data = timer.data = NULL;
    	uv_timer_init(uv_default_loop(), &timer);
    }

    ~PgSQLDatabase() {
        Destroy();
    }

    void Destroy() {
    	Clear();
        POLL_STOP(poll);
        if (handle) PQfinish(handle);
        handle = NULL;
        for (int i = 0; i < CB_MAX; i++) {
            if (!callback[i].IsEmpty()) callback[i].Dispose();
        }
        if (timer.data) Unref();
        timer.data = NULL;
    }

    void Clear() {
    	for (uint i = 0; i < results.size(); i++) {
    		PQclear(results[i]);
    	}
    	results.clear();
    }

    bool CallCallback(int id, string msg = string(), bool err = false, bool dispose = false) {
        if (!callback[id].IsEmpty()) {
            Local<Value> argv[2];
            if (err) {
                argv[0] = Exception::Error(String::New(msg.c_str()));
            } else {
                argv[0] = String::New(msg.c_str());
            }
            argv[1] = Array::New(0);
            Persistent<Function> cb = callback[id];
            if (dispose) callback[id] = Persistent<Function>();
            TRY_CATCH_CALL(handle_, cb, 2, argv);
            if (dispose) cb.Dispose();
            return true;
        }
        LogDebug("%d: %s", id, msg.c_str());
        return false;
    }

    const char *Error() {
        const char *msg = PQerrorMessage(handle);
        return msg ? msg : "Unknown error";
    }

    static void Init(Handle<Object> target);
    static Handle<Value> New(const Arguments& args);
    static Handle<Value> OpenGetter(Local<String> str, const AccessorInfo& accessor);
    static Handle<Value> InsertedOidGetter(Local<String> str, const AccessorInfo& accessor);
    static Handle<Value> AffectedRowsGetter(Local<String> str, const AccessorInfo& accessor);
    static void Timer_Connect(uv_timer_t* req, int status);
    static void Handle_Connect(uv_poll_t* w, int status, int revents);
    static void Handle_Notice(void *arg, const char *message);

    static Handle<Value> Query(const Arguments& args);
    static Handle<Value> QuerySync(const Arguments& args);
    static Handle<Value> Close(const Arguments& args);

    static Handle<Value> SetNotify(const Arguments& args);
    static void Handle_Poll(uv_poll_t* w, int status, int revents);
    void Handle_Result(PGresult* result);
    void Process_Result();
    Local<Array> getResult(PGresult* result);
};

Persistent<FunctionTemplate> PgSQLDatabase::constructor_template;
static const char *errnames[] = { "severity", "code", "detail", "hint", "position", "internalPosition", "internalQuery", "where", "file", "line", "routine", NULL };
static const char errcodes[] = { PG_DIAG_SEVERITY, PG_DIAG_SQLSTATE, PG_DIAG_MESSAGE_DETAIL, PG_DIAG_MESSAGE_HINT, PG_DIAG_STATEMENT_POSITION, PG_DIAG_INTERNAL_POSITION, PG_DIAG_INTERNAL_QUERY, PG_DIAG_CONTEXT, PG_DIAG_SOURCE_FILE, PG_DIAG_SOURCE_LINE, PG_DIAG_SOURCE_FUNCTION, 0 };

void PgSQLInit(Handle<Object> target)
{
    HandleScope scope;
    PgSQLDatabase::Init(target);
}

void PgSQLDatabase::Init(Handle<Object> target)
{
    HandleScope scope;
    Local < FunctionTemplate > t = FunctionTemplate::New(New);
    constructor_template = Persistent < FunctionTemplate > ::New(t);
    constructor_template->InstanceTemplate()->SetInternalFieldCount(1);
    constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("open"), OpenGetter);
    constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("inserted_oid"), InsertedOidGetter);
    constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("affected_rows"), AffectedRowsGetter);
    constructor_template->SetClassName(String::NewSymbol("PgSQLDatabase"));

    NODE_SET_PROTOTYPE_METHOD(t, "notify", SetNotify);
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
    if (!db->callback[CB_NOTIFY].IsEmpty()) db->callback[CB_NOTIFY].Dispose();
    if (!cb.IsEmpty()) db->callback[CB_NOTIFY] = Persistent < Function > ::New(cb);
    return args.This();
}

Handle<Value> PgSQLDatabase::New(const Arguments& args)
{
    HandleScope scope;

    if (!args.IsConstructCall()) return ThrowException(Exception::TypeError(String::New("Use the new operator to create new Database objects")));
    REQUIRE_ARGUMENT_STRING(0, info);

    PgSQLDatabase* db = new PgSQLDatabase();
    db->Wrap(args.This());
    db->conninfo = *info;
    LogDev("%s", *info);

    EXPECT_ARGUMENT_FUNCTION(-1, cb);
    if (!cb.IsEmpty()) db->callback[CB_CONNECT] = Persistent < Function > ::New(cb);

    // Run in timer to call callback properly on any error, new does not allow callbacks
	db->timer.data = db;
	uv_timer_start(&db->timer, Timer_Connect, 0, 0);

	// To keep from garbage collection while waiting for event
	db->Ref();
    return args.This();
}

void PgSQLDatabase::Timer_Connect(uv_timer_t* req, int status)
{
    PgSQLDatabase* db = static_cast<PgSQLDatabase*>(req->data);

    db->handle = PQconnectStart(db->conninfo.c_str());
    if (PQstatus(db->handle) == CONNECTION_BAD || (db->fd = PQsocket(db->handle)) < 0) {
        db->CallCallback(CB_CONNECT, db->Error(), true, true);
        db->Destroy();
        return;
    }
    PQsetnonblocking(db->handle, 1);
    PQsetNoticeProcessor(db->handle, Handle_Notice, db);

    uv_poll_init(uv_default_loop(), &db->poll, db->fd);
    POLL_START(db->poll, UV_WRITABLE, Handle_Connect, db);
}

void PgSQLDatabase::Handle_Connect(uv_poll_t* w, int status, int revents)
{
    if (status == -1) return;
    PgSQLDatabase *db = static_cast<PgSQLDatabase*>(w->data);
    PostgresPollingStatusType rc = PQconnectPoll(db->handle);

    switch (rc) {
    case PGRES_POLLING_READING:
        POLL_START(db->poll, UV_READABLE, Handle_Connect, db);
    	break;

    case PGRES_POLLING_WRITING:
        POLL_START(db->poll, UV_WRITABLE, Handle_Connect, db);
        break;

    case PGRES_POLLING_OK:
        POLL_START(db->poll, UV_READABLE, Handle_Poll, db);
        db->CallCallback(CB_CONNECT, "", false, true);
        break;

    case PGRES_POLLING_FAILED:
    	POLL_STOP(db->poll);
        db->CallCallback(CB_CONNECT, db->Error(), true, true);
        break;

    default:
        LogError("status: %d", rc);
    }
}

void PgSQLDatabase::Handle_Notice(void *arg, const char *message)
{
    PgSQLDatabase *db = (PgSQLDatabase *)arg;
    db->CallCallback(CB_NOTIFY, message);
}

Handle<Value> PgSQLDatabase::Close(const Arguments& args)
{
    HandleScope scope;
    PgSQLDatabase *db = ObjectWrap::Unwrap<PgSQLDatabase>(args.This());

    OPTIONAL_ARGUMENT_FUNCTION(-1, cb);

    db->Destroy();

    if (!cb.IsEmpty()) {
    	Local<Value> argv[1];
    	TRY_CATCH_CALL(Context::GetCurrent()->Global(), cb, 0, argv);
    }
    return args.This();
}

Handle<Value> PgSQLDatabase::QuerySync(const Arguments& args)
{
    HandleScope scope;
    PgSQLDatabase *db = ObjectWrap::Unwrap<PgSQLDatabase>(args.This());
    int nparams = 0;
    PGresult *rc;

    REQUIRE_ARGUMENT_STRING(0, sql);
    OPTIONAL_ARGUMENT_ARRAY(1, params);
    if (!params.IsEmpty()) nparams = params->Length();
    OPTIONAL_ARGUMENT_FUNCTION(-1, cb);
    if (!cb.IsEmpty()) db->callback[CB_QUERY] = Persistent < Function > ::New(cb);

    db->Clear();
    POLL_STOP(db->poll);

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
    POLL_START(db->poll, UV_WRITABLE, Handle_Poll, db);
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

Handle<Value> PgSQLDatabase::Query(const Arguments& args)
{
    HandleScope scope;
    PgSQLDatabase *db = ObjectWrap::Unwrap<PgSQLDatabase>(args.This());
    int rc, nparams = 0;

    REQUIRE_ARGUMENT_STRING(0, sql);
    OPTIONAL_ARGUMENT_ARRAY(1, params);
    if (!params.IsEmpty()) nparams = params->Length();
    OPTIONAL_ARGUMENT_FUNCTION(-1, cb);
    if (!cb.IsEmpty()) db->callback[CB_QUERY] = Persistent < Function > ::New(cb);

    db->Clear();

    if (nparams) {
        int nvalues = 0;
        char* values[nvalues];
        for (int i = 0; i < nvalues; i++) {
            String::Utf8Value str(params->Get(i)->ToString());
            values[i] = strdup(*str);
        }
        rc = PQsendQueryParams(db->handle, *sql, nvalues, NULL, values, NULL, NULL, 0);
        for (int i = 0; i < nvalues; i++) free(values[i]);
    } else {
        rc = PQsendQuery(db->handle, *sql);
    }
    POLL_START(db->poll, UV_WRITABLE, Handle_Poll, db);

    if (!rc) db->CallCallback(CB_QUERY, db->Error(), true, true);
    return args.This();
}

void PgSQLDatabase::Handle_Poll(uv_poll_t* w, int status, int revents)
{
    LogDev("status=%d, revents=%d", status, revents);

    if (status == -1) return;
    PgSQLDatabase *db = static_cast<PgSQLDatabase*>(w->data);

    if (revents & UV_READABLE) {
        if (!PQconsumeInput(db->handle)) {
        	db->CallCallback(CB_NOTIFY, db->Error(), true);
            return;
        }

        // Read all results until we get NULL,  this is required by libpq
        if (!PQisBusy(db->handle)) {
        	PGresult *result;
        	while ((result = PQgetResult(db->handle))) {
        		db->Handle_Result(result);
        	}
        	db->Process_Result();
        }

        PGnotify *notify;
        while ((notify = PQnotifies(db->handle))) {
            db->CallCallback(CB_NOTIFY, vFmtStr("%s: %s", notify->relname, notify->extra));
            PQfreemem(notify);
        }
    }

    if (revents & UV_WRITABLE) {
        if (!PQflush(db->handle)) {
            POLL_START(db->poll, UV_READABLE, Handle_Poll, db);
        }
    }
}

void PgSQLDatabase::Handle_Result(PGresult* result)
{
    ExecStatusType status = PQresultStatus(result);

    switch (status) {
    case PGRES_SINGLE_TUPLE:
    case PGRES_TUPLES_OK:
        results.push_back(result);
        break;

    case PGRES_FATAL_ERROR:
    	results.push_back(result);
        break;

    case PGRES_COMMAND_OK:
        affected_rows = PQcmdTuples(result);
        break;

    case PGRES_EMPTY_QUERY:
        LogError("empty query");
        break;

    default:
        LogError("Unrecogized query status: %s", PQresStatus(status));
        break;
    }
}

Local<Array> PgSQLDatabase::getResult(PGresult* result)
{
	HandleScope scope;
	inserted_oid = PQoidValue(result);
	int rcount = PQntuples(result);
	Local<Array> rc = Array::New(rcount);
    for (int r = 0; r < rcount; r++) {
        Local<Object> row = Object::New();
        int ccount = PQnfields(result);
        for (int c = 0; c < ccount; c++) {
            Local<Value> value;
            vector<string> list;
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
            	value = StringBytes::Encode(val, PQgetlength(result, r, c), HEX);
            	break;

            case 20:
            case 21:
            case 23:
            case 26: // integer
            	value = Local<Value>(Number::New(atoll(val)));
            	break;

            case 16: // bool
            	value = Local<Value>::New(Boolean::New(val[0] == 't' ? true : false));
            	break;

            case 700: // float32
            case 701: // float64
            case 1700: // numeric
            	value = Local<Value>(Number::New(atof(val)));
            	break;

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
            	value = Local<Value>(String::New(val));
            }
            row->Set(String::NewSymbol(name), value);
        }
        rc->Set(r, row);
    }
    return scope.Close(rc);
}

void PgSQLDatabase::Process_Result()
{
    if (callback[CB_QUERY].IsEmpty()) {
    	Clear();
    	return;
    }
    if (!results.size()) {
    	CallCallback(CB_QUERY);
    	return;
    }
    PGresult *result = results[0];

    HandleScope scope;
    Local<Array> rc;

    EXCEPTION(err, result);
    if (err->IsNull()) {
    	rc = getResult(result);
    } else {
    	rc = Array::New(0);
    }
    Clear();

    // Save the callback before firing so we can deallocate it safely if inside the callback the same client will execute another query
    Persistent<Function> cb = callback[CB_QUERY];
    callback[CB_QUERY] = Persistent<Function>();
    Local<Value> argv[2] = { err, rc };
    TRY_CATCH_CALL(handle_, cb, 2, argv);
    cb.Dispose();
}

