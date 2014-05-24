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

class NNSocket: public ObjectWrap {
public:
    NNSocket(int d = AF_SP, int t = NN_SUB): sock(-1), err(0), domain(d), type(t), rfd(-1), wfd(-1), peer(-1) {
        poll.data = NULL;
        Setup();
    }

    ~NNSocket() {
        Close();
    }

    int sock;
    int err;

    // Config parameters
    int domain;
    int type;
    vector<string> address;

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
        if (sock < 0) return Close(sock);
        size_t fdsz = sizeof(rfd);
        nn_getsockopt(sock, NN_SOL_SOCKET, NN_RCVFD, (char*) &rfd, &fdsz);
        nn_getsockopt(sock, NN_SOL_SOCKET, NN_SNDFD, (char*) &wfd, &fdsz);
        LogDev("%d, domain=%d, type=%d, rfd=%d, wfd=%d", sock, domain, type, rfd, wfd);
        return 0;
    }

    int Close(int rc = 0) {
        err = nn_errno();
        if (rc == -1) LogError("%d, domain=%d, type=%d, err=%s:%d", sock, domain, type, nn_strerror(err), err);
        ClosePoll();
        if (sock >= 0) nn_close(sock);
        sock = rfd = wfd = -1;
        address.clear();
        return err;
    }

    int ClosePoll() {
        if (!callback.IsEmpty()) callback.Dispose();
        if (poll.data) uv_poll_stop(&poll), poll.data = NULL;
        peer = -1;
        return 0;
    }

    int Bind(string addr) {
        LogDev("%d, domain=%d, type=%d, rfd=%d, wfd=%d, %s", sock, domain, type, rfd, wfd, addr.c_str());
        if (sock < 0) return ENOTSOCK;
        vector<string> urls = strSplit(addr, " ,");
        for (uint i = 0; i < urls.size(); i++) {
        	if (!urls[i].size()) continue;
        	if (find(address.begin(), address.end(), urls[i]) != address.end()) continue;
            int rc = nn_bind(sock, urls[i].c_str());
            if (nn_slow(rc == -1)) return err = nn_errno();
            address.push_back(urls[i]);
        }
        return 0;
    }

    int Connect(string addr) {
        LogDev("%d, domain=%d, type=%d, rfd=%d, wfd=%d, %s", sock, domain, type, rfd, wfd, addr.c_str());
        if (sock < 0) return ENOTSOCK;
        vector<string> urls = strSplit(addr, " ,");
        for (uint i = 0; i < urls.size(); i++) {
            if (!urls[i].size()) continue;
            if (find(address.begin(), address.end(), urls[i]) != address.end()) continue;
            int rc = nn_connect(sock, urls[i].c_str());
            if (nn_slow(rc == -1)) return err = nn_errno();
            address.push_back(urls[i]);
        }
        return 0;
    }

    int Subscribe(string topic) {
        if (sock < 0) return ENOTSOCK;
        int rc = nn_setsockopt(sock, NN_SUB, NN_SUB_SUBSCRIBE, topic.c_str(), 0);
        if (nn_slow(rc == -1)) return err = nn_errno();
        return 0;
    }

    int Unsubscribe(string topic) {
        if (sock < 0) return ENOTSOCK;
        int rc = nn_setsockopt(sock, NN_SUB, NN_SUB_UNSUBSCRIBE, topic.c_str(), 0);
        if (nn_slow(rc == -1)) return err = nn_errno();
        return 0;
    }

    int SetOption(int opt, int n) {
        if (sock < 0) return ENOTSOCK;
    	int rc = nn_setsockopt(sock, type, opt, &n, sizeof(n));
    	if (nn_slow(rc == -1)) return err = nn_errno();
    	return 0;
    }

    int SetOption(int opt, string s) {
        if (sock < 0) return ENOTSOCK;
    	int rc = nn_setsockopt(sock, type, opt, s.c_str(), 0);
    	if (nn_slow(rc == -1)) return err = nn_errno();
    	return 0;
    }

    int Send(void *data, int len) {
        if (sock < 0) return ENOTSOCK;
        void *buf = nn_allocmsg(len, 0);
        memcpy(buf, data, len + 1);
        int rc = nn_send(sock, &buf, NN_MSG, NN_DONTWAIT);
        if (nn_slow(rc == -1)) return err = nn_errno();
        return 0;
    }

    int Recv(char **data, int *size) {
        if (sock < 0) return ENOTSOCK;
        if (!data || !size) return EINVAL;
        int rc = nn_recv(sock, data, NN_MSG, NN_DONTWAIT);
        if (rc == -1) return err = nn_errno();
        *size = rc;
        return 0;
    }

    static void HandleRead(uv_poll_t *w, int status, int revents) {
        NNSocket *s = (NNSocket*)w->data;
        if (nn_slow(status == -1 || !(revents & UV_READABLE))) return;
        if (s->sock < 0) return;

        char *buf;
        HandleScope scope;
        int n = nn_recv(s->sock, (void*)&buf, NN_MSG, NN_DONTWAIT);

        // Send it out before calling the callback
        if (s->peer > -1 && n != -1) {
            nn_send(s->peer, buf, n, NN_DONTWAIT);
        }

        if (!s->callback.IsEmpty() && s->callback->IsFunction()) {
            if (n == -1) {
                s->err = nn_errno();
                if (s->err == EAGAIN || s->err == EINTR) return;
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
        if (n != -1) nn_freemsg(buf);
    }

    static void HandleForward(uv_poll_t *w, int status, int revents) {
        NNSocket *s = (NNSocket*)w->data;
        if (nn_slow(status == -1 || !(revents & UV_READABLE))) return;
        if (s->sock < 0 || s->peer < 0) return;

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

    // Implements a device, tranparent proxy between two sockets
    int SetProxy(NNSocket *p) {
        if (sock < 0) return ENOTSOCK;
        if (!p) return err = EINVAL;
        // Make sure we are compatible with the peer
        if (type / 16 != p->type / 16 || domain != AF_SP_RAW || p->domain != AF_SP_RAW) {
            LogError("%d: invalid socket types: %d/%d %d/%d", sock, domain, type, p->domain, p->type);
            return err = EINVAL;
        }
        //  Check the directionality of the sockets.
        if ((rfd != -1 && p->wfd == -1) || (wfd != -1 && p->rfd == -1) || (p->rfd != -1 && wfd == -1) || (p->wfd != -1 && rfd == -1)) {
            LogError("%d: invalid direction of sockets: %d/%d - %d/%d", sock, rfd, wfd, p->rfd, p->wfd);
            return err = EINVAL;
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

    int SetCallback(Handle<Function> cb) {
        ClosePoll();
        if (sock < 0) return ENOTSOCK;
        if (rfd == -1 || cb.IsEmpty()) return 0;
        callback = Persistent<Function>::New(cb);
        uv_poll_init(uv_default_loop(), &poll, rfd);
        uv_poll_start(&poll, UV_READABLE, HandleRead);
        poll.data = (void*)this;
        return 0;
    }

    // Set forwarding peer for the regular socket, will be used by reading handler
    int SetPeer(NNSocket *p) {
        if (sock < 0) return ENOTSOCK;
        peer = p && p->wfd != -1 ? p->sock : -1;
        return 0;
    }

    // Forwards msgs from the current socket to the peer, one way
    int SetForward(NNSocket *p) {
        if (sock < 0) return ENOTSOCK;
    	if (!p) return err = EINVAL;
    	if (rfd == -1 || p->wfd == -1) {
    		LogError("%d: invalid direction of sockets: %d/%d - %d/%d", sock, rfd, wfd, p->rfd, p->wfd);
    		return err = EINVAL;
    	}

    	ClosePoll();
    	peer = p->sock;
    	uv_poll_init(uv_default_loop(), &poll, rfd);
    	uv_poll_start(&poll, UV_READABLE, HandleForward);
    	poll.data = (void*)this;
    	return 0;
    }

    static void _device(void *arg) {
        NNSocket *sock = (NNSocket*)arg;
        sock->err = nn_device(sock->sock, sock->peer);
        if (sock->err) LogError("%d: peer=%d", sock, sock->peer, nn_strerror(sock->err));
    }

    int StartDevice(NNSocket *p) {
        if (sock < 0) return ENOTSOCK;
        peer = p ? p->sock : -1;
        if (peer < 0) return EINVAL;
        uv_thread_t tid;
        uv_thread_create(&tid, _device, (void*)this);
        return 0;
    }

    static Persistent<FunctionTemplate> constructor_template;
    static inline bool HasInstance(Handle<Value> val) { return constructor_template->HasInstance(val); }

    static Handle<Value> New(const Arguments& args) {
        HandleScope scope;

        if (!args.IsConstructCall()) return ThrowException(Exception::TypeError(String::New("Use the new operator to create new NNSocket objects")));

        REQUIRE_ARGUMENT_INT(0, domain);
        REQUIRE_ARGUMENT_INT(1, type);

        NNSocket* sock = new NNSocket(domain, type);
        sock->Wrap(args.This());

        return args.This();
    }

    static Handle<Value> SocketGetter(Local<String> str, const AccessorInfo& accessor) {
        HandleScope scope;
        NNSocket* sock= ObjectWrap::Unwrap < NNSocket > (accessor.This());
        return scope.Close(Local<Integer>::New(Integer::New(sock->sock)));
    }

    static Handle<Value> PeerGetter(Local<String> str, const AccessorInfo& accessor) {
        HandleScope scope;
        NNSocket* sock= ObjectWrap::Unwrap < NNSocket > (accessor.This());
        return scope.Close(Local<Integer>::New(Integer::New(sock->peer)));
    }

    static Handle<Value> AddressGetter(Local<String> str, const AccessorInfo& accessor) {
        HandleScope scope;
        NNSocket* sock= ObjectWrap::Unwrap < NNSocket > (accessor.This());
        return scope.Close(Local<Value>::New(toArray(sock->address)));
    }

    static Handle<Value> TypeGetter(Local<String> str, const AccessorInfo& accessor) {
        HandleScope scope;
        NNSocket* sock= ObjectWrap::Unwrap < NNSocket > (accessor.This());
        return scope.Close(Local<Integer>::New(Integer::New(sock->type)));
    }

    static Handle<Value> ErrnoGetter(Local<String> str, const AccessorInfo& accessor) {
        HandleScope scope;
        NNSocket* sock= ObjectWrap::Unwrap < NNSocket > (accessor.This());
        return scope.Close(Local<Integer>::New(Integer::New(sock->err)));
    }

    static Handle<Value> ErrorGetter(Local<String> str, const AccessorInfo& accessor) {
        HandleScope scope;
        NNSocket* sock= ObjectWrap::Unwrap < NNSocket > (accessor.This());
        return scope.Close(Local<String>::New(String::New(sock->err ? nn_strerror(sock->err) : "")));
    }

    static Handle<Value> ReadFdGetter(Local<String> str, const AccessorInfo& accessor) {
        HandleScope scope;
        NNSocket* sock= ObjectWrap::Unwrap < NNSocket > (accessor.This());
        return scope.Close(Local<Integer>::New(Integer::New(sock->rfd)));
    }

    static Handle<Value> WriteFdGetter(Local<String> str, const AccessorInfo& accessor) {
        HandleScope scope;
        NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (accessor.This());
        return scope.Close(Local<Integer>::New(Integer::New(sock->wfd)));
    }

    static Handle<Value> Close(const Arguments& args) {
        HandleScope scope;

        NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
        sock->Close();

        return args.This();
    }

    static Handle<Value> Setup(const Arguments& args) {
        HandleScope scope;

        NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());

        int rc = sock->Setup();
        return scope.Close(Local<Integer>::New(Integer::New(rc)));
    }

    static Handle<Value> Connect(const Arguments& args) {
        HandleScope scope;

        NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
        REQUIRE_ARGUMENT_AS_STRING(0, addr);

        int rc = sock->Connect(*addr);
        return scope.Close(Local<Integer>::New(Integer::New(rc)));
    }

    static Handle<Value> Bind(const Arguments& args) {
        HandleScope scope;

        NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
        REQUIRE_ARGUMENT_AS_STRING(0, addr);

        int rc = sock->Bind(*addr);
        return scope.Close(Local<Integer>::New(Integer::New(rc)));
    }

    static Handle<Value> SetOption(const Arguments& args) {
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
        return scope.Close(Local<Integer>::New(Integer::New(rc)));
    }

    static Handle<Value> Subscribe(const Arguments& args) {
        HandleScope scope;

        NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
        REQUIRE_ARGUMENT_AS_STRING(0, topic);

        int rc = sock->Subscribe(*topic);
        return scope.Close(Local<Integer>::New(Integer::New(rc)));
    }

    static Handle<Value> Unsubscribe(const Arguments& args) {
        HandleScope scope;

        NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
        REQUIRE_ARGUMENT_AS_STRING(0, topic);

        int rc = sock->Unsubscribe(*topic);
        return scope.Close(Local<Integer>::New(Integer::New(rc)));
    }

    static Handle<Value> SetCallback(const Arguments& args) {
        HandleScope scope;

        NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
        REQUIRE_ARGUMENT_FUNCTION(0, cb);

        int rc = sock->SetCallback(cb);
        return scope.Close(Local<Integer>::New(Integer::New(rc)));
    }

    static Handle<Value> SetProxy(const Arguments& args) {
        HandleScope scope;

        NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
        REQUIRE_ARGUMENT_OBJECT(0, obj);
        if (!HasInstance(args[0])) return scope.Close(Local<Integer>::New(Integer::New(sock->err = EINVAL)));

        NNSocket *sock2 = ObjectWrap::Unwrap< NNSocket > (obj);
        int rc = sock->SetProxy(sock2);
        if (rc == -1) return scope.Close(Local<Integer>::New(Integer::New(rc)));
        rc = sock2->SetProxy(sock);
        return scope.Close(Local<Integer>::New(Integer::New(rc)));
    }

    static Handle<Value> SetForward(const Arguments& args)
    {
        HandleScope scope;

        NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
        REQUIRE_ARGUMENT_OBJECT(0, obj);
        if (!HasInstance(args[0])) return scope.Close(Local<Integer>::New(Integer::New(sock->err = EINVAL)));

        NNSocket *sock2 = ObjectWrap::Unwrap< NNSocket > (obj);
        int rc = sock->SetForward(sock2);
        return scope.Close(Local<Integer>::New(Integer::New(rc)));
    }

    static Handle<Value> SetPeer(const Arguments& args) {
        HandleScope scope;

        NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
        REQUIRE_ARGUMENT_OBJECT(0, obj);
        NNSocket *sock2 = HasInstance(args[0]) ? ObjectWrap::Unwrap< NNSocket > (obj) : NULL;
        int rc = sock->SetPeer(sock2);
        return scope.Close(Local<Integer>::New(Integer::New(rc)));
    }

    static Handle<Value> StartDevice(const Arguments& args) {
        HandleScope scope;

        NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
        REQUIRE_ARGUMENT_OBJECT(0, obj);
        NNSocket *sock2 = HasInstance(args[0]) ? ObjectWrap::Unwrap< NNSocket > (obj) : NULL;
        int rc = sock->StartDevice(sock2);
        return scope.Close(Local<Integer>::New(Integer::New(rc)));
    }

    static Handle<Value> Send(const Arguments& args) {
        HandleScope scope;

        NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
        REQUIRE_ARGUMENT_AS_STRING(0, str);
        int rc = sock->Send(*str, str.length() + 1);
        return scope.Close(Local<Integer>::New(Integer::New(rc)));
    }

    static Handle<Value> Recv(const Arguments& args) {
        HandleScope scope;

        NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
        int size = 0;
        char *data = NULL;
        int rc = sock->Recv(&data, &size);
        if (rc) return scope.Close(Undefined());
        Buffer *buffer = Buffer::New(data, rc, (Buffer::free_callback)nn_freemsg, NULL);
        return scope.Close(Local<Value>::New(buffer->handle_));
    }

    static Handle<Value> StrError(const Arguments& args) {
        HandleScope scope;

        REQUIRE_ARGUMENT_INT(0, err);
        return scope.Close(Local<String>::New(String::New(nn_strerror(err))));
    }

    static void Init(Handle<Object> target) {
        HandleScope scope;

        NODE_SET_METHOD(target, "nn_strerror", StrError);

        Local < FunctionTemplate > t = FunctionTemplate::New(New);
        constructor_template = Persistent < FunctionTemplate > ::New(t);
        constructor_template->InstanceTemplate()->SetInternalFieldCount(1);
        constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("writefd"), WriteFdGetter);
        constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("readfd"), ReadFdGetter);
        constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("errno"), ErrnoGetter);
        constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("error"), ErrorGetter);
        constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("socket"), SocketGetter);
        constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("peer"), PeerGetter);
        constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("type"), TypeGetter);
        constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("address"), AddressGetter);
        constructor_template->SetClassName(String::NewSymbol("NNSocket"));

        NODE_SET_PROTOTYPE_METHOD(constructor_template, "setup", Setup);
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
        NODE_SET_PROTOTYPE_METHOD(constructor_template, "setPeer", SetPeer);
        NODE_SET_PROTOTYPE_METHOD(constructor_template, "startDevice", StartDevice);

        target->Set(String::NewSymbol("NNSocket"), constructor_template->GetFunction());

        for (int i = 0; ; i++) {
            int val;
            const char* name = nn_symbol(i, &val);
            if (!name) break;
            target->Set(String::NewSymbol(name), Integer::New(val), static_cast<PropertyAttribute>(ReadOnly | DontDelete) );
        }
    }

};

