//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  April 2013
//
//  Backtrace
//  Copyright (c) 2013, Ben Noordhuis <info@bnoordhuis.nl>
//  https://github.com/bnoordhuis/node-backtrace
//
//  V8 profiler
//  Copyright (c) 2011, Danny Coates
//  All rights reserved.
//
//  toobusy
//  Lloyd Hilaiel, lloyd@hilaiel.com
//

#include "node_backend.h"
#include <cxxabi.h>
#include <dlfcn.h>

#define OFFSET(base, addr) (static_cast<long>(static_cast<const char*>(addr) - static_cast<const char*>(base)))

// Assumes -fno-omit-frame-pointer.
struct Frame {
    const Frame* frame_pointer;
    const void* return_address;
};

// Linked list. Wildly inefficient.
struct Code {
    Code* next;
    const void* start;
    const void* end;
    char name[1]; // Variadic length.
};

struct FileOutputStream: public OutputStream {
    FILE *out;
    FileOutputStream(FILE *fp): out(fp) {}
    void EndOfStream() { fflush(out); }
    int GetChunkSize() { return 32*1024; }
    OutputStream::WriteResult WriteAsciiChunk(char *data, int size) {
        int n = write(fileno(out), data, size);
        if (n <= 0) return kAbort;
        return kContinue;
    }
};

struct SerializeOutputStream : public OutputStream {
public:
    SerializeOutputStream(Handle<Function> onData, Handle<Function> onEnd) {
        onEndFunction = onEnd;
        onDataFunction = onData;
    }
    void EndOfStream() { TRY_CATCH_CALL(Context::GetCurrent()->Global(), onEndFunction, 0, NULL); }
    int GetChunkSize() { return 10*1024; }
    WriteResult WriteAsciiChunk(char* data, int size) {
        HandleScope scope;
        Handle<Value> argv[2] = { Buffer::New(data, size)->handle_, Integer::New(size) };
        TRY_CATCH_CALL_RETURN(Context::GetCurrent()->Global(), onDataFunction, 2, argv, kAbort);
        return kContinue;
    }

private:
    Handle<Function> onEndFunction;
    Handle<Function> onDataFunction;
};

class ProfileNode {
 public:
   static Handle<Value> New(const CpuProfileNode* node) {
       HandleScope scope;
       if (node_template_.IsEmpty()) ProfileNode::Initialize();
       if (!node) return Undefined();
       Local<Object> obj = node_template_->NewInstance();
       obj->SetPointerInInternalField(0, const_cast<CpuProfileNode*>(node));
       return scope.Close(obj);
     }

