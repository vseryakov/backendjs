//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  April 2013
//

#include "node_backend.h"
#include "snappy.h"
#include "bkunzip.h"

string exceptionString(TryCatch* try_catch)
{
    HandleScope scope;
    String::Utf8Value exception(try_catch->Exception());
    Handle<Message> message = try_catch->Message();
    if (message.IsEmpty()) return string(*exception);

    string msg;
    int linenum = message->GetLineNumber();
    String::Utf8Value filename(message->GetScriptResourceName());
    String::Utf8Value sourceline(message->GetSourceLine());
    msg += vFmtStr("%s:%i: %s\n%s\n", *filename, linenum, *exception, *sourceline);
    String::Utf8Value stack_trace(try_catch->StackTrace());
    if (stack_trace.length() > 0) msg += *stack_trace;
    return msg;
}

static Handle<Value> logging(const Arguments& args)
{
    HandleScope scope;

    if (args.Length() > 0) {
        String::Utf8Value level(args[0]);
        VLog::set(*level);
    }

    return scope.Close(Integer::New(VLog::level()));
}

static Handle<Value> loggingChannel(const Arguments& args)
{
    HandleScope scope;

    if (args.Length() > 0) {
        String::Utf8Value name(args[0]);
        VLog::setChannel(!strcmp(*name, "stderr") ? stderr : NULL);
    }
    FILE *fp = VLog::getChannel();
    return scope.Close(String::New(fp == stderr ? "stderr" : "stdout"));
}

string jsonStringify(Local<Value> obj)
{
    HandleScope scope;

    Local<Value> argv[1] = { obj };
    Handle<Object> JSON = Context::GetCurrent()->Global()->Get(String::New("JSON"))->ToObject();
    Handle<Function> JSON_stringify = Handle<Function>::Cast(JSON->Get(String::New("stringify")));
    Local<Value> val = Local<Value>::New(JSON_stringify->Call(JSON, 1, argv));
    String::Utf8Value json(val);
    return *json;
}

Handle<Value> jsonParse(string str)
{
    HandleScope scope;

    Local<Value> argv[1] = { Local<String>::New(String::New(str.c_str())) };
    Handle<Object> JSON = Context::GetCurrent()->Global()->Get(String::New("JSON"))->ToObject();
    Handle<Function> JSON_parse = Handle<Function>::Cast(JSON->Get(String::New("parse")));
    Local<Value> val;
    {
    	TryCatch try_catch;
    	val = Local<Value>::New(JSON_parse->Call(JSON, 1, argv));
    	if (try_catch.HasCaught()) val = Local<Value>::New(Null());
    }
    return scope.Close(val);
}

Handle<Value> toArray(vector<string> &list, int numeric)
{
    HandleScope scope;
    Local<Array> rc = Local<Array>::New(Array::New(list.size()));
    for (uint i = 0; i < list.size(); i++) {
    	switch (numeric) {
    	case 1:
    		rc->Set(Integer::New(i), Local<Number>::New(Number::New(atol(list[i].c_str()))));
    		break;

    	case 2:
    		rc->Set(Integer::New(i), Local<Number>::New(Number::New(atof(list[i].c_str()))));
    		break;

    	default:
    		rc->Set(Integer::New(i), Local<String>::New(String::New(list[i].c_str())));
    	}
    }
    return scope.Close(rc);
}

Handle<Value> toArray(vector<pair<string,string> > &list)
{
    HandleScope scope;
    Local<Array> rc = Local<Array>::New(Array::New(list.size()));
    for (uint i = 0; i < list.size(); i++) {
        Local<Object> obj = Local<Object>::New(Object::New());
        obj->Set(String::NewSymbol("name"), Local<String>::New(String::New(list[i].first.c_str())));
        obj->Set(String::NewSymbol("value"), Local<String>::New(String::New(list[i].second.c_str())));
        rc->Set(Integer::New(i), obj);
    }
    return scope.Close(rc);
}

