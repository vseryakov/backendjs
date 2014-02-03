//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  April 2013
//

#include "node_backend.h"

#ifdef USE_MYSQL

#include <mysql.h>

#define MYSQL_MAX_BIND 99

#define EXCEPTION(msg, errno, name) \
        Local<Value> name = Exception::Error(String::New(msg)); \
        Local<Object> name ##_obj = name->ToObject(); \
        name ##_obj->Set(NODE_PSYMBOL("errno"), Integer::New(errno)); \
        name ##_obj->Set(NODE_PSYMBOL("code"), Integer::New(errno));

struct MysqlField {
    inline MysqlField(int _index, int _type = MYSQL_TYPE_NULL, double n = 0, string s = string()): type(_type), index(_index), ivalue(n), nvalue(n), svalue(s) {}
    inline MysqlField(const char *_name, int _type = MYSQL_TYPE_NULL, double n = 0, string s = string()): type(_type), index(0), name(_name), ivalue(n), nvalue(n), svalue(s) {}
    int type;
    int index;
    string name;
    int32_t ivalue;
    double nvalue;
    string svalue;
};

typedef vector<MysqlField> Row;
class MysqlStatement;

static map<MysqlStatement*,bool> _stmts;

class MysqlDatabase: public ObjectWrap {
public:
    static Persistent<FunctionTemplate> constructor_template;
    static void Init(Handle<Object> target);
    static inline bool HasInstance(Handle<Value> val) { return constructor_template->HasInstance(val); }

    struct Baton {
        uv_work_t request;
        MysqlDatabase* db;
        Persistent<Function> callback;
        int status;
        string message;
        string sparam;
        int iparam;
        int64_t inserted_id;
        int affected_rows;
        vector<Row> rows;

        Baton(MysqlDatabase* db_, Handle<Function> cb_, string s = "", int i = 0): db(db_), status(0), sparam(s), iparam(i) {
            db->Ref();
            request.data = this;
            callback = Persistent < Function > ::New(cb_);
        }
        virtual ~Baton() {
            db->Unref();
            callback.Dispose();
        }
    };

    friend class MysqlStatement;

    MysqlDatabase() : ObjectWrap(), handle(NULL) {}
    ~MysqlDatabase() { if (handle) mysql_close(handle); }

    static Handle<Value> New(const Arguments& args);
    static Handle<Value> OpenGetter(Local<String> str, const AccessorInfo& accessor);
    static Handle<Value> NameGetter(Local<String> str, const AccessorInfo& accessor);
    static Handle<Value> InsertedOidGetter(Local<String> str, const AccessorInfo& accessor);
    static Handle<Value> AffectedRowsGetter(Local<String> str, const AccessorInfo& accessor);

    static void Work_Open(uv_work_t* req);
    static void Work_AfterOpen(uv_work_t* req);

    static Handle<Value> QuerySync(const Arguments& args);
    static Handle<Value> Query(const Arguments& args);
    static Handle<Value> Exec(const Arguments& args);
    static void Work_Exec(uv_work_t* req);
    static void Work_AfterExec(uv_work_t* req);

    static Handle<Value> CloseSync(const Arguments& args);
    static Handle<Value> Close(const Arguments& args);
    static void Work_Close(uv_work_t* req);
    static void Work_AfterClose(uv_work_t* req);

    int64_t inserted_id;
    int affected_rows;

    MYSQL *handle;
    string db;
};

class MysqlStatement: public ObjectWrap {
public:
    static Persistent<FunctionTemplate> constructor_template;
    static Persistent<ObjectTemplate> object_template;

    static void Init(Handle<Object> target);
    static Handle<Value> New(const Arguments& args);
    static Handle<Value> SqlGetter(Local<String> str, const AccessorInfo& accessor);
    static inline bool HasInstance(Handle<Value> val) { return constructor_template->HasInstance(val); }
    static Handle<Object> Create(MysqlDatabase *db, string sql = string()) {
        Local<Object> obj = object_template->NewInstance();
        MysqlStatement* stmt = new MysqlStatement(db, sql);
        obj->SetInternalField(0, External::New(stmt));
        stmt->Wrap(obj);
        return obj;
    }

    struct Baton {
        uv_work_t request;
        MysqlStatement* stmt;
        Persistent<Function> callback;
        Persistent<Function> completed;
        Row params;
        vector<Row> rows;
        int64_t inserted_id;
        int affected_rows;
        string sql;

        Baton(MysqlStatement* stmt_, Handle<Function> cb_): stmt(stmt_), inserted_id(0), affected_rows(0), sql(stmt->sql)  {
            stmt->Ref();
            request.data = this;
            callback = Persistent < Function > ::New(cb_);
        }
        virtual ~Baton() {
            stmt->Unref();
            if (!callback.IsEmpty()) callback.Dispose();
            if (!completed.IsEmpty()) completed.Dispose();
        }
    };

    MysqlStatement(MysqlDatabase* db_, string sql_ = string()): ObjectWrap(), db(db_), handle(NULL), meta(NULL), sql(sql_), status(0), ncolumns(0) {
        db->Ref();
        _stmts[this] = 0;
        memset(bind, 0, sizeof(bind));
    }

    ~MysqlStatement() {
        Finalize();
        db->Unref();
        _stmts.erase(this);
    }