 private:
   static Handle<Value> GetFunctionName(Local<String> property, const AccessorInfo& info) {
       HandleScope scope;
       Local<Object> self = info.Holder();
       void* ptr = self->GetPointerFromInternalField(0);
       Handle<String> fname = static_cast<CpuProfileNode*>(ptr)->GetFunctionName();
       return scope.Close(fname);
   }
   static Handle<Value> GetScriptName(Local<String> property, const AccessorInfo& info) {
       HandleScope scope;
       Local<Object> self = info.Holder();
       void* ptr = self->GetPointerFromInternalField(0);
       Handle<String> sname = static_cast<CpuProfileNode*>(ptr)->GetScriptResourceName();
       return scope.Close(sname);
   }
   static Handle<Value> GetLineNumber(Local<String> property, const AccessorInfo& info) {
       HandleScope scope;
       Local<Object> self = info.Holder();
       void* ptr = self->GetPointerFromInternalField(0);
       int32_t ln = static_cast<CpuProfileNode*>(ptr)->GetLineNumber();
       return scope.Close(Integer::New(ln));
   }
   static Handle<Value> GetTotalTime(Local<String> property, const AccessorInfo& info) {
       HandleScope scope;
       Local<Object> self = info.Holder();
       void* ptr = self->GetPointerFromInternalField(0);
       double ttime = static_cast<CpuProfileNode*>(ptr)->GetTotalTime();
       return scope.Close(Number::New(ttime));
   }
   static Handle<Value> GetSelfTime(Local<String> property, const AccessorInfo& info) {
       HandleScope scope;
       Local<Object> self = info.Holder();
       void* ptr = self->GetPointerFromInternalField(0);
       double stime = static_cast<CpuProfileNode*>(ptr)->GetSelfTime();
       return scope.Close(Number::New(stime));
   }
   static Handle<Value> GetTotalSamplesCount(Local<String> property, const AccessorInfo& info) {
       HandleScope scope;
       Local<Object> self = info.Holder();
       void* ptr = self->GetPointerFromInternalField(0);
       double samples = static_cast<CpuProfileNode*>(ptr)->GetTotalSamplesCount();
       return scope.Close(Number::New(samples));
   }
   static Handle<Value> GetSelfSamplesCount(Local<String> property, const AccessorInfo& info) {
       HandleScope scope;
       Local<Object> self = info.Holder();
       void* ptr = self->GetPointerFromInternalField(0);
       double samples = static_cast<CpuProfileNode*>(ptr)->GetSelfSamplesCount();
       return scope.Close(Number::New(samples));
   }
   static Handle<Value> GetCallUid(Local<String> property, const AccessorInfo& info) {
       HandleScope scope;
       Local<Object> self = info.Holder();
       void* ptr = self->GetPointerFromInternalField(0);
       uint32_t uid = static_cast<CpuProfileNode*>(ptr)->GetCallUid();
       return scope.Close(Integer::NewFromUnsigned(uid));
   }
   static Handle<Value> GetChildrenCount(Local<String> property, const AccessorInfo& info) {
       HandleScope scope;
       Local<Object> self = info.Holder();
       void* ptr = self->GetPointerFromInternalField(0);
       int32_t count = static_cast<CpuProfileNode*>(ptr)->GetChildrenCount();
       return scope.Close(Integer::New(count));
   }
   static Handle<Value> GetChild(const Arguments& args) {
       HandleScope scope;
       if (args.Length() < 1) {
         return ThrowException(Exception::Error(String::NewSymbol("No index specified")));
       } else
       if (!args[0]->IsInt32()) {
         return ThrowException(Exception::Error(String::NewSymbol("Argument must be integer")));
       }
       int32_t index = args[0]->Int32Value();
       Handle<Object> self = args.This();
       void* ptr = self->GetPointerFromInternalField(0);
       const CpuProfileNode* node = static_cast<CpuProfileNode*>(ptr)->GetChild(index);
       return scope.Close(ProfileNode::New(node));
   }
   static void Initialize() {
       node_template_ = Persistent<ObjectTemplate>::New(ObjectTemplate::New());
       node_template_->SetInternalFieldCount(1);
       node_template_->SetAccessor(String::NewSymbol("functionName"), ProfileNode::GetFunctionName);
       node_template_->SetAccessor(String::NewSymbol("scriptName"), ProfileNode::GetScriptName);
       node_template_->SetAccessor(String::NewSymbol("lineNumber"), ProfileNode::GetLineNumber);
       node_template_->SetAccessor(String::NewSymbol("totalTime"), ProfileNode::GetTotalTime);
       node_template_->SetAccessor(String::NewSymbol("selfTime"), ProfileNode::GetSelfTime);
       node_template_->SetAccessor(String::NewSymbol("totalSamplesCount"), ProfileNode::GetTotalSamplesCount);
       node_template_->SetAccessor(String::NewSymbol("selfSamplesCount"), ProfileNode::GetSelfSamplesCount);
       node_template_->SetAccessor(String::NewSymbol("callUid"), ProfileNode::GetCallUid);
       node_template_->SetAccessor(String::New("childrenCount"), ProfileNode::GetChildrenCount);
       node_template_->Set(String::NewSymbol("getChild"), FunctionTemplate::New(ProfileNode::GetChild));
   }
   static Persistent<ObjectTemplate> node_template_;
};