static Handle<Value> getUser(const Arguments& args)
{
   HandleScope scope;
   struct passwd *pw = NULL;

   if (args.Length() > 0) {
       String::Utf8Value name(args[0]->ToString());
       pw = getpwnam(*name);
       if (!pw) pw = getpwuid(args[0]->ToInteger()->Int32Value());
   } else {
       pw = getpwnam(getlogin());
   }
   Local<Object> obj = Local<Object>::New(Object::New());
   if (pw) {
       obj->Set(String::NewSymbol("uid"), Local<Integer>::New(Integer::New(pw->pw_uid)));
       obj->Set(String::NewSymbol("gid"), Local<Integer>::New(Integer::New(pw->pw_gid)));
       obj->Set(String::NewSymbol("name"), Local<String>::New(String::New(pw->pw_name)));
       obj->Set(String::NewSymbol("dir"), Local<String>::New(String::New(pw->pw_dir)));
   }
   return scope.Close(obj);
}

static Handle<Value> getGroup(const Arguments& args)
{
   HandleScope scope;
   struct group *g = NULL;

   if (args.Length() > 0) {
       String::Utf8Value name(args[0]->ToString());
       g = getgrnam(*name);
       if (!g) g = getgrgid(args[0]->ToInteger()->Int32Value());
   } else {
       struct passwd *pw = getpwnam(getlogin());
       g = getgrgid(pw ? pw->pw_gid : 0);
   }
   Local<Object> obj = Local<Object>::New(Object::New());
   if (g) {
       obj->Set(String::NewSymbol("gid"), Local<Integer>::New(Integer::New(g->gr_gid)));
       obj->Set(String::NewSymbol("name"), Local<String>::New(String::New(g->gr_name)));
   }
   return scope.Close(obj);
}

static Handle<Value> countWords(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_AS_STRING(0, word);
    REQUIRE_ARGUMENT_AS_STRING(1, text);

    return scope.Close(Integer::New(vCountWords(*word, *text)));
}

static vector<CountWords*> _wc;

static Handle<Value> countWordsInit(const Arguments& args)
{
    HandleScope scope;

    for (uint i = 0; i < _wc.size(); i++) delete _wc[i];
    _wc.clear();

    return scope.Close(Undefined());
}

static Handle<Value> countAllWords(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_ARRAY(0, list);
    REQUIRE_ARGUMENT_AS_STRING(1, text);

    CountWords w, *cw = &w;

    // Find cached class
    if (args.Length() > 2 && !args[2]->IsNull()) {
        cw = NULL;
        String::Utf8Value hash(args[2]);
        for (uint i = 0; i < _wc.size() && !cw; i++) {
            if (_wc[i]->name == *hash) cw = _wc[i];
        }
        if (!cw) {
            cw = new CountWords(*hash);
            _wc.push_back(cw);
        }
    }

    // Additional delimiters
    if (args.Length() > 3 && !args[3]->IsNull()) {
        String::AsciiValue str(args[3]);
        cw->setAlphabet(*str, str.length(), true);
    }
    // Additional non-delimiters
    if (args.Length() > 4 && !args[4]->IsNull()) {
        String::AsciiValue str(args[4]);
        cw->setAlphabet(*str, str.length(), false);
    }

    // Op mode
    if (args.Length() > 5 && !args[5]->IsNull()) {
        String::AsciiValue str(args[5]);
        cw->setMode(*str);
    }

    if (!cw->list.size()) {
        for (uint i = 0; i < list->Length(); i++) {
            Local<Value> val = list->Get(i);
            if (val->IsString()) {
                String::Utf8Value str(val);
                cw->add(*str);
            } else
            if (val->IsInt32()) {
                if (!cw->list.empty()) cw->list.back().value = val->Int32Value();
            }
        }
    }

    cw->search(*text);
    list = Array::New();
    Local<Array> counters = Local<Array>::New(Array::New());
    Local<Array> values = Local<Array>::New(Array::New());
    for (uint i = 0, j = 0; i < cw->counters.size(); i++) {
        if (cw->counters[i]) {
            string w = cw->list[i].word;
            if (cw->list[i].value) w += vFmtStr("/%d", cw->list[i].value);
            list->Set(Integer::New(j), Local<String>::New(String::New(w.c_str())));
            counters->Set(Integer::New(j), Local<Integer>::New(Integer::New(cw->counters[i])));
            values->Set(Integer::New(j++), Local<Integer>::New(Integer::New(cw->list[i].value)));
        }
    }
    Local<Object> obj = Object::New();
    obj->Set(String::New("count"), Local<Integer>::New(Integer::New(cw->count)));
    obj->Set(String::New("value"), Local<Integer>::New(Integer::New(cw->value)));
    obj->Set(String::New("mode"), Local<String>::New(String::New(cw->modeName().c_str())));
    obj->Set(String::New("matches"), list);
    obj->Set(String::New("counters"), counters);
    obj->Set(String::New("values"), values);

    return scope.Close(obj);
}

