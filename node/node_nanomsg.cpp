//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  April 2013
//

#include "node_backend.h"

#if defined __GNUC__ || defined __llvm__
#define nn_fast(x) __builtin_expect ((x), 1)
#define nn_slow(x) __builtin_expect ((x), 0)
#else
#define nn_fast(x) (x)
#define nn_slow(x) (x)
#endif

#define MAX_SOCKS 512
#define GETSOCK(n, var) if (n < 0 || n >= MAX_SOCKS || _socks[n].sock < 0) return ThrowException(Exception::Error(String::New(vFmtStr("Invalid socket: %d", n).c_str()))); Sock *var = &_socks[n];

struct Sock {
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
    struct Sock* peer;

    Sock(int d = AF_SP, int t = NN_REQ): sock(-1), err(0), domain(d), type(t), rfd(-1), wfd(-1) {
        poll.data = NULL;
    }

    ~Sock() {
        Close();
    }

    int Create(int s, int d, int t) {
    	sock = s;
        domain = d;
        type = t;
        size_t fdsz = sizeof(rfd);
        nn_getsockopt(sock, NN_SOL_SOCKET, NN_RCVFD, (char*) &rfd, &fdsz);
        nn_getsockopt(sock, NN_SOL_SOCKET, NN_SNDFD, (char*) &wfd, &fdsz);
        LogDebug("%d, domain=%d, type=%d, rfd=%d, wfd=%d", sock, domain, type, rfd, wfd);
        return 0;
    }

    int Close(int rc = 0) {
        err = nn_errno();
        if (rc == -1) LogError("%d: domain=%d, type=%d, err=%s:%d", sock, domain, type, nn_strerror(err), err);
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
        Sock *s = (Sock*)w->data;
        if (nn_slow(status == -1 || !(revents & UV_READABLE))) return;

        char *buf;
        HandleScope scope;
        int n = nn_recv(s->sock, (void*)&buf, NN_MSG, NN_DONTWAIT);
        if (nn_slow(n == -1)) {
        	s->err = nn_errno();
            Local <Value> argv[2];
        	argv[0] = Exception::Error(String::New(nn_strerror(nn_errno())));
        	argv[1] = Local<Value>::New(Integer::New(s->sock));
        	TRY_CATCH_CALL(Context::GetCurrent()->Global(), s->callback, 1, argv);
        } else {
            Local <Value> argv[3];
        	argv[0] = Local<Value>::New(Null());
        	argv[1] = Local<Value>::New(Integer::New(s->sock));
        	argv[2] = Local<String>::New(String::New(buf));
        	TRY_CATCH_CALL(Context::GetCurrent()->Global(), s->callback, 3, argv);
        }
        nn_freemsg(buf);
    }

    // Implements a device, tranparent proxy between two sockets
    int SetProxy(Sock *p) {
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
        peer = p;
        // The peer must have read socket which it will forward to our write socket or vice versa
        if (rfd == -1) return 0;
        uv_poll_init(uv_default_loop(), &poll, rfd);
        uv_poll_start(&poll, UV_READABLE, HandleForward);
        poll.data = (void*)this;
        return 0;
    }

    // Forwards msgs from the current socket to the peer, one way
    int SetForward(Sock *p) {
    	if (!p) return -1;
    	if (rfd == -1 || p->wfd == -1) {
    		LogError("%d: invalid direction of sockets: %d/%d - %d/%d", sock, rfd, wfd, p->rfd, p->wfd);
    		err = EINVAL;
    		return -1;
    	}

    	ClosePoll();
    	peer = p;
    	uv_poll_init(uv_default_loop(), &poll, rfd);
    	uv_poll_start(&poll, UV_READABLE, HandleForward);
    	poll.data = (void*)this;
    	return 0;
    }

    static void HandleForward(uv_poll_t *w, int status, int revents) {
        Sock *s = (Sock*)w->data;
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
        rc = nn_sendmsg(s->peer->sock, &hdr, NN_DONTWAIT);
        if (rc == -1) s->peer->err = nn_errno();
    }

};

static Sock _socks[MAX_SOCKS];

static Handle<Value> Create(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_INT(0, domain);
    REQUIRE_ARGUMENT_INT(1, type);
    int sock = nn_socket(domain, type);
    if (sock == -1) ThrowException(Exception::Error(String::New(nn_strerror(nn_errno()))));
    _socks[sock].Create(sock, domain, type);
    return scope.Close(Integer::New(sock));
}

static Handle<Value> ReadFd(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_INT(0, n);
    GETSOCK(n, sock);

    return scope.Close(Integer::New(sock->rfd));
}

static Handle<Value> WriteFd(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_INT(0, n);
    GETSOCK(n, sock);

    return scope.Close(Integer::New(sock->wfd));
}

static Handle<Value> Errno(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_INT(0, n);
    GETSOCK(n, sock);

    return scope.Close(Integer::New(sock->err));
}

static Handle<Value> Connect(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_INT(0, n);
    REQUIRE_ARGUMENT_AS_STRING(1, addr);
    GETSOCK(n, sock);

    int rc = sock->Connect(*addr);
    if (rc == -1) return ThrowException(Exception::Error(String::New(nn_strerror(sock->err))));
    return scope.Close(Integer::New(rc));
}