Persistent<FunctionTemplate> NNSocket::constructor_template;

void NanoMsgInit(Handle<Object> target)
{
    HandleScope scope;

    NNSocket::Init(target);
}

struct NNServerBaton {
    NNServerBaton(NNServer *s, char *b = 0, int l = 0): server(s), buf(b), len(l) {
        req.data = s;
    }
    ~NNServerBaton() {
        server->Free(buf);
    }
    uv_work_t req;
    NNServer *server;
    string value;
    char *buf;
    int len;
};

NNServer::NNServer()
{
    poll.data = NULL;
    Stop();
}

NNServer::~NNServer()
{
    Stop();
}

void NNServer::Stop()
{
    if (poll.data) uv_poll_stop(&poll);
    poll.data = NULL;
    rfd = wfd = queue = err = 0;
    maxsize = 1524;
    bkcallback = NULL;
    if (bkfree) bkfree(data);
    data = NULL;
    bkfree = NULL;
}

int NNServer::Start(int r, int w, bool q, NNServerCallback *cb, void *d, NNServerFree *f)
{
    rsock = r;
    wsock = w;

    size_t sz = sizeof(int);
    nn_getsockopt(rsock, NN_SOL_SOCKET, NN_PROTOCOL, (char*) &rproto, &sz);
    nn_getsockopt(wsock, NN_SOL_SOCKET, NN_PROTOCOL, (char*) &wproto, &sz);

    int rc = nn_getsockopt(rsock, NN_SOL_SOCKET, NN_RCVFD, (char*) &rfd, &sz);
    if (rc == -1) goto done;

    if (wsock > -1) rc = nn_getsockopt(wsock, NN_SOL_SOCKET, NN_SNDFD, (char*) &wfd, &sz);
    if (rc == -1) goto done;

    queue = q;
    bkcallback = cb;
    data = d;
    bkfree = f;
    uv_poll_init(uv_default_loop(), &poll, rfd);
    uv_poll_start(&poll, UV_READABLE, ReadRequest);
    poll.data = this;
    return 0;

done:
    err = nn_errno();
    return -1;
}

