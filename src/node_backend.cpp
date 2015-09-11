//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  April 2013
//

#include "node_backend.h"
#include "snappy.h"
#include "bkunzip.h"

static NAN_METHOD(logging)
{
    if (info.Length() > 0) {
        Nan::Utf8String level(info[0]);
        VLog::set(*level);
    }

    return info.GetReturnValue().Set(Nan::New(VLog::level()));
}

static NAN_METHOD(loggingChannel)
{
    if (info.Length() > 0) {
        Nan::Utf8String name(info[0]);
        VLog::setChannel(!strcmp(*name, "stderr") ? stderr : NULL);
    }
    FILE *fp = VLog::getChannel();
    return info.GetReturnValue().Set(Nan::New(fp == stderr ? "stderr" : "stdout").ToLocalChecked());
}

string stringifyJSON(Local<Value> obj)
{
    Nan::EscapableHandleScope scope;
    Local<Value> argv[1] = { obj };
    Handle<Object> JSON = Context::GetCurrent()->Global()->Get(Nan::New("JSON").ToLocalChecked())->ToObject();
    Handle<Function> JSON_stringify = Handle<Function>::Cast(JSON->Get(Nan::New("stringify").ToLocalChecked()));
    Local<Value> val = Local<Value>::New(JSON_stringify->Call(JSON, 1, argv));
    Nan::Utf8String json(val);
    return *json;
}

Handle<Value> parseJSON(const char* str)
{
    Nan::EscapableHandleScope scope;
    Local<Value> argv[1] = { Nan::New(str).ToLocalChecked() };
    Handle<Object> JSON = Context::GetCurrent()->Global()->Get(Nan::New("JSON").ToLocalChecked())->ToObject();
    Handle<Function> JSON_parse = Handle<Function>::Cast(JSON->Get(Nan::New("parse").ToLocalChecked()));
    Local<Value> val;
    {
        Nan::TryCatch try_catch;
        val = Local<Value>::New(JSON_parse->Call(JSON, 1, argv));
        if (try_catch.HasCaught()) val = Local<Value>::New(Null());
    }
    return scope.Escape(val);
}

Local<Value> toArray(vector<string> &list, int numeric)
{
    Nan::EscapableHandleScope scope;
    Local<Array> rc = Local<Array>::New(Array::New(list.size()));
    for (uint i = 0; i < list.size(); i++) {
        switch (numeric) {
        case 1:
            rc->Set(Nan::New(i), Nan::New(::atof(list[i].c_str())));
            break;

        case 2:
            rc->Set(Nan::New(i), Nan::New(::atof(list[i].c_str())));
            break;

        default:
            rc->Set(Nan::New(i), Nan::New(list[i].c_str()).ToLocalChecked());
        }
    }
    return scope.Escape(rc);
}

Local<Value> toArray(vector<pair<string,string> > &list)
{
    Nan::EscapableHandleScope scope;
    Local<Array> rc = Local<Array>::New(Array::New(list.size()));
    for (uint i = 0; i < list.size(); i++) {
        Local<Object> obj = Local<Object>::New(Object::New());
        obj->Set(Nan::New("name").ToLocalChecked(), Nan::New(list[i].first.c_str()).ToLocalChecked());
        obj->Set(Nan::New("value").ToLocalChecked(), Nan::New(list[i].second.c_str()).ToLocalChecked());
        rc->Set(Nan::New(i), obj);
    }
    return scope.Escape(rc);
}

static NAN_METHOD(getUser)
{
   struct passwd *pw = NULL;

   if (info.Length() > 0) {
       Nan::Utf8String name(info[0]->ToString());
       pw = getpwnam(*name);
       if (!pw && strNumeric(*name)) pw = getpwuid(info[0]->ToInteger()->Int32Value());
   } else {
       pw = getpwnam(getlogin());
   }
   Local<Object> obj = Local<Object>::New(Object::New());
   if (pw) {
       obj->Set(Nan::New("uid").ToLocalChecked(), Nan::New(pw->pw_uid));
       obj->Set(Nan::New("gid").ToLocalChecked(), Nan::New(pw->pw_gid));
       obj->Set(Nan::New("name").ToLocalChecked(), Nan::New(pw->pw_name).ToLocalChecked());
       obj->Set(Nan::New("dir").ToLocalChecked(), Nan::New(pw->pw_dir).ToLocalChecked());
   }
   info.GetReturnValue().Set(obj);
}

