//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  April 2013
//

#include "node_backend.h"
#include "snappy.h"
#include "bkunzip.h"

static const unsigned int POLL_PERIOD_MS = 500;
static unsigned int HIGH_WATER_MARK_MS = 70;
static const unsigned int AVG_DECAY_FACTOR = 3;
static uv_timer_t _busyTimer;
static uint32_t _currentLag;
static uint64_t _lastMark;

static void busy_timer(uv_timer_t* handle, int status)
{
    uint64_t now = uv_hrtime();

    if (_lastMark > 0) {
        // keep track of (dampened) average lag.
        uint32_t lag = (uint32_t) ((now - _lastMark) / 1000000);
        lag = (lag < POLL_PERIOD_MS) ? 0 : lag - POLL_PERIOD_MS;
        _currentLag = (lag + (_currentLag * (AVG_DECAY_FACTOR-1))) / AVG_DECAY_FACTOR;
    }
    _lastMark = now;
}

static NAN_METHOD(initBusy)
{
    NAN_OPTIONAL_ARGUMENT_INT(0, ms);

    if (ms > 10) HIGH_WATER_MARK_MS = ms;

    if ((long long)_busyTimer.data != 1970) {
        uv_timer_init(uv_default_loop(), &_busyTimer);
        uv_timer_start(&_busyTimer, busy_timer, POLL_PERIOD_MS, POLL_PERIOD_MS);
        _busyTimer.data = (void*)1970;
    }
    NAN_RETURN(HIGH_WATER_MARK_MS);
}

static NAN_METHOD(isBusy)
{
    if (_currentLag > HIGH_WATER_MARK_MS) {
        // probabilistically block requests proportional to how far behind we are.
        double pctToBlock = ((_currentLag - HIGH_WATER_MARK_MS) / (double) HIGH_WATER_MARK_MS) * 100.0;
        double r = (rand() / (double) RAND_MAX) * 100.0;
        if (r < pctToBlock) NAN_RETURN(Nan::True());
    }
    NAN_RETURN(Nan::False());
}

static NAN_METHOD(getBusy)
{
    NAN_RETURN(_currentLag);
}

static NAN_METHOD(logging)
{
    if (info.Length() > 0) {
        Nan::Utf8String level(info[0]);
        bkLog::set(*level);
    }

    NAN_RETURN(Nan::New(bkLog::level()));
}

static NAN_METHOD(loggingChannel)
{
    if (info.Length() > 0) {
        Nan::Utf8String name(info[0]);
        bkLog::setChannel(!strcmp(*name, "stderr") ? stderr : NULL);
    }
    FILE *fp = bkLog::getChannel();
    NAN_RETURN(Nan::New(fp == stderr ? "stderr" : "stdout").ToLocalChecked());
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

    NAN_RETURN(Nan::New(bkCountWords(*word, *text)));
}

static vector<bkAhoCorasick*> _wc;

static NAN_METHOD(countWordsInit)
{
    for (uint i = 0; i < _wc.size(); i++) delete _wc[i];
    _wc.clear();
}

