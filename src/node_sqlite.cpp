//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  April 2013
//

#include "node_backend.h"
#include "bksqlite.h"

#define SQLITE_JSON 99

#define EXCEPTION(msg, errno, name) \
        Local<Value> name = Exception::Error(Nan::New(bkFmtStr("%d: %s", errno, msg).c_str()).ToLocalChecked()); \
        Local<Object> name ##_obj = name->ToObject(); \
        name ##_obj->Set(Nan::New("errno").ToLocalChecked(), Nan::New(errno)); \
        name ##_obj->Set(Nan::New("code").ToLocalChecked(), Nan::New(sqlite_code_string(errno)).ToLocalChecked());

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

class SQLiteDatabase: public Nan::ObjectWrap {
public:
    static Nan::Persistent<v8::Function> constructor;
    static void Init(Handle<Object> target);

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

    SQLiteDatabase() : Nan::ObjectWrap(), _handle(NULL), timeout(500), retries(2) {}
    virtual ~SQLiteDatabase() { sqlite3_close_v2(_handle); }

    static NAN_METHOD(New);
    static NAN_GETTER(OpenGetter1);
    static NAN_GETTER(InsertedOidGetter1);
    static NAN_GETTER(AffectedRowsGetter1);
    static Handle<Value> OpenGetter(Local<String> str, const AccessorInfo& accessor);
    static Handle<Value> InsertedOidGetter(Local<String> str, const AccessorInfo& accessor);
    static Handle<Value> AffectedRowsGetter(Local<String> str, const AccessorInfo& accessor);


    static void Work_Open(uv_work_t* req);
    static void Work_AfterOpen(uv_work_t* req);

    static NAN_METHOD(QuerySync);
    static NAN_METHOD(Query);
    static NAN_METHOD(RunSync);
    static NAN_METHOD(Run);
    static NAN_METHOD(Exec);
    static void Work_Exec(uv_work_t* req);
    static void Work_AfterExec(uv_work_t* req);

    static NAN_METHOD(CloseSync);
    static NAN_METHOD(Close);
    static void Work_Close(uv_work_t* req);
    static void Work_AfterClose(uv_work_t* req);
    static NAN_METHOD(Copy);

    sqlite3* _handle;
    int timeout;
    int retries;
};

class SQLiteStatement: public Nan::ObjectWrap {
public:
    static Nan::Persistent<v8::Function> constructor;
    static Persistent<ObjectTemplate> object_template;

    static void Init(Handle<Object> target);
    static NAN_METHOD(New);
    static NAN_GETTER(SqlGetter);

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

    SQLiteStatement(SQLiteDatabase* db_, string sql_ = string()): Nan::ObjectWrap(), db(db_), _handle(NULL), sql(sql_), status(SQLITE_OK), each(NULL) {
        db->Ref();
        _stmts[this] = 0;
    }

    virtual ~SQLiteStatement() {
        Finalize();
        db->Unref();
        _stmts.erase(this);
    }

    void Finalize(void) {
        LogDev("%s", sql.c_str());
        if (_handle) sqlite3_finalize(_handle);
        _handle = NULL;
    }

    bool Prepare() {
        _handle = NULL;
        status = bkSqlitePrepare(db->_handle, &_handle, sql, db->retries, db->timeout);
        if (status != SQLITE_OK) {
            message = string(sqlite3_errmsg(db->_handle));
            if (_handle) sqlite3_finalize(_handle);
            _handle = NULL;
            return false;
        }
        return true;
    }

    static NAN_METHOD(Finalize);

    static NAN_METHOD(Prepare);
    static void Work_Prepare(uv_work_t* req);
    static void Work_AfterPrepare(uv_work_t* req);

    static NAN_METHOD(RunSync);
    static NAN_METHOD(Run);
    static void Work_Run(uv_work_t* req);
    static void Work_RunPrepare(uv_work_t* req);
    static void Work_AfterRun(uv_work_t* req);

    static NAN_METHOD(QuerySync);
    static NAN_METHOD(Query);
    static void Work_Query(uv_work_t* req);
    static void Work_QueryPrepare(uv_work_t* req);
    static void Work_AfterQuery(uv_work_t* req);

    static NAN_METHOD(Each);
    static void Work_Each(uv_work_t* req);
    static void Work_EachNext(uv_work_t* req);
    static void Work_AfterEach(uv_work_t* req);
    static NAN_METHOD(Next);
    void Next(void);

    SQLiteDatabase* db;
    sqlite3_stmt* _handle;
    string sql;
    string op;
    int status;
    string message;
    Baton *each;
};

Nan::Persistent<v8::Function> SQLiteDatabase::constructor;
Nan::Persistent<v8::Function> SQLiteStatement::constructor;
Persistent<ObjectTemplate> SQLiteStatement::object_template;