static NAN_METHOD(getGroup)
{
   struct group *g = NULL;

   if (info.Length() > 0) {
       Nan::Utf8String name(info[0]->ToString());
       g = getgrnam(*name);
       if (!g && strNumeric(*name)) g = getgrgid(info[0]->ToInteger()->Int32Value());
   } else {
       struct passwd *pw = getpwnam(getlogin());
       g = getgrgid(pw ? pw->pw_gid : 0);
   }
   Local<Object> obj = Local<Object>::New(Object::New());
   if (g) {
       obj->Set(Nan::New("gid").ToLocalChecked(), Nan::New(g->gr_gid));
       obj->Set(Nan::New("name").ToLocalChecked(), Nan::New(g->gr_name).ToLocalChecked());
   }
   info.GetReturnValue().Set(obj);
}

static NAN_METHOD(countWords)
{
    HandleScope scope;

    NAN_REQUIRE_ARGUMENT_AS_STRING(0, word);
    NAN_REQUIRE_ARGUMENT_AS_STRING(1, text);

    return info.GetReturnValue().Set(Nan::New(vCountWords(*word, *text)));
}

static vector<CountWords*> _wc;

static NAN_METHOD(countWordsInit)
{
    for (uint i = 0; i < _wc.size(); i++) delete _wc[i];
    _wc.clear();
}