static NAN_METHOD(countAllWords)
{
    NAN_REQUIRE_ARGUMENT_ARRAY(0, list);
    NAN_REQUIRE_ARGUMENT_AS_STRING(1, text);

    bkAhoCorasick w, *cw = &w;

    // Find cached class
    if (info.Length() > 2 && !info[2]->IsNull()) {
        cw = NULL;
        Nan::Utf8String hash(info[2]);
        for (uint i = 0; i < _wc.size() && !cw; i++) {
            if (_wc[i]->name == *hash) cw = _wc[i];
        }
        if (!cw) {
            cw = new bkAhoCorasick(*hash);
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
            if (cw->list[i].value) w += bkFmtStr("/%d", cw->list[i].value);
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

   string hash = bkGeoHashEncode(lat, lon, len);
   NAN_RETURN(Nan::New(hash.c_str()).ToLocalChecked());
}

static NAN_METHOD(geoHashDecode)
{
   NAN_REQUIRE_ARGUMENT_AS_STRING(0, hash);

   vector<double> rc = bkGeoHashDecode(*hash);
   Local<Array> result = Local<Array>::New(Array::New(rc.size()));
   for (uint i = 0; i < rc.size(); i++) {
       result->Set(Nan::New(i), Nan::New(rc[i]));
   }
   NAN_RETURN(result);
}

static NAN_METHOD(geoHashAdjacent)
{
   NAN_REQUIRE_ARGUMENT_STRING(0, base);
   NAN_REQUIRE_ARGUMENT_STRING(1, dir);

   string hash = bkGeoHashAdjacent(*base, *dir);
   NAN_RETURN(Nan::New(hash.c_str()).ToLocalChecked());
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

   info.GetReturnValue().Set(Nan::New(bkDistance(lat1, lon1, lat2, lon2)));
}

static NAN_METHOD(geoBoundingBox)
{
   NAN_REQUIRE_ARGUMENT_NUMBER(0, lat1);
   NAN_REQUIRE_ARGUMENT_NUMBER(1, lon1);
   NAN_REQUIRE_ARGUMENT_NUMBER(2, distance);

   vector<double> rc = bkBoundingBox(lat1, lon1, distance);
   Local<Array> result = Local<Array>::New(Array::New(rc.size()));
   for (uint i = 0; i < rc.size(); i++) {
       result->Set(Nan::New(i), Nan::New(rc[i]));
   }
   NAN_RETURN(result);
}

static NAN_METHOD(geoHashGrid)
{
   NAN_REQUIRE_ARGUMENT_STRING(0, base);
   NAN_OPTIONAL_ARGUMENT_NUMBER(1, steps);
   if (steps <= 0) steps = 1;

   vector< vector<string> > rc = bkGeoHashGrid(*base, steps);
   Local<Array> result = Local<Array>::New(Array::New());
   for (uint j = 0, n = 0; j < rc[0].size(); j++) {
       for (uint i = 0; i < rc.size(); i++) {
           result->Set(Nan::New(n++), Nan::New(rc[i][j].c_str()).ToLocalChecked());
       }
   }
   NAN_RETURN(result);
}

static NAN_METHOD(geoHashRow)
{
   NAN_REQUIRE_ARGUMENT_STRING(0, base);
   NAN_OPTIONAL_ARGUMENT_NUMBER(1, steps);
   if (steps <= 0) steps = 1;

   vector<string> rc = bkGeoHashRow(*base, steps);
   Local<Array> result = Local<Array>::New(Array::New(rc.size()));
   for (uint i = 0; i < rc.size(); i++) {
       result->Set(Nan::New(i), Nan::New(rc[i].c_str()).ToLocalChecked());
   }
   NAN_RETURN(result);
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
   bkDeflateInit(&strm, level ? level : Z_BEST_SPEED);
   bkDeflate(&strm, *str, str.length(), &out);
   bkDeflateEnd(&strm, &out);
   info.GetReturnValue().Set(Nan::New(out.c_str(), out.size()).ToLocalChecked());
}

static NAN_METHOD(zlibUncompress)
{
   NAN_REQUIRE_ARGUMENT_STRING(0, str);

   string out;
   z_stream strm;
   bkInflateInit(&strm);
   bkInflate(&strm, *str, str.length(), &out);
   bkInflateEnd(&strm);
   info.GetReturnValue().Set(Nan::New(out.c_str(), out.size()).ToLocalChecked());
}

static NAN_METHOD(unzipFile)
{
   HandleScope scope;

   NAN_REQUIRE_ARGUMENT_STRING(0, zip);
   NAN_REQUIRE_ARGUMENT_STRING(1, file);
   NAN_OPTIONAL_ARGUMENT_STRING(2, outfile);

   if (info.Length() == 3) {
       int rc = bkUnzip::unzip(*zip, *file, *outfile);
       NAN_RETURN(Local<Integer>::New(Nan::New(rc)));
   }

   string out = bkUnzip::toString(*zip, *file);
   info.GetReturnValue().Set(Local<String>::New(String::New(out.c_str(), out.size())));
}

static NAN_METHOD(unzip)
{
   NAN_REQUIRE_ARGUMENT_STRING(0, zip);
   NAN_REQUIRE_ARGUMENT_STRING(1, dir);

   int rc = bkUnzip::unzip(*zip, *dir);
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

    bkLibInit();

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

    NAN_EXPORT(target, initBusy);
    NAN_EXPORT(target, isBusy);
    NAN_EXPORT(target, getBusy);

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