void SQLiteInit(Handle<Object> target)
{
    Nan::HandleScope scope;

    bkSqliteInit();
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

static NAN_METHOD(sqliteStats)
{
    Nan::HandleScope scope;
    Local<Array> keys = Array::New();
    map<SQLiteStatement*,bool>::const_iterator it = _stmts.begin();
    int i = 0;
    while (it != _stmts.end()) {
        Local<Object> obj = Local<Object>::New(Object::New());
        obj->Set(Nan::New("op").ToLocalChecked(), Nan::New(it->first->op.c_str()).ToLocalChecked());
        obj->Set(Nan::New("sql").ToLocalChecked(), Nan::New(it->first->sql.c_str()).ToLocalChecked());
        obj->Set(Nan::New("prepared").ToLocalChecked(), Nan::New(it->first->_handle != NULL));
        keys->Set(Nan::New(i), obj);
        it++;
        i++;
    }
    NAN_RETURN(keys);
}

void SQLiteDatabase::Init(Handle<Object> target)
{
    Nan::HandleScope scope;

    NAN_EXPORT(target, sqliteStats);

    v8::Local<v8::FunctionTemplate> t = Nan::New<v8::FunctionTemplate>(New);
    t->SetClassName(Nan::New("SQLiteDatabase").ToLocalChecked());
    t->InstanceTemplate()->SetInternalFieldCount(1);
    t->InstanceTemplate()->SetAccessor(Nan::New("open").ToLocalChecked(), OpenGetter);
    t->InstanceTemplate()->SetAccessor(Nan::New("inserted_oid").ToLocalChecked(), InsertedOidGetter);
    t->InstanceTemplate()->SetAccessor(Nan::New("affected_rows").ToLocalChecked(), AffectedRowsGetter);

    Nan::SetPrototypeMethod(t, "close", Close);
    Nan::SetPrototypeMethod(t, "closeSync", CloseSync);
    Nan::SetPrototypeMethod(t, "exec", Exec);
    Nan::SetPrototypeMethod(t, "run", Run);
    Nan::SetPrototypeMethod(t, "runSync", RunSync);
    Nan::SetPrototypeMethod(t, "query", Query);
    Nan::SetPrototypeMethod(t, "querySync", QuerySync);
    Nan::SetPrototypeMethod(t, "copy", Copy);
    constructor.Reset(t->GetFunction());
    target->Set(Nan::New("SQLiteDatabase").ToLocalChecked(), t->GetFunction());
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

static bool ParseParameters(Row &params, const Nan::FunctionCallbackInfo<v8::Value>& args, int idx)
{
    Nan::HandleScope scope;
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
    Nan::EscapableHandleScope scope;

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
        obj->Set(Nan::New(name).ToLocalChecked(), value);
    }
    return scope.Escape(obj);
}

static Local<Object> RowToJS(Row &row)
{
    Nan::EscapableHandleScope scope;

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
        result->Set(Nan::New(field.name.c_str()).ToLocalChecked(), value);
    }
    row.clear();
    return scope.Escape(result);
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
    return scope.Close(Boolean::New(db->_handle != NULL));
}

Handle<Value> SQLiteDatabase::InsertedOidGetter(Local<String> str, const AccessorInfo& accessor)
{
    HandleScope scope;
    SQLiteDatabase* db = ObjectWrap::Unwrap < SQLiteDatabase > (accessor.This());
    return scope.Close(Integer::New(sqlite3_last_insert_rowid(db->_handle)));
}

Handle<Value> SQLiteDatabase::AffectedRowsGetter(Local<String> str, const AccessorInfo& accessor)
{
    HandleScope scope;
    SQLiteDatabase* db = ObjectWrap::Unwrap < SQLiteDatabase > (accessor.This());
    return scope.Close(Integer::New(sqlite3_changes(db->_handle)));
}

NAN_GETTER(SQLiteDatabase::OpenGetter1)
{
    Nan::HandleScope scope;
    SQLiteDatabase* db = ObjectWrap::Unwrap < SQLiteDatabase > (info.Holder());
    NAN_RETURN(Nan::New(db->_handle != NULL));
}

NAN_GETTER(SQLiteDatabase::InsertedOidGetter1)
{
    Nan::HandleScope scope;
    SQLiteDatabase* db = ObjectWrap::Unwrap < SQLiteDatabase > (info.Holder());
    NAN_RETURN(Nan::New((double)sqlite3_last_insert_rowid(db->_handle)));
}

NAN_GETTER(SQLiteDatabase::AffectedRowsGetter1)
{
    Nan::HandleScope scope;
    SQLiteDatabase* db = ObjectWrap::Unwrap < SQLiteDatabase > (info.Holder());
    NAN_RETURN(Nan::New(sqlite3_changes(db->_handle)));
}