    void Finalize(void) {
        if (meta) mysql_free_result(meta);
        if (handle) mysql_stmt_close(handle);
        for (int i = 0;i < MYSQL_MAX_BIND; i++) {
            if (bind[i].buffer) free(bind[i].buffer);
        }
        memset(bind, 0, sizeof(bind));
        handle = NULL;
        meta = NULL;
    }

    bool Prepare() {
        handle = mysql_stmt_init(db->handle);
        if (mysql_stmt_prepare(handle, (const char*)sql.c_str(), sql.size())) goto err;

        ncolumns = mysql_stmt_field_count(handle);
        LogDev("%s, ncols=%d, nparams=%d", sql.c_str(), ncolumns, mysql_stmt_param_count(handle));
        if (ncolumns > 0) {
            meta = mysql_stmt_result_metadata(handle);
            if (!meta) goto err;

            for (int i = 0; i < ncolumns; i++) {
                MYSQL_FIELD *field = mysql_fetch_field_direct(meta, i);
                if (!field) goto err;

                bind[i].buffer_type = field->type;
                bind[i].length = &lengths[i];
                bind[i].is_null = &nulls[i];

                switch (field->type) {
                case MYSQL_TYPE_NULL:
                case MYSQL_TYPE_TINY:
                    bind[i].buffer_length = sizeof(signed char);
                    break;
                case MYSQL_TYPE_YEAR:
                case MYSQL_TYPE_SHORT:
                    bind[i].buffer_length = sizeof(short);
                    break;
                case MYSQL_TYPE_LONG:
                case MYSQL_TYPE_INT24:
                    bind[i].buffer_length = sizeof(int);
                    break;
                case MYSQL_TYPE_FLOAT:
                    bind[i].buffer_length = sizeof(float);
                    break;
                case MYSQL_TYPE_DOUBLE:
                    bind[i].buffer_length = sizeof(double);
                    break;
                case MYSQL_TYPE_LONGLONG:
                    bind[i].buffer_length = sizeof(long long);
                    break;
                case MYSQL_TYPE_DATE:
                case MYSQL_TYPE_TIME:
                case MYSQL_TYPE_NEWDATE:
                case MYSQL_TYPE_DATETIME:
                case MYSQL_TYPE_TIMESTAMP:
#if MYSQL_VERSION_ID >= 50615
                case MYSQL_TYPE_TIME2:
                case MYSQL_TYPE_DATETIME2:
                case MYSQL_TYPE_TIMESTAMP2:
#endif
                    bind[i].buffer_length = sizeof(MYSQL_TIME);
                    break;
                case MYSQL_TYPE_BLOB:
                case MYSQL_TYPE_TINY_BLOB:
                case MYSQL_TYPE_MEDIUM_BLOB:
                case MYSQL_TYPE_LONG_BLOB:
                case MYSQL_TYPE_DECIMAL:
                case MYSQL_TYPE_VARCHAR:
                case MYSQL_TYPE_BIT:
                case MYSQL_TYPE_NEWDECIMAL:
                case MYSQL_TYPE_ENUM:
                case MYSQL_TYPE_SET:
                case MYSQL_TYPE_VAR_STRING:
                case MYSQL_TYPE_STRING:
                case MYSQL_TYPE_GEOMETRY:
                default:
                    bind[i].buffer_length = sizeof(char) * field->length;
                }
                bind[i].buffer = malloc(bind[i].buffer_length);
            }
        }
        return true;
err:
        message = string(mysql_stmt_error(handle));
        status = mysql_stmt_errno(handle);
        Finalize();
        return false;
    }

    bool Bind(Row &params) {
        LogDev("%s, params=%d", sql.c_str(), mysql_stmt_param_count(handle));
        if (!params.size() || !mysql_stmt_param_count(handle)) return true;
        mysql_stmt_reset(handle);

        MYSQL_BIND pbind[MYSQL_MAX_BIND];
        memset(pbind, 0, sizeof(pbind));

        for (uint i = 0; i < params.size(); i++) {
            MysqlField &field = params[i];
            switch (field.type) {
            case MYSQL_TYPE_LONG:
                pbind[i].buffer = (char*)&field.ivalue;
                break;
            case MYSQL_TYPE_DOUBLE:
                pbind[i].buffer = (char*)&field.nvalue;
                break;
            case MYSQL_TYPE_STRING:
                pbind[i].buffer = (void*)field.svalue.c_str();
                pbind[i].buffer_length = field.svalue.size();
                break;
            case MYSQL_TYPE_BLOB:
                pbind[i].buffer = (void*)field.svalue.c_str();
                pbind[i].buffer_length = field.svalue.size();
                break;
            case MYSQL_TYPE_NULL:
                break;
            }
            pbind[i].buffer_type = (enum_field_types)field.type;
        }
        if (mysql_stmt_bind_param(handle, pbind)) {
            status = mysql_stmt_errno(handle);
            message = string(mysql_stmt_error(handle));
            return false;
        }
        return true;
    }

