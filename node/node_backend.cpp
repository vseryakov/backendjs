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
    unsigned int quality;
    unsigned int width;
    unsigned int height;
    char *exception;
    int err;
};

class Baton {
public:
    Baton(string k, string v = ""): key(k), value(v) {}
    ~Baton() { cb.Dispose(); }
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
    MagickBaton *mgr = (MagickBaton *)req->data;
    MagickWand *wand = NewMagickWand();
    MagickBooleanType status;
    ExceptionType severity;

    if (mgr->image) {
    	status = MagickReadImageBlob(wand, mgr->image, mgr->length);
    	free(mgr->image);
    	mgr->image = NULL;
    } else {
    	status = MagickReadImage(wand, mgr->path.c_str());
    }
    if (status == MagickFalse) goto err;
    if (mgr->height == 0 || mgr->width == 0) {
        int width = MagickGetImageWidth(wand);
        int height = MagickGetImageHeight(wand);
        float aspectRatio = (width * 1.0)/height;
        if (mgr->height == 0) mgr->height =  mgr->width * (1.0/aspectRatio); else
        if (mgr->width == 0) mgr->width = mgr->height * aspectRatio;
    }
    if (mgr->width && mgr->height) {
        status = MagickResizeImage(wand, mgr->width, mgr->height, mgr->filter, 1.0);
        if (status == MagickFalse) goto err;
    }
    if (mgr->format.size()) MagickSetImageFormat(wand, mgr->format.c_str());
    if (mgr->quality <= 100) MagickSetImageCompressionQuality(wand, mgr->quality);
    if (mgr->out.size()) {
    	// Make sure all subdirs exist
    	if (vMakePath(mgr->out)) {
    		status = MagickWriteImage(wand, mgr->out.c_str());
    		if (status == MagickFalse) goto err;
    	} else {
    		mgr->err = errno;
    	}
    } else {
        mgr->image = MagickGetImageBlob(wand, &mgr->length);
        if (!mgr->image) goto err;
    }
    DestroyMagickWand(wand);
    return;
err:
    mgr->exception = MagickGetException(wand, &severity);
    DestroyMagickWand(wand);
}

static void afterResizeImage(uv_work_t *req)
{
    HandleScope scope;
    MagickBaton *mgr = (MagickBaton *)req->data;

    Local<Value> argv[4];

    if (!mgr->cb.IsEmpty()) {
        if (mgr->err || mgr->exception) {
            argv[0] = Exception::Error(String::New(mgr->err ? strerror(mgr->err) : mgr->exception));
            TRY_CATCH_CALL(Context::GetCurrent()->Global(), mgr->cb, 1, argv);
        } else
        if (mgr->image) {
            Buffer *buf = Buffer::New((const char*)mgr->image, mgr->length);
            argv[0] = Local<Value>::New(Null());
            argv[1] = Local<Value>::New(buf->handle_);
            argv[2] = Local<Value>::New(Integer::New(mgr->width));
            argv[3] = Local<Value>::New(Integer::New(mgr->height));
            TRY_CATCH_CALL(Context::GetCurrent()->Global(), mgr->cb, 4, argv);
        } else {
        	argv[0] = Local<Value>::New(Null());
        	TRY_CATCH_CALL(Context::GetCurrent()->Global(), mgr->cb, 1, argv);
        }
    }
    if (mgr->image) MagickRelinquishMemory(mgr->image);
    if (mgr->exception) MagickRelinquishMemory(mgr->exception);
    delete mgr;
    delete req;
}

