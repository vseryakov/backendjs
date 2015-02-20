//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  April 2013
//

#include "node_backend.h"

#define SQLITE_JSON 99

#define EXCEPTION(msg, errno, name) \
        Local<Value> name = Exception::Error(String::Concat(String::Concat(String::NewSymbol(sqlite_code_string(errno)),String::NewSymbol(": ")),String::New(msg))); \
        Local<Object> name ##_obj = name->ToObject(); \
        name ##_obj->Set(NODE_PSYMBOL("errno"), Integer::New(errno)); \
        name ##_obj->Set(NODE_PSYMBOL("code"), String::NewSymbol(sqlite_code_string(errno)));

struct SQLiteField {
    inline SQLiteField(unsigned short _index, unsigned short _type = SQLITE_NULL, double n = 0, string s = string()): type(_type), index(_index), nvalue(n), svalue(s) {}
    inline SQLiteField(const char *_name, unsigned short _type = SQLITE_NULL, double n = 0, string s = string()): type(_type), index(0), name(_name), nvalue(n), svalue(s) {}
    unsigned short type;
    unsigned short index;
    string name;
    double nvalue;
    string svalue;
};

typedef vector<SQLiteField> Row;
class SQLiteStatement;

static map<SQLiteStatement*,bool> _stmts;

class SQLiteDatabase: public ObjectWrap {
public:
    static Persistent<FunctionTemplate> constructor_template;
    static void Init(Handle<Object> target);
    static inline bool HasInstance(Handle<Value> val) { return constructor_template->HasInstance(val); }

    struct Baton {
        uv_work_t request;
        SQLiteDatabase* db;
        Persistent<Function> callback;
        int status;
        string message;
        string sparam;
        int iparam;
        sqlite3_int64 inserted_id;
        int changes;

        Baton(SQLiteDatabase* db_, Handle<Function> cb_, string s = "", int i = 0): db(db_), status(SQLITE_OK), sparam(s), iparam(i) {
            db->Ref();
            request.data = this;
            if (!cb_.IsEmpty()) callback = Persistent < Function > ::New(cb_);
        }
        virtual ~Baton() {
            db->Unref();
            if (!callback.IsEmpty()) callback.Dispose();
        }
    };

    friend class SQLiteStatement;

    SQLiteDatabase() : ObjectWrap(), handle(NULL), timeout(500), retries(2) {}
    ~SQLiteDatabase() { sqlite3_close_v2(handle); }

    static Handle<Value> New(const Arguments& args);
    static Handle<Value> OpenGetter(Local<String> str, const AccessorInfo& accessor);
    static Handle<Value> InsertedOidGetter(Local<String> str, const AccessorInfo& accessor);
    static Handle<Value> AffectedRowsGetter(Local<String> str, const AccessorInfo& accessor);

    static void Work_Open(uv_work_t* req);
    static void Work_AfterOpen(uv_work_t* req);

    static Handle<Value> QuerySync(const Arguments& args);
    static Handle<Value> Query(const Arguments& args);
    static Handle<Value> RunSync(const Arguments& args);
    static Handle<Value> Run(const Arguments& args);
    static Handle<Value> Exec(const Arguments& args);
    static void Work_Exec(uv_work_t* req);
    static void Work_AfterExec(uv_work_t* req);

    static Handle<Value> CloseSync(const Arguments& args);
    static Handle<Value> Close(const Arguments& args);
    static void Work_Close(uv_work_t* req);
    static void Work_AfterClose(uv_work_t* req);
    static Handle<Value> Copy(const Arguments& args);

    sqlite3* handle;
    int timeout;
    int retries;
};

class SQLiteStatement: public ObjectWrap {
public:
    static Persistent<FunctionTemplate> constructor_template;
    static Persistent<ObjectTemplate> object_template;

    static void Init(Handle<Object> target);
    static Handle<Value> New(const Arguments& args);
    static Handle<Value> SqlGetter(Local<String> str, const AccessorInfo& accessor);
    static inline bool HasInstance(Handle<Value> val) { return constructor_template->HasInstance(val); }
    static Handle<Object> Create(SQLiteDatabase *db, string sql = string()) {
        Local<Object> obj = object_template->NewInstance();
        SQLiteStatement* stmt = new SQLiteStatement(db, sql);
        obj->SetInternalField(0, External::New(stmt));
        stmt->Wrap(obj);
        return obj;
    }

    struct Baton {
        uv_work_t request;
        SQLiteStatement* stmt;
        Persistent<Function> callback;
        Persistent<Function> completed;
        Row params;
        vector<Row> rows;
        sqlite3_int64 inserted_id;
        int changes;
        string sql;

        Baton(SQLiteStatement* stmt_, Handle<Function> cb_): stmt(stmt_), inserted_id(0), changes(0), sql(stmt->sql)  {
            stmt->Ref();
            request.data = this;
            if (!cb_.IsEmpty()) callback = Persistent < Function > ::New(cb_);
        }
        virtual ~Baton() {
            stmt->Unref();
            if (!callback.IsEmpty()) callback.Dispose();
            if (!completed.IsEmpty()) completed.Dispose();
        }
    };

    SQLiteStatement(SQLiteDatabase* db_, string sql_ = string()): ObjectWrap(), db(db_), handle(NULL), sql(sql_), status(SQLITE_OK), each(NULL) {
        db->Ref();
        _stmts[this] = 0;
    }

    ~SQLiteStatement() {
        Finalize();
        db->Unref();
        _stmts.erase(this);
    }

    void Finalize(void) {
        LogDev("%s", sql.c_str());
        if (handle) sqlite3_finalize(handle);
        handle = NULL;
    }

    bool Prepare() {
        handle = NULL;
        status = vsqlite_prepare(db->handle, &handle, sql, db->retries, db->timeout);
        if (status != SQLITE_OK) {
            message = string(sqlite3_errmsg(db->handle));
            if (handle) sqlite3_finalize(handle);
            handle = NULL;
            return false;
        }
        return true;
    }

    static Handle<Value> Finalize(const Arguments& args);

    static Handle<Value> Prepare(const Arguments& args);
    static void Work_Prepare(uv_work_t* req);
    static void Work_AfterPrepare(uv_work_t* req);

    static Handle<Value> RunSync(const Arguments& args);
    static Handle<Value> Run(const Arguments& args);
    static void Work_Run(uv_work_t* req);
    static void Work_RunPrepare(uv_work_t* req);
    static void Work_AfterRun(uv_work_t* req);

