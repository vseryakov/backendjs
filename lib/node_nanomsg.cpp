//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  April 2013
//

#include "node_backend.h"

#ifdef USE_NANOMSG

#include <nanomsg/nn.h>
#include <nanomsg/bus.h>
#include <nanomsg/tcp.h>
#include <nanomsg/ipc.h>
#include <nanomsg/pair.h>
#include <nanomsg/inproc.h>
#include <nanomsg/survey.h>
#include <nanomsg/pipeline.h>
#include <nanomsg/pubsub.h>
#include <nanomsg/reqrep.h>

#if defined __GNUC__ || defined __llvm__
#define nn_fast(x) __builtin_expect ((x), 1)
#define nn_slow(x) __builtin_expect ((x), 0)
#else
#define nn_fast(x) (x)
#define nn_slow(x) (x)
#endif

static map<uint,int> _socks;

class NNSocket: public ObjectWrap {
public:
    static Persistent<FunctionTemplate> constructor_template;
    static void Init(Handle<Object> target);
    static inline bool HasInstance(Handle<Value> val) { return constructor_template->HasInstance(val); }
    static Handle<Value> SocketGetter(Local<String> str, const AccessorInfo& accessor);
    static Handle<Value> ErrnoGetter(Local<String> str, const AccessorInfo& accessor);
    static Handle<Value> ReadFdGetter(Local<String> str, const AccessorInfo& accessor);
    static Handle<Value> WriteFdGetter(Local<String> str, const AccessorInfo& accessor);

    static Handle<Value> New(const Arguments& args);
    static Handle<Value> Close(const Arguments& args);
    static Handle<Value> Subscribe(const Arguments& args);
    static Handle<Value> Bind(const Arguments& args);
    static Handle<Value> SetOption(const Arguments& args);
    static Handle<Value> Connect(const Arguments& args);
    static Handle<Value> Unsubscribe(const Arguments& args);
    static Handle<Value> Send(const Arguments& args);
    static Handle<Value> Recv(const Arguments& args);
    static Handle<Value> SetCallback(const Arguments& args);
    static Handle<Value> SetProxy(const Arguments& args);
    static Handle<Value> SetForward(const Arguments& args);

    NNSocket(int d = AF_SP, int t = NN_SUB): sock(-1), err(0), domain(d), type(t), rfd(-1), wfd(-1) {
        poll.data = NULL;
        Setup();
        if (sock> -1) _socks[sock] = type;
    }

    ~NNSocket() {
        _socks.erase(sock);
        Close();
    }

    int sock;
    int err;

    // Config parameters
    int domain;
    int type;
    string url;

    // Socket OS descriptors
    int rfd;
    int wfd;

    // Socket read/write support
    uv_poll_t poll;
    Persistent<Function> callback;

    // Peer for forwading
    int peer;

    int Setup() {
        sock = nn_socket(domain, type);
        if (sock == -1) return Close();
        size_t fdsz = sizeof(rfd);
        nn_getsockopt(sock, NN_SOL_SOCKET, NN_RCVFD, (char*) &rfd, &fdsz);
        nn_getsockopt(sock, NN_SOL_SOCKET, NN_SNDFD, (char*) &wfd, &fdsz);
        LogDebug("%d, domain=%d, type=%d, rfd=%d, wfd=%d", sock, domain, type, rfd, wfd);
        return 0;
    }

    int Close(int rc = 0) {
        err = nn_errno();
        if (rc == -1) LogError("%d, domain=%d, type=%d, err=%s:%d", sock, domain, type, nn_strerror(err), err);
        ClosePoll();
        if (sock > 0) nn_close(sock), sock = -1, rfd = -1, wfd = -1;
        return rc;
    }

    int ClosePoll() {
        if (!callback.IsEmpty()) callback.Dispose();
        if (poll.data) uv_poll_stop(&poll), poll.data = NULL;
        peer = NULL;
        return 0;
    }

    int Bind(string addr) {
        url = addr;
        vector<string> urls = strSplit(url);
        for (uint i = 0; i < urls.size(); i++) {
        	if (!urls[i].size()) continue;
            int rc = nn_bind(sock, urls[i].c_str());
            if (nn_slow(rc == -1)) return Close(rc);
        }
        LogDebug("%d, domain=%d, type=%d, rfd=%d, wfd=%d, %s", sock, domain, type, rfd, wfd, addr.c_str());
        return 0;
    }

    int Connect(string addr) {
        url = addr;
        vector<string> urls = strSplit(url);
        for (uint i = 0; i < urls.size(); i++) {
            int rc = nn_connect(sock, urls[i].c_str());
            if (nn_slow(rc == -1)) return Close(rc);
        }
        LogDebug("%d, domain=%d, type=%d, rfd=%d, wfd=%d, %s", sock, domain, type, rfd, wfd, addr.c_str());
        return 0;
    }