class Profile {
public:
    static Handle<Value> New(const CpuProfile* profile) {
        HandleScope scope;
        if (profile_template_.IsEmpty()) Profile::Initialize();
        if (!profile) return scope.Close(Undefined());
        Local<Object> obj = profile_template_->NewInstance();
        obj->SetPointerInInternalField(0, const_cast<CpuProfile*>(profile));
        return scope.Close(obj);
    }

private:
    static Handle<Value> GetUid(Local<String> property, const AccessorInfo& info) {
        HandleScope scope;
        Local<Object> self = info.Holder();
        void* ptr = self->GetPointerFromInternalField(0);
        uint32_t uid = static_cast<CpuProfile*>(ptr)->GetUid();
        return scope.Close(Integer::NewFromUnsigned(uid));
    }
    static Handle<Value> GetTitle(Local<String> property, const AccessorInfo& info) {
        HandleScope scope;
        Local<Object> self = info.Holder();
        void* ptr = self->GetPointerFromInternalField(0);
        Handle<String> title = static_cast<CpuProfile*>(ptr)->GetTitle();
        return scope.Close(title);
    }
    static Handle<Value> GetTopRoot(Local<String> property, const AccessorInfo& info) {
        HandleScope scope;
        Local<Object> self = info.Holder();
        void* ptr = self->GetPointerFromInternalField(0);
        const CpuProfileNode* node = static_cast<CpuProfile*>(ptr)->GetTopDownRoot();
        return scope.Close(ProfileNode::New(node));
    }
    static Handle<Value> GetBottomRoot(Local<String> property, const AccessorInfo& info) {
        HandleScope scope;
        Local<Object> self = info.Holder();
        void* ptr = self->GetPointerFromInternalField(0);
        const CpuProfileNode* node = static_cast<CpuProfile*>(ptr)->GetBottomUpRoot();
        return scope.Close(ProfileNode::New(node));
    }
    static Handle<Value> Delete(const Arguments& args) {
        HandleScope scope;
        Handle<Object> self = args.This();
        void* ptr = self->GetPointerFromInternalField(0);
        static_cast<CpuProfile*>(ptr)->Delete();
        return Undefined();
    }
    static void Initialize() {
        profile_template_ = Persistent<ObjectTemplate>::New(ObjectTemplate::New());
        profile_template_->SetInternalFieldCount(1);
        profile_template_->SetAccessor(String::NewSymbol("title"), Profile::GetTitle);
        profile_template_->SetAccessor(String::NewSymbol("uid"), Profile::GetUid);
        profile_template_->SetAccessor(String::NewSymbol("topRoot"), Profile::GetTopRoot);
        profile_template_->SetAccessor(String::NewSymbol("bottomRoot"), Profile::GetBottomRoot);
        profile_template_->Set(String::NewSymbol("delete"), FunctionTemplate::New(Profile::Delete));
    }
    static Persistent<ObjectTemplate> profile_template_;
};