    static Handle<Value> QuerySync(const Arguments& args);
    static Handle<Value> Query(const Arguments& args);
    static void Work_Query(uv_work_t* req);
    static void Work_QueryPrepare(uv_work_t* req);
    static void Work_AfterQuery(uv_work_t* req);

    static Handle<Value> Each(const Arguments& args);
    static void Work_Each(uv_work_t* req);
    static void Work_EachNext(uv_work_t* req);
    static void Work_AfterEach(uv_work_t* req);
    static Handle<Value> Next(const Arguments& args);
    void Next(void);

    SQLiteDatabase* db;
    sqlite3_stmt* handle;
    string sql;
    string op;
    int status;
    string message;
    Baton *each;
};

Persistent<FunctionTemplate> SQLiteDatabase::constructor_template;
Persistent<FunctionTemplate> SQLiteStatement::constructor_template;
Persistent<ObjectTemplate> SQLiteStatement::object_template;

void SQLiteInit(Handle<Object> target)
{
    HandleScope scope;

    SQLiteDatabase::Init(target);
    SQLiteStatement::Init(target);

    DEFINE_CONSTANT_INTEGER(target, SQLITE_OPEN_READONLY, OPEN_READONLY);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_OPEN_READWRITE, OPEN_READWRITE);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_OPEN_CREATE, OPEN_CREATE);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_OPEN_NOMUTEX, OPEN_NOMUTEX);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_OPEN_FULLMUTEX, OPEN_FULMUTEX);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_OPEN_SHAREDCACHE, OPEN_SHAREDCACHE);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_OPEN_PRIVATECACHE, OPEN_PRIVATECACHE);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_OPEN_URI, OPEN_URI);

    DEFINE_CONSTANT_STRING(target, SQLITE_VERSION, SQLITE_VERSION);
    DEFINE_CONSTANT_STRING(target, SQLITE_SOURCE_ID, SQLITE_SOURCE_ID);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_VERSION_NUMBER, SQLITE_VERSION_NUMBER);

    DEFINE_CONSTANT_INTEGER(target, SQLITE_OK, OK);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_ERROR, ERROR);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_INTERNAL, INTERNAL);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_PERM, PERM);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_ABORT, ABORT);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_BUSY, BUSY);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_LOCKED, LOCKED);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_NOMEM, NOMEM);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_READONLY, READONLY);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_INTERRUPT, INTERRUPT);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_IOERR, IOERR);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_CORRUPT, CORRUPT);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_NOTFOUND, NOTFOUND);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_FULL, FULL);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_CANTOPEN, CANTOPEN);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_PROTOCOL, PROTOCOL);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_EMPTY, EMPTY);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_SCHEMA, SCHEMA);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_TOOBIG, TOOBIG);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_CONSTRAINT, CONSTRAINT);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_MISMATCH, MISMATCH);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_MISUSE, MISUSE);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_NOLFS, NOLFS);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_AUTH, AUTH);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_FORMAT, FORMAT);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_RANGE, RANGE);
    DEFINE_CONSTANT_INTEGER(target, SQLITE_NOTADB, NOTADB);
}

static Handle<Value> listStatements(const Arguments& args)
{
    HandleScope scope;

    Local<Array> keys = Array::New();
    map<SQLiteStatement*,bool>::const_iterator it = _stmts.begin();
    int i = 0;
    while (it != _stmts.end()) {
        Local<Object> obj = Local<Object>::New(Object::New());
        obj->Set(String::NewSymbol("op"), Local<String>::New(String::New(it->first->op.c_str())));
        obj->Set(String::NewSymbol("sql"), Local<String>::New(String::New(it->first->sql.c_str())));
        obj->Set(String::NewSymbol("prepared"), Local<Boolean>::New(Boolean::New(it->first->handle != NULL)));
        keys->Set(Integer::New(i), obj);
        it++;
        i++;
    }
    return scope.Close(keys);
}

void SQLiteDatabase::Init(Handle<Object> target)
{
    HandleScope scope;

    NODE_SET_METHOD(target, "sqliteStats", listStatements);

    Local < FunctionTemplate > t = FunctionTemplate::New(New);
    constructor_template = Persistent < FunctionTemplate > ::New(t);
    constructor_template->InstanceTemplate()->SetInternalFieldCount(1);
    constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("open"), OpenGetter);
    constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("inserted_oid"), InsertedOidGetter);
    constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("affected_rows"), AffectedRowsGetter);
    constructor_template->SetClassName(String::NewSymbol("SQLiteDatabase"));

    NODE_SET_PROTOTYPE_METHOD(constructor_template, "close", Close);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "closeSync", CloseSync);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "exec", Exec);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "run", Run);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "runSync", RunSync);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "query", Query);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "querySync", QuerySync);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "copy", Copy);

    target->Set(String::NewSymbol("SQLiteDatabase"), constructor_template->GetFunction());
}

static bool BindParameters(Row &params, sqlite3_stmt *stmt)
{
    sqlite3_reset(stmt);
    if (!params.size()) return true;

    sqlite3_clear_bindings(stmt);
    for (uint i = 0; i < params.size(); i++) {
        SQLiteField &field = params[i];
        int status;
        switch (field.type) {
        case SQLITE_INTEGER:
            status = sqlite3_bind_int(stmt, field.index, field.nvalue);
            break;
        case SQLITE_FLOAT:
            status = sqlite3_bind_double(stmt, field.index, field.nvalue);
            break;
        case SQLITE_TEXT:
            status = sqlite3_bind_text(stmt, field.index, field.svalue.c_str(), field.svalue.size(), SQLITE_TRANSIENT);
            break;
        case SQLITE_BLOB:
            status = sqlite3_bind_blob(stmt, field.index, field.svalue.c_str(), field.svalue.size(), SQLITE_TRANSIENT);
            break;
        case SQLITE_NULL:
            status = sqlite3_bind_null(stmt, field.index);
            break;
        }
        if (status != SQLITE_OK) return false;
    }
    return true;
}