    void GetRow(Row &row) {
        row.clear();

        for (int i = 0; i < ncolumns; i++) {
            char *name = meta->fields[i].name;
            int type = meta->fields[i].type;
            if (nulls[i]) {
                row.push_back(MysqlField(name));
                continue;
            }
            string sval;
            double dval = 0;
            MYSQL_TIME tval;
            switch (type) {
            case MYSQL_TYPE_NULL:
            case MYSQL_TYPE_TINY:
                dval = *((signed char *) bind[i].buffer);
                type = MYSQL_TYPE_LONG;
                break;
            case MYSQL_TYPE_YEAR:
            case MYSQL_TYPE_SHORT:
                dval = *((short *) bind[i].buffer);
                type = MYSQL_TYPE_LONG;
                break;
            case MYSQL_TYPE_LONG:
            case MYSQL_TYPE_INT24:
                dval = *((int32_t *) bind[i].buffer);
                type = MYSQL_TYPE_LONG;
                break;
            case MYSQL_TYPE_FLOAT:
                dval = *((float *) bind[i].buffer);
                type = MYSQL_TYPE_DOUBLE;
                break;
            case MYSQL_TYPE_DOUBLE:
                dval = *((double *) bind[i].buffer);
                type = MYSQL_TYPE_DOUBLE;
                break;
            case MYSQL_TYPE_LONGLONG:
                dval = *((long long *) bind[i].buffer);
                type = MYSQL_TYPE_DOUBLE;
                break;
            case MYSQL_TYPE_DATE:
            case MYSQL_TYPE_TIME:
            case MYSQL_TYPE_DATETIME:
            case MYSQL_TYPE_NEWDATE:
            case MYSQL_TYPE_TIMESTAMP:
#if MYSQL_VERSION_ID >= 50615
            case MYSQL_TYPE_TIMESTAMP2:
            case MYSQL_TYPE_DATETIME2:
            case MYSQL_TYPE_TIME2:
#endif
                tval = *((MYSQL_TIME *) bind[i].buffer);
                sval = vFmtStr("%04d-%02d-%02d %02d:%02d:%02d GMT", tval.year, tval.month, tval.day, tval.hour, tval.minute, tval.second);
                type = MYSQL_TYPE_STRING;
                break;
            case MYSQL_TYPE_BLOB:
            case MYSQL_TYPE_TINY_BLOB:
            case MYSQL_TYPE_MEDIUM_BLOB:
            case MYSQL_TYPE_LONG_BLOB:
                sval = string((char*)bind[i].buffer, lengths[i]);
                type = meta->fields[i].flags & BINARY_FLAG ? MYSQL_TYPE_BLOB : MYSQL_TYPE_STRING;
                break;
            case MYSQL_TYPE_SET:
                break;
            case MYSQL_TYPE_DECIMAL:
            case MYSQL_TYPE_VARCHAR:
            case MYSQL_TYPE_BIT:
            case MYSQL_TYPE_NEWDECIMAL:
            case MYSQL_TYPE_ENUM:
            case MYSQL_TYPE_VAR_STRING:
            case MYSQL_TYPE_STRING:
            case MYSQL_TYPE_GEOMETRY:
            default:
                sval = string((char*)bind[i].buffer, lengths[i]);
                type = meta->fields[i].flags & BINARY_FLAG ? MYSQL_TYPE_BLOB : MYSQL_TYPE_STRING;
            }
            row.push_back(MysqlField(name, type, dval, sval));
        }
    }

    bool Execute() {
        status = mysql_stmt_execute(handle);
        if (!status) {
            if (mysql_stmt_field_count(handle)) {
                status = mysql_stmt_bind_result(handle, bind);
            }
            if (!status) status = mysql_stmt_store_result(handle);
        }
        if (status) {
            status = mysql_stmt_errno(handle);
            message = string(mysql_stmt_error(handle));
            return false;
        }
        return true;
    }
    Handle<Value> querySync(const Arguments& args, int idx = 0);

    static Handle<Value> Finalize(const Arguments& args);

    static Handle<Value> Prepare(const Arguments& args);
    static void Work_Prepare(uv_work_t* req);
    static void Work_AfterPrepare(uv_work_t* req);

    static Handle<Value> QuerySync(const Arguments& args);
    static Handle<Value> Query(const Arguments& args);
    static void Work_Query(uv_work_t* req);
    static void Work_QueryPrepare(uv_work_t* req);
    static void Work_AfterQuery(uv_work_t* req);

    MysqlDatabase* db;
    MYSQL_STMT* handle;
    MYSQL_RES *meta;
    string sql;
    string op;
    int status;
    int ncolumns;
    string message;
    MYSQL_BIND bind[MYSQL_MAX_BIND];
    unsigned long lengths[MYSQL_MAX_BIND];
    my_bool nulls[MYSQL_MAX_BIND];
};

Persistent<FunctionTemplate> MysqlDatabase::constructor_template;
Persistent<FunctionTemplate> MysqlStatement::constructor_template;
Persistent<ObjectTemplate> MysqlStatement::object_template;
#endif