NAN_METHOD(SQLiteDatabase::New)
{
    Nan::HandleScope scope;

    if (!info.IsConstructCall()) Nan::ThrowError("Use the new operator to create new Database objects");

    NAN_REQUIRE_ARGUMENT_STRING(0, filename);
    int arg = 1, mode = 0;
    if (info.Length() >= arg && info[arg]->IsInt32()) mode = info[arg++]->Int32Value();

    Local < Function > callback;
    if (info.Length() >= arg && info[arg]->IsFunction()) callback = Local < Function > ::Cast(info[arg]);

    // Default RW and create
    mode |= mode & SQLITE_OPEN_READONLY ? 0 : (SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE);
    // No global mutex in read only
    mode |= mode & SQLITE_OPEN_NOMUTEX ? 0 : SQLITE_OPEN_FULLMUTEX;
    // Default is shared cache unless private is specified
    mode |= mode & SQLITE_OPEN_PRIVATECACHE ? 0 : SQLITE_OPEN_SHAREDCACHE;

    SQLiteDatabase* db = new SQLiteDatabase();
    db->Wrap(info.This());
    info.This()->Set(Nan::New("name").ToLocalChecked(), info[0]->ToString(), ReadOnly);
    info.This()->Set(Nan::New("mode").ToLocalChecked(), Nan::New(mode), ReadOnly);

    if (!callback.IsEmpty()) {
        Baton* baton = new Baton(db, callback, *filename, mode);
        uv_queue_work(uv_default_loop(), &baton->request, Work_Open, (uv_after_work_cb)Work_AfterOpen);
    } else {
        int status = sqlite3_open_v2(*filename, &db->_handle, mode, NULL);
        if (status != SQLITE_OK) {
            sqlite3_close(db->_handle);
            db->_handle = NULL;
            Nan::ThrowError(sqlite3_errmsg(db->_handle));
        }
        bkSqliteInitDb(db->_handle, NULL);
    }
    NAN_RETURN(info.This());
}

void SQLiteDatabase::Work_Open(uv_work_t* req)
{
    Baton* baton = static_cast<Baton*>(req->data);

    baton->status = sqlite3_open_v2(baton->sparam.c_str(), &baton->db->_handle, baton->iparam, NULL);
    if (baton->status != SQLITE_OK) {
        baton->message = string(sqlite3_errmsg(baton->db->_handle));
        sqlite3_close(baton->db->_handle);
        baton->db->_handle = NULL;
    } else {
        bkSqliteInitDb(baton->db->_handle, NULL);
    }
}

void SQLiteDatabase::Work_AfterOpen(uv_work_t* req)
{
    Nan::HandleScope scope;
    Baton* baton = static_cast<Baton*>(req->data);

    if (!baton->callback.IsEmpty() && baton->callback->IsFunction()) {
        Local < Value > argv[1];
        if (baton->status != SQLITE_OK) {
            EXCEPTION(baton->message.c_str(), baton->status, exception);
            argv[0] = exception;
        } else {
            argv[0] = Local < Value > ::New(Null());
        }
        NAN_TRY_CATCH_CALL(baton->db->handle(), baton->callback, 1, argv);
    } else
    if (baton->status != SQLITE_OK) {
        LogError("%s", baton->message.c_str());
    }
    delete baton;
}

NAN_METHOD(SQLiteDatabase::CloseSync)
{
    Nan::HandleScope scope;
    SQLiteDatabase* db = ObjectWrap::Unwrap < SQLiteDatabase > (info.Holder());
    NAN_EXPECT_ARGUMENT_FUNCTION(0, callback);

    int status = sqlite3_close(db->_handle);
    db->_handle = NULL;
    if (status != SQLITE_OK) {
        Nan::ThrowError(sqlite3_errmsg(db->_handle));
    }
    NAN_RETURN(info.Holder());
}

NAN_METHOD(SQLiteDatabase::Close)
{
    Nan::HandleScope scope;
    SQLiteDatabase* db = ObjectWrap::Unwrap < SQLiteDatabase > (info.Holder());
    NAN_EXPECT_ARGUMENT_FUNCTION(0, callback);

    Baton* baton = new Baton(db, callback);
    uv_queue_work(uv_default_loop(), &baton->request, Work_Close, (uv_after_work_cb)Work_AfterClose);

    NAN_RETURN(info.Holder());
}

void SQLiteDatabase::Work_Close(uv_work_t* req)
{
    Baton* baton = static_cast<Baton*>(req->data);

    baton->status = sqlite3_close(baton->db->_handle);
    if (baton->status != SQLITE_OK) {
        baton->message = string(sqlite3_errmsg(baton->db->_handle));
    }
    baton->db->_handle = NULL;
}

void SQLiteDatabase::Work_AfterClose(uv_work_t* req)
{
    Nan::HandleScope scope;
    Baton* baton = static_cast<Baton*>(req->data);

    if (!baton->callback.IsEmpty() && baton->callback->IsFunction()) {
        Local < Value > argv[1];
        if (baton->status != SQLITE_OK) {
            EXCEPTION(baton->message.c_str(), baton->status, exception);
            argv[0] = exception;
        } else {
            argv[0] = Local < Value > ::New(Null());
        }
        NAN_TRY_CATCH_CALL(baton->db->handle(), baton->callback, 1, argv);
    } else
    if (baton->status != SQLITE_OK) {
        LogError("%s", baton->message.c_str());
    }
    delete baton;
}

