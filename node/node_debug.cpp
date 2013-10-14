//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  April 2013
//
//  Backtrace
//  Copyright (c) 2013, Ben Noordhuis <info@bnoordhuis.nl>
//  https://github.com/bnoordhuis/node-backtrace

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
    FileOutputStream(FILE *fp): out(fp)    {}
    void EndOfStream() { fflush(out); }
    OutputStream::WriteResult WriteAsciiChunk(char *data, int size) {
        write(fileno(out), data, size);
        return (OutputStream::kContinue);
    }
};

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

static void jsbacktrace(void)
{
    walk_stack_frames(1, print_stack_frame);
    free_code();
}

static void sigbacktrace(int)
{
    jsbacktrace();
    raise(SIGABRT);
}

static void sigsegv(int)
{
    void *array[50];
    int size;
    size = backtrace(array, 50);
    backtrace_symbols_fd(array, size, 2);
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

static Handle<Value> setsegv(const Arguments& args)
{
    install_handler(sigsegv);
    return Undefined();
}

static Handle<Value> setbacktrace(const Arguments& args)
{
    install_handler(sigbacktrace);
    walk_stack_frames(0, find_stack_top);
    return Undefined();
}

Handle<Value> backtrace(const Arguments&)
{
    jsbacktrace();
    return Undefined();
}

static Handle<Value> rungc(const Arguments& args)
{
    HandleScope scope;

    while (!V8::IdleNotification()) ;
    return scope.Close(Undefined());
}

Handle<Value> heapSnapshot(const Arguments& args)
{
    HandleScope scope;
    FileOutputStream *out;
    const HeapSnapshot *hsp;

    REQUIRE_ARGUMENT_STRING(0, name);
    FILE *fp = fopen(*name, "w");
    if (!fp) return ThrowException(Exception::Error(String::New("Cannot create file")));

    out = new FileOutputStream(fp);
    hsp = HeapProfiler::TakeSnapshot(String::New(vFmtStr("snapshot:%d", getpid()).c_str()));
    hsp->Serialize(out, HeapSnapshot::kJSON);
    HeapProfiler::DeleteAllSnapshots();
    fclose(fp);
    return scope.Close(Undefined());
}

void DebugInit(Handle<Object> target)
{
    HandleScope scope;

    NODE_SET_METHOD(target, "rungc", rungc);
    NODE_SET_METHOD(target, "setsegv", setsegv);
    NODE_SET_METHOD(target, "setbacktrace", setbacktrace);
    NODE_SET_METHOD(target, "backtrace", backtrace);
    NODE_SET_METHOD(target, "heapSnapshot", heapSnapshot);

    install_handler(sigsegv);
}