void MysqlInit(Handle<Object> target)
{
#ifdef USE_MYSQL
    HandleScope scope;
    mysql_library_init(0, NULL, NULL);

    MysqlDatabase::Init(target);
    MysqlStatement::Init(target);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_OPT_CONNECT_TIMEOUT, CONNECT_TIMEOUT);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_OPT_COMPRESS, COMPRESS);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_OPT_NAMED_PIPE, NAMED_PIPE);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_INIT_COMMAND, INIT_COMMAND);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_READ_DEFAULT_FILE, DEFAULT_FILE);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_READ_DEFAULT_GROUP, DEFAULT_GROUP);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_SET_CHARSET_DIR, SET_CHARSET_DIR);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_SET_CHARSET_NAME, SET_CHARSET_NAME);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_OPT_LOCAL_INFILE, LOCAL_INFILE);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_OPT_PROTOCOL, PROTOCL);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_SHARED_MEMORY_BASE_NAME, SHARED_MEMORY_BASE_NAME);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_OPT_READ_TIMEOUT, READ_TIMEOUT);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_OPT_WRITE_TIMEOUT, WRITE_TIMEOUT);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_OPT_USE_RESULT, USE_RESULT);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_OPT_USE_REMOTE_CONNECTION, USE_REMOTE_CONNECTION);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_OPT_USE_EMBEDDED_CONNECTION, USE_EMBEDDED_CONNECTION);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_OPT_GUESS_CONNECTION, GUESS_CONNECTION);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_SET_CLIENT_IP, SET_CLIENT_IP);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_SECURE_AUTH, SECURE_AUTH);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_REPORT_DATA_TRUNCATION, REPORT_DATA_TRUNCATION);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_OPT_RECONNECT, RECONNECT);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_OPT_SSL_VERIFY_SERVER_CERT, SSL_VERIFY_SERVER_CERT);
    DEFINE_CONSTANT_INTEGER(target, CLIENT_LONG_PASSWORD, CLIENT_LONG_PASSWORD);
    DEFINE_CONSTANT_INTEGER(target, CLIENT_FOUND_ROWS, CLIENT_FOUND_ROWS);
    DEFINE_CONSTANT_INTEGER(target, CLIENT_LONG_FLAG, CLIENT_LONG_FLAG);
    DEFINE_CONSTANT_INTEGER(target, CLIENT_CONNECT_WITH_DB, CLIENT_CONNECT_WITH_DB);
    DEFINE_CONSTANT_INTEGER(target, CLIENT_NO_SCHEMA, CLIENT_NO_SCHEMA);
    DEFINE_CONSTANT_INTEGER(target, CLIENT_COMPRESS, CLIENT_COMPRESS);
    DEFINE_CONSTANT_INTEGER(target, CLIENT_ODBC, CLIENT_ODBC);
    DEFINE_CONSTANT_INTEGER(target, CLIENT_LOCAL_FILES, CLIENT_LOCAL_FILES);
    DEFINE_CONSTANT_INTEGER(target, CLIENT_IGNORE_SPACE, CLIENT_IGNORE_SPACE);
    DEFINE_CONSTANT_INTEGER(target, CLIENT_PROTOCOL_41, CLIENT_PROTOCOL_41);
    DEFINE_CONSTANT_INTEGER(target, CLIENT_INTERACTIVE, CLIENT_INTERACTIVE);
    DEFINE_CONSTANT_INTEGER(target, CLIENT_SSL, CLIENT_SSL);
    DEFINE_CONSTANT_INTEGER(target, CLIENT_IGNORE_SIGPIPE, CLIENT_IGNORE_SIGPIPE);
    DEFINE_CONSTANT_INTEGER(target, CLIENT_TRANSACTIONS, CLIENT_TRANSACTIONS);
    DEFINE_CONSTANT_INTEGER(target, CLIENT_RESERVED, CLIENT_RESERVED);
    DEFINE_CONSTANT_INTEGER(target, CLIENT_SECURE_CONNECTION, CLIENT_SECURE_CONNECTION);
    DEFINE_CONSTANT_INTEGER(target, CLIENT_MULTI_STATEMENTS, CLIENT_MULTI_STATEMENTS);
    DEFINE_CONSTANT_INTEGER(target, CLIENT_MULTI_RESULTS, CLIENT_MULTI_RESULTS);

#if MYSQL_VERSION_ID >= 50615
    DEFINE_CONSTANT_INTEGER(target, MYSQL_PLUGIN_DIR, PLUGIN_DIR);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_DEFAULT_AUTH, DEFAULT_AUTH);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_OPT_BIND, BIND);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_OPT_SSL_KEY, SSL_KEY);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_OPT_SSL_CERT, SL_CERT);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_OPT_SSL_CA, SSL_CA);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_OPT_SSL_CAPATH, SSL_CAPATH);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_OPT_SSL_CIPHER, SSL_CIPHER);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_OPT_SSL_CRL, SSL_CRL);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_OPT_SSL_CRLPATH, SSL_CRLPATH);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_OPT_CONNECT_ATTR_RESET, CONNECT_ATTR_RESET);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_OPT_CONNECT_ATTR_ADD, CONNECT_ATTR_ADD);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_OPT_CONNECT_ATTR_DELETE, CONNECT_ATTR_DELETE);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_SERVER_PUBLIC_KEY, SERVER_PUBLIC_KEY);
    DEFINE_CONSTANT_INTEGER(target, MYSQL_ENABLE_CLEARTEXT_PLUGIN, ENABLE_CLEARTEXT_PLUGIN)
    DEFINE_CONSTANT_INTEGER(target, MYSQL_OPT_CAN_HANDLE_EXPIRED_PASSWORDS, CAN_HANDLE_EXPIRED_PASSWORDS);
    DEFINE_CONSTANT_INTEGER(target, CLIENT_PS_MULTI_RESULTS, CLIENT_PS_MULTI_RESULTS);
#endif

#endif
}

