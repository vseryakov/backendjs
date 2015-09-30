//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  October 2014

#include "bklib.h"
#include "bkzip.h"

#define Z_CHUNK 16384

int bkDeflateInit(z_stream *strm, int level)
{
    strm->zalloc = Z_NULL;
    strm->zfree = Z_NULL;
    strm->opaque = Z_NULL;
    return deflateInit2(strm, level, Z_DEFLATED, 16 + MAX_WBITS, 8, Z_DEFAULT_STRATEGY);
}

// Compress input and put into out string
int bkDeflate(z_stream *strm, const char *inbuf, int inlen, string *outbuf)
{
    int ret = Z_OK;
    unsigned char tmp[Z_CHUNK];

    while (inlen > 0) {
        strm->avail_in = inlen > Z_CHUNK ? Z_CHUNK : inlen;
        strm->next_in = (Bytef*)inbuf;
        do {
            strm->avail_out = Z_CHUNK;
            strm->next_out = (Bytef*)tmp;
            ret = deflate(strm, Z_NO_FLUSH);
            if (ret == Z_STREAM_ERROR) return ret;
            outbuf->append((const char*)tmp, Z_CHUNK - strm->avail_out);
        } while (strm->avail_out == 0);

        inbuf += Z_CHUNK;
        inlen -= Z_CHUNK;
    }
    return ret;
}

int bkDeflateEnd(z_stream *strm, string *outbuf)
{
    int ret = Z_OK;
    unsigned char tmp[Z_CHUNK];

    do {
        strm->avail_out = Z_CHUNK;
        strm->next_out = (Bytef*)tmp;
        ret = deflate(strm, Z_FINISH);
        if (ret == Z_STREAM_ERROR) return ret;
        outbuf->append((const char*)tmp, Z_CHUNK - strm->avail_out);
    } while (strm->avail_out == 0);
    if (ret != Z_STREAM_END) return ret;

    ret = deflateEnd(strm);
    return ret;
}

int bkInflateInit(z_stream *strm)
{
    strm->zalloc = Z_NULL;
    strm->zfree = Z_NULL;
    strm->opaque = Z_NULL;
    strm->avail_in = 0;
    strm->next_in = Z_NULL;
    // +16 to decode only the gzip format (no auto-header detection)
    return inflateInit2(strm, 16 + MAX_WBITS);
}

int bkInflate(z_stream *strm, const char* inbuf, int inlen, string *outbuf)
{
    int ret = Z_OK;
    unsigned char tmp[Z_CHUNK];

    while (inlen > 0) {
        strm->avail_in = inlen > Z_CHUNK ? Z_CHUNK : inlen;
        strm->next_in = (Bytef*)inbuf;

        do {
            strm->avail_out = Z_CHUNK;
            strm->next_out = (Bytef*)tmp;
            ret = inflate(strm, Z_NO_FLUSH);
            switch (ret) {
            case Z_STREAM_ERROR:
                return ret;
            case Z_NEED_DICT:
                ret = Z_DATA_ERROR;
            case Z_DATA_ERROR:
            case Z_MEM_ERROR:
                inflateEnd(strm);
                return ret;
            }
            outbuf->append((const char*)tmp, Z_CHUNK - strm->avail_out);
        } while (strm->avail_out == 0);
        inbuf += Z_CHUNK;
        inlen -= Z_CHUNK;
    }
    return ret;
}

void bkInflateEnd(z_stream *strm)
{
    inflateEnd(strm);
}
