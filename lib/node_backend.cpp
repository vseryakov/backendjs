//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  April 2013
//

#include "node_backend.h"

#include <wand/MagickWand.h>
#include <uuid/uuid.h>

// Async request for magickwand resize callback
class MagickBaton {
public:
    MagickBaton(): image(0), exception(0), err(0) {}
    ~MagickBaton() { cb.Dispose(); }
    Persistent<Function> cb;
    unsigned char *image;
    size_t length;
    string format;
    string path;
    string out;
    FilterTypes filter;
    int quality;
    int width;
    int height;
    char *exception;
    int err;
};

class BKBaton {
public:
    BKBaton(string k, string v = ""): key(k), value(v) {}
    ~BKBaton() { cb.Dispose(); }
    Persistent<Function> cb;
    string key;
    string value;
};

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

    String::Utf8Value json(JSON_stringify->Call(JSON, 1, argv));
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
    	val = JSON_parse->Call(JSON, 1, argv);
    	if (try_catch.HasCaught()) {
    		val = Local<Value>::New(Null());
    	}
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

static FilterTypes getMagickFilter(string filter)
{
    return filter == "point" ? PointFilter :
                  filter == "box" ? BoxFilter :
                  filter == "triangle" ? TriangleFilter :
                  filter == "hermite" ? HermiteFilter :
                  filter == "hanning" ? HanningFilter :
                  filter == "hamming" ? HammingFilter :
                  filter == "blackman" ? BlackmanFilter :
                  filter == "gaussian" ?  GaussianFilter :
                  filter == "quadratic" ? QuadraticFilter :
                  filter == "cubic" ? CubicFilter :
                  filter == "catrom" ? CatromFilter :
                  filter == "mitchell" ? MitchellFilter :
                  filter == "lanczos" ? LanczosFilter :
                  filter == "kaiser" ? KaiserFilter:
                  filter == "welsh" ? WelshFilter :
                  filter == "parzen" ? ParzenFilter :
                  filter == "bohman" ? BohmanFilter:
                  filter == "barlett" ? BartlettFilter:
                  filter == "lagrange" ? LagrangeFilter:
#ifdef JincFilter
                  filter == "jinc" ? JincFilter :
                  filter == "sinc" ? SincFilter :
                  filter == "sincfast" ? SincFastFilter :
                  filter == "lanczossharp" ? LanczosSharpFilter:
                  filter == "lanzos2" ? Lanczos2Filter:
                  filter == "lanzos2sharp" ? Lanczos2SharpFilter:
                  filter == "robidoux" ? RobidouxFilter:
                  filter == "robidouxsharp" ? RobidouxSharpFilter:
                  filter == "cosine" ? CosineFilter:
                  filter == "spline" ? SplineFilter:
                  filter == "lanczosradius" ? LanczosRadiusFilter:
#endif
                  LanczosFilter;
}

static void doResizeImage(uv_work_t *req)
{
    MagickBaton *baton = (MagickBaton *)req->data;
    MagickWand *wand = NewMagickWand();
    MagickBooleanType status;
    ExceptionType severity;

    if (baton->image) {
    	status = MagickReadImageBlob(wand, baton->image, baton->length);
    	free(baton->image);
    	baton->image = NULL;
    } else {
    	status = MagickReadImage(wand, baton->path.c_str());
    }
    int width = MagickGetImageWidth(wand);
    int height = MagickGetImageHeight(wand);
    if (status == MagickFalse) goto err;

    // Negative width or height means we should not upscale if the image is already below the given dimensions
    if (baton->width < 0) {
        baton->width *= -1;
        if (width >= baton->width) baton->width = 0;
    }
    if (baton->height < 0) {
        baton->height *= -1;
        if (baton->height >= height) baton->height = 0;
    }
    // Keep the aspect if no dimensions given
    if (baton->height == 0 || baton->width == 0) {
        float aspectRatio = (width * 1.0)/height;
        if (baton->height == 0) baton->height =  baton->width * (1.0/aspectRatio); else
        if (baton->width == 0) baton->width = baton->height * aspectRatio;
    }
    if (baton->width && baton->height) {
        status = MagickResizeImage(wand, baton->width, baton->height, baton->filter, 1.0);
        if (status == MagickFalse) goto err;
    }
    if (baton->format.size()) {
        const char *fmt = baton->format.c_str();
        while (fmt && *fmt && *fmt == '.') fmt++;
        MagickSetImageFormat(wand, fmt);
    }
    if (baton->quality <= 100) MagickSetImageCompressionQuality(wand, baton->quality);
    if (baton->out.size()) {
    	// Make sure all subdirs exist
    	if (vMakePath(baton->out)) {
    		status = MagickWriteImage(wand, baton->out.c_str());
    		if (status == MagickFalse) goto err;
    	} else {
    		baton->err = errno;
    	}
    } else {
        baton->image = MagickGetImageBlob(wand, &baton->length);
        if (!baton->image) goto err;
    }
    DestroyMagickWand(wand);
    return;
err:
    baton->exception = MagickGetException(wand, &severity);
    DestroyMagickWand(wand);
}