NAN_METHOD(SQLiteDatabase::QuerySync)
{
    Nan::EscapableHandleScope scope;
    SQLiteDatabase *db = ObjectWrap::Unwrap < SQLiteDatabase > (info.Holder());

    NAN_REQUIRE_ARGUMENT_STRING(0, text);

    Row params;
    sqlite3_stmt *stmt;
    ParseParameters(params, info, 1);
    int status = sqlite3_prepare_v2(db->_handle, *text, text.length(), &stmt, NULL);
    if (status != SQLITE_OK) {
        Nan::ThrowError(sqlite3_errmsg(db->_handle));
    }

    int n = 0;
    string message;
    Local<Array> result(Array::New());
    if (BindParameters(params, stmt)) {
        while ((status = sqlite3_step(stmt)) == SQLITE_ROW) {
            Local<Object> obj(GetRow(stmt));
            result->Set(Nan::New(n++), obj);
        }
        if (status != SQLITE_DONE) {
            message = string(sqlite3_errmsg(db->_handle));
        }
    } else {
        message = string(sqlite3_errmsg(db->_handle));
    }
    sqlite3_finalize(stmt);
    if (status != SQLITE_DONE) {
        Nan::ThrowError(message.c_str());
    }
    NAN_RETURN(result);
}

NAN_METHOD(SQLiteDatabase::RunSync)
{
    Nan::HandleScope scope;
    SQLiteDatabase *db = ObjectWrap::Unwrap < SQLiteDatabase > (info.Holder());

    NAN_REQUIRE_ARGUMENT_STRING(0, text);

    Row params;
    string message;
    sqlite3_stmt *stmt;
    ParseParameters(params, info, 1);
    int status = sqlite3_prepare_v2(db->_handle, *text, text.length(), &stmt, NULL);
    if (status != SQLITE_OK) {
        Nan::ThrowError(sqlite3_errmsg(db->_handle));
    }

    if (BindParameters(params, stmt)) {
        status = sqlite3_step(stmt);
        if (!(status == SQLITE_ROW || status == SQLITE_DONE)) {
            message = string(sqlite3_errmsg(db->_handle));
        } else {
            status = SQLITE_OK;
            db->handle()->Set(Nan::New("inserted_oid").ToLocalChecked(), Nan::New((double)sqlite3_last_insert_rowid(db->_handle)));
            db->handle()->Set(Nan::New("affected_rows").ToLocalChecked(), Nan::New(sqlite3_changes(db->_handle)));
        }
    } else {
        message = string(sqlite3_errmsg(db->_handle));
    }
    sqlite3_finalize(stmt);
    if (status != SQLITE_OK) {
        Nan::ThrowError(message.c_str());
    }
    NAN_RETURN(info.Holder());
}

NAN_METHOD(SQLiteDatabase::Run)
{
    Nan::HandleScope scope;
    SQLiteDatabase* db = ObjectWrap::Unwrap < SQLiteDatabase > (info.Holder());

    NAN_REQUIRE_ARGUMENT_STRING(0, sql);
    NAN_OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

    Local<Object> obj = Local<Object>::New(SQLiteStatement::Create(db, *sql));
    SQLiteStatement* stmt = ObjectWrap::Unwrap < SQLiteStatement > (obj);
    SQLiteStatement::Baton* baton = new SQLiteStatement::Baton(stmt, callback);
    ParseParameters(baton->params, info, 1);
    uv_queue_work(uv_default_loop(), &baton->request, SQLiteStatement::Work_RunPrepare, (uv_after_work_cb)SQLiteStatement::Work_AfterRun);

    NAN_RETURN(obj);
}

NAN_METHOD(SQLiteDatabase::Query)
{
    Nan::HandleScope scope;
    SQLiteDatabase* db = ObjectWrap::Unwrap < SQLiteDatabase > (info.Holder());

    NAN_REQUIRE_ARGUMENT_STRING(0, sql);
    NAN_OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

    Local<Object> obj = Local<Object>::New(SQLiteStatement::Create(db, *sql));
    SQLiteStatement* stmt = ObjectWrap::Unwrap < SQLiteStatement > (obj);
    SQLiteStatement::Baton* baton = new SQLiteStatement::Baton(stmt, callback);
    ParseParameters(baton->params, info, 1);
    uv_queue_work(uv_default_loop(), &baton->request, SQLiteStatement::Work_QueryPrepare, (uv_after_work_cb)SQLiteStatement::Work_AfterQuery);

    NAN_RETURN(obj);
}

NAN_METHOD(SQLiteDatabase::Exec)
{
    Nan::HandleScope scope;
    SQLiteDatabase* db = ObjectWrap::Unwrap < SQLiteDatabase > (info.Holder());

    NAN_REQUIRE_ARGUMENT_STRING(0, sql);
    NAN_EXPECT_ARGUMENT_FUNCTION(1, callback);

    Baton* baton = new Baton(db, callback, *sql);
    uv_queue_work(uv_default_loop(), &baton->request, Work_Exec, (uv_after_work_cb)Work_AfterExec);

    NAN_RETURN(info.Holder());
}