static bool ParseParameters(Row &params, const Arguments& args, int idx)
{
    HandleScope scope;
    if (idx >= args.Length() || !args[idx]->IsArray()) return false;

    Local<Array> array = Local<Array>::Cast(args[idx]);
    for (uint i = 0, pos = 1; i < array->Length(); i++, pos++) {
        Local<Value> source = array->Get(i);

        if (source->IsString() || source->IsRegExp()) {
            String::Utf8Value val(source->ToString());
            params.push_back(SQLiteField(pos, SQLITE_TEXT, 0, string(*val, val.length())));
        } else
        if (source->IsInt32()) {
            params.push_back(SQLiteField(pos, SQLITE_INTEGER, source->Int32Value()));
        } else
        if (source->IsNumber()) {
            params.push_back(SQLiteField(pos, SQLITE_FLOAT, source->NumberValue()));
        } else
        if (source->IsBoolean()) {
            params.push_back(SQLiteField(pos, SQLITE_INTEGER, source->BooleanValue() ? 1 : 0));
        } else
        if (source->IsNull()) {
            params.push_back(SQLiteField(pos));
        } else
        if (Buffer::HasInstance(source)) {
            Local < Object > buffer = source->ToObject();
            params.push_back(SQLiteField(pos, SQLITE_BLOB, 0, string(Buffer::Data(buffer), Buffer::Length(buffer))));
        } else
        if (source->IsDate()) {
            params.push_back(SQLiteField(pos, SQLITE_FLOAT, source->NumberValue()));
        } else
        if (source->IsObject()) {
            params.push_back(SQLiteField(pos, SQLITE_TEXT, 0, stringifyJSON(source)));
        } else
        if (source->IsUndefined()) {
            params.push_back(SQLiteField(pos));
        }
    }
    return true;
}

static void GetRow(Row &row, sqlite3_stmt* stmt)
{
    row.clear();
    int cols = sqlite3_column_count(stmt);
    for (int i = 0; i < cols; i++) {
        int type = sqlite3_column_type(stmt, i);
        int length = sqlite3_column_bytes(stmt, i);
        const char* name = sqlite3_column_name(stmt, i);
        const char* dtype = sqlite3_column_decltype(stmt, i);
        const char* text;

        if (dtype && !strcasecmp(dtype, "json")) type = SQLITE_JSON;
        switch (type) {
        case SQLITE_INTEGER:
            row.push_back(SQLiteField(name, type, sqlite3_column_int64(stmt, i)));
            break;
        case SQLITE_FLOAT:
            row.push_back(SQLiteField(name, type, sqlite3_column_double(stmt, i)));
            break;
        case SQLITE_TEXT:
        case SQLITE_JSON:
            text = (const char*) sqlite3_column_text(stmt, i);
            row.push_back(SQLiteField(name, type, 0, string(text, length)));
            break;
        case SQLITE_BLOB:
            text = (const char*)sqlite3_column_blob(stmt, i);
            row.push_back(SQLiteField(name, type, 0, string(text, length)));
            break;
        case SQLITE_NULL:
            row.push_back(SQLiteField(name));
            break;
        }
    }
}

static Local<Object> GetRow(sqlite3_stmt *stmt)
{
    HandleScope scope;

    Local<Object> obj(Object::New());
    int cols = sqlite3_column_count(stmt);
    for (int i = 0; i < cols; i++) {
        int type = sqlite3_column_type(stmt, i);
        int length = sqlite3_column_bytes(stmt, i);
        const char* name = sqlite3_column_name(stmt, i);
        const char* dtype = sqlite3_column_decltype(stmt, i);
        const char* text;
        Local<Value> value;
        Buffer *buffer;

        if (dtype && !strcasecmp(dtype, "json")) type = SQLITE_JSON;
        switch (type) {
        case SQLITE_INTEGER:
            value = Local<Value>(Local<Number>::New(Number::New(sqlite3_column_int64(stmt, i))));
            break;
        case SQLITE_FLOAT:
            value = Local<Value>(Local<Number>::New(Number::New(sqlite3_column_double(stmt, i))));
            break;
        case SQLITE_TEXT:
            value = Local<Value>(Local<String>::New(String::New((const char*) sqlite3_column_text(stmt, i))));
            break;
        case SQLITE_JSON:
            value = Local<Value>::New(parseJSON((const char*)sqlite3_column_text(stmt, i)));
            break;
        case SQLITE_BLOB:
            text = (const char*)sqlite3_column_blob(stmt, i);
            buffer = Buffer::New(text, length);
            value = Local<Value>::New(buffer->handle_);
            break;
        case SQLITE_NULL:
            value = Local<Value>::New(Null());
            break;
        }
        obj->Set(String::NewSymbol(name), value);
    }
    return scope.Close(obj);
}

static Local<Object> RowToJS(Row &row)
{
    HandleScope scope;

    Local<Object> result(Object::New());
    for (uint i = 0; i < row.size(); i++) {
        SQLiteField &field = row[i];
        Buffer *buffer;
        Local<Value> value;
        switch (field.type) {
        case SQLITE_JSON:
            value = Local<Value>::New(parseJSON(field.svalue.c_str()));
            break;
        case SQLITE_INTEGER:
            value = Local<Value>(Local<Number>::New(Number::New(field.nvalue)));
            break;
        case SQLITE_FLOAT:
            value = Local<Value>(Local<Number>::New(Number::New(field.nvalue)));
            break;
        case SQLITE_TEXT:
            value = Local<Value>(Local<String>::New(String::New(field.svalue.c_str(), field.svalue.size())));
            break;
        case SQLITE_BLOB:
            buffer = Buffer::New(field.svalue.c_str(), field.svalue.size());
            value = Local<Value>::New(buffer->handle_);
            break;
        case SQLITE_NULL:
            value = Local<Value>::New(Null());
            break;
        }
        result->Set(String::NewSymbol(field.name.c_str()), value);
    }
    row.clear();
    return scope.Close(result);
}

