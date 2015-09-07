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

#define OPTIONAL_ARGUMENT_FUNCTION(i, var) Local<Function> var; \
        if (args.Length() > 0 && args.Length() > (i) && args[(i) >= 0 ? (i) : args.Length() - 1]->IsFunction()) \
        var = Local<Function>::Cast(args[(i) >= 0 ? (i) : args.Length() - 1]);

#define OPTIONAL_ARGUMENT_INT(i, var) int var = (args.Length() > (i) && args[i]->IsInt32() ? args[i]->Int32Value() : 0);
#define OPTIONAL_ARGUMENT_AS_INT(i, var) int var = (args.Length() > (i) ? args[i]->Int32Value() : 0);
#define OPTIONAL_ARGUMENT_INT2(i, var, dflt) int var = (args.Length() > (i) && args[i]->IsInt32() ? args[i]->Int32Value() : dflt);
#define OPTIONAL_ARGUMENT_NUMBER(i, var) float var = (args.Length() > (i) && args[i]->IsNumber() ? args[i]->NumberValue() : 0);
#define OPTIONAL_ARGUMENT_STRING(i, var) String::Utf8Value var(args.Length() > (i) && args[i]->IsString() ? args[i]->ToString() : String::New(""));
#define OPTIONAL_ARGUMENT_STRING2(i, var, dflt) String::Utf8Value var(args.Length() > (i) && args[i]->IsString() ? args[i]->ToString() : dflt);
#define OPTIONAL_ARGUMENT_AS_STRING(i, var) String::Utf8Value var(args.Length() > (i) ? args[i]->ToString() : String::New(""));
#define OPTIONAL_ARGUMENT_ARRAY(i, var) Local<Array> var(args.Length() > (i) && args[i]->IsArray() ? Local<Array>::Cast(args[i]) : Local<Array>::New(Array::New()));
#define OPTIONAL_ARGUMENT_OBJECT(i, var) Local<Object> var(args.Length() > (i) && args[i]->IsObject() ? Local<Object>::Cast(args[i]) : Local<Object>::New(Object::New()));

#define GETOPTS_BOOL(obj,opts,name) if (!obj.IsEmpty()) { Local<String> name(String::New(#name)); if (obj->Has(name)) opts.name = obj->Get(name)->BooleanValue(); }
#define GETOPTS_INT(obj,opts,name) if (!obj.IsEmpty()) { Local<String> name(String::New(#name)); if (obj->Has(name)) opts.name = obj->Get(name)->ToInt32()->Value(); }
#define GETOPTS_INTVAL(obj,opts,name,expr) if (!obj.IsEmpty()) { Local<String> name(String::New(#name)); if (obj->Has(name)) { int val = obj->Get(name)->ToInt32()->Value(); opts.name = (expr); }}

#define DEFINE_CONSTANT_INTEGER(target, constant, name) (target)->Set(String::NewSymbol(#name),Integer::New(constant),static_cast<PropertyAttribute>(ReadOnly | DontDelete) );
#define DEFINE_CONSTANT_STRING(target, constant, name) (target)->Set(String::NewSymbol(#name),String::NewSymbol(constant),static_cast<PropertyAttribute>(ReadOnly | DontDelete));

#define TRY_CATCH_CALL(context, callback, argc, argv) { TryCatch try_catch; (callback)->Call((context), (argc), (argv)); if (try_catch.HasCaught()) FatalException(try_catch); }
#define TRY_CATCH_CALL_RETURN(context, callback, argc, argv, rc) { TryCatch try_catch; (callback)->Call((context), (argc), (argv)); if (try_catch.HasCaught()) { FatalException(try_catch); return rc; }}

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

Handle<Value> parseJSON(const char* str);
string stringifyJSON(Local<Value> obj);

#endif