static NAN_METHOD(countAllWords)
{
    NAN_REQUIRE_ARGUMENT_ARRAY(0, list);
    NAN_REQUIRE_ARGUMENT_AS_STRING(1, text);

    CountWords w, *cw = &w;

    // Find cached class
    if (info.Length() > 2 && !info[2]->IsNull()) {
        cw = NULL;
        Nan::Utf8String hash(info[2]);
        for (uint i = 0; i < _wc.size() && !cw; i++) {
            if (_wc[i]->name == *hash) cw = _wc[i];
        }
        if (!cw) {
            cw = new CountWords(*hash);
            _wc.push_back(cw);
        }
    }

    // Additional delimiters
    if (info.Length() > 3 && !info[3]->IsNull()) {
        String::AsciiValue str(info[3]);
        cw->setAlphabet(*str, str.length(), true);
    }
    // Additional non-delimiters
    if (info.Length() > 4 && !info[4]->IsNull()) {
        String::AsciiValue str(info[4]);
        cw->setAlphabet(*str, str.length(), false);
    }

    // Op mode
    if (info.Length() > 5 && !info[5]->IsNull()) {
        String::AsciiValue str(info[5]);
        cw->setMode(*str);
    }

    if (!cw->list.size()) {
        for (uint i = 0; i < list->Length(); i++) {
            Local<Value> val = list->Get(i);
            if (val->IsString()) {
                Nan::Utf8String str(val);
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
            list->Set(Nan::New(j), Nan::New(w.c_str()).ToLocalChecked());
            counters->Set(Nan::New(j), Nan::New(cw->counters[i]));
            values->Set(Nan::New(j++), Nan::New(cw->list[i].value));
        }
    }
    Local<Object> obj = Object::New();
    obj->Set(Nan::New("count").ToLocalChecked(), Nan::New(cw->count));
    obj->Set(Nan::New("value").ToLocalChecked(), Nan::New(cw->value));
    obj->Set(Nan::New("mode").ToLocalChecked(), Nan::New(cw->modeName().c_str()).ToLocalChecked());
    obj->Set(Nan::New("matches").ToLocalChecked(), list);
    obj->Set(Nan::New("counters").ToLocalChecked(), counters);
    obj->Set(Nan::New("values").ToLocalChecked(), values);

    info.GetReturnValue().Set(obj);
}

static NAN_METHOD(geoHashEncode)
{
   NAN_REQUIRE_ARGUMENT_NUMBER(0, lat);
   NAN_REQUIRE_ARGUMENT_NUMBER(1, lon);
   NAN_OPTIONAL_ARGUMENT_INT(2, len);

   string hash = vGeoHashEncode(lat, lon, len);
   return info.GetReturnValue().Set(Nan::New(hash.c_str()).ToLocalChecked());
}

static NAN_METHOD(geoHashDecode)
{
   NAN_REQUIRE_ARGUMENT_AS_STRING(0, hash);

   vector<double> rc = vGeoHashDecode(*hash);
   Local<Array> result = Local<Array>::New(Array::New(rc.size()));
   for (uint i = 0; i < rc.size(); i++) {
       result->Set(Nan::New(i), Nan::New(rc[i]));
   }
   return info.GetReturnValue().Set(result);
}

static NAN_METHOD(geoHashAdjacent)
{
   NAN_REQUIRE_ARGUMENT_STRING(0, base);
   NAN_REQUIRE_ARGUMENT_STRING(1, dir);

   string hash = vGeoHashAdjacent(*base, *dir);
   return info.GetReturnValue().Set(Nan::New(hash.c_str()).ToLocalChecked());
}

static bool isNumber(Local<Value> arg)
{
    Nan::HandleScope scope;
    Nan::Utf8String str(arg);
    const char *p = *str;
    while (*p && (*p == ' ' || *p == '-' || *p == '+')) p++;
    if (!isdigit(*p)) return false;
    return true;
}

static NAN_METHOD(geoDistance)
{
   if (info.Length() < 4) return;
   double lat1 = info[0]->NumberValue();
   double lon1 = info[1]->NumberValue();
   double lat2 = info[2]->NumberValue();
   double lon2 = info[3]->NumberValue();
   if (isnan(lat1) || isnan(lon1) || isnan(lat2) || isnan(lon2)) return;
   if (lat1 == 0 && !isNumber(info[0]->ToString())) return;
   if (lon1 == 0 && !isNumber(info[1]->ToString())) return;
   if (lat2 == 0 && !isNumber(info[2]->ToString())) return;
   if (lon2 == 0 && !isNumber(info[3]->ToString())) return;

   info.GetReturnValue().Set(Nan::New(vDistance(lat1, lon1, lat2, lon2)));
}

static NAN_METHOD(geoBoundingBox)
{
   NAN_REQUIRE_ARGUMENT_NUMBER(0, lat1);
   NAN_REQUIRE_ARGUMENT_NUMBER(1, lon1);
   NAN_REQUIRE_ARGUMENT_NUMBER(2, distance);

   vector<double> rc = vBoundingBox(lat1, lon1, distance);
   Local<Array> result = Local<Array>::New(Array::New(rc.size()));
   for (uint i = 0; i < rc.size(); i++) {
       result->Set(Nan::New(i), Nan::New(rc[i]));
   }
   return info.GetReturnValue().Set(result);
}

static NAN_METHOD(geoHashGrid)
{
   NAN_REQUIRE_ARGUMENT_STRING(0, base);
   NAN_OPTIONAL_ARGUMENT_NUMBER(1, steps);
   if (steps <= 0) steps = 1;

   vector< vector<string> > rc = vGeoHashGrid(*base, steps);
   Local<Array> result = Local<Array>::New(Array::New());
   for (uint j = 0, n = 0; j < rc[0].size(); j++) {
       for (uint i = 0; i < rc.size(); i++) {
           result->Set(Nan::New(n++), Nan::New(rc[i][j].c_str()).ToLocalChecked());
       }
   }
   return info.GetReturnValue().Set(result);
}

static NAN_METHOD(geoHashRow)
{
   NAN_REQUIRE_ARGUMENT_STRING(0, base);
   NAN_OPTIONAL_ARGUMENT_NUMBER(1, steps);
   if (steps <= 0) steps = 1;

   vector<string> rc = vGeoHashRow(*base, steps);
   Local<Array> result = Local<Array>::New(Array::New(rc.size()));
   for (uint i = 0; i < rc.size(); i++) {
       result->Set(Nan::New(i), Nan::New(rc[i].c_str()).ToLocalChecked());
   }
   return info.GetReturnValue().Set(result);
}

static NAN_METHOD(snappyCompress)
{
   NAN_REQUIRE_ARGUMENT_STRING(0, str);

   string out;
   snappy::Compress(*str, str.length(), &out);
   info.GetReturnValue().Set(Nan::New(out.c_str(), out.size()).ToLocalChecked());
}

static NAN_METHOD(snappyUncompress)
{
   NAN_REQUIRE_ARGUMENT_STRING(0, str);

   string out;
   snappy::Uncompress(*str, str.length(), &out);
   info.GetReturnValue().Set(Nan::New(out.c_str(), out.size()).ToLocalChecked());
}

static NAN_METHOD(zlibCompress)
{
   NAN_REQUIRE_ARGUMENT_STRING(0, str);
   NAN_OPTIONAL_ARGUMENT_INT(1, level);

   string out;
   z_stream strm;
   vDeflateInit(&strm, level ? level : Z_BEST_SPEED);
   vDeflate(&strm, *str, str.length(), &out);
   vDeflateEnd(&strm, &out);
   info.GetReturnValue().Set(Nan::New(out.c_str(), out.size()).ToLocalChecked());
}

static NAN_METHOD(zlibUncompress)
{
   NAN_REQUIRE_ARGUMENT_STRING(0, str);

   string out;
   z_stream strm;
   vInflateInit(&strm);
   vInflate(&strm, *str, str.length(), &out);
   vInflateEnd(&strm);
   info.GetReturnValue().Set(Nan::New(out.c_str(), out.size()).ToLocalChecked());
}

static NAN_METHOD(unzipFile)
{
   HandleScope scope;

   NAN_REQUIRE_ARGUMENT_STRING(0, zip);
   NAN_REQUIRE_ARGUMENT_STRING(1, file);
   NAN_OPTIONAL_ARGUMENT_STRING(2, outfile);

   if (info.Length() == 3) {
       int rc = VUnzip::unzip(*zip, *file, *outfile);
       return info.GetReturnValue().Set(Local<Integer>::New(Nan::New(rc)));
   }

   string out = VUnzip::toString(*zip, *file);
   return info.GetReturnValue().Set(Local<String>::New(String::New(out.c_str(), out.size())));
}

static NAN_METHOD(unzip)
{
   NAN_REQUIRE_ARGUMENT_STRING(0, zip);
   NAN_REQUIRE_ARGUMENT_STRING(1, dir);

   int rc = VUnzip::unzip(*zip, *dir);
   info.GetReturnValue().Set(Nan::New(rc));
}

static NAN_METHOD(strSplit)
{
   NAN_OPTIONAL_ARGUMENT_STRING(0, str);
   NAN_OPTIONAL_ARGUMENT_STRING(1, delim);
   NAN_OPTIONAL_ARGUMENT_STRING(2, quotes);

   vector<string> list = strSplit(*str, *delim, *quotes);
   info.GetReturnValue().Set(toArray(list));
}

static NAN_METHOD(run)
{
   NAN_OPTIONAL_ARGUMENT_STRING(0, cmd);
   string out;

   FILE *fp = popen(*cmd, "r");
   if (fp) {
       size_t len;
       char buf[4096];
       while (!feof(fp)) {
           len = fread(buf, 1, sizeof(buf), fp);
           if (len) out += string(buf, len);
       }
       pclose(fp);
   }
   info.GetReturnValue().Set(Nan::New(out.c_str(), out.size()).ToLocalChecked());
}


void backend_init(Handle<Object> target)
{
    Nan::HandleScope scope;

    vlib_init();
    vsqlite_init();

    DebugInit(target);

    NAN_EXPORT(target, run);

    NAN_EXPORT(target, strSplit);

    NAN_EXPORT(target, getUser);
    NAN_EXPORT(target, getGroup);

    NAN_EXPORT(target, logging);
    NAN_EXPORT(target, loggingChannel);

    NAN_EXPORT(target, countWordsInit);
    NAN_EXPORT(target, countWords);
    NAN_EXPORT(target, countAllWords);

    NAN_EXPORT(target, snappyCompress);
    NAN_EXPORT(target, snappyUncompress);

    NAN_EXPORT(target, zlibCompress);
    NAN_EXPORT(target, zlibUncompress);

    NAN_EXPORT(target, geoDistance);
    NAN_EXPORT(target, geoBoundingBox);
    NAN_EXPORT(target, geoHashEncode);
    NAN_EXPORT(target, geoHashDecode);
    NAN_EXPORT(target, geoHashAdjacent);
    NAN_EXPORT(target, geoHashGrid);
    NAN_EXPORT(target, geoHashRow);

    NAN_EXPORT(target, unzipFile);
    NAN_EXPORT(target, unzip);

    CacheInit(target);
    SyslogInit(target);
    SQLiteInit(target);
    PgSQLInit(target);
#ifdef USE_LEVELDB
    LevelDBInit(target);
#endif
#ifdef USE_LMDB
    LMDBInit(target);
#endif
#ifdef USE_WAND
    WandInit(target);
#endif
#ifdef USE_MYSQL
    MysqlInit(target);
#endif
}

NODE_MODULE(backend, backend_init);
