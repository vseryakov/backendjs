/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  Author: Dm. Mayorov <arrabon@dimview.org>
 *  April 2007
 *
 */

#ifndef _BK_ZIP_H_
#define _BK_ZIP_H_

// Compress/decompres using zlib
int bkDeflateInit(z_stream *strm, int level);
int bkDeflate(z_stream *strm, const char *inbuf, int inlen, string *outbuf);
int bkDeflateEnd(z_stream *strm, string *outbuf);

int bkInflateInit(z_stream *strm);
int bkInflate(z_stream *strm, const char* inbuf, int inlen, string *outbuf);
void bkInflateEnd(z_stream *strm);

#endif