class Snapshot {
public:
    static Handle<Value> New(const HeapSnapshot* snapshot) {
        HandleScope scope;
        if (snapshot_template_.IsEmpty()) Snapshot::Initialize();
        if (!snapshot) return Undefined();
        Local<Object> obj = snapshot_template_->NewInstance();
        obj->SetPointerInInternalField(0, const_cast<HeapSnapshot*>(snapshot));
        return scope.Close(obj);
    }

private:
    static Handle<Value> GetTitle(Local<String> property, const AccessorInfo& info) {
        HandleScope scope;
        Local<Object> self = info.Holder();
        void* ptr = self->GetPointerFromInternalField(0);
        Handle<String> title = static_cast<HeapSnapshot*>(ptr)->GetTitle();
        return scope.Close(title);
    }
    static Handle<Value> GetUid(Local<String> property, const AccessorInfo& info) {
        HandleScope scope;
        Local<Object> self = info.Holder();
        void* ptr = self->GetPointerFromInternalField(0);
        uint32_t uid = static_cast<HeapSnapshot*>(ptr)->GetUid();
        return scope.Close(Integer::NewFromUnsigned(uid));
    }
    static Handle<Value> GetType(Local<String> property, const AccessorInfo& info) {
        HandleScope scope;
        Local<Object> self = info.Holder();
        void* ptr = self->GetPointerFromInternalField(0);
        HeapSnapshot::Type type = static_cast<HeapSnapshot*>(ptr)->GetType();
        Local<String> t = String::NewSymbol(type == HeapSnapshot::kFull ? "Full" : "Unknown");
        return scope.Close(t);
    }
    static Handle<Value> Delete(const Arguments& args) {
        HandleScope scope;
        Handle<Object> self = args.This();
        void* ptr = self->GetPointerFromInternalField(0);
        static_cast<HeapSnapshot*>(ptr)->Delete();
        return Undefined();
    }
    static Handle<Value> Serialize(const Arguments& args) {
        HandleScope scope;
        Handle<Object> self = args.This();
        REQUIRE_ARGUMENT_FUNCTION(0, onData);
        REQUIRE_ARGUMENT_FUNCTION(1, onEnd);
        SerializeOutputStream *stream = new SerializeOutputStream(onData, onEnd);
        void* ptr = self->GetPointerFromInternalField(0);
        static_cast<HeapSnapshot*>(ptr)->Serialize(stream, HeapSnapshot::kJSON);
        return Undefined();
    }
    static Handle<Value> Save(const Arguments& args) {
        HandleScope scope;
        Handle<Object> self = args.This();
        REQUIRE_ARGUMENT_STRING(0, name);
        FILE *fp = fopen(*name, "w");
        if (!fp) return ThrowException(Exception::Error(String::NewSymbol("Cannot create file")));
        FileOutputStream *stream = new FileOutputStream(fp);
        void* ptr = self->GetPointerFromInternalField(0);
        static_cast<HeapSnapshot*>(ptr)->Serialize(stream, HeapSnapshot::kJSON);
        fclose(fp);
        return scope.Close(Undefined());
    }
    static void Initialize() {
        snapshot_template_ = Persistent<ObjectTemplate>::New(ObjectTemplate::New());
        snapshot_template_->SetInternalFieldCount(1);
        snapshot_template_->SetAccessor(String::NewSymbol("title"), Snapshot::GetTitle);
        snapshot_template_->SetAccessor(String::NewSymbol("uid"), Snapshot::GetUid);
        snapshot_template_->SetAccessor(String::NewSymbol("type"), Snapshot::GetType);
        snapshot_template_->Set(String::NewSymbol("delete"), FunctionTemplate::New(Snapshot::Delete));
        snapshot_template_->Set(String::NewSymbol("serialize"), FunctionTemplate::New(Snapshot::Serialize));
        snapshot_template_->Set(String::NewSymbol("save"), FunctionTemplate::New(Snapshot::Save));
    }
    static Persistent<ObjectTemplate> snapshot_template_;
};

Persistent<ObjectTemplate> Snapshot::snapshot_template_;
Persistent<ObjectTemplate> Profile::profile_template_;
Persistent<ObjectTemplate> ProfileNode::node_template_;

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

static bool run_segv = 0;
static struct Code* code_head = NULL;
static int stack_trace_index = 0;
static Local<StackTrace> stack_trace;
const Frame* stack_top = reinterpret_cast<const Frame*>(-1);

static Code* find_code(const void* addr)
{
    for (Code* code = code_head; code != NULL; code = code->next) {
        if (code->start <= addr && code->end >= addr) return code;
    }
    return NULL;
}