    int Subscribe(string topic) {
        int rc = nn_setsockopt(sock, NN_SUB, NN_SUB_SUBSCRIBE, topic.c_str(), 0);
        if (nn_slow(rc == -1)) return Close(rc);
        return 0;
    }

    int Unsubscribe(string topic) {
        int rc = nn_setsockopt(sock, NN_SUB, NN_SUB_UNSUBSCRIBE, topic.c_str(), 0);
        if (nn_slow(rc == -1)) return Close(rc);
        return 0;
    }

    int SetOption(int opt, int n) {
    	int rc = nn_setsockopt(sock, type, opt, &n, sizeof(n));
    	if (nn_slow(rc == -1)) return Close(rc);
    	return 0;
    }

    int SetOption(int opt, string s) {
    	int rc = nn_setsockopt(sock, type, opt, s.c_str(), 0);
    	if (nn_slow(rc == -1)) return Close(rc);
    	return 0;
    }

    int SetCallback(Handle<Function> cb) {
        ClosePoll();
        if (rfd == -1 || cb.IsEmpty()) return 0;
        callback = Persistent<Function>::New(cb);
        uv_poll_init(uv_default_loop(), &poll, rfd);
        uv_poll_start(&poll, UV_READABLE, HandleRead);
        poll.data = (void*)this;
        return 0;
    }

    static void HandleRead(uv_poll_t *w, int status, int revents) {
        NNSocket *s = (NNSocket*)w->data;
        if (nn_slow(status == -1 || !(revents & UV_READABLE))) return;

        char *buf;
        HandleScope scope;
        int n = nn_recv(s->sock, (void*)&buf, NN_MSG, NN_DONTWAIT);
        if (!s->callback.IsEmpty() && s->callback->IsFunction()) {
            if (nn_slow(n == -1)) {
                s->err = nn_errno();
                Local <Value> argv[1];
                argv[0] = Exception::Error(String::New(nn_strerror(nn_errno())));
                TRY_CATCH_CALL(s->handle_, s->callback, 1, argv);
            } else {
                Local <Value> argv[2];
                argv[0] = Local<Value>::New(Null());
                argv[1] = Local<String>::New(String::New(buf));
                TRY_CATCH_CALL(s->handle_, s->callback, 2, argv);
            }
        }
        nn_freemsg(buf);
    }

    // Implements a device, tranparent proxy between two sockets
    int SetProxy(NNSocket *p) {
        if (!p) return -1;
        // Make sure we are compatible with the peer
        if (type / 16 != p->type / 16 || domain != AF_SP_RAW || p->domain != AF_SP_RAW) {
            LogError("%d: invalid socket types: %d/%d %d/%d", sock, domain, type, p->domain, p->type);
            err = EINVAL;
            return -1;
        }
        //  Check the directionality of the sockets.
        if ((rfd != -1 && p->wfd == -1) || (wfd != -1 && p->rfd == -1) || (p->rfd != -1 && wfd == -1) || (p->wfd != -1 && rfd == -1)) {
            LogError("%d: invalid direction of sockets: %d/%d - %d/%d", sock, rfd, wfd, p->rfd, p->wfd);
            err = EINVAL;
            return -1;
        }

        ClosePoll();
        peer = p->sock;
        // The peer must have read socket which it will forward to our write socket or vice versa
        if (rfd == -1) return 0;
        uv_poll_init(uv_default_loop(), &poll, rfd);
        uv_poll_start(&poll, UV_READABLE, HandleForward);
        poll.data = (void*)this;
        return 0;
    }

    // Forwards msgs from the current socket to the peer, one way
    int SetForward(NNSocket *p) {
    	if (!p) return -1;
    	if (rfd == -1 || p->wfd == -1) {
    		LogError("%d: invalid direction of sockets: %d/%d - %d/%d", sock, rfd, wfd, p->rfd, p->wfd);
    		err = EINVAL;
    		return -1;
    	}

    	ClosePoll();
    	peer = p->sock;
    	uv_poll_init(uv_default_loop(), &poll, rfd);
    	uv_poll_start(&poll, UV_READABLE, HandleForward);
    	poll.data = (void*)this;
    	return 0;
    }