void SQLiteDatabase::Work_Exec(uv_work_t* req)
{
    Baton* baton = static_cast<Baton*>(req->data);

    char* message = NULL;
    baton->status = sqlite3_exec(baton->db->_handle, baton->sparam.c_str(), NULL, NULL, &message);
    if (baton->status != SQLITE_OK) {
        baton->message = bkFmtStr("sqlite3 error %d: %s", baton->status, message ? message : sqlite3_errmsg(baton->db->_handle));
        sqlite3_free(message);
    } else {
        baton->inserted_id = sqlite3_last_insert_rowid(baton->db->_handle);
        baton->changes = sqlite3_changes(baton->db->_handle);
    }
}

void SQLiteDatabase::Work_AfterExec(uv_work_t* req)
{
    Nan::HandleScope scope;
    Baton* baton = static_cast<Baton*>(req->data);

    baton->db->handle()->Set(Nan::New("inserted_oid").ToLocalChecked(), Nan::New((double)baton->inserted_id));
    baton->db->handle()->Set(Nan::New("affected_rows").ToLocalChecked(), Nan::New(baton->changes));

    if (!baton->callback.IsEmpty() && baton->callback->IsFunction()) {
        Local < Value > argv[1];
        if (baton->status != SQLITE_OK) {
            EXCEPTION(baton->message.c_str(), baton->status, exception);
            argv[0] = exception;
        } else {
            argv[0] = Local < Value > ::New(Null());
        }
        NAN_TRY_CATCH_CALL(baton->db->handle(), baton->callback, 1, argv);
    } else
    if (baton->status != SQLITE_OK) {
        LogError("%s", baton->message.c_str());
    }
    delete baton;
}

NAN_METHOD(SQLiteDatabase::Copy)
{
    Nan::HandleScope scope;
    SQLiteDatabase* db = ObjectWrap::Unwrap < SQLiteDatabase > (info.Holder());
    string errmsg;
    sqlite3 *handle2 = 0;
    int rc;

    if (info.Length() && info[0]->IsObject()) {
        SQLiteDatabase* sdb = ObjectWrap::Unwrap < SQLiteDatabase > (info[0]->ToObject());
        handle2 = sdb->_handle;
    } else
    if (info.Length() && info[0]->IsString()) {
        Nan::Utf8String filename(info[0]);
        rc = sqlite3_open_v2(*filename, &handle2, SQLITE_OPEN_READONLY, NULL);
        if (rc != SQLITE_OK) {
            errmsg = sqlite3_errmsg(handle2);
            sqlite3_close(handle2);
            Nan::ThrowError(errmsg.c_str());
        }
    } else {
        Nan::ThrowError("Database object or database file name expected");
    }

    sqlite3_backup *backup;
    backup = sqlite3_backup_init(db->_handle, "main", handle2, "main");
    if (backup) {
        sqlite3_backup_step(backup, -1);
        sqlite3_backup_finish(backup);
        rc = sqlite3_errcode(db->_handle);
        errmsg = sqlite3_errmsg(db->_handle);
    }

    if (info[0]->IsString()) {
        sqlite3_close(handle2);
    }

    if (rc != SQLITE_OK) {
        Nan::ThrowError(errmsg.c_str());
    }
    NAN_RETURN(info.Holder());
}

void SQLiteStatement::Init(Handle<Object> target)
{
    Nan::HandleScope scope;

    v8::Local<v8::FunctionTemplate> t = Nan::New<v8::FunctionTemplate>(New);
    t->SetClassName(Nan::New("SQLiteStatement").ToLocalChecked());
    t->InstanceTemplate()->SetInternalFieldCount(1);

    Nan::SetPrototypeMethod(t, "prepare", Prepare);
    Nan::SetPrototypeMethod(t, "run", Run);
    Nan::SetPrototypeMethod(t, "runSync", RunSync);
    Nan::SetPrototypeMethod(t, "query", Query);
    Nan::SetPrototypeMethod(t, "querySync", QuerySync);
    Nan::SetPrototypeMethod(t, "each", Each);
    Nan::SetPrototypeMethod(t, "next", Next);
    Nan::SetPrototypeMethod(t, "finalize", Finalize);
    constructor.Reset(t->GetFunction());
    target->Set(Nan::New("SQLiteStatement").ToLocalChecked(), t->GetFunction());

    // For statements created within database, All, Run
    object_template = Persistent<ObjectTemplate>::New(ObjectTemplate::New());
    object_template->SetInternalFieldCount(1);
}

// { Database db, String sql, Function callback }
NAN_METHOD(SQLiteStatement::New)
{
    Nan::HandleScope scope;

    if (!info.IsConstructCall()) Nan::ThrowError("Use the new operator to create new Statement objects");

    if (info.Length() < 1 || !info[0]->IsObject()) return Nan::ThrowError("Database object expected");
    NAN_REQUIRE_ARGUMENT_STRING(1, sql);
    NAN_EXPECT_ARGUMENT_FUNCTION(2, callback);

    SQLiteDatabase* db = ObjectWrap::Unwrap < SQLiteDatabase > (info[0]->ToObject());
    SQLiteStatement* stmt = new SQLiteStatement(db, *sql);
    stmt->Wrap(info.Holder());
    info.Holder()->Set(Nan::New("sql").ToLocalChecked(), Nan::New(*sql).ToLocalChecked(), ReadOnly);
    stmt->op = "new";
    Baton* baton = new Baton(stmt, callback);
    uv_queue_work(uv_default_loop(), &baton->request, Work_Prepare, (uv_after_work_cb)Work_AfterPrepare);

    NAN_RETURN(info.Holder());
}