static Handle<Value> geoHashEncode(const Arguments& args)
{
   HandleScope scope;

   REQUIRE_ARGUMENT_NUMBER(0, lat);
   REQUIRE_ARGUMENT_NUMBER(1, lon);
   OPTIONAL_ARGUMENT_INT(2, len);

   string hash = vGeoHashEncode(lat, lon, len);
   Local<String> result = Local<String>::New(String::New(hash.c_str()));
   return scope.Close(result);
}

static Handle<Value> geoHashDecode(const Arguments& args)
{
   HandleScope scope;

   REQUIRE_ARGUMENT_AS_STRING(0, hash);

   vector<double> rc = vGeoHashDecode(*hash);
   Local<Array> result = Local<Array>::New(Array::New(rc.size()));
   for (uint i = 0; i < rc.size(); i++) {
	   result->Set(Integer::New(i), Local<Number>::New(Number::New(rc[i])));
   }
   return scope.Close(result);
}

static Handle<Value> geoHashAdjacent(const Arguments& args)
{
   HandleScope scope;

   REQUIRE_ARGUMENT_STRING(0, base);
   REQUIRE_ARGUMENT_STRING(1, dir);

   string hash = vGeoHashAdjacent(*base, *dir);
   Local<String> result = Local<String>::New(String::New(hash.c_str()));
   return scope.Close(result);
}

static bool isNumber(Handle<Value> arg)
{
    HandleScope scope;
    String::Utf8Value str(arg);
    const char *p = *str;
    while (*p && (*p == ' ' || *p == '-' || *p == '+')) p++;
    if (!isdigit(*p)) return false;
    return true;
}

static Handle<Value> geoDistance(const Arguments& args)
{
   HandleScope scope;

   if (args.Length() < 4) return scope.Close(Null());
   double lat1 = args[0]->NumberValue();
   double lon1 = args[1]->NumberValue();
   double lat2 = args[2]->NumberValue();
   double lon2 = args[3]->NumberValue();
   if (isnan(lat1) || isnan(lon1) || isnan(lat2) || isnan(lon2)) return scope.Close(Null());
   if (lat1 == 0 && !isNumber(args[0]->ToString())) return scope.Close(Null());
   if (lon1 == 0 && !isNumber(args[1]->ToString())) return scope.Close(Null());
   if (lat2 == 0 && !isNumber(args[2]->ToString())) return scope.Close(Null());
   if (lon2 == 0 && !isNumber(args[3]->ToString())) return scope.Close(Null());

   return scope.Close(Local<Number>::New(Number::New(vDistance(lat1, lon1, lat2, lon2))));
}

static Handle<Value> geoBoundingBox(const Arguments& args)
{
   HandleScope scope;

   REQUIRE_ARGUMENT_NUMBER(0, lat1);
   REQUIRE_ARGUMENT_NUMBER(1, lon1);
   REQUIRE_ARGUMENT_NUMBER(2, distance);

   vector<double> rc = vBoundingBox(lat1, lon1, distance);
   Local<Array> result = Local<Array>::New(Array::New(rc.size()));
   for (uint i = 0; i < rc.size(); i++) {
	   result->Set(Integer::New(i), Local<Number>::New(Number::New(rc[i])));
   }
   return scope.Close(result);
}

static Handle<Value> geoHashGrid(const Arguments& args)
{
   HandleScope scope;

   REQUIRE_ARGUMENT_STRING(0, base);
   OPTIONAL_ARGUMENT_NUMBER(1, steps);
   if (steps <= 0) steps = 1;

   vector< vector<string> > rc = vGeoHashGrid(*base, steps);
   Local<Array> result = Local<Array>::New(Array::New());
   for (uint j = 0, n = 0; j < rc[0].size(); j++) {
       for (uint i = 0; i < rc.size(); i++) {
           result->Set(Integer::New(n++), Local<String>::New(String::New(rc[i][j].c_str())));
       }
   }
   return scope.Close(result);
}