static Handle<Value> resizeImage(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT(0);
    REQUIRE_ARGUMENT_INT(1, w);
    REQUIRE_ARGUMENT_INT(2, h);
    REQUIRE_ARGUMENT_AS_STRING(3, format);
    REQUIRE_ARGUMENT_AS_STRING(4, filter);
    REQUIRE_ARGUMENT_INT(5, q);
    OPTIONAL_ARGUMENT_AS_STRING(6, out);
    EXPECT_ARGUMENT_FUNCTION(-1, cb);

    uv_work_t *req = new uv_work_t;
    MagickBaton *mgr = new MagickBaton;
    req->data = mgr;
    mgr->cb = Persistent<Function>::New(cb);
    mgr->width = w;
    mgr->height = h;
    mgr->quality = q;
    mgr->format = *format;
    mgr->out = *out;
    mgr->filter = getMagickFilter(*filter);

    // If a Buffer passed we use it as a source for image
    if (args[0]->IsObject()) {
    	Local<Object> buf = args[0]->ToObject();
    	mgr->length = Buffer::Length(buf);
    	mgr->image = (unsigned char*)malloc(mgr->length);
    	memcpy(mgr->image, Buffer::Data(buf), mgr->length);
    } else {
    	// Otherwise read form file
    	String::Utf8Value name(args[0]);
    	mgr->path = *name;
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

static Handle<Value> tokenize(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_STRING(0, word);

    vector<string> list = vsqlite_tokenize(*word);
    return scope.Close(toArray(list));
}

static Handle<Value> findSynonyms(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_STRING(0, word);

    vector<string> list = vsqlite_find_synonyms(*word);
    return scope.Close(toArray(list));
}

static Handle<Value> addSynonyms(const Arguments& args)
{
    HandleScope scope;

    if (args.Length() < 2) return ThrowException(Exception::Error(String::New("must have at least 2 parameters")));

    vector<string> words;
    for (int i = 0; i < args.Length(); i++) {
        String::Utf8Value word(args[i]);
        words.push_back(*word);
    }
    vsqlite_add_synonyms(words);

    return scope.Close(Undefined());
}

static Handle<Value> addStopword(const Arguments& args)
{
    HandleScope scope;

    for (int i = 0; i < args.Length(); i++) {
        String::Utf8Value word(args[i]);
        vsqlite_add_stopword(*word);
    }
    return scope.Close(Undefined());
}

static Handle<Value> addStemming(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_STRING(0, word);
    REQUIRE_ARGUMENT_STRING(1, rule);

    vsqlite_add_stemming(*word, *rule);

    return scope.Close(Undefined());
}

static Handle<Value> loadTokenizer(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_STRING(0, type);
    REQUIRE_ARGUMENT_STRING(1, file);

    return scope.Close(Integer::New(vsqlite_load(*type, *file)));
}

static Handle<Value> listTokenizer(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_STRING(0, type);

	vector<string> list;
    if (!strcmp(*type, "stemming")) {
    	string_map map = vsqlite_stemming_list();
    	string_map::const_iterator it = map.begin();
    	while (it != map.end()) {
    		list.push_back(it->first + "|" + it->second);
    		it++;
    	}
    }

    if (!strcmp(*type, "synonyms")) {
    	list = vsqlite_synonyms_list();
    }

    if (!strcmp(*type, "stopwords")) {
    	int_map map = vsqlite_stopwords_list();
    	int_map::const_iterator it = map.begin();
    	while (it != map.end()) {
    		list.push_back(it->first);
    		it++;
    	}
    }
	return scope.Close(toArray(list));
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

    NODE_SET_METHOD(target, "tokenize", tokenize);
    NODE_SET_METHOD(target, "addSynonyms", addSynonyms);
    NODE_SET_METHOD(target, "findSynonyms", findSynonyms);
    NODE_SET_METHOD(target, "addStopword", addStopword);
    NODE_SET_METHOD(target, "addStemming", addStemming);
    NODE_SET_METHOD(target, "loadTokenizer", loadTokenizer);
    NODE_SET_METHOD(target, "listTokenizer", listTokenizer);

    NODE_SET_METHOD(target, "countWordsInit", countWordsInit);
    NODE_SET_METHOD(target, "countWords", countWords);
    NODE_SET_METHOD(target, "countAllWords", countAllWords);

    NODE_SET_METHOD(target, "resizeImage", resizeImage);
    NODE_SET_METHOD(target, "resizeImageSync", resizeImageSync);

    NODE_SET_METHOD(target, "uuid", uuid);

    CacheInit(target);
    SyslogInit(target);
    SQLiteInit(target);
    PgSQLInit(target);
    LevelDBInit(target);
    NanoMsgInit(target);
}

NODE_MODULE(backend, backend_init);