NAN_METHOD(SQLiteStatement::Prepare)
{
    Nan::HandleScope scope;
    SQLiteStatement* stmt = ObjectWrap::Unwrap < SQLiteStatement > (info.Holder());

    NAN_REQUIRE_ARGUMENT_STRING(0, sql);
    NAN_OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

    stmt->op = "prepare";
    stmt->sql = *sql;
    Baton* baton = new Baton(stmt, callback);
    uv_queue_work(uv_default_loop(), &baton->request, Work_Prepare, (uv_after_work_cb)Work_AfterPrepare);

    NAN_RETURN(info.Holder());
}

void SQLiteStatement::Work_Prepare(uv_work_t* req)
{
    Baton* baton = static_cast<Baton*>(req->data);
    baton->stmt->Prepare();
}

void SQLiteStatement::Work_AfterPrepare(uv_work_t* req)
{
    Nan::HandleScope scope;
    Baton* baton = static_cast<Baton*>(req->data);

    if (!baton->callback.IsEmpty() && baton->callback->IsFunction()) {
        Local < Value > argv[1];
        if (baton->stmt->status != SQLITE_OK) {
            EXCEPTION(baton->stmt->message.c_str(), baton->stmt->status, exception);
            argv[0] = exception;
        } else {
            argv[0] = Local < Value > ::New(Null());
        }
        NAN_TRY_CATCH_CALL(baton->stmt->handle(), baton->callback, 1, argv);
    } else
    if (baton->stmt->status != SQLITE_OK) {
        LogError("%s", baton->stmt->message.c_str());
    }
    delete baton;
}

NAN_METHOD(SQLiteStatement::Finalize)
{
    Nan::HandleScope scope;
    SQLiteStatement* stmt = ObjectWrap::Unwrap < SQLiteStatement > (info.Holder());

    stmt->Finalize();
    NAN_RETURN(info.Holder());
}

NAN_METHOD(SQLiteStatement::RunSync)
{
    Nan::HandleScope scope;
    SQLiteStatement* stmt = ObjectWrap::Unwrap < SQLiteStatement > (info.Holder());
    Row params;

    stmt->op = "runSync";
    ParseParameters(params, info, 0);
    if (BindParameters(params, stmt->_handle)) {
        stmt->status = sqlite3_step(stmt->_handle);

        if (!(stmt->status == SQLITE_ROW || stmt->status == SQLITE_DONE)) {
            stmt->message = string(sqlite3_errmsg(stmt->db->_handle));
        } else {
            stmt->handle()->Set(Nan::New("lastID").ToLocalChecked(), Nan::New((double)sqlite3_last_insert_rowid(stmt->db->_handle)));
            stmt->handle()->Set(Nan::New("changes").ToLocalChecked(), Nan::New((int)sqlite3_changes(stmt->db->_handle)));
            stmt->status = SQLITE_OK;
        }
    } else {
        stmt->message = string(sqlite3_errmsg(stmt->db->_handle));
    }

    if (stmt->status != SQLITE_OK) {
        Nan::ThrowError(stmt->message.c_str());
    }
    NAN_RETURN(info.Holder());
}

NAN_METHOD(SQLiteStatement::Run)
{
    Nan::HandleScope scope;
    SQLiteStatement* stmt = ObjectWrap::Unwrap < SQLiteStatement > (info.Holder());

    NAN_OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

    stmt->op = "run";
    Baton* baton = new Baton(stmt, callback);
    ParseParameters(baton->params, info, 0);

    uv_queue_work(uv_default_loop(), &baton->request, Work_Run, (uv_after_work_cb)Work_AfterRun);
    NAN_RETURN(info.Holder());
}

void SQLiteStatement::Work_Run(uv_work_t* req)
{
    Baton* baton = static_cast<Baton*>(req->data);

    if (BindParameters(baton->params, baton->stmt->_handle)) {
        baton->stmt->status = bkSqliteStep(baton->stmt->_handle, baton->stmt->db->retries, baton->stmt->db->timeout);

        if (!(baton->stmt->status == SQLITE_ROW || baton->stmt->status == SQLITE_DONE)) {
            baton->stmt->message = string(sqlite3_errmsg(baton->stmt->db->_handle));
        } else {
            baton->inserted_id = sqlite3_last_insert_rowid(baton->stmt->db->_handle);
            baton->changes = sqlite3_changes(baton->stmt->db->_handle);
            baton->stmt->status = SQLITE_OK;
        }
    } else {
        baton->stmt->message = string(sqlite3_errmsg(baton->stmt->db->_handle));
    }
}

