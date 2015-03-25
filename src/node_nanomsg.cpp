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

#ifndef nn_geterrno
#define nn_geterrno(s,e) 0
#endif

class NNSocket: public ObjectWrap {
public:
    NNSocket(int d = AF_SP, int t = NN_SUB): sock(-1), err(0), domain(d), type(t), rfd(-1), wfd(-1), peer(-1), dev_err(0), dev_state(0) {
        poll.data = NULL;
        Setup();
    }

    ~NNSocket() {
        Close();
    }

    int sock;
    int err;
    string op;

    // Config parameters
    int domain;
    int type;
    map<string,int> baddr;
    map<string,int> caddr;

    // Socket OS descriptors
    int rfd;
    int wfd;
    // Peer for forwading
    int peer;

    // Device status
    int dev_err;
    int dev_state;

    // Socket read/write support
    uv_poll_t poll;
    Persistent<Function> callback;

    int Setup() {
        op = __FUNCTION__;
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
        baddr.clear();
        caddr.clear();
        op.clear();
        return err;
    }

    int ClosePoll() {
        if (!callback.IsEmpty()) callback.Dispose();
        callback.Clear();
        if (poll.data) uv_poll_stop(&poll);
        poll.data = NULL;
        peer = -1;
        return 0;
    }

    int Bind(string addr) {
        op = __FUNCTION__;
        LogDev("%d, domain=%d, type=%d, rfd=%d, wfd=%d, %s", sock, domain, type, rfd, wfd, addr.c_str());
        if (sock < 0) return err = ENOTSOCK;
        vector<string> urls = strSplit(addr, " ,");
        for (uint i = 0; i < urls.size(); i++) {
            if (!urls[i].size()) continue;
            if (baddr.find(urls[i]) != baddr.end()) continue;
            int rc = nn_bind(sock, urls[i].c_str());
            if (nn_slow(rc <= -1)) return err = nn_errno();
            baddr[urls[i]] = rc;
        }
        return 0;
    }

    int Connect(string addr) {
        op = __FUNCTION__;
        LogDev("%d, domain=%d, type=%d, rfd=%d, wfd=%d, %s", sock, domain, type, rfd, wfd, addr.c_str());
        if (sock < 0) return err = ENOTSOCK;
        vector<string> urls = strSplit(addr, " ,");
        for (uint i = 0; i < urls.size(); i++) {
            if (!urls[i].size()) continue;
            if (caddr.find(urls[i]) != caddr.end()) continue;
            int rc = nn_connect(sock, urls[i].c_str());
            if (nn_slow(rc <= -1)) return err = nn_errno();
            caddr[urls[i]] = rc;
        }
        return 0;
    }

    int Shutdown(int eid) {
        op = __FUNCTION__;
        LogDev("%d, domain=%d, type=%d, rfd=%d, wfd=%d, eid=%d", sock, domain, type, rfd, wfd, eid);
        if (sock < 0) return err = ENOTSOCK;
        int rc = nn_shutdown(sock, eid);
        if (nn_slow(rc == -1)) return err = nn_errno();
        for (map<string,int>::iterator it = caddr.begin(); it != caddr.end(); it++) {
            if (it->second == eid) {
                caddr.erase(it);
                return 0;
            }
        }
        for (map<string,int>::iterator it = baddr.begin(); it != baddr.end(); it++) {
            if (it->second == eid) {
                baddr.erase(it);
                return 0;
            }
        }
        return 0;
    }

    int Subscribe(string topic) {
        op = __FUNCTION__;
        if (sock < 0) return err = ENOTSOCK;
        int rc = nn_setsockopt(sock, NN_SUB, NN_SUB_SUBSCRIBE, topic.c_str(), 0);
        if (nn_slow(rc == -1)) return err = nn_errno();
        return 0;
    }

    int Unsubscribe(string topic) {
        op = __FUNCTION__;
        if (sock < 0) return err = ENOTSOCK;
        int rc = nn_setsockopt(sock, NN_SUB, NN_SUB_UNSUBSCRIBE, topic.c_str(), 0);
        if (nn_slow(rc == -1)) return err = nn_errno();
        return 0;
    }