    static void HandleForward(uv_poll_t *w, int status, int revents) {
        NNSocket *s = (NNSocket*)w->data;
        if (nn_slow(status == -1 || !(revents & UV_READABLE))) return;

        void *body;
        void *control;
        struct nn_iovec iov;
        struct nn_msghdr hdr;

        iov.iov_base = &body;
        iov.iov_len = NN_MSG;
        memset (&hdr, 0, sizeof (hdr));
        hdr.msg_iov = &iov;
        hdr.msg_iovlen = 1;
        hdr.msg_control = &control;
        hdr.msg_controllen = NN_MSG;
        int rc = nn_recvmsg(s->sock, &hdr, NN_DONTWAIT);
        if (rc == -1) {
        	s->err = nn_errno();
        	return;
        }
        rc = nn_sendmsg(s->peer, &hdr, NN_DONTWAIT);
        if (rc == -1) s->err = nn_errno();
    }

};

Persistent<FunctionTemplate> NNSocket::constructor_template;

static Handle<Value> Sockets(const Arguments& args)
{
    HandleScope scope;

    Local<Array> rc = Array::New();
    map<uint,int>::const_iterator it = _socks.begin();
    int i = 0;
    while (it != _socks.end()) {
        Local<Object> obj = Local<Object>::New(Object::New());
        obj->Set(String::NewSymbol("sock"), Local<Integer>::New(Integer::New(it->first)));
        obj->Set(String::NewSymbol("type"), Local<Integer>::New(Integer::New(it->second)));
        rc->Set(Integer::New(i), obj);
        it++;
        i++;
    }
    return scope.Close(rc);
}

void NNSocket::Init(Handle<Object> target)
{
    HandleScope scope;

    NODE_SET_METHOD(target, "nnSockets", Sockets);

    Local < FunctionTemplate > t = FunctionTemplate::New(New);
    constructor_template = Persistent < FunctionTemplate > ::New(t);
    constructor_template->InstanceTemplate()->SetInternalFieldCount(1);
    constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("writefd"), WriteFdGetter);
    constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("readfd"), ReadFdGetter);
    constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("errno"), ErrnoGetter);
    constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("socket"), SocketGetter);
    constructor_template->SetClassName(String::NewSymbol("NNSocket"));

    NODE_SET_PROTOTYPE_METHOD(constructor_template, "subscribe", Subscribe);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "bind", Bind);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "close", Close);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "setOption", SetOption);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "connect", Connect);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "unsubscribe", Unsubscribe);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "send", Send);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "recv", Recv);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "setCallback", SetCallback);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "setProxy", SetProxy);
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "setForward", SetForward);

    target->Set(String::NewSymbol("NNSocket"), constructor_template->GetFunction());
}

void NanoMsgInit(Handle<Object> target)
{
    HandleScope scope;

    NNSocket::Init(target);

    for (int i = 0; ; i++) {
        int val;
        const char* name = nn_symbol (i, &val);
        if (!name) break;
        target->Set(String::NewSymbol(name), Integer::New(val), static_cast<PropertyAttribute>(ReadOnly | DontDelete) );
    }

}

Handle<Value> NNSocket::New(const Arguments& args)
{
    HandleScope scope;

    if (!args.IsConstructCall()) return ThrowException(Exception::TypeError(String::New("Use the new operator to create new NNSocket objects")));

    REQUIRE_ARGUMENT_INT(0, domain);
    REQUIRE_ARGUMENT_INT(1, type);

    NNSocket* sock = new NNSocket(domain, type);
    sock->Wrap(args.This());

    return args.This();
}

Handle<Value> NNSocket::SocketGetter(Local<String> str, const AccessorInfo& accessor)
{
    HandleScope scope;
    NNSocket* sock= ObjectWrap::Unwrap < NNSocket > (accessor.This());
    return Integer::New(sock->sock);
}

Handle<Value> NNSocket::ErrnoGetter(Local<String> str, const AccessorInfo& accessor)
{
    HandleScope scope;
    NNSocket* sock= ObjectWrap::Unwrap < NNSocket > (accessor.This());
    return Integer::New(sock->err);
}

Handle<Value> NNSocket::ReadFdGetter(Local<String> str, const AccessorInfo& accessor)
{
    HandleScope scope;
    NNSocket* sock= ObjectWrap::Unwrap < NNSocket > (accessor.This());
    return Integer::New(sock->rfd);
}

Handle<Value> NNSocket::WriteFdGetter(Local<String> str, const AccessorInfo& accessor)
{
    HandleScope scope;
    NNSocket* sock= ObjectWrap::Unwrap < NNSocket > (accessor.This());
    return Integer::New(sock->wfd);
}

Handle<Value> NNSocket::Close(const Arguments& args)
{
    HandleScope scope;

    NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
    sock->Close();

    return args.This();
}

Handle<Value> NNSocket::Connect(const Arguments& args)
{
    HandleScope scope;

    NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
    REQUIRE_ARGUMENT_AS_STRING(0, addr);

    int rc = sock->Connect(*addr);
    if (rc == -1) return ThrowException(Exception::Error(String::New(nn_strerror(sock->err))));
    return scope.Close(Integer::New(rc));
}