static void add_code(const char* name, unsigned int namelen, const void* start, const void* end)
{
    Code* code = static_cast<Code*>(malloc(sizeof(*code) + namelen));
    if (code == NULL) return;
    memcpy(code->name, name, namelen);
    code->name[namelen] = '\0';
    code->start = start;
    code->end = end;
    code->next = code_head;
    code_head = code;
}

static void free_code()
{
    while (code_head != NULL) {
        Code* code = code_head;
        code_head = code->next;
        free(code);
    }
}

static void find_stack_top(const Frame* frame)
{
    Dl_info info;
    if (dladdr(frame->return_address, &info) == 0) return;
    if (info.dli_sname == NULL) return;
#if defined(__APPLE__)
    if (strcmp(info.dli_sname, "start") == 0) stack_top = frame->frame_pointer;
#elif defined(__linux__)
    // __libc_start_main() has no next frame pointer. Scanning for main() is not
    // safe because the compiler sometimes optimizes it away entirely.
    if (strcmp(info.dli_sname, "__libc_start_main") == 0) stack_top = frame;
#endif
}

static bool print_c_frame(const Frame* frame, FILE* stream)
{
    Dl_info info;

    if (dladdr(frame->return_address, &info) == 0) return false;
    const char* name = info.dli_sname;
    const char* demangled_name = abi::__cxa_demangle(name, NULL, NULL, NULL);
    if (demangled_name != NULL) name = demangled_name;
    fprintf(stream, "%lx+%lx\t%s %s(%p)\n", reinterpret_cast<long>(info.dli_saddr), OFFSET(info.dli_saddr, frame->return_address), name, info.dli_fname, info.dli_fbase);
    if (name == demangled_name) free(const_cast<char*>(name));
    return true;
}

static void jit_code_event(const JitCodeEvent* ev)
{
    if (ev->type == JitCodeEvent::CODE_ADDED) {
        add_code(ev->name.str, ev->name.len, ev->code_start, static_cast<const char*>(ev->code_start) + ev->code_len);
    }
}

static bool print_js_frame(const Frame* frame, FILE* stream)
{
    if (!code_head) {
        V8::SetJitCodeEventHandler(kJitCodeEventEnumExisting, jit_code_event);
        V8::SetJitCodeEventHandler(kJitCodeEventDefault, NULL);
        stack_trace = StackTrace::CurrentStackTrace(64);
        stack_trace_index = 0;
    }

    Code* code = find_code(frame->return_address);
    if (!code) return false;

    if (stack_trace_index < stack_trace->GetFrameCount()) {
        Local<StackFrame> js_frame = stack_trace->GetFrame(stack_trace_index++);
        String::Utf8Value function_name(js_frame->GetFunctionName());
        if (function_name.length() > 0) {
            String::Utf8Value script_name(js_frame->GetScriptName());
            fprintf(stream, "js: %lx+%lx\t%s %s:%d:%d\n",
                    reinterpret_cast<long>(code->start), OFFSET(code->start, frame->return_address), *function_name, *script_name, js_frame->GetLineNumber(), js_frame->GetColumn());
            return true;
        }
    }
    fprintf(stream, "js: %lx+%lx\t%s\n", reinterpret_cast<long>(code->start), OFFSET(code->start, frame->return_address), code->name);
    return true;
}

static void print_stack_frame(const Frame* frame)
{
    if (print_c_frame(frame, stderr)) return;
    if (print_js_frame(frame, stderr)) return;
    fprintf(stderr, "%lx\n", reinterpret_cast<long>(frame->return_address));
}

__attribute__((noinline)) void walk_stack_frames(unsigned skip, void (*cb)(const Frame* frame))
{
    const Frame* frame;

#if defined(__x86_64__)
    __asm__ __volatile__ ("mov %%rbp, %0" : "=g" (frame));
#elif defined(__i386__)
    __asm__ __volatile__ ("mov %%ebp, %0" : "=g" (frame));
#endif

    do {
        if (skip == 0) cb(frame); else skip -= 1;
    } while ((frame = frame->frame_pointer) != NULL && frame < stack_top);
}