void SQLiteStatement::Work_RunPrepare(uv_work_t* req)
{
    Baton* baton = static_cast<Baton*>(req->data);

    if (!baton->stmt->Prepare()) return;

    if (BindParameters(baton->params, baton->stmt->_handle)) {
        baton->stmt->status = bkSqliteStep(baton->stmt->_handle, baton->stmt->db->retries, baton->stmt->db->timeout);

        if (!(baton->stmt->status == SQLITE_ROW || baton->stmt->status == SQLITE_DONE)) {
            baton->stmt->message = string(sqlite3_errmsg(baton->stmt->db->_handle));
        } else {
            baton->inserted_id = sqlite3_last_insert_rowid(baton->stmt->db->_handle);
            baton->changes = sqlite3_changes(baton->stmt->db->_handle);
            baton->stmt->status = SQLITE_OK;
        }
    } else {
        baton->stmt->message = string(sqlite3_errmsg(baton->stmt->db->_handle));
    }
    baton->stmt->Finalize();
}

void SQLiteStatement::Work_AfterRun(uv_work_t* req)
{
    Nan::HandleScope scope;
    Baton* baton = static_cast<Baton*>(req->data);

    baton->stmt->handle()->Set(Nan::New("lastID").ToLocalChecked(), Nan::New((double)baton->inserted_id));
    baton->stmt->handle()->Set(Nan::New("changes").ToLocalChecked(), Nan::New(baton->changes));

    if (!baton->callback.IsEmpty() && baton->callback->IsFunction()) {
        Local < Value > argv[1];
        if (baton->stmt->status != SQLITE_OK) {
            EXCEPTION(baton->stmt->message.c_str(), baton->stmt->status, exception);
            argv[0] = exception;
        } else {
            argv[0] = Local < Value > ::New(Null());
        }
        NAN_TRY_CATCH_CALL(baton->stmt->handle(), baton->callback, 1, argv);
    } else
    if (baton->stmt->status != SQLITE_OK) {
        LogError("%s", baton->stmt->message.c_str());
    }
    delete baton;
}

NAN_METHOD(SQLiteStatement::QuerySync)
{
    Nan::HandleScope scope;
    SQLiteStatement* stmt = ObjectWrap::Unwrap < SQLiteStatement > (info.Holder());

    NAN_OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

    int n = 0;
    Row params;
    ParseParameters(params, info, 0);
    Local<Array> result(Array::New());
    stmt->op = "querySync";

    if (BindParameters(params, stmt->_handle)) {
        while ((stmt->status = sqlite3_step(stmt->_handle)) == SQLITE_ROW) {
            Local<Object> obj(GetRow(stmt->_handle));
            result->Set(Nan::New(n++), obj);
        }
        if (stmt->status != SQLITE_DONE) {
            stmt->message = string(sqlite3_errmsg(stmt->db->_handle));
        }
    } else {
        stmt->message = string(sqlite3_errmsg(stmt->db->_handle));
    }
    if (stmt->status != SQLITE_DONE) {
        Nan::ThrowError(stmt->message.c_str());
    }
    NAN_RETURN(result);
}

NAN_METHOD(SQLiteStatement::Query)
{
    Nan::HandleScope scope;
    SQLiteStatement* stmt = ObjectWrap::Unwrap < SQLiteStatement > (info.Holder());

    NAN_OPTIONAL_ARGUMENT_FUNCTION(-1, callback);
    Baton* baton = new Baton(stmt, callback);
    ParseParameters(baton->params, info, 0);
    stmt->op = "query";
    uv_queue_work(uv_default_loop(), &baton->request, Work_Query, (uv_after_work_cb)Work_AfterQuery);
    NAN_RETURN(info.Holder());
}

void SQLiteStatement::Work_Query(uv_work_t* req)
{
    Baton* baton = static_cast<Baton*>(req->data);

    if (BindParameters(baton->params, baton->stmt->_handle)) {
        while ((baton->stmt->status = bkSqliteStep(baton->stmt->_handle, baton->stmt->db->retries, baton->stmt->db->timeout)) == SQLITE_ROW) {
            Row row;
            GetRow(row, baton->stmt->_handle);
            baton->rows.push_back(row);
        }
        if (baton->stmt->status != SQLITE_DONE) {
            baton->stmt->message = string(sqlite3_errmsg(baton->stmt->db->_handle));
        }
    } else {
        baton->stmt->message = string(sqlite3_errmsg(baton->stmt->db->_handle));
    }
}

void SQLiteStatement::Work_QueryPrepare(uv_work_t* req)
{
    Baton* baton = static_cast<Baton*>(req->data);

    if (!baton->stmt->Prepare()) return;

    if (BindParameters(baton->params, baton->stmt->_handle)) {
        while ((baton->stmt->status = bkSqliteStep(baton->stmt->_handle, baton->stmt->db->retries, baton->stmt->db->timeout)) == SQLITE_ROW) {
            Row row;
            GetRow(row, baton->stmt->_handle);
            baton->rows.push_back(row);
        }
        if (baton->stmt->status != SQLITE_DONE) {
            baton->stmt->message = string(sqlite3_errmsg(baton->stmt->db->_handle));
        }
    } else {
        baton->stmt->message = string(sqlite3_errmsg(baton->stmt->db->_handle));
    }
    baton->stmt->Finalize();
}