#ifdef USE_MYSQL
static Handle<Value> listStatements(const Arguments& args)
{
    HandleScope scope;

    Local<Array> keys = Array::New();
    map<MysqlStatement*,bool>::const_iterator it = _stmts.begin();
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

void MysqlDatabase::Init(Handle<Object> target)
{
    HandleScope scope;

    NODE_SET_METHOD(target, "listStatements", listStatements);

    Local < FunctionTemplate > t = FunctionTemplate::New(New);
    constructor_template = Persistent < FunctionTemplate > ::New(t);
    constructor_template->InstanceTemplate()->SetInternalFieldCount(1);
    constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("open"), OpenGetter);
    constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("name"), NameGetter);
    constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("inserted_oid"), InsertedOidGetter);
    constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("affected_rows"), AffectedRowsGetter);
    constructor_template->SetClassName(String::NewSymbol("MysqlDatabase"));

    NODE_SET_PROTOTYPE_METHOD(constructor_template, "close", Close);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "closeSync", CloseSync);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "exec", Exec);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "query", Query);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "querySync", QuerySync);

    target->Set(String::NewSymbol("MysqlDatabase"), constructor_template->GetFunction());
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
            params.push_back(MysqlField(pos, MYSQL_TYPE_STRING, 0, string(*val, val.length())));
        } else
        if (source->IsInt32()) {
            params.push_back(MysqlField(pos, MYSQL_TYPE_LONG, source->Int32Value()));
        } else
        if (source->IsNumber()) {
            params.push_back(MysqlField(pos, MYSQL_TYPE_DOUBLE, source->NumberValue()));
        } else
        if (source->IsBoolean()) {
            params.push_back(MysqlField(pos, MYSQL_TYPE_LONG, source->BooleanValue() ? 1 : 0));
        } else
        if (source->IsNull()) {
            params.push_back(MysqlField(pos));
        } else
        if (Buffer::HasInstance(source)) {
            Local < Object > buffer = source->ToObject();
            params.push_back(MysqlField(pos, MYSQL_TYPE_BLOB, 0, string(Buffer::Data(buffer), Buffer::Length(buffer))));
        } else
        if (source->IsDate()) {
            params.push_back(MysqlField(pos, MYSQL_TYPE_DOUBLE, source->NumberValue()));
        } else
        if (source->IsObject()) {
        	params.push_back(MysqlField(pos, MYSQL_TYPE_STRING, 0, jsonStringify(source)));
        } else
        if (source->IsUndefined()) {
            params.push_back(MysqlField(pos));
        }
    }
    return true;
}

static Local<Object> RowToJS(Row &row)
{
    HandleScope scope;

    Local<Object> result(Object::New());
    for (uint i = 0; i < row.size(); i++) {
        MysqlField &field = row[i];
        Buffer *buffer;
        Local<Value> value;
        switch (field.type) {
        case MYSQL_TYPE_LONG:
            value = Local<Value>(Number::New(field.nvalue));
            break;
        case MYSQL_TYPE_DOUBLE:
            value = Local<Value>(Number::New(field.nvalue));
            break;
        case MYSQL_TYPE_STRING:
            value = Local<Value>(String::New(field.svalue.c_str(), field.svalue.size()));
            break;
        case MYSQL_TYPE_BLOB:
            buffer = Buffer::New(field.svalue.c_str(), field.svalue.size());
            value = Local<Value>::New(buffer->handle_);
            break;
        case MYSQL_TYPE_NULL:
            value = Local<Value>::New(Null());
            break;
        }
        result->Set(String::NewSymbol(field.name.c_str()), value);
    }
    row.clear();
    return scope.Close(result);
}

Handle<Value> MysqlDatabase::OpenGetter(Local<String> str, const AccessorInfo& accessor)
{
    HandleScope scope;
    MysqlDatabase* db = ObjectWrap::Unwrap < MysqlDatabase > (accessor.This());
    return Boolean::New(db->handle != NULL);
}

Handle<Value> MysqlDatabase::NameGetter(Local<String> str, const AccessorInfo& accessor)
{
    HandleScope scope;
    MysqlDatabase* db = ObjectWrap::Unwrap < MysqlDatabase > (accessor.This());
    return String::New(db->db.c_str());
}

Handle<Value> MysqlDatabase::InsertedOidGetter(Local<String> str, const AccessorInfo& accessor)
{
    HandleScope scope;
    MysqlDatabase* db = ObjectWrap::Unwrap < MysqlDatabase > (accessor.This());
    return Integer::New(db->inserted_id);
}

Handle<Value> MysqlDatabase::AffectedRowsGetter(Local<String> str, const AccessorInfo& accessor)
{
    HandleScope scope;
    MysqlDatabase* db = ObjectWrap::Unwrap < MysqlDatabase > (accessor.This());
    return Integer::New(db->affected_rows);
}

Handle<Value> MysqlDatabase::New(const Arguments& args)
{
    HandleScope scope;

    if (!args.IsConstructCall()) return ThrowException(Exception::TypeError(String::New("Use the new operator to create new Database objects")));

    REQUIRE_ARGUMENT_STRING(0, info);
    int arg = 1, mode = 0;
    if (args.Length() >= arg && args[arg]->IsInt32()) mode = args[arg++]->Int32Value();

    Local < Function > callback;
    if (args.Length() >= arg && args[arg]->IsFunction()) callback = Local < Function > ::Cast(args[arg]);

    MysqlDatabase* db = new MysqlDatabase();
    db->Wrap(args.This());
    Baton* baton = new Baton(db, callback, *info, mode);

    if (!callback.IsEmpty()) {
        uv_queue_work(uv_default_loop(), &baton->request, Work_Open, (uv_after_work_cb)Work_AfterOpen);
    } else {
        Work_Open(&baton->request);
        if (!db->handle) {
            string errmsg = baton->message;
            delete baton;
            return ThrowException(Exception::Error(String::New(errmsg.c_str())));
        }
        delete baton;
    }
    return args.This();
}