static void jsBacktrace(void)
{
    walk_stack_frames(1, print_stack_frame);
    free_code();
}

static void sigBacktrace(int)
{
    jsBacktrace();
    fprintf(stderr, "SEGV[%d]: ERROR: keep running=%d\n", getpid(), run_segv);
    while (run_segv) sleep(1);
    raise(SIGABRT);
}

static void sigSEGV(int)
{
    void *array[50];
    int size;
    size = backtrace(array, 50);
    backtrace_symbols_fd(array, size, 2);
    fprintf(stderr, "SEGV[%d]: ERROR: keep running=%d\n", getpid(), run_segv);
    while (run_segv) sleep(1);
    raise(SIGSEGV);
}

static void install_handler(sig_t func)
{
    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_flags = SA_RESETHAND;
    sa.sa_handler = func;
    sigaction(SIGABRT, &sa, NULL);
    sigaction(SIGSEGV, &sa, NULL);
    sigaction(SIGBUS, &sa, NULL);
}

static Handle<Value> runSEGV(const Arguments& args)
{
    OPTIONAL_ARGUMENT_AS_INT(0, on);
    run_segv = on;
    return Undefined();
}

static Handle<Value> setSEGV(const Arguments& args)
{
    install_handler(sigSEGV);
    return Undefined();
}

static Handle<Value> setBacktrace(const Arguments& args)
{
    install_handler(sigBacktrace);
    walk_stack_frames(0, find_stack_top);
    return Undefined();
}

Handle<Value> backtrace(const Arguments&)
{
    jsBacktrace();
    return Undefined();
}

static Handle<Value> runGC(const Arguments& args)
{
    HandleScope scope;

    while (!V8::IdleNotification()) ;
    return scope.Close(Undefined());
}

static Handle<Value> GetSnapshotsCount(const Arguments& args)
{
    HandleScope scope;
    return scope.Close(Integer::New(v8::HeapProfiler::GetSnapshotsCount()));
}

static Handle<Value> GetSnapshot(const Arguments& args)
{
    HandleScope scope;
    REQUIRE_ARGUMENT_INT(0, index);
    const v8::HeapSnapshot* snapshot = v8::HeapProfiler::GetSnapshot(index);
    return scope.Close(Snapshot::New(snapshot));
}

static Handle<Value> FindSnapshot(const Arguments& args)
{
    HandleScope scope;
    REQUIRE_ARGUMENT_INT(0, uid);
    const v8::HeapSnapshot* snapshot = v8::HeapProfiler::FindSnapshot(uid);
    return scope.Close(Snapshot::New(snapshot));
}

static Handle<Value> TakeSnapshot(const Arguments& args)
{
    HandleScope scope;
    const v8::HeapSnapshot* snapshot = v8::HeapProfiler::TakeSnapshot(args.Length() > 0 ? args[0]->ToString() : Local<String>::New(String::NewSymbol("")));
    return scope.Close(Snapshot::New(snapshot));
}

static Handle<Value> DeleteAllSnapshots(const Arguments& args)
{
    HandleScope scope;
    v8::HeapProfiler::DeleteAllSnapshots();
    return Undefined();
}

static Handle<Value> GetProfilesCount(const Arguments& args)
{
    HandleScope scope;
    return scope.Close(Integer::New(v8::CpuProfiler::GetProfilesCount()));
}

static Handle<Value> GetProfile(const Arguments& args)
{
    HandleScope scope;
    REQUIRE_ARGUMENT_INT(0, index);
    if (index < v8::CpuProfiler::GetProfilesCount()) {
        const CpuProfile* profile = v8::CpuProfiler::GetProfile(index);
        return scope.Close(Profile::New(profile));
    }
    return scope.Close(Undefined());
}