void SQLiteStatement::Work_AfterQuery(uv_work_t* req)
{
    Nan::HandleScope scope;
    Baton* baton = static_cast<Baton*>(req->data);

    baton->stmt->handle()->Set(Nan::New("lastID").ToLocalChecked(), Nan::New((double)baton->inserted_id));
    baton->stmt->handle()->Set(Nan::New("changes").ToLocalChecked(), Nan::New(baton->changes));

    if (!baton->callback.IsEmpty() && baton->callback->IsFunction()) {
        if (baton->stmt->status != SQLITE_DONE) {
            EXCEPTION(baton->stmt->message.c_str(), baton->stmt->status, exception);
            Local<Value> argv[] = { exception, Local<Value>::New(Array::New(0)) };
            NAN_TRY_CATCH_CALL(baton->stmt->handle(), baton->callback, 2, argv);
        } else
        if (baton->rows.size()) {
            Local<Array> result(Array::New(baton->rows.size()));
            for (uint i = 0; i < baton->rows.size(); i++) {
                result->Set(i, RowToJS(baton->rows[i]));
            }
            Local<Value> argv[] = { Local<Value>::New(Null()), result };
            NAN_TRY_CATCH_CALL(baton->stmt->handle(), baton->callback, 2, argv);
        } else {
            Local<Value> argv[] = { Local<Value>::New(Null()), Local<Value>::New(Array::New(0)) };
            NAN_TRY_CATCH_CALL(baton->stmt->handle(), baton->callback, 2, argv);
        }
    } else
    if (baton->stmt->status != SQLITE_DONE) {
        LogError("%s", baton->stmt->message.c_str());
    }
    delete baton;
}

NAN_METHOD(SQLiteStatement::Each)
{
    Nan::HandleScope scope;
    SQLiteStatement* stmt = ObjectWrap::Unwrap < SQLiteStatement > (info.Holder());

    Local<Function> callback, completed;
    if (info.Length() >= 3 && info[info.Length() - 1]->IsFunction() && info[info.Length() - 2]->IsFunction()) {
        callback = Local<Function>::Cast(info[info.Length() - 2]);
        completed = Local<Function>::Cast(info[info.Length() - 1]);
    } else
    if (info.Length() >= 2 && info[info.Length() - 1]->IsFunction()) {
        callback = Local<Function>::Cast(info[info.Length() - 1]);
    }
    stmt->op = "each";
    if (stmt->each) delete stmt->each;
    stmt->each = new Baton(stmt, callback);
    stmt->each->completed = Persistent<Function>::New(completed);
    ParseParameters(stmt->each->params, info, 0);

    uv_queue_work(uv_default_loop(), &stmt->each->request, Work_Each, (uv_after_work_cb)Work_AfterEach);
    NAN_RETURN(info.Holder());
}

void SQLiteStatement::Next()
{
    Nan::HandleScope scope;
    if (!each) return;

    if (each->rows.size()) {
        Local<Value> argv[1] = { RowToJS(each->rows[0]) };
        each->rows.erase(each->rows.begin());
        NAN_TRY_CATCH_CALL(handle(), each->callback, 1, argv);
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
        NAN_TRY_CATCH_CALL(handle(), each->completed, 1, argv);
    }
    delete each;
    each = NULL;
}

NAN_METHOD(SQLiteStatement::Next)
{
    Nan::HandleScope scope;
    SQLiteStatement* stmt = ObjectWrap::Unwrap < SQLiteStatement > (info.Holder());

    stmt->Next();
}

void SQLiteStatement::Work_Each(uv_work_t* req)
{
    Baton* baton = static_cast<Baton*>(req->data);

    if (BindParameters(baton->params, baton->stmt->_handle)) {
        Work_EachNext(req);
    } else {
        baton->stmt->message = string(sqlite3_errmsg(baton->stmt->db->_handle));
    }
}

void SQLiteStatement::Work_EachNext(uv_work_t* req)
{
    Baton* baton = static_cast<Baton*>(req->data);

    while ((baton->stmt->status = bkSqliteStep(baton->stmt->_handle, baton->stmt->db->retries, baton->stmt->db->timeout)) == SQLITE_ROW) {
        Row row;
        GetRow(row, baton->stmt->_handle);
        baton->rows.push_back(row);
        if (baton->rows.size() >= 50) break;
    }
    if (baton->stmt->status != SQLITE_ROW && baton->stmt->status != SQLITE_DONE) {
        baton->stmt->message = string(sqlite3_errmsg(baton->stmt->db->_handle));
    }
}

void SQLiteStatement::Work_AfterEach(uv_work_t* req)
{
    Baton* baton = static_cast<Baton*>(req->data);
    baton->stmt->Next();
}