static Handle<Value> geoHashRow(const Arguments& args)
{
   HandleScope scope;

   REQUIRE_ARGUMENT_STRING(0, base);
   OPTIONAL_ARGUMENT_NUMBER(1, steps);
   if (steps <= 0) steps = 1;

   vector<string> rc = vGeoHashRow(*base, steps);
   Local<Array> result = Local<Array>::New(Array::New(rc.size()));
   for (uint i = 0; i < rc.size(); i++) {
       result->Set(Integer::New(i), Local<String>::New(String::New(rc[i].c_str())));
   }
   return scope.Close(result);
}

static Handle<Value> snappyCompress(const Arguments& args)
{
   HandleScope scope;

   REQUIRE_ARGUMENT_STRING(0, str);

   string out;
   snappy::Compress(*str, str.length(), &out);
   return scope.Close(Local<String>::New(String::New(out.c_str(), out.size())));
}

static Handle<Value> snappyUncompress(const Arguments& args)
{
   HandleScope scope;

   REQUIRE_ARGUMENT_STRING(0, str);

   string out;
   snappy::Uncompress(*str, str.length(), &out);
   return scope.Close(Local<String>::New(String::New(out.c_str(), out.size())));
}

static Handle<Value> unzipFile(const Arguments& args)
{
   HandleScope scope;

   REQUIRE_ARGUMENT_STRING(0, zip);
   REQUIRE_ARGUMENT_STRING(1, file);
   OPTIONAL_ARGUMENT_STRING(2, outfile);

   if (args.Length() == 3) {
       int rc = VUnzip::unzip(*zip, *file, *outfile);
       return scope.Close(Local<Integer>::New(Integer::New(rc)));
   }

   string out = VUnzip::toString(*zip, *file);
   return scope.Close(Local<String>::New(String::New(out.c_str(), out.size())));
}

static Handle<Value> unzip(const Arguments& args)
{
   HandleScope scope;

   REQUIRE_ARGUMENT_STRING(0, zip);
   REQUIRE_ARGUMENT_STRING(1, dir);

   int rc = VUnzip::unzip(*zip, *dir);
   return scope.Close(Local<Integer>::New(Integer::New(rc)));
}

static Handle<Value> strSplit(const Arguments& args)
{
   HandleScope scope;

   REQUIRE_ARGUMENT_AS_STRING(0, str);
   OPTIONAL_ARGUMENT_STRING(1, delim);
   OPTIONAL_ARGUMENT_STRING(2, quotes);

   vector<string> list = strSplit(*str, *delim, *quotes);
   return scope.Close(toArray(list));
}

void backend_init(Handle<Object> target)
{
    HandleScope scope;

    vlib_init();
    vsqlite_init();

    DebugInit(target);

    NODE_SET_METHOD(target, "strSplit", strSplit);

    NODE_SET_METHOD(target, "getUser", getUser);
    NODE_SET_METHOD(target, "getGroup", getGroup);

    NODE_SET_METHOD(target, "logging", logging);
    NODE_SET_METHOD(target, "loggingChannel", loggingChannel);

    NODE_SET_METHOD(target, "countWordsInit", countWordsInit);
    NODE_SET_METHOD(target, "countWords", countWords);
    NODE_SET_METHOD(target, "countAllWords", countAllWords);

    NODE_SET_METHOD(target, "snappyCompress", snappyCompress);
    NODE_SET_METHOD(target, "snappyUncompress", snappyUncompress);

    NODE_SET_METHOD(target, "geoDistance", geoDistance);
    NODE_SET_METHOD(target, "geoBoundingBox", geoBoundingBox);
    NODE_SET_METHOD(target, "geoHashEncode", geoHashEncode);
    NODE_SET_METHOD(target, "geoHashDecode", geoHashDecode);
    NODE_SET_METHOD(target, "geoHashAdjacent", geoHashAdjacent);
    NODE_SET_METHOD(target, "geoHashGrid", geoHashGrid);
    NODE_SET_METHOD(target, "geoHashRow", geoHashRow);

    NODE_SET_METHOD(target, "unzipFile", unzipFile);
    NODE_SET_METHOD(target, "unzip", unzip);

    CacheInit(target);
    SyslogInit(target);
    SQLiteInit(target);
    LevelDBInit(target);
    LMDBInit(target);
#ifdef USE_WAND
    WandInit(target);
#endif
#ifdef USE_PGSQL
    PgSQLInit(target);
#endif
#ifdef USE_MYSQL
    MysqlInit(target);
#endif
#ifdef USE_NANOMSG
    NanoMsgInit(target);
#endif
}

NODE_MODULE(backend, backend_init);