static const char* sqlite_code_string(int code)
{
    switch (code) {
    case SQLITE_OK:
        return "SQLITE_OK";
    case SQLITE_ERROR:
        return "SQLITE_ERROR";
    case SQLITE_INTERNAL:
        return "SQLITE_INTERNAL";
    case SQLITE_PERM:
        return "SQLITE_PERM";
    case SQLITE_ABORT:
        return "SQLITE_ABORT";
    case SQLITE_BUSY:
        return "SQLITE_BUSY";
    case SQLITE_LOCKED:
        return "SQLITE_LOCKED";
    case SQLITE_NOMEM:
        return "SQLITE_NOMEM";
    case SQLITE_READONLY:
        return "SQLITE_READONLY";
    case SQLITE_INTERRUPT:
        return "SQLITE_INTERRUPT";
    case SQLITE_IOERR:
        return "SQLITE_IOERR";
    case SQLITE_CORRUPT:
        return "SQLITE_CORRUPT";
    case SQLITE_NOTFOUND:
        return "SQLITE_NOTFOUND";
    case SQLITE_FULL:
        return "SQLITE_FULL";
    case SQLITE_CANTOPEN:
        return "SQLITE_CANTOPEN";
    case SQLITE_PROTOCOL:
        return "SQLITE_PROTOCOL";
    case SQLITE_EMPTY:
        return "SQLITE_EMPTY";
    case SQLITE_SCHEMA:
        return "SQLITE_SCHEMA";
    case SQLITE_TOOBIG:
        return "SQLITE_TOOBIG";
    case SQLITE_CONSTRAINT:
        return "SQLITE_CONSTRAINT";
    case SQLITE_MISMATCH:
        return "SQLITE_MISMATCH";
    case SQLITE_MISUSE:
        return "SQLITE_MISUSE";
    case SQLITE_NOLFS:
        return "SQLITE_NOLFS";
    case SQLITE_AUTH:
        return "SQLITE_AUTH";
    case SQLITE_FORMAT:
        return "SQLITE_FORMAT";
    case SQLITE_RANGE:
        return "SQLITE_RANGE";
    case SQLITE_NOTADB:
        return "SQLITE_NOTADB";
    case SQLITE_ROW:
        return "SQLITE_ROW";
    case SQLITE_DONE:
        return "SQLITE_DONE";
    default:
        return "UNKNOWN";
    }
}

Handle<Value> SQLiteDatabase::OpenGetter(Local<String> str, const AccessorInfo& accessor)
{
    HandleScope scope;
    SQLiteDatabase* db = ObjectWrap::Unwrap < SQLiteDatabase > (accessor.This());
    return Boolean::New(db->handle != NULL);
}

Handle<Value> SQLiteDatabase::InsertedOidGetter(Local<String> str, const AccessorInfo& accessor)
{
    HandleScope scope;
    SQLiteDatabase* db = ObjectWrap::Unwrap < SQLiteDatabase > (accessor.This());
    return Integer::New(sqlite3_last_insert_rowid(db->handle));
}

Handle<Value> SQLiteDatabase::AffectedRowsGetter(Local<String> str, const AccessorInfo& accessor)
{
    HandleScope scope;
    SQLiteDatabase* db = ObjectWrap::Unwrap < SQLiteDatabase > (accessor.This());
    return Integer::New(sqlite3_changes(db->handle));
}

Handle<Value> SQLiteDatabase::New(const Arguments& args)
{
    HandleScope scope;

    if (!args.IsConstructCall()) return ThrowException(Exception::TypeError(String::NewSymbol("Use the new operator to create new Database objects")));

    REQUIRE_ARGUMENT_STRING(0, filename);
    int arg = 1, mode = 0;
    if (args.Length() >= arg && args[arg]->IsInt32()) mode = args[arg++]->Int32Value();

    Local < Function > callback;
    if (args.Length() >= arg && args[arg]->IsFunction()) callback = Local < Function > ::Cast(args[arg]);

    // Default RW and create
    mode |= mode & SQLITE_OPEN_READONLY ? 0 : (SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE);
    // No global mutex in read only
    mode |= mode & SQLITE_OPEN_NOMUTEX ? 0 : SQLITE_OPEN_FULLMUTEX;
    // Default is shared cache unless private is specified
    mode |= mode & SQLITE_OPEN_PRIVATECACHE ? 0 : SQLITE_OPEN_SHAREDCACHE;

    SQLiteDatabase* db = new SQLiteDatabase();
    db->Wrap(args.This());
    args.This()->Set(String::NewSymbol("name"), args[0]->ToString(), ReadOnly);
    args.This()->Set(String::NewSymbol("mode"), Integer::New(mode), ReadOnly);

    if (!callback.IsEmpty()) {
        Baton* baton = new Baton(db, callback, *filename, mode);
        uv_queue_work(uv_default_loop(), &baton->request, Work_Open, (uv_after_work_cb)Work_AfterOpen);
    } else {
        int status = sqlite3_open_v2(*filename, &db->handle, mode, NULL);
        if (status != SQLITE_OK) {
            sqlite3_close(db->handle);
            db->handle = NULL;
            return ThrowException(Exception::Error(String::New(sqlite3_errmsg(db->handle))));
        }
        vsqlite_init_db(db->handle, NULL);
    }
    return args.This();
}

void SQLiteDatabase::Work_Open(uv_work_t* req)
{
    Baton* baton = static_cast<Baton*>(req->data);

    baton->status = sqlite3_open_v2(baton->sparam.c_str(), &baton->db->handle, baton->iparam, NULL);
    if (baton->status != SQLITE_OK) {
        baton->message = string(sqlite3_errmsg(baton->db->handle));
        sqlite3_close(baton->db->handle);
        baton->db->handle = NULL;
    } else {
        vsqlite_init_db(baton->db->handle, NULL);
    }
}

void SQLiteDatabase::Work_AfterOpen(uv_work_t* req)
{
    HandleScope scope;
    Baton* baton = static_cast<Baton*>(req->data);

    if (!baton->callback.IsEmpty() && baton->callback->IsFunction()) {
        Local < Value > argv[1];
        if (baton->status != SQLITE_OK) {
            EXCEPTION(baton->message.c_str(), baton->status, exception);
            argv[0] = exception;
        } else {
            argv[0] = Local < Value > ::New(Null());
        }
        TRY_CATCH_CALL(baton->db->handle_, baton->callback, 1, argv);
    } else
    if (baton->status != SQLITE_OK) {
        LogError("%s", baton->message.c_str());
    }
    delete baton;
}

Handle<Value> SQLiteDatabase::CloseSync(const Arguments& args)
{
    HandleScope scope;
    SQLiteDatabase* db = ObjectWrap::Unwrap < SQLiteDatabase > (args.This());
    EXPECT_ARGUMENT_FUNCTION(0, callback);

    int status = sqlite3_close(db->handle);
    db->handle = NULL;
    if (status != SQLITE_OK) {
        return ThrowException(Exception::Error(String::New(sqlite3_errmsg(db->handle))));
    }
    return args.This();
}


Handle<Value> SQLiteDatabase::Close(const Arguments& args)
{
    HandleScope scope;
    SQLiteDatabase* db = ObjectWrap::Unwrap < SQLiteDatabase > (args.This());
    EXPECT_ARGUMENT_FUNCTION(0, callback);

    Baton* baton = new Baton(db, callback);
    uv_queue_work(uv_default_loop(), &baton->request, Work_Close, (uv_after_work_cb)Work_AfterClose);

    return args.This();
}