void MysqlDatabase::Work_Open(uv_work_t* req)
{
    Baton* baton = static_cast<Baton*>(req->data);
    // Parse connection URL in the form: mysql://user:pass@host:port/dbname
    char *host = NULL, *user = NULL, *pass = NULL, *db = NULL, *sock = NULL, *port = NULL;
    char *s = strstr((char*)baton->sparam.c_str(), "://");
    if (s) {
        s += 3;
        db = strchr(s, '/');
        if (db) *db++ = 0;
        host = strchr(s, '@');
        if (host) {
            *host++ = 0;
            port = strchr(host, ':');
            if (port) *port++ = 0;
        }
        pass = strchr(s, ':');
        if (pass) *pass++ = 0;
        if (*s) user = s;
    }
    char *home = getenv("HOME");
    if (!home) home = (char*)".";
    string conf = vFmtStr("%s/.my.cnf", home);
    my_bool reconnect = true;
    if (db) baton->db->db = db;
    baton->db->handle = mysql_init(NULL);
    mysql_options(baton->db->handle, MYSQL_READ_DEFAULT_FILE, conf.c_str());
    mysql_options(baton->db->handle, MYSQL_READ_DEFAULT_GROUP, "client");
    mysql_options(baton->db->handle, MYSQL_OPT_RECONNECT, &reconnect);
    baton->status = mysql_real_connect(baton->db->handle, host, user, pass, db, atoi(port?port:"0"), sock, baton->iparam) ? 0 : -1;
    if (baton->status != 0) {
        baton->message = string(mysql_error(baton->db->handle));
        baton->status = mysql_errno(baton->db->handle);
        mysql_close(baton->db->handle);
        baton->db->handle = NULL;
    }
}

void MysqlDatabase::Work_AfterOpen(uv_work_t* req)
{
    HandleScope scope;
    Baton* baton = static_cast<Baton*>(req->data);

    if (!baton->callback.IsEmpty() && baton->callback->IsFunction()) {
        Local < Value > argv[1];
        if (baton->status != 0) {
            EXCEPTION(baton->message.c_str(), baton->status, exception);
            argv[0] = exception;
        } else {
            argv[0] = Local < Value > ::New(Null());
        }
        TRY_CATCH_CALL(baton->db->handle_, baton->callback, 1, argv);
    } else
    if (baton->status != 0) {
        LogError("%s", baton->message.c_str());
    }
    delete baton;
}

Handle<Value> MysqlDatabase::CloseSync(const Arguments& args)
{
    HandleScope scope;
    MysqlDatabase* db = ObjectWrap::Unwrap < MysqlDatabase > (args.This());
    EXPECT_ARGUMENT_FUNCTION(0, callback);

    mysql_close(db->handle);
    return args.This();
}


Handle<Value> MysqlDatabase::Close(const Arguments& args)
{
    HandleScope scope;
    MysqlDatabase* db = ObjectWrap::Unwrap < MysqlDatabase > (args.This());
    EXPECT_ARGUMENT_FUNCTION(0, callback);

    Baton* baton = new Baton(db, callback);
    uv_queue_work(uv_default_loop(), &baton->request, Work_Close, (uv_after_work_cb)Work_AfterClose);

    return args.This();
}

void MysqlDatabase::Work_Close(uv_work_t* req)
{
    Baton* baton = static_cast<Baton*>(req->data);

    mysql_close(baton->db->handle);
    baton->db->handle = NULL;
}

void MysqlDatabase::Work_AfterClose(uv_work_t* req)
{
    HandleScope scope;
    Baton* baton = static_cast<Baton*>(req->data);

    if (!baton->callback.IsEmpty() && baton->callback->IsFunction()) {
        Local < Value > argv[1];
        if (baton->status != 0) {
            EXCEPTION(baton->message.c_str(), baton->status, exception);
            argv[0] = exception;
        } else {
            argv[0] = Local < Value > ::New(Null());
        }
        TRY_CATCH_CALL(baton->db->handle_, baton->callback, 1, argv);
    } else
    if (baton->status != 0) {
        LogError("%s", baton->message.c_str());
    }
    delete baton;
}

Handle<Value> MysqlDatabase::QuerySync(const Arguments& args)
{
    HandleScope scope;
    MysqlDatabase *db = ObjectWrap::Unwrap < MysqlDatabase > (args.This());

    REQUIRE_ARGUMENT_STRING(0, sql);

    Local<Object> obj = Local<Object>::New(MysqlStatement::Create(db, *sql));
    MysqlStatement* stmt = ObjectWrap::Unwrap < MysqlStatement > (obj);
    Local<Value> rc = Local<Value>::New(stmt->querySync(args, 1));

    return scope.Close(rc);
}