Handle<Value> NNSocket::Bind(const Arguments& args)
{
    HandleScope scope;

    NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
    REQUIRE_ARGUMENT_AS_STRING(0, addr);

    int rc = sock->Bind(*addr);
    if (rc == -1) return ThrowException(Exception::Error(String::New(nn_strerror(sock->err))));
    return scope.Close(Integer::New(rc));
}

Handle<Value> NNSocket::SetOption(const Arguments& args)
{
    HandleScope scope;

    NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
    REQUIRE_ARGUMENT_INT(0, opt);
    REQUIRE_ARGUMENT(1);

    int rc = 0;
    if (args[2]->IsString()) {
    	REQUIRE_ARGUMENT_STRING(1, s);
    	rc = sock->SetOption(opt, *s);
    } else
    if (args[2]->IsInt32()) {
    	REQUIRE_ARGUMENT_INT(2, n);
    	rc = sock->SetOption(opt, n);
    }
    if (rc == -1) return ThrowException(Exception::Error(String::New(nn_strerror(sock->err))));
    return scope.Close(Integer::New(rc));
}

Handle<Value> NNSocket::Subscribe(const Arguments& args)
{
    HandleScope scope;

    NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
    REQUIRE_ARGUMENT_AS_STRING(0, topic);

    int rc = sock->Subscribe(*topic);
    if (rc == -1) return ThrowException(Exception::Error(String::New(nn_strerror(sock->err))));
    return scope.Close(Integer::New(rc));
}

Handle<Value> NNSocket::Unsubscribe(const Arguments& args)
{
    HandleScope scope;

    NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
    REQUIRE_ARGUMENT_AS_STRING(0, topic);

    int rc = sock->Unsubscribe(*topic);
    if (rc == -1) return ThrowException(Exception::Error(String::New(nn_strerror(sock->err))));
    return scope.Close(Integer::New(rc));
}

Handle<Value> NNSocket::SetCallback(const Arguments& args)
{
    HandleScope scope;

    NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
    REQUIRE_ARGUMENT_FUNCTION(0, cb);

    int rc = sock->SetCallback(cb);
    if (rc == -1) return ThrowException(Exception::Error(String::New(nn_strerror(sock->err))));
    return scope.Close(Integer::New(rc));
}

Handle<Value> NNSocket::SetProxy(const Arguments& args)
{
    HandleScope scope;

    NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
    REQUIRE_ARGUMENT_OBJECT(0, obj);
    if (!HasInstance(args[0])) return ThrowException(Exception::Error(String::New("arg 0 be an instance of NNSocket")));
    NNSocket *sock2 = ObjectWrap::Unwrap< NNSocket > (obj);

    int rc = sock->SetProxy(sock2);
    if (rc == -1) return ThrowException(Exception::Error(String::New(nn_strerror(sock->err))));
    rc = sock2->SetProxy(sock);
    if (rc == -1) return ThrowException(Exception::Error(String::New(nn_strerror(sock2->err))));
    return scope.Close(Integer::New(rc));
}

Handle<Value> NNSocket::SetForward(const Arguments& args)
{
    HandleScope scope;

    NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
    REQUIRE_ARGUMENT_OBJECT(0, obj);
    if (!HasInstance(args[0])) return ThrowException(Exception::Error(String::New("arg 0 be an instance of NNSocket")));
    NNSocket *sock2 = ObjectWrap::Unwrap< NNSocket > (obj);

    int rc = sock->SetForward(sock2);
    if (rc == -1) return ThrowException(Exception::Error(String::New(nn_strerror(sock->err))));
    return scope.Close(Integer::New(rc));
}

Handle<Value> NNSocket::Send(const Arguments& args)
{
    HandleScope scope;

    NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
    REQUIRE_ARGUMENT_AS_STRING(0, str);

    void *buf = nn_allocmsg(str.length() + 1, 0);
    memcpy(buf, *str, str.length() + 1);
    int rc = nn_send(sock->sock, &buf, NN_MSG, NN_DONTWAIT);
    if (rc == -1) return ThrowException(Exception::Error(String::New(nn_strerror(sock->err))));
    return scope.Close(Integer::New(rc));
}

Handle<Value> NNSocket::Recv(const Arguments& args)
{
    HandleScope scope;

    NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
    char *data = NULL;
    int rc = nn_recv(sock->sock, &data, NN_MSG, NN_DONTWAIT);
    if (rc == -1) return ThrowException(Exception::Error(String::New(nn_strerror(sock->err))));
    Buffer *buffer = Buffer::New(data, rc, (Buffer::free_callback)nn_freemsg, NULL);
    return scope.Close(Local<Value>::New(buffer->handle_));
}

#endif