static void afterResizeImage(uv_work_t *req)
{
    HandleScope scope;
    MagickBaton *baton = (MagickBaton *)req->data;

    Local<Value> argv[4];

    if (!baton->cb.IsEmpty()) {
        if (baton->err || baton->exception) {
            argv[0] = Exception::Error(String::New(baton->err ? strerror(baton->err) : baton->exception));
            TRY_CATCH_CALL(Context::GetCurrent()->Global(), baton->cb, 1, argv);
        } else
        if (baton->image) {
            Buffer *buf = Buffer::New((const char*)baton->image, baton->length);
            argv[0] = Local<Value>::New(Null());
            argv[1] = Local<Value>::New(buf->handle_);
            argv[2] = Local<Value>::New(Integer::New(baton->width));
            argv[3] = Local<Value>::New(Integer::New(baton->height));
            TRY_CATCH_CALL(Context::GetCurrent()->Global(), baton->cb, 4, argv);
        } else {
        	argv[0] = Local<Value>::New(Null());
        	TRY_CATCH_CALL(Context::GetCurrent()->Global(), baton->cb, 1, argv);
        }
    }
    if (baton->image) MagickRelinquishMemory(baton->image);
    if (baton->exception) MagickRelinquishMemory(baton->exception);
    delete baton;
    delete req;
}

static Handle<Value> resizeImage(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT(0);
    REQUIRE_ARGUMENT_OBJECT(1, opts);
    EXPECT_ARGUMENT_FUNCTION(-1, cb);

    uv_work_t *req = new uv_work_t;
    MagickBaton *baton = new MagickBaton;
    req->data = baton;
    baton->cb = Persistent<Function>::New(cb);

    const Local<Array> names = opts->GetPropertyNames();
    for (uint i = 0 ; i < names->Length(); ++i) {
        String::Utf8Value key(names->Get(i));
        String::Utf8Value val(opts->Get(names->Get(i))->ToString());
        if (!strcmp(*key, "width")) baton->width = atoi(*val); else
        if (!strcmp(*key, "height")) baton->height = atoi(*val); else
        if (!strcmp(*key, "quality")) baton->quality = atoi(*val); else
        if (!strcmp(*key, "outfile")) baton->out = *val; else
        if (!strcmp(*key, "ext")) baton->format = *val; else
        if (!strcmp(*key, "filter")) baton->filter = getMagickFilter(*val);
    }

    // If a Buffer passed we use it as a source for image
    if (args[0]->IsObject()) {
    	Local<Object> buf = args[0]->ToObject();
    	baton->length = Buffer::Length(buf);
    	baton->image = (unsigned char*)malloc(baton->length);
    	memcpy(baton->image, Buffer::Data(buf), baton->length);
    } else {
    	// Otherwise read form file
    	String::Utf8Value name(args[0]);
    	baton->path = *name;
    }

    uv_queue_work(uv_default_loop(), req, doResizeImage, (uv_after_work_cb)afterResizeImage);
    return scope.Close(Undefined());
}