Handle<Value> MysqlDatabase::Query(const Arguments& args)
{
    HandleScope scope;
    MysqlDatabase* db = ObjectWrap::Unwrap < MysqlDatabase > (args.This());

    REQUIRE_ARGUMENT_STRING(0, sql);
    OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

    Local<Object> obj = Local<Object>::New(MysqlStatement::Create(db, *sql));
    MysqlStatement* stmt = ObjectWrap::Unwrap < MysqlStatement > (obj);
    MysqlStatement::Baton* baton = new MysqlStatement::Baton(stmt, callback);
    ParseParameters(baton->params, args, 1);
    uv_queue_work(uv_default_loop(), &baton->request, MysqlStatement::Work_QueryPrepare, (uv_after_work_cb)MysqlStatement::Work_AfterQuery);

    return scope.Close(obj);
}

Handle<Value> MysqlDatabase::Exec(const Arguments& args)
{
    HandleScope scope;
    MysqlDatabase* db = ObjectWrap::Unwrap < MysqlDatabase > (args.This());

    REQUIRE_ARGUMENT_STRING(0, sql);
    EXPECT_ARGUMENT_FUNCTION(1, callback);

    Baton* baton = new Baton(db, callback, *sql);
    uv_queue_work(uv_default_loop(), &baton->request, Work_Exec, (uv_after_work_cb)Work_AfterExec);

    return args.This();
}

void MysqlDatabase::Work_Exec(uv_work_t* req)
{
    Baton* baton = static_cast<Baton*>(req->data);

    baton->status = mysql_query(baton->db->handle, baton->sparam.c_str());
    if (baton->status != 0) {
        baton->message = mysql_error(baton->db->handle);
        baton->status = mysql_errno(baton->db->handle);
        return;
    }

    MYSQL_ROW rec;
    MYSQL_RES *result = mysql_store_result(baton->db->handle);
    if (result) {
        MYSQL_FIELD *fields = mysql_fetch_fields(result);
        int ncols = mysql_num_fields(result);
        while ((rec = mysql_fetch_row(result))) {
            unsigned long *lengths = mysql_fetch_lengths(result);
            Row row;
            for (int i = 0; i < ncols; i++) {
                row.push_back(MysqlField(fields[i].name, rec[i] ? MYSQL_TYPE_STRING : MYSQL_TYPE_NULL, 0, string(rec[i], lengths[i])));
            }
            baton->rows.push_back(row);
        }
        mysql_free_result(result);
    } else {
        baton->inserted_id = mysql_insert_id(baton->db->handle);
        baton->affected_rows = mysql_affected_rows(baton->db->handle);
    }
}

void MysqlDatabase::Work_AfterExec(uv_work_t* req)
{
    HandleScope scope;
    Baton* baton = static_cast<Baton*>(req->data);

    baton->db->inserted_id = baton->inserted_id;
    baton->db->affected_rows = baton->affected_rows;

    if (!baton->callback.IsEmpty() && baton->callback->IsFunction()) {
        if (baton->status != 0) {
            EXCEPTION(baton->message.c_str(), baton->status, exception);
            Local<Value> argv[] = { exception, Local<Value>::New(Array::New(0)) };
            TRY_CATCH_CALL(baton->db->handle_, baton->callback, 2, argv);
        } else
        if (baton->rows.size()) {
            Local<Array> result(Array::New(baton->rows.size()));
            for (uint i = 0; i < baton->rows.size(); i++) {
                result->Set(i, RowToJS(baton->rows[i]));
            }
            Local<Value> argv[] = { Local<Value>::New(Null()), result };
            TRY_CATCH_CALL(baton->db->handle_, baton->callback, 2, argv);
        } else {
            Local<Value> argv[] = { Local<Value>::New(Null()), Local<Value>::New(Array::New(0)) };
            TRY_CATCH_CALL(baton->db->handle_, baton->callback, 2, argv);
        }
    } else
    if (baton->status != 0) {
        LogError("%s", baton->message.c_str());
    }
    delete baton;
}

void MysqlStatement::Init(Handle<Object> target)
{
    HandleScope scope;

    Local < FunctionTemplate > t = FunctionTemplate::New(New);

    constructor_template = Persistent < FunctionTemplate > ::New(t);
    constructor_template->InstanceTemplate()->SetInternalFieldCount(1);
    constructor_template->SetClassName(String::NewSymbol("Statement"));

    NODE_SET_PROTOTYPE_METHOD(constructor_template, "prepare", Prepare);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "query", Query);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "querySync", QuerySync);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "finalize", Finalize);

    target->Set(String::NewSymbol("MysqlStatement"), constructor_template->GetFunction());

    // For statements created within database, All, Run
    object_template = Persistent<ObjectTemplate>::New(ObjectTemplate::New());
    object_template->SetInternalFieldCount(1);
}

// { Database db, String sql, Function callback }
Handle<Value> MysqlStatement::New(const Arguments& args)
{
    HandleScope scope;

    if (!args.IsConstructCall()) return ThrowException(Exception::TypeError(String::New("Use the new operator to create new Statement objects")));

    if (args.Length() < 1 || !MysqlDatabase::HasInstance(args[0])) return ThrowException(Exception::TypeError(String::New("Database object expected")));
    REQUIRE_ARGUMENT_STRING(1, sql);
    EXPECT_ARGUMENT_FUNCTION(2, callback);

    MysqlDatabase* db = ObjectWrap::Unwrap < MysqlDatabase > (args[0]->ToObject());
    MysqlStatement* stmt = new MysqlStatement(db, *sql);
    stmt->Wrap(args.This());
    args.This()->Set(String::NewSymbol("sql"), String::New(*sql), ReadOnly);
    stmt->op = "new";
    Baton* baton = new Baton(stmt, callback);
    uv_queue_work(uv_default_loop(), &baton->request, Work_Prepare, (uv_after_work_cb)Work_AfterPrepare);

    return args.This();
}