static Handle<Value> FindProfile(const Arguments& args)
{
    HandleScope scope;
    REQUIRE_ARGUMENT_INT(0, uid);
    const CpuProfile* profile = v8::CpuProfiler::FindProfile(uid);
    return scope.Close(Profile::New(profile));
}

static Handle<Value> StartProfiling(const Arguments& args)
{
    HandleScope scope;
    Local<String> title = args.Length() > 0 ? args[0]->ToString() : String::NewSymbol("");
    v8::CpuProfiler::StartProfiling(title);
    return Undefined();
}

static Handle<Value> StopProfiling(const Arguments& args)
{
    HandleScope scope;
    Local<String> title = args.Length() > 0 ? args[0]->ToString() : String::NewSymbol("");
    const CpuProfile* profile = v8::CpuProfiler::StopProfiling(title);
    return scope.Close(Profile::New(profile));
}

static Handle<Value> DeleteAllProfiles(const Arguments& args)
{
    v8::CpuProfiler::DeleteAllProfiles();
    return Undefined();
}

static Handle<Value> initBusy(const Arguments& args)
{
    HandleScope scope;
    OPTIONAL_ARGUMENT_INT(0, ms);

    if (ms > 10) HIGH_WATER_MARK_MS = ms;

    if (!_busyTimer.data) {
        uv_timer_init(uv_default_loop(), &_busyTimer);
        uv_timer_start(&_busyTimer, busy_timer, POLL_PERIOD_MS, POLL_PERIOD_MS);
        _busyTimer.data = (void*)1;
    }
    return scope.Close(Number::New(HIGH_WATER_MARK_MS));
}

static Handle<Value> isBusy(const Arguments& args)
{
    if (_currentLag > HIGH_WATER_MARK_MS) {
        // probabilistically block requests proportional to how far behind we are.
        double pctToBlock = ((_currentLag - HIGH_WATER_MARK_MS) / (double) HIGH_WATER_MARK_MS) * 100.0;
        double r = (rand() / (double) RAND_MAX) * 100.0;
        if (r < pctToBlock) return True();
    }
    return False();
}

static Handle<Value> getBusy(const Arguments& args)
{
    HandleScope scope;
    return scope.Close(Integer::New(_currentLag));
}

void DebugInit(Handle<Object> target)
{
    HandleScope scope;
    _busyTimer.data = NULL;

    NODE_SET_METHOD(target, "runGC", runGC);
    NODE_SET_METHOD(target, "setSEGV", setSEGV);
    NODE_SET_METHOD(target, "runSEGV", runSEGV);
    NODE_SET_METHOD(target, "setBacktrace", setBacktrace);
    NODE_SET_METHOD(target, "backtrace", backtrace);

    NODE_SET_METHOD(target, "takeSnapshot", TakeSnapshot);
    NODE_SET_METHOD(target, "getSnapshot", GetSnapshot);
    NODE_SET_METHOD(target, "findSnapshot", FindSnapshot);
    NODE_SET_METHOD(target, "getSnapshotsCount", GetSnapshotsCount);
    NODE_SET_METHOD(target, "deleteAllSnapshots", DeleteAllSnapshots);

    NODE_SET_METHOD(target, "getProfilesCount", GetProfilesCount);
    NODE_SET_METHOD(target, "getProfile", GetProfile);
    NODE_SET_METHOD(target, "findProfile", FindProfile);
    NODE_SET_METHOD(target, "startProfiling", StartProfiling);
    NODE_SET_METHOD(target, "stopProfiling", StopProfiling);
    NODE_SET_METHOD(target, "deleteAllProfiles", DeleteAllProfiles);

    NODE_SET_METHOD(target, "isBusy", isBusy);
    NODE_SET_METHOD(target, "initBusy", initBusy);
    NODE_SET_METHOD(target, "getBusy", getBusy);
}