void SQLiteDatabase::Work_Close(uv_work_t* req)
{
    Baton* baton = static_cast<Baton*>(req->data);

    baton->status = sqlite3_close(baton->db->handle);
    if (baton->status != SQLITE_OK) {
        baton->message = string(sqlite3_errmsg(baton->db->handle));
    }
    baton->db->handle = NULL;
}

void SQLiteDatabase::Work_AfterClose(uv_work_t* req)
{
    HandleScope scope;
    Baton* baton = static_cast<Baton*>(req->data);

    if (!baton->callback.IsEmpty() && baton->callback->IsFunction()) {
        Local < Value > argv[1];
        if (baton->status != SQLITE_OK) {
            EXCEPTION(baton->message.c_str(), baton->status, exception);
            argv[0] = exception;
        } else {
            argv[0] = Local < Value > ::New(Null());
        }
        TRY_CATCH_CALL(baton->db->handle_, baton->callback, 1, argv);
    } else
    if (baton->status != SQLITE_OK) {
        LogError("%s", baton->message.c_str());
    }
    delete baton;
}

Handle<Value> SQLiteDatabase::QuerySync(const Arguments& args)
{
    HandleScope scope;
    SQLiteDatabase *db = ObjectWrap::Unwrap < SQLiteDatabase > (args.This());

    REQUIRE_ARGUMENT_STRING(0, text);

    Row params;
    sqlite3_stmt *stmt;
    ParseParameters(params, args, 1);
    int status = sqlite3_prepare_v2(db->handle, *text, text.length(), &stmt, NULL);
    if (status != SQLITE_OK) {
        return ThrowException(Exception::Error(String::New(sqlite3_errmsg(db->handle))));
    }

    int n = 0;
    string message;
    Local<Array> result(Array::New());
    if (BindParameters(params, stmt)) {
        while ((status = sqlite3_step(stmt)) == SQLITE_ROW) {
            Local<Object> obj(GetRow(stmt));
            result->Set(Integer::New(n++), obj);
        }
        if (status != SQLITE_DONE) {
            message = string(sqlite3_errmsg(db->handle));
        }
    } else {
        message = string(sqlite3_errmsg(db->handle));
    }
    sqlite3_finalize(stmt);
    if (status != SQLITE_DONE) {
        return ThrowException(Exception::Error(String::New(message.c_str())));
    }
    return scope.Close(result);
}

Handle<Value> SQLiteDatabase::RunSync(const Arguments& args)
{
    HandleScope scope;
    SQLiteDatabase *db = ObjectWrap::Unwrap < SQLiteDatabase > (args.This());

    REQUIRE_ARGUMENT_STRING(0, text);

    Row params;
    string message;
    sqlite3_stmt *stmt;
    ParseParameters(params, args, 1);
    int status = sqlite3_prepare_v2(db->handle, *text, text.length(), &stmt, NULL);
    if (status != SQLITE_OK) {
        return ThrowException(Exception::Error(String::New(sqlite3_errmsg(db->handle))));
    }

    if (BindParameters(params, stmt)) {
        status = sqlite3_step(stmt);
        if (!(status == SQLITE_ROW || status == SQLITE_DONE)) {
            message = string(sqlite3_errmsg(db->handle));
        } else {
            status = SQLITE_OK;
            db->handle_->Set(String::NewSymbol("inserted_oid"), Local < Integer > (Integer::New(sqlite3_last_insert_rowid(db->handle))));
            db->handle_->Set(String::NewSymbol("affected_rows"), Local < Integer > (Integer::New(sqlite3_changes(db->handle))));
        }
    } else {
        message = string(sqlite3_errmsg(db->handle));
    }
    sqlite3_finalize(stmt);
    if (status != SQLITE_OK) {
        return ThrowException(Exception::Error(String::New(message.c_str())));
    }
    return args.This();
}

Handle<Value> SQLiteDatabase::Run(const Arguments& args)
{
    HandleScope scope;
    SQLiteDatabase* db = ObjectWrap::Unwrap < SQLiteDatabase > (args.This());

    REQUIRE_ARGUMENT_STRING(0, sql);
    OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

    Local<Object> obj = Local<Object>::New(SQLiteStatement::Create(db, *sql));
    SQLiteStatement* stmt = ObjectWrap::Unwrap < SQLiteStatement > (obj);
    SQLiteStatement::Baton* baton = new SQLiteStatement::Baton(stmt, callback);
    ParseParameters(baton->params, args, 1);
    uv_queue_work(uv_default_loop(), &baton->request, SQLiteStatement::Work_RunPrepare, (uv_after_work_cb)SQLiteStatement::Work_AfterRun);

    return scope.Close(obj);
}

Handle<Value> SQLiteDatabase::Query(const Arguments& args)
{
    HandleScope scope;
    SQLiteDatabase* db = ObjectWrap::Unwrap < SQLiteDatabase > (args.This());

    REQUIRE_ARGUMENT_STRING(0, sql);
    OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

    Local<Object> obj = Local<Object>::New(SQLiteStatement::Create(db, *sql));
    SQLiteStatement* stmt = ObjectWrap::Unwrap < SQLiteStatement > (obj);
    SQLiteStatement::Baton* baton = new SQLiteStatement::Baton(stmt, callback);
    ParseParameters(baton->params, args, 1);
    uv_queue_work(uv_default_loop(), &baton->request, SQLiteStatement::Work_QueryPrepare, (uv_after_work_cb)SQLiteStatement::Work_AfterQuery);

    return scope.Close(obj);
}

Handle<Value> SQLiteDatabase::Exec(const Arguments& args)
{
    HandleScope scope;
    SQLiteDatabase* db = ObjectWrap::Unwrap < SQLiteDatabase > (args.This());

    REQUIRE_ARGUMENT_STRING(0, sql);
    EXPECT_ARGUMENT_FUNCTION(1, callback);

    Baton* baton = new Baton(db, callback, *sql);
    uv_queue_work(uv_default_loop(), &baton->request, Work_Exec, (uv_after_work_cb)Work_AfterExec);

    return args.This();
}

void SQLiteDatabase::Work_Exec(uv_work_t* req)
{
    Baton* baton = static_cast<Baton*>(req->data);

    char* message = NULL;
    baton->status = sqlite3_exec(baton->db->handle, baton->sparam.c_str(), NULL, NULL, &message);
    if (baton->status != SQLITE_OK) {
        baton->message = vFmtStr("sqlite3 error %d: %s", baton->status, message ? message : sqlite3_errmsg(baton->db->handle));
        sqlite3_free(message);
    } else {
        baton->inserted_id = sqlite3_last_insert_rowid(baton->db->handle);
        baton->changes = sqlite3_changes(baton->db->handle);
    }
}

