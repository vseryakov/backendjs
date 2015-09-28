/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  Author: Dm. Mayorov <arrabon@dimview.org>
 *  April 2007
 *
 */

#ifndef _BK_LIB_H_
#define _BK_LIB_H_

#include "bksystem.h"
#include "bklog.h"

typedef map<string, int> bkIntMap;
typedef map<string, string> bkStringMap;
typedef map<string, vector<string> > bkVectorMap;

enum bkJsonType { JSON_NULL, JSON_OBJECT, JSON_ARRAY, JSON_STRING, JSON_INT, JSON_FLOAT, JSON_BOOL };

class bkJsonValue {
public:
    bkJsonValue(bkJsonType otype, string oname = string(), string ovalue = string()): parent(0), next(0), first(0), last(0), type(otype), name(oname), value(ovalue) {}
    bkJsonValue *parent;
    bkJsonValue *next;
    bkJsonValue *first;
    bkJsonValue *last;
    bkJsonType type;
    string name;
    string value;
};

// Aho-Corasick algorithm according to http://dx.doi.org/10.1145/360825.360855
// Based on (https://gist.github.com/andmej/1233426) but uses dynamic memory
class bkAhoCorasick {
public:
    bkAhoCorasick(string id = string());
    ~bkAhoCorasick();
    int search(const string &text) { return search(text.c_str(), text.size()); }
    int search(const char *text, int size);
    void add(const string word, int value = 0) { list.push_back(Word(word, value)); }
    bool addJson(const char *text, int size, string *errmsg = NULL);
    void setAlphabet(const char *symbols, int size, bool delimiter);
    void prepare();
    void reset();
    void setMode(string name);
    string modeName();

    struct Word {
        Word(string w, int v = 0): word(w), value(v) {}
        string word;
        int value;
    };

    string name;
    int count;
    int value;
    int mode;
    queue<int> queued;
    vector<Word> list;
    vector<int> counters;
    char alphabet[256];
protected:
    int state;
    int *matches;
    int *failures;
    int *gotos;
};

// System init, OS specific actions
void bkLibInit();

// Convenient C++ functions
string strReplace(const string value, const string search, const string replace);
string strToLower(const string word);
string strTrim(const string str, const string delim = " \r\n\t");
string strRtrim(const string str, const string delim = " \r\n\t");
vector<string> strSplit(const string str, const string delim = " ", const string quotes = string());
bool strContains(const vector<string> &list, const string key);
string toString(const vector<string> &list, const string delim = " ");
string toString(vector<string> *list, const string delim = " ");
bool strEqual(const string &a, const string &b);
bool strNumeric(string str);

// sprintf like
string bkFmtStr(string, ...);
string bkFmtStrV(string fmt, va_list ap);
string bkStrFmtV(string &str, string fmt, va_list ap);
string bkStrFmtV(string &str, string fmt, ...);

// Returns number of milliseconds since the epoch
long long bkClock();
string bkFmtTime3339(int64_t msec);
string bkFmtTime(string fmt, int64_t sec);

// Return how many times word appears in text using Knuth-Morris-Pratt algorithm
int bkCountWords(const char *word, int wlen, const char *text, int tlen, bool all = true);
int bkCountWords(const string &word, const string &text, bool all = true);
bool bkFindWords(const char *word, int wlen, const char *text, int tlen);

// Recursively create all direcotris for given path
bool bkMakePath(string path);
uint32_t bkHash(const uint8_t *buf, int size);
uint32_t bkHash2(const uint8_t *buf, int size, uint32_t seed = 0);
uint32_t bkCrc32(const void *data, int size);

void bkSetFileTime(string file, int64_t t);
bool bkWriteFile(const string file, const string data, int perms);
vector<string> bkShuffleList(const vector<string> list);

// Global logging level
void bkSetLogging(const char *level);

// Returns distance between 2 coordinates
double bkDistance(double lat1, double long1, double lat2, double long2);
int bkBearing(double lat1, double long1, double lat2, double long2);
vector<double> bkBoundingBox(double lat, double lon, double distance);

// Encode into GeoHash with given precision
string bkGeoHashEncode(double latitude, double longitude, uint precision = 12);
// Decode GeoHash into a vector, item0 is lat, item1 is long, item2-3 are lat min/max, item4-5 are long min/max
vector<double> bkGeoHashDecode(string hash);
// Return adjacent points, dir is one of top,left,right,bottom
string bkGeoHashAdjacent(string hash, string dir);
// Return grid of all neighboring boxes around the center, steps defines how many boxes in each direction from the center
// With steps = 1 the returned matrix is 3x3
vector< vector<string> > bkGeoHashGrid(string center, int steps = 1);
vector<string> bkGeoHashRow(string center, int steps);

// Parse JSON text into object
bkJsonValue *bkJsonParse(const char *source, int size = -1, string *errmsg = NULL);
bool bkJsonAppend(bkJsonValue *root, bkJsonValue *val);
int bkJsonLength(bkJsonValue *root);
bool bkJsonDel(bkJsonValue *root, string name);
bool bkJsonSet(bkJsonValue *root, bkJsonValue *val);
bool bkJsonSet(bkJsonValue *root, bkJsonType type, string name, string val = string());
bkJsonValue *bkJsonGet(bkJsonValue *obj, string name);
string bkJsonGetStr(bkJsonValue *root, string name);
int64_t bkJsonGetInt(bkJsonValue *root, string name);
double bkJsonGetNum(bkJsonValue *root, string name);
void bkJsonPrint(bkJsonValue *obj, int ident = 0);
string bkJsonStringify(bkJsonValue *value, string rc = string());
void bkJsonFree(bkJsonValue *obj);

// Compress/decompres using zlib
int bkDeflateInit(z_stream *strm, int level);
int bkDeflate(z_stream *strm, const char *inbuf, int inlen, string *outbuf);
int bkDeflateEnd(z_stream *strm, string *outbuf);

int bkInflateInit(z_stream *strm);
int bkInflate(z_stream *strm, const char* inbuf, int inlen, string *outbuf);
void bkInflateEnd(z_stream *strm);

#endif