    int SetOption(int opt, int n) {
        op = __FUNCTION__;
        if (sock < 0) return err = ENOTSOCK;
        int rc = nn_setsockopt(sock, type, opt, &n, sizeof(n));
        if (nn_slow(rc == -1)) return err = nn_errno();
        return 0;
    }

    int SetOption(int opt, string s) {
        op = __FUNCTION__;
        if (sock < 0) return err = ENOTSOCK;
        int rc = nn_setsockopt(sock, type, opt, s.c_str(), 0);
        if (nn_slow(rc == -1)) return err = nn_errno();
        return 0;
    }

    int Send(void *data, int len) {
        op = __FUNCTION__;
        if (sock < 0) return err = ENOTSOCK;
        void *msg = nn_allocmsg(len, 0);
        memcpy(msg, data, len);
        int rc = nn_send(sock, &msg, NN_MSG, NN_DONTWAIT);
        if (nn_slow(rc == -1)) return err = nn_errno();
        return 0;
    }

    int Recv(char **data, int *size) {
        op = __FUNCTION__;
        if (sock < 0) return err = ENOTSOCK;
        if (!data || !size) return err = EINVAL;
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
        LogDev("sock=%d, fd=%d, size=%d, peer=%d, errno=%d", s->sock, s->rfd, n, s->peer, n == -1 ? nn_errno() : 0);

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
                argv[1] = Local<String>::New(String::New(buf, n));
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
        int n = nn_recvmsg(s->sock, &hdr, NN_DONTWAIT);
        LogDev("sock=%d, fd=%d, size=%d, peer=%d, errno=%d", s->sock, s->rfd, n, s->peer, n == -1 ? nn_errno() : 0);

        if (n == -1) {
            s->err = nn_errno();
            return;
        }
        n = nn_sendmsg(s->peer, &hdr, NN_DONTWAIT);
        if (n == -1) s->err = nn_errno();
    }

    // Implements a device, tranparent proxy between two sockets
    int SetProxy(NNSocket *p) {
        op = __FUNCTION__;
        if (sock < 0) return err = ENOTSOCK;
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
        op = __FUNCTION__;
        ClosePoll();
        if (sock < 0) return err = ENOTSOCK;
        if (rfd == -1 || cb.IsEmpty()) return 0;
        callback = Persistent<Function>::New(cb);
        uv_poll_init(uv_default_loop(), &poll, rfd);
        uv_poll_start(&poll, UV_READABLE, HandleRead);
        poll.data = (void*)this;
        return 0;
    }

    // Set forwarding peer for the regular socket, will be used by reading handler
    int SetPeer(NNSocket *p) {
        op = __FUNCTION__;
        if (sock < 0) return err = ENOTSOCK;
        peer = p && p->wfd != -1 ? p->sock : -1;
        return 0;
    }

    // Forwards msgs from the current socket to the peer, one way
    int SetForward(NNSocket *p) {
        op = __FUNCTION__;
        if (sock < 0) return err = ENOTSOCK;
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
        sock->dev_state = 1;
        sock->dev_err = nn_device(sock->sock, sock->peer);
        if (sock->dev_err) LogError("%d: peer=%d", sock, sock->peer, nn_strerror(sock->dev_err));
        sock->dev_state = 0;
    }

    int StartDevice(NNSocket *p) {
        op = __FUNCTION__;
        if (sock < 0) return err = ENOTSOCK;
        peer = p ? p->sock : -1;
        if (peer < 0) return err = EINVAL;
        uv_thread_t tid;
        uv_thread_create(&tid, _device, (void*)this);
        return 0;
    }

    static Persistent<FunctionTemplate> constructor_template;
    static inline bool HasInstance(Handle<Value> val) { return constructor_template->HasInstance(val); }