void SQLiteDatabase::Work_AfterExec(uv_work_t* req)
{
    HandleScope scope;
    Baton* baton = static_cast<Baton*>(req->data);

    baton->db->handle_->Set(String::NewSymbol("inserted_oid"), Local < Integer > (Integer::New(baton->inserted_id)));
    baton->db->handle_->Set(String::NewSymbol("affected_rows"), Local < Integer > (Integer::New(baton->changes)));

    if (!baton->callback.IsEmpty() && baton->callback->IsFunction()) {
        Local < Value > argv[1];
        if (baton->status != SQLITE_OK) {
            EXCEPTION(baton->message.c_str(), baton->status, exception);
            argv[0] = exception;
        } else {
            argv[0] = Local < Value > ::New(Null());
        }
        TRY_CATCH_CALL(baton->db->handle_, baton->callback, 1, argv);
    } else
    if (baton->status != SQLITE_OK) {
        LogError("%s", baton->message.c_str());
    }
    delete baton;
}

Handle<Value> SQLiteDatabase::Copy(const Arguments& args)
{
    HandleScope scope;
    SQLiteDatabase* db = ObjectWrap::Unwrap < SQLiteDatabase > (args.This());
    string errmsg;
    sqlite3 *handle;
    int rc;

    if (args.Length() && SQLiteDatabase::HasInstance(args[0])) {
        SQLiteDatabase* sdb = ObjectWrap::Unwrap < SQLiteDatabase > (args[0]->ToObject());
        handle = sdb->handle;
    } else
    if (args.Length() && args[0]->IsString()) {
        String::Utf8Value filename(args[0]);
        rc = sqlite3_open_v2(*filename, &handle, SQLITE_OPEN_READONLY, NULL);
        if (rc != SQLITE_OK) {
            errmsg = sqlite3_errmsg(handle);
            sqlite3_close(handle);
            return ThrowException(Exception::Error(String::New(errmsg.c_str())));
        }
    } else {
        return ThrowException(Exception::TypeError(String::NewSymbol("Database object or database file name expected")));
    }

    sqlite3_backup *backup;
    backup = sqlite3_backup_init(db->handle, "main", handle, "main");
    if (backup) {
        sqlite3_backup_step(backup, -1);
        sqlite3_backup_finish(backup);
        rc = sqlite3_errcode(db->handle);
        errmsg = sqlite3_errmsg(db->handle);
    }

    if (args[0]->IsString()) {
        sqlite3_close(handle);
    }

    if (rc != SQLITE_OK) {
        return ThrowException(Exception::Error(String::New(errmsg.c_str())));
    }
    return args.This();
}

void SQLiteStatement::Init(Handle<Object> target)
{
    HandleScope scope;

    Local < FunctionTemplate > t = FunctionTemplate::New(New);

    constructor_template = Persistent < FunctionTemplate > ::New(t);
    constructor_template->InstanceTemplate()->SetInternalFieldCount(1);
    constructor_template->SetClassName(String::NewSymbol("Statement"));

    NODE_SET_PROTOTYPE_METHOD(constructor_template, "prepare", Prepare);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "run", Run);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "runSync", RunSync);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "query", Query);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "querySync", QuerySync);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "each", Each);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "next", Next);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "finalize", Finalize);

    target->Set(String::NewSymbol("SQLiteStatement"), constructor_template->GetFunction());

    // For statements created within database, All, Run
    object_template = Persistent<ObjectTemplate>::New(ObjectTemplate::New());
    object_template->SetInternalFieldCount(1);
}

// { Database db, String sql, Function callback }
Handle<Value> SQLiteStatement::New(const Arguments& args)
{
    HandleScope scope;

    if (!args.IsConstructCall()) return ThrowException(Exception::TypeError(String::NewSymbol("Use the new operator to create new Statement objects")));

    if (args.Length() < 1 || !SQLiteDatabase::HasInstance(args[0])) return ThrowException(Exception::TypeError(String::NewSymbol("Database object expected")));
    REQUIRE_ARGUMENT_STRING(1, sql);
    EXPECT_ARGUMENT_FUNCTION(2, callback);

    SQLiteDatabase* db = ObjectWrap::Unwrap < SQLiteDatabase > (args[0]->ToObject());
    SQLiteStatement* stmt = new SQLiteStatement(db, *sql);
    stmt->Wrap(args.This());
    args.This()->Set(String::NewSymbol("sql"), String::New(*sql), ReadOnly);
    stmt->op = "new";
    Baton* baton = new Baton(stmt, callback);
    uv_queue_work(uv_default_loop(), &baton->request, Work_Prepare, (uv_after_work_cb)Work_AfterPrepare);

    return args.This();
}

Handle<Value> SQLiteStatement::Prepare(const Arguments& args)
{
    HandleScope scope;
    SQLiteStatement* stmt = ObjectWrap::Unwrap < SQLiteStatement > (args.This());

    REQUIRE_ARGUMENT_STRING(0, sql);
    OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

    stmt->op = "prepare";
    stmt->sql = *sql;
    Baton* baton = new Baton(stmt, callback);
    uv_queue_work(uv_default_loop(), &baton->request, Work_Prepare, (uv_after_work_cb)Work_AfterPrepare);

    return args.This();
}

void SQLiteStatement::Work_Prepare(uv_work_t* req)
{
    Baton* baton = static_cast<Baton*>(req->data);
    baton->stmt->Prepare();
}

void SQLiteStatement::Work_AfterPrepare(uv_work_t* req)
{
    HandleScope scope;
    Baton* baton = static_cast<Baton*>(req->data);

    if (!baton->callback.IsEmpty() && baton->callback->IsFunction()) {
        Local < Value > argv[1];
        if (baton->stmt->status != SQLITE_OK) {
            EXCEPTION(baton->stmt->message.c_str(), baton->stmt->status, exception);
            argv[0] = exception;
        } else {
            argv[0] = Local < Value > ::New(Null());
        }
        TRY_CATCH_CALL(baton->stmt->handle_, baton->callback, 1, argv);
    } else
    if (baton->stmt->status != SQLITE_OK) {
        LogError("%s", baton->stmt->message.c_str());
    }
    delete baton;
}

Handle<Value> SQLiteStatement::Finalize(const Arguments& args)
{
    HandleScope scope;
    SQLiteStatement* stmt = ObjectWrap::Unwrap < SQLiteStatement > (args.This());

    stmt->Finalize();
    return args.This();
}