void NNServer::ReadRequest(uv_poll_t *w, int status, int revents)
{
    if (status == -1 || !(revents & UV_READABLE)) return;
    NNServer *srv = (NNServer*)w->data;

    char *buf = NULL;
    int len = srv->Recv(&buf);
    if (len <= 0 || !buf) return;

    srv->Forward(buf, len);

    if (srv->queue) {
        NNServerBaton *d = new NNServerBaton(srv, buf, len);
        uv_queue_work(uv_default_loop(), &d->req, WorkRequest, PostRequest);
    } else {
        string val = srv->Run(buf, len);
        srv->Send(val);
        srv->Free(buf);
    }
}

void NNServer::PostRequest(uv_work_t* req, int status)
{
    NNServerBaton* d = static_cast<NNServerBaton*>(req->data);
    d->server->Send(d->value);
    delete d;
}

void NNServer::WorkRequest(uv_work_t* req)
{
    NNServerBaton* d = static_cast<NNServerBaton*>(req->data);
    d->value = d->server->Run(d->buf, d->len);
}

string NNServer::Run(char *buf, int len)
{
    if (!buf || !len || !bkcallback) return string();
    return bkcallback(buf, len, data);
}

string NNServer::error(int err)
{
    return nn_strerror(err);
}

int NNServer::Recv(char **buf)
{
    int rc = nn_recv(rsock, (void*)buf, NN_MSG, NN_DONTWAIT);
    if (rc == -1) {
        err = nn_errno();
        LogError("%d: %d: recv: %s", rproto, rsock, nn_strerror(err));
    }
    return rc;
}

int NNServer::Send(string val)
{
    if (rproto != NN_REP) return 0;
    int rc = nn_send(rsock, val.c_str(), val.size() + 1, NN_DONTWAIT);
    if (rc == -1) {
        err = nn_errno();
        LogError("%d: %d: send: %s", rproto, rsock, nn_strerror(err));
    }
    return 0;
}

int NNServer::Forward(char *buf, int size)
{
    if (wsock < 0) return 0;
    int rc = nn_send(wsock, buf, size, NN_DONTWAIT);
    if (rc == -1) {
        err = nn_errno();
        LogError("%d: %d: forward: %s", wproto, wsock, nn_strerror(err));
    }
    return 0;
}

void NNServer::Free(char *buf)
{
    if (buf) nn_freemsg(buf);
}


#endif