static Handle<Value> Bind(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_INT(0, n);
    REQUIRE_ARGUMENT_AS_STRING(1, addr);
    GETSOCK(n, sock);

    int rc = sock->Bind(*addr);
    if (rc == -1) return ThrowException(Exception::Error(String::New(nn_strerror(sock->err))));
    return scope.Close(Integer::New(rc));
}

static Handle<Value> Subscribe(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_INT(0, n);
    REQUIRE_ARGUMENT_AS_STRING(1, topic);
    GETSOCK(n, sock);

    int rc = sock->Subscribe(*topic);
    if (rc == -1) return ThrowException(Exception::Error(String::New(nn_strerror(sock->err))));
    return scope.Close(Integer::New(rc));
}

static Handle<Value> Unsubscribe(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_INT(0, n);
    REQUIRE_ARGUMENT_AS_STRING(1, topic);
    GETSOCK(n, sock);

    int rc = sock->Unsubscribe(*topic);
    if (rc == -1) return ThrowException(Exception::Error(String::New(nn_strerror(sock->err))));
    return scope.Close(Integer::New(rc));
}

static Handle<Value> Close(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_INT(0, n);
    GETSOCK(n, sock);

    int rc = sock->Close();
    return scope.Close(Integer::New(rc));
}

static Handle<Value> SetCallback(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_INT(0, n);
    OPTIONAL_ARGUMENT_FUNCTION(1, cb);
    GETSOCK(n, sock);

    int rc = sock->SetCallback(cb);
    if (rc == -1) return ThrowException(Exception::Error(String::New(nn_strerror(sock->err))));
    return scope.Close(Integer::New(rc));
}

static Handle<Value> SetProxy(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_INT(0, n1);
    REQUIRE_ARGUMENT_INT(1, n2);

    GETSOCK(n1, sock1);
    GETSOCK(n2, sock2);

    int rc = sock1->SetProxy(sock2);
    if (rc == -1) return ThrowException(Exception::Error(String::New(nn_strerror(sock1->err))));
    rc = sock2->SetProxy(sock1);
    if (rc == -1) return ThrowException(Exception::Error(String::New(nn_strerror(sock2->err))));
    return scope.Close(Integer::New(rc));
}

static Handle<Value> SetForward(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_INT(0, n1);
    REQUIRE_ARGUMENT_INT(1, n2);

    GETSOCK(n1, sock1);
    GETSOCK(n2, sock2);

    int rc = sock1->SetForward(sock2);
    if (rc == -1) return ThrowException(Exception::Error(String::New(nn_strerror(sock1->err))));
    return scope.Close(Integer::New(rc));
}

static Handle<Value> Send(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_INT(0, n);
    REQUIRE_ARGUMENT_AS_STRING(1, str);
    GETSOCK(n, sock);

    void *buf = nn_allocmsg(str.length() + 1, 0);
    memcpy(buf, *str, str.length() + 1);
    int rc = nn_send(sock->sock, &buf, NN_MSG, NN_DONTWAIT);
    if (rc == -1) return ThrowException(Exception::Error(String::New(nn_strerror(sock->err))));
    return scope.Close(Integer::New(rc));
}

static Handle<Value> Recv(const Arguments& args)
{
    HandleScope scope;

    REQUIRE_ARGUMENT_INT(0, n);
    GETSOCK(n, sock);
    char *data = NULL;
    int rc = nn_recv(sock->sock, &data, NN_MSG, NN_DONTWAIT);
    if (rc == -1) return ThrowException(Exception::Error(String::New(nn_strerror(sock->err))));
    Buffer *buffer = Buffer::New(data, rc, (Buffer::free_callback)nn_freemsg, NULL);
    return scope.Close(Local<Value>::New(buffer->handle_));
}

void NanoMsgInit(Handle<Object> target)
{
    HandleScope scope;

    NODE_SET_METHOD(target, "nnCreate", Create);
    NODE_SET_METHOD(target, "nnReadFd", ReadFd);
    NODE_SET_METHOD(target, "nnWriteFd", WriteFd);
    NODE_SET_METHOD(target, "nnErrno", Errno);
    NODE_SET_METHOD(target, "nnSubscribe", Subscribe);
    NODE_SET_METHOD(target, "nnBind", Bind);
    NODE_SET_METHOD(target, "nnClose", Close);
    NODE_SET_METHOD(target, "nnConnect", Connect);
    NODE_SET_METHOD(target, "nnUnsubscribe", Unsubscribe);
    NODE_SET_METHOD(target, "nnSend", Send);
    NODE_SET_METHOD(target, "nnRecv", Recv);
    NODE_SET_METHOD(target, "nnSetCallback", SetCallback);
    NODE_SET_METHOD(target, "nnSetProxy", SetProxy);
    NODE_SET_METHOD(target, "nnSetForward", SetForward);

    for (int i = 0; ; i++) {
        int val;
        const char* name = nn_symbol (i, &val);
        if (!name) break;
        target->Set(String::NewSymbol(name), Integer::New(val), static_cast<PropertyAttribute>(ReadOnly | DontDelete) );
    }

}