Handle<Value> SQLiteStatement::RunSync(const Arguments& args)
{
    HandleScope scope;
    SQLiteStatement* stmt = ObjectWrap::Unwrap < SQLiteStatement > (args.This());
    Row params;

    stmt->op = "runSync";
    ParseParameters(params, args, 0);
    if (BindParameters(params, stmt->handle)) {
        stmt->status = sqlite3_step(stmt->handle);

        if (!(stmt->status == SQLITE_ROW || stmt->status == SQLITE_DONE)) {
            stmt->message = string(sqlite3_errmsg(stmt->db->handle));
        } else {
            stmt->handle_->Set(String::NewSymbol("lastID"), Local < Integer > (Integer::New(sqlite3_last_insert_rowid(stmt->db->handle))));
            stmt->handle_->Set(String::NewSymbol("changes"), Local < Integer > (Integer::New(sqlite3_changes(stmt->db->handle))));
            stmt->status = SQLITE_OK;
        }
    } else {
        stmt->message = string(sqlite3_errmsg(stmt->db->handle));
    }

    if (stmt->status != SQLITE_OK) {
        return ThrowException(Exception::Error(String::New(stmt->message.c_str())));
    }
    return args.This();
}

Handle<Value> SQLiteStatement::Run(const Arguments& args)
{
    HandleScope scope;
    SQLiteStatement* stmt = ObjectWrap::Unwrap < SQLiteStatement > (args.This());

    OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

    stmt->op = "run";
    Baton* baton = new Baton(stmt, callback);
    ParseParameters(baton->params, args, 0);

    uv_queue_work(uv_default_loop(), &baton->request, Work_Run, (uv_after_work_cb)Work_AfterRun);
    return args.This();
}

void SQLiteStatement::Work_Run(uv_work_t* req)
{
    Baton* baton = static_cast<Baton*>(req->data);

    if (BindParameters(baton->params, baton->stmt->handle)) {
        baton->stmt->status = vsqlite_step(baton->stmt->handle, baton->stmt->db->retries, baton->stmt->db->timeout);

        if (!(baton->stmt->status == SQLITE_ROW || baton->stmt->status == SQLITE_DONE)) {
            baton->stmt->message = string(sqlite3_errmsg(baton->stmt->db->handle));
        } else {
            baton->inserted_id = sqlite3_last_insert_rowid(baton->stmt->db->handle);
            baton->changes = sqlite3_changes(baton->stmt->db->handle);
            baton->stmt->status = SQLITE_OK;
        }
    } else {
        baton->stmt->message = string(sqlite3_errmsg(baton->stmt->db->handle));
    }
}

void SQLiteStatement::Work_RunPrepare(uv_work_t* req)
{
    Baton* baton = static_cast<Baton*>(req->data);

    if (!baton->stmt->Prepare()) return;

    if (BindParameters(baton->params, baton->stmt->handle)) {
        baton->stmt->status = vsqlite_step(baton->stmt->handle, baton->stmt->db->retries, baton->stmt->db->timeout);

        if (!(baton->stmt->status == SQLITE_ROW || baton->stmt->status == SQLITE_DONE)) {
            baton->stmt->message = string(sqlite3_errmsg(baton->stmt->db->handle));
        } else {
            baton->inserted_id = sqlite3_last_insert_rowid(baton->stmt->db->handle);
            baton->changes = sqlite3_changes(baton->stmt->db->handle);
            baton->stmt->status = SQLITE_OK;
        }
    } else {
        baton->stmt->message = string(sqlite3_errmsg(baton->stmt->db->handle));
    }
    baton->stmt->Finalize();
}

void SQLiteStatement::Work_AfterRun(uv_work_t* req)
{
    HandleScope scope;
    Baton* baton = static_cast<Baton*>(req->data);

    baton->stmt->handle_->Set(String::NewSymbol("lastID"), Local < Integer > (Integer::New(baton->inserted_id)));
    baton->stmt->handle_->Set(String::NewSymbol("changes"), Local < Integer > (Integer::New(baton->changes)));

    if (!baton->callback.IsEmpty() && baton->callback->IsFunction()) {
        Local < Value > argv[1];
        if (baton->stmt->status != SQLITE_OK) {
            EXCEPTION(baton->stmt->message.c_str(), baton->stmt->status, exception);
            argv[0] = exception;
        } else {
            argv[0] = Local < Value > ::New(Null());
        }
        TRY_CATCH_CALL(baton->stmt->handle_, baton->callback, 1, argv);
    } else
    if (baton->stmt->status != SQLITE_OK) {
        LogError("%s", baton->stmt->message.c_str());
    }
    delete baton;
}

Handle<Value> SQLiteStatement::QuerySync(const Arguments& args)
{
    HandleScope scope;
    SQLiteStatement* stmt = ObjectWrap::Unwrap < SQLiteStatement > (args.This());

    OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

    int n = 0;
    Row params;
    ParseParameters(params, args, 0);
    Local<Array> result(Array::New());
    stmt->op = "querySync";

    if (BindParameters(params, stmt->handle)) {
        while ((stmt->status = sqlite3_step(stmt->handle)) == SQLITE_ROW) {
            Local<Object> obj(GetRow(stmt->handle));
            result->Set(Integer::New(n++), obj);
        }
        if (stmt->status != SQLITE_DONE) {
            stmt->message = string(sqlite3_errmsg(stmt->db->handle));
        }
    } else {
        stmt->message = string(sqlite3_errmsg(stmt->db->handle));
    }
    if (stmt->status != SQLITE_DONE) {
        return ThrowException(Exception::Error(String::New(stmt->message.c_str())));
    }
    return scope.Close(result);
}

Handle<Value> SQLiteStatement::Query(const Arguments& args)
{
    HandleScope scope;
    SQLiteStatement* stmt = ObjectWrap::Unwrap < SQLiteStatement > (args.This());

    OPTIONAL_ARGUMENT_FUNCTION(-1, callback);
    Baton* baton = new Baton(stmt, callback);
    ParseParameters(baton->params, args, 0);
    stmt->op = "query";
    uv_queue_work(uv_default_loop(), &baton->request, Work_Query, (uv_after_work_cb)Work_AfterQuery);
    return args.This();
}