Handle<Value> MysqlStatement::Prepare(const Arguments& args)
{
    HandleScope scope;
    MysqlStatement* stmt = ObjectWrap::Unwrap < MysqlStatement > (args.This());

    REQUIRE_ARGUMENT_STRING(0, sql);
    OPTIONAL_ARGUMENT_FUNCTION(-1, callback);

    stmt->op = "prepare";
    stmt->sql = *sql;
    Baton* baton = new Baton(stmt, callback);
    uv_queue_work(uv_default_loop(), &baton->request, Work_Prepare, (uv_after_work_cb)Work_AfterPrepare);

    return args.This();
}

void MysqlStatement::Work_Prepare(uv_work_t* req)
{
    Baton* baton = static_cast<Baton*>(req->data);
    baton->stmt->Prepare();
}

void MysqlStatement::Work_AfterPrepare(uv_work_t* req)
{
    HandleScope scope;
    Baton* baton = static_cast<Baton*>(req->data);

    if (!baton->callback.IsEmpty() && baton->callback->IsFunction()) {
        Local < Value > argv[1];
        if (baton->stmt->status != 0) {
            EXCEPTION(baton->stmt->message.c_str(), baton->stmt->status, exception);
            argv[0] = exception;
        } else {
            argv[0] = Local < Value > ::New(Null());
        }
        TRY_CATCH_CALL(baton->stmt->handle_, baton->callback, 1, argv);
    } else
    if (baton->stmt->status != 0) {
        LogError("%s", baton->stmt->message.c_str());
    }
    delete baton;
}

Handle<Value> MysqlStatement::Finalize(const Arguments& args)
{
    HandleScope scope;
    MysqlStatement* stmt = ObjectWrap::Unwrap < MysqlStatement > (args.This());

    stmt->Finalize();
    return args.This();
}

Handle<Value> MysqlStatement::QuerySync(const Arguments& args)
{
    HandleScope scope;
    MysqlStatement* stmt = ObjectWrap::Unwrap < MysqlStatement > (args.This());
    return stmt->querySync(args);
}

Handle<Value> MysqlStatement::querySync(const Arguments& args, int idx)
{
    HandleScope scope;

    OPTIONAL_ARGUMENT_FUNCTION(-1, callback);
    op = "querySync";

    Baton baton(this, callback);
    ParseParameters(baton.params, args, idx);
    Prepare();
    if (status != 0) {
        return ThrowException(Exception::Error(String::New(message.c_str())));
    }
    Work_Query(&baton.request);
    if (status != 0) {
        return ThrowException(Exception::Error(String::New(message.c_str())));
    }
    db->inserted_id = baton.inserted_id;
    db->affected_rows = baton.affected_rows;
    Local<Array> result(Array::New(baton.rows.size()));
    for (uint i = 0; i < baton.rows.size(); i++) {
        result->Set(i, RowToJS(baton.rows[i]));
    }
    return scope.Close(result);
}

Handle<Value> MysqlStatement::Query(const Arguments& args)
{
    HandleScope scope;
    MysqlStatement* stmt = ObjectWrap::Unwrap < MysqlStatement > (args.This());

    OPTIONAL_ARGUMENT_FUNCTION(-1, callback);
    stmt->op = "query";

    Baton* baton = new Baton(stmt, callback);
    ParseParameters(baton->params, args, 0);
    uv_queue_work(uv_default_loop(), &baton->request, Work_Query, (uv_after_work_cb)Work_AfterQuery);
    return args.This();
}

void MysqlStatement::Work_Query(uv_work_t* req)
{
    Baton* baton = static_cast<Baton*>(req->data);

    if (baton->stmt->Bind(baton->params)) {
        if (baton->stmt->Execute()) {
            if (baton->stmt->meta) {
                while (!(baton->stmt->status = mysql_stmt_fetch(baton->stmt->handle))) {
                    Row row;
                    baton->stmt->GetRow(row);
                    baton->rows.push_back(row);
                }
            }
            if (baton->stmt->status != 0 && baton->stmt->status != MYSQL_NO_DATA) {
                baton->stmt->message = string(mysql_stmt_error(baton->stmt->handle));
                baton->stmt->status = mysql_stmt_errno(baton->stmt->handle);
            } else {
                baton->stmt->status = 0;
            }
            baton->inserted_id = mysql_insert_id(baton->stmt->db->handle);
            baton->affected_rows = mysql_affected_rows(baton->stmt->db->handle);
        }
    }
    baton->stmt->Finalize();
}

void MysqlStatement::Work_QueryPrepare(uv_work_t* req)
{
    Baton* baton = static_cast<Baton*>(req->data);

    if (baton->stmt->Prepare()) Work_Query(req);
}

void MysqlStatement::Work_AfterQuery(uv_work_t* req)
{
    HandleScope scope;
    Baton* baton = static_cast<Baton*>(req->data);

    baton->stmt->db->inserted_id = baton->inserted_id;
    baton->stmt->db->affected_rows = baton->affected_rows;

    if (!baton->callback.IsEmpty() && baton->callback->IsFunction()) {
        if (baton->stmt->status != 0) {
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
    if (baton->stmt->status != 0) {
        LogError("%s", baton->stmt->message.c_str());
    }
    delete baton;
}
#endif