static Handle<Value> resizeImageSync(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_AS_STRING(0, name);
    REQUIRE_ARGUMENT_INT(1, w);
    REQUIRE_ARGUMENT_INT(2, h);
    REQUIRE_ARGUMENT_AS_STRING(3, format);
    REQUIRE_ARGUMENT_AS_STRING(4, filter);
    REQUIRE_ARGUMENT_INT(5, quality);
    REQUIRE_ARGUMENT_AS_STRING(6, out);

    MagickWand *wand = NewMagickWand();
    MagickBooleanType status = MagickReadImage(wand, *name);
    if (status == MagickFalse) goto err;
    if (h <= 0 || w <= 0) {
        int width = MagickGetImageWidth(wand);
        int height = MagickGetImageHeight(wand);
        float aspectRatio = (width * 1.0)/height;
        if (h <= 0) h =  w * (1.0/aspectRatio); else
        if (w <= 0) w = h * aspectRatio;
    }
    if (w > 0 && h > 0) {
        status = MagickResizeImage(wand, w, h, getMagickFilter(*filter), 1.0);
        if (status == MagickFalse) goto err;
    }
    if (format.length()) MagickSetImageFormat(wand, *format);
    if (quality <= 100) MagickSetImageCompressionQuality(wand, quality);
    status = MagickWriteImage(wand, *out);
    if (status == MagickFalse) goto err;
    DestroyMagickWand(wand);
    return scope.Close(Undefined());

err:
    ExceptionType severity;
    const char *str = MagickGetException(wand, &severity);
    string msg(str);
    MagickRelinquishMemory((char*)str);
    DestroyMagickWand(wand);
    ThrowException(Exception::Error(String::New(msg.c_str())));
    return scope.Close(Undefined());
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

static Handle<Value> uuid(const Arguments& args)
{
   HandleScope scope;

   uuid_t myid;
   char buf[36+1];

   if (args.Length()) uuid_generate_time(myid); else uuid_generate(myid);
   uuid_unparse(myid, buf);

   Local<String> result = Local<String>::New(String::New(buf));
   return scope.Close(result);
}

static Handle<Value> splitArray(const Arguments& args)
{
   HandleScope scope;

   REQUIRE_ARGUMENT_STRING(0, str);
   OPTIONAL_ARGUMENT_STRING(1, delim);
   OPTIONAL_ARGUMENT_STRING(2, quotes);

   vector<string> list = strSplit(*str, *delim, *quotes);
   return scope.Close(toArray(list));
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

   REQUIRE_ARGUMENT_STRING(0, hash);

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

static Handle<Value> geoDistance(const Arguments& args)
{
   HandleScope scope;

   REQUIRE_ARGUMENT_NUMBER(0, lat1);
   REQUIRE_ARGUMENT_NUMBER(1, lon1);
   REQUIRE_ARGUMENT_NUMBER(2, lat2);
   REQUIRE_ARGUMENT_NUMBER(3, lon2);

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

void backend_init(Handle<Object> target)
{
    HandleScope scope;

    vlib_init();
    vsqlite_init();
    MagickWandGenesis();

    DebugInit(target);

    NODE_SET_METHOD(target, "splitArray", splitArray);

    NODE_SET_METHOD(target, "logging", logging);
    NODE_SET_METHOD(target, "loggingChannel", loggingChannel);

    NODE_SET_METHOD(target, "countWordsInit", countWordsInit);
    NODE_SET_METHOD(target, "countWords", countWords);
    NODE_SET_METHOD(target, "countAllWords", countAllWords);

    NODE_SET_METHOD(target, "resizeImage", resizeImage);
    NODE_SET_METHOD(target, "resizeImageSync", resizeImageSync);

    NODE_SET_METHOD(target, "uuid", uuid);

    NODE_SET_METHOD(target, "geoDistance", geoDistance);
    NODE_SET_METHOD(target, "geoBoundingBox", geoBoundingBox);
    NODE_SET_METHOD(target, "geoHashEncode", geoHashEncode);
    NODE_SET_METHOD(target, "geoHashDecode", geoHashDecode);
    NODE_SET_METHOD(target, "geoHashAdjacent", geoHashAdjacent);
    NODE_SET_METHOD(target, "geoHashGrid", geoHashGrid);
    NODE_SET_METHOD(target, "geoHashRow", geoHashRow);

    CacheInit(target);
    SyslogInit(target);
    SQLiteInit(target);
    PgSQLInit(target);
    MysqlInit(target);
    LevelDBInit(target);
    NanoMsgInit(target);
}

NODE_MODULE(backend, backend_init);