void SQLiteStatement::Work_Query(uv_work_t* req)
{
    Baton* baton = static_cast<Baton*>(req->data);

    if (BindParameters(baton->params, baton->stmt->handle)) {
        while ((baton->stmt->status = vsqlite_step(baton->stmt->handle, baton->stmt->db->retries, baton->stmt->db->timeout)) == SQLITE_ROW) {
            Row row;
            GetRow(row, baton->stmt->handle);
            baton->rows.push_back(row);
        }
        if (baton->stmt->status != SQLITE_DONE) {
            baton->stmt->message = string(sqlite3_errmsg(baton->stmt->db->handle));
        }
    } else {
        baton->stmt->message = string(sqlite3_errmsg(baton->stmt->db->handle));
    }
}

void SQLiteStatement::Work_QueryPrepare(uv_work_t* req)
{
    Baton* baton = static_cast<Baton*>(req->data);

    if (!baton->stmt->Prepare()) return;

    if (BindParameters(baton->params, baton->stmt->handle)) {
        while ((baton->stmt->status = vsqlite_step(baton->stmt->handle, baton->stmt->db->retries, baton->stmt->db->timeout)) == SQLITE_ROW) {
            Row row;
            GetRow(row, baton->stmt->handle);
            baton->rows.push_back(row);
        }
        if (baton->stmt->status != SQLITE_DONE) {
            baton->stmt->message = string(sqlite3_errmsg(baton->stmt->db->handle));
        }
    } else {
        baton->stmt->message = string(sqlite3_errmsg(baton->stmt->db->handle));
    }
    baton->stmt->Finalize();
}

void SQLiteStatement::Work_AfterQuery(uv_work_t* req)
{
    HandleScope scope;
    Baton* baton = static_cast<Baton*>(req->data);

    baton->stmt->handle_->Set(String::NewSymbol("lastID"), Local < Integer > (Integer::New(baton->inserted_id)));
    baton->stmt->handle_->Set(String::NewSymbol("changes"), Local < Integer > (Integer::New(baton->changes)));

    if (!baton->callback.IsEmpty() && baton->callback->IsFunction()) {
        if (baton->stmt->status != SQLITE_DONE) {
            EXCEPTION(baton->stmt->message.c_str(), baton->stmt->status, exception);
            Local<Value> argv[] = { exception, Local<Value>::New(Array::New(0)) };
            TRY_CATCH_CALL(baton->stmt->handle_, baton->callback, 2, argv);
        } else
        if (baton->rows.size()) {
            Local<Array> result(Array::New(baton->rows.size()));
            for (uint i = 0; i < baton->rows.size(); i++) {
                result->Set(i, RowToJS(baton->rows[i]));
            }
            Local<Value> argv[] = { Local<Value>::New(Null()), result };
            TRY_CATCH_CALL(baton->stmt->handle_, baton->callback, 2, argv);
        } else {
            Local<Value> argv[] = { Local<Value>::New(Null()), Local<Value>::New(Array::New(0)) };
            TRY_CATCH_CALL(baton->stmt->handle_, baton->callback, 2, argv);
        }
    } else
    if (baton->stmt->status != SQLITE_DONE) {
        LogError("%s", baton->stmt->message.c_str());
    }
    delete baton;
}

Handle<Value> SQLiteStatement::Each(const Arguments& args)
{
    HandleScope scope;
    SQLiteStatement* stmt = ObjectWrap::Unwrap < SQLiteStatement > (args.This());

    Local<Function> callback, completed;
    if (args.Length() >= 3 && args[args.Length() - 1]->IsFunction() && args[args.Length() - 2]->IsFunction()) {
        callback = Local<Function>::Cast(args[args.Length() - 2]);
        completed = Local<Function>::Cast(args[args.Length() - 1]);
    } else
    if (args.Length() >= 2 && args[args.Length() - 1]->IsFunction()) {
        callback = Local<Function>::Cast(args[args.Length() - 1]);
    }
    stmt->op = "each";
    if (stmt->each) delete stmt->each;
    stmt->each = new Baton(stmt, callback);
    stmt->each->completed = Persistent<Function>::New(completed);
    ParseParameters(stmt->each->params, args, 0);

    uv_queue_work(uv_default_loop(), &stmt->each->request, Work_Each, (uv_after_work_cb)Work_AfterEach);
    return args.This();
}

void SQLiteStatement::Next()
{
    HandleScope scope;
    if (!each) return;

    if (each->rows.size()) {
        Local<Value> argv[1] = { RowToJS(each->rows[0]) };
        each->rows.erase(each->rows.begin());
        TRY_CATCH_CALL(handle_, each->callback, 1, argv);
        return;
    } else
    if (status == SQLITE_ROW) {
        uv_queue_work(uv_default_loop(), &each->request, Work_EachNext, (uv_after_work_cb)Work_AfterEach);
        return;
    }
    // No more rows or error, run final callback
    if (!each->completed.IsEmpty()) {
        Local<Value> argv[1];
        if (status != SQLITE_DONE) {
            EXCEPTION(message.c_str(), status, exception);
            argv[0] = exception;
        } else {
            argv[0] = Local<Value>::New(Null());
        }
        TRY_CATCH_CALL(handle_, each->completed, 1, argv);
    }
    delete each;
    each = NULL;
}

Handle<Value> SQLiteStatement::Next(const Arguments& args)
{
    HandleScope scope;
    SQLiteStatement* stmt = ObjectWrap::Unwrap < SQLiteStatement > (args.This());

    stmt->Next();
    return scope.Close(Undefined());
}

void SQLiteStatement::Work_Each(uv_work_t* req)
{
    Baton* baton = static_cast<Baton*>(req->data);

    if (BindParameters(baton->params, baton->stmt->handle)) {
        Work_EachNext(req);
    } else {
        baton->stmt->message = string(sqlite3_errmsg(baton->stmt->db->handle));
    }
}

void SQLiteStatement::Work_EachNext(uv_work_t* req)
{
    Baton* baton = static_cast<Baton*>(req->data);

    while ((baton->stmt->status = vsqlite_step(baton->stmt->handle, baton->stmt->db->retries, baton->stmt->db->timeout)) == SQLITE_ROW) {
        Row row;
        GetRow(row, baton->stmt->handle);
        baton->rows.push_back(row);
        if (baton->rows.size() >= 50) break;
    }
    if (baton->stmt->status != SQLITE_ROW && baton->stmt->status != SQLITE_DONE) {
        baton->stmt->message = string(sqlite3_errmsg(baton->stmt->db->handle));
    }
}

void SQLiteStatement::Work_AfterEach(uv_work_t* req)
{
    Baton* baton = static_cast<Baton*>(req->data);
    baton->stmt->Next();
}
