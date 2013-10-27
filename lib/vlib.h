/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  Author: Dm. Mayorov <arrabon@dimview.org>
 *  April 2007
 *
 */

#ifndef _V_LIB_H_
#define _V_LIB_H_

#include "vsystem.h"
#include "vlog.h"

typedef map<string, int> int_map;
typedef map<string, string> string_map;
typedef map<string, vector<string> > vector_map;

enum jsonType { JSON_NULL, JSON_OBJECT, JSON_ARRAY, JSON_STRING, JSON_INT, JSON_FLOAT, JSON_BOOL };

class jsonValue {
public:
    jsonValue(jsonType otype, string oname, string ovalue = string()): parent(0), next(0), first(0), last(0), type(otype), name(oname), value(ovalue) {}
    jsonValue *parent;
    jsonValue *next;
    jsonValue *first;
    jsonValue *last;
    jsonType type;
    string name;
    string value;
};

// Aho-Corasick algorithm according to http://dx.doi.org/10.1145/360825.360855
// Based on (https://gist.github.com/andmej/1233426) but uses dynamic memory
class CountWords {
public:
    CountWords(string id = string());
    ~CountWords();
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
void vlib_init();

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

// sprintf like
string vFmtStr(string, ...);
string vFmtStrV(string fmt, va_list ap);
string vStrFmtV(string &str, string fmt, va_list ap);
string vStrFmtV(string &str, string fmt, ...);

// Returns number of milliseconds since the epoch
long long vClock();

// Return how many times word appears in text using Knuth-Morris-Pratt algorithm
int vCountWords(const char *word, int wlen, const char *text, int tlen, bool all = true);
int vCountWords(const string &word, const string &text, bool all = true);
bool vFindWords(const char *word, int wlen, const char *text, int tlen);

// Recursively create all direcotris for given path
bool vMakePath(string path);

uint32_t vHash(const uint8_t *buf, int size);
uint32_t vHash2(const uint8_t *buf, int size, uint32_t seed = 0);
uint32_t vCrc32(const void *data, int size);
string vFmtTime(string fmt, int64_t sec);
void vSetFileTime(string file, int64_t t);
bool vWriteFile(const string file, const string data, int perms);
vector<string> vShuffleList(const vector<string> list);

// Global logging level
void vSetLogging(const char *level);

// Returns distance between 2 coordinates
double vDistance(double lat1, double long1, double lat2, double long2);
int vBearing(double lat1, double long1, double lat2, double long2);

// Encode into GeoHash with given precision
string vGeoHashEncode(double latitude, double longitude, uint precision = 12);
// Decode GeoHash into a vector, item0 is lat, item1 is long, item2-3 are lat min/max, item4-5 are long min/max
vector<double> vGeoHashDecode(string hash);
// Return adjacent points, dir is one of top,left,right,bottom
string vGeoHashAdjacent(string hash, string dir);

// Parse JSON text into object
jsonValue *jsonParse(const char *source, int size = -1, string *errmsg = NULL);
string jsonGet(jsonValue *obj, string name);
void jsonPrint(jsonValue *obj, int ident = 0);
void jsonFree(jsonValue *obj);

#endif