    static Handle<Value> New(const Arguments& args) {
        HandleScope scope;

        if (!args.IsConstructCall()) return ThrowException(Exception::TypeError(String::NewSymbol("Use the new operator to create new NNSocket objects")));

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

    static Handle<Value> PollingGetter(Local<String> str, const AccessorInfo& accessor) {
        HandleScope scope;
        NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (accessor.This());
        return scope.Close(Local<Integer>::New(Integer::New(sock->poll.data != NULL)));
    }

    static Handle<Value> BindAddressGetter(Local<String> str, const AccessorInfo& accessor) {
        HandleScope scope;
        NNSocket* sock= ObjectWrap::Unwrap < NNSocket > (accessor.This());
        Local<Object> rc = Local<Object>::New(Object::New());
        for (map<string,int>::iterator it = sock->baddr.begin(); it != sock->baddr.end(); it++) {
            Local<Object> ep = Local<Object>::New(Object::New());
            ep->Set(String::NewSymbol("ep"), Integer::New(it->second));
            ep->Set(String::NewSymbol("errno"), Integer::New(nn_geterrno(sock->sock, it->second)));
            rc->Set(String::New(it->first.c_str()), ep);
        }
        return scope.Close(rc);
    }

    static Handle<Value> ConnectAddressGetter(Local<String> str, const AccessorInfo& accessor) {
        HandleScope scope;
        NNSocket* sock= ObjectWrap::Unwrap < NNSocket > (accessor.This());
        Local<Object> rc = Local<Object>::New(Object::New());
        for (map<string,int>::iterator it = sock->caddr.begin(); it != sock->caddr.end(); it++) {
            Local<Object> ep = Local<Object>::New(Object::New());
            ep->Set(String::NewSymbol("ep"), Integer::New(it->second));
            ep->Set(String::NewSymbol("errno"), Integer::New(nn_geterrno(sock->sock, it->second)));
            rc->Set(String::New(it->first.c_str()), ep);
        }
        return scope.Close(rc);
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

    static Handle<Value> DevErrnoGetter(Local<String> str, const AccessorInfo& accessor) {
        HandleScope scope;
        NNSocket* sock= ObjectWrap::Unwrap < NNSocket > (accessor.This());
        return scope.Close(Local<Integer>::New(Integer::New(sock->dev_err)));
    }

    static Handle<Value> DeviceGetter(Local<String> str, const AccessorInfo& accessor) {
        HandleScope scope;
        NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (accessor.This());
        return scope.Close(Local<Integer>::New(Integer::New(sock->dev_state)));
    }

    static Handle<Value> OpGetter(Local<String> str, const AccessorInfo& accessor) {
        HandleScope scope;
        NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (accessor.This());
        return scope.Close(Local<String>::New(String::New(sock->op.c_str())));
    }

    static Handle<Value> ErrorGetter(Local<String> str, const AccessorInfo& accessor) {
        HandleScope scope;
        NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (accessor.This());
        return scope.Close(Local<String>::New(String::New(sock->err ? nn_strerror(sock->err) : "")));
    }

    static Handle<Value> ReadFdGetter(Local<String> str, const AccessorInfo& accessor) {
        HandleScope scope;
        NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (accessor.This());
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
        OPTIONAL_ARGUMENT_STRING(0, addr);

        int rc = sock->Connect(*addr);
        return scope.Close(Local<Integer>::New(Integer::New(rc)));
    }

    static Handle<Value> Bind(const Arguments& args) {
        HandleScope scope;

        NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
        OPTIONAL_ARGUMENT_STRING(0, addr);

        int rc = sock->Bind(*addr);
        return scope.Close(Local<Integer>::New(Integer::New(rc)));
    }

    static Handle<Value> Shutdown(const Arguments& args) {
        HandleScope scope;

        NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
        OPTIONAL_ARGUMENT_INT(0, eid);

        int rc = sock->Shutdown(eid);
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
        OPTIONAL_ARGUMENT_STRING(0, topic);

        int rc = sock->Subscribe(*topic);
        return scope.Close(Local<Integer>::New(Integer::New(rc)));
    }

    static Handle<Value> Unsubscribe(const Arguments& args) {
        HandleScope scope;

        NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
        OPTIONAL_ARGUMENT_STRING(0, topic);

        int rc = sock->Unsubscribe(*topic);
        return scope.Close(Local<Integer>::New(Integer::New(rc)));
    }

    static Handle<Value> SetCallback(const Arguments& args) {
        HandleScope scope;

        NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
        OPTIONAL_ARGUMENT_FUNCTION(0, cb);

        int rc = sock->SetCallback(cb);
        return scope.Close(Local<Integer>::New(Integer::New(rc)));
    }

    static Handle<Value> SetProxy(const Arguments& args) {
        HandleScope scope;

        NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
        OPTIONAL_ARGUMENT_OBJECT(0, obj);
        if (!HasInstance(obj)) return scope.Close(Local<Integer>::New(Integer::New(sock->err = EINVAL)));

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
        OPTIONAL_ARGUMENT_OBJECT(0, obj);
        if (!HasInstance(obj)) return scope.Close(Local<Integer>::New(Integer::New(sock->err = EINVAL)));

        NNSocket *sock2 = ObjectWrap::Unwrap< NNSocket > (obj);
        int rc = sock->SetForward(sock2);
        return scope.Close(Local<Integer>::New(Integer::New(rc)));
    }

    static Handle<Value> SetPeer(const Arguments& args) {
        HandleScope scope;

        NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
        OPTIONAL_ARGUMENT_OBJECT(0, obj);
        NNSocket *sock2 = HasInstance(obj) ? ObjectWrap::Unwrap< NNSocket > (obj) : NULL;
        int rc = sock->SetPeer(sock2);
        return scope.Close(Local<Integer>::New(Integer::New(rc)));
    }

    static Handle<Value> StartDevice(const Arguments& args) {
        HandleScope scope;

        NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
        OPTIONAL_ARGUMENT_OBJECT(0, obj);
        NNSocket *sock2 = HasInstance(obj) ? ObjectWrap::Unwrap< NNSocket > (obj) : NULL;
        int rc = sock->StartDevice(sock2);
        return scope.Close(Local<Integer>::New(Integer::New(rc)));
    }

    static Handle<Value> Send(const Arguments& args) {
        HandleScope scope;

        NNSocket* sock = ObjectWrap::Unwrap < NNSocket > (args.This());
        OPTIONAL_ARGUMENT_AS_STRING(0, str);
        int rc = str.length() ? sock->Send(*str, str.length()) : 0;
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

        OPTIONAL_ARGUMENT_INT(0, err);
        return scope.Close(Local<String>::New(String::New(nn_strerror(err))));
    }

    static void Init(Handle<Object> target) {
        HandleScope scope;

        NODE_SET_METHOD(target, "nn_strerror", StrError);

        Local < FunctionTemplate > t = FunctionTemplate::New(New);
        constructor_template = Persistent < FunctionTemplate > ::New(t);
        constructor_template->InstanceTemplate()->SetInternalFieldCount(1);
        constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("derrno"), DevErrnoGetter);
        constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("device"), DeviceGetter);
        constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("writefd"), WriteFdGetter);
        constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("readfd"), ReadFdGetter);
        constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("errno"), ErrnoGetter);
        constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("error"), ErrorGetter);
        constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("op"), OpGetter);
        constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("peer"), PeerGetter);
        constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("polling"), PollingGetter);
        constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("type"), TypeGetter);
        constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("bound"), BindAddressGetter);
        constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("connected"), ConnectAddressGetter);
        constructor_template->InstanceTemplate()->SetAccessor(String::NewSymbol("socket"), SocketGetter);
        constructor_template->SetClassName(String::NewSymbol("NNSocket"));

        NODE_SET_PROTOTYPE_METHOD(constructor_template, "setup", Setup);
        NODE_SET_PROTOTYPE_METHOD(constructor_template, "subscribe", Subscribe);
        NODE_SET_PROTOTYPE_METHOD(constructor_template, "bind", Bind);
        NODE_SET_PROTOTYPE_METHOD(constructor_template, "close", Close);
        NODE_SET_PROTOTYPE_METHOD(constructor_template, "setOption", SetOption);
        NODE_SET_PROTOTYPE_METHOD(constructor_template, "connect", Connect);
        NODE_SET_PROTOTYPE_METHOD(constructor_template, "shutdown", Shutdown);
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

#endif
