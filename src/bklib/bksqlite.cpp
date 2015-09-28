//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  April 2007
//

#include "bksqlite.h"
#include "bkregexp.h"

// Convenience function to enable logging
static void sqliteLogger(sqlite3_context *ctx, int argc, sqlite3_value **argv)
{
    if (argc > 0) bkLog::set((const char*)sqlite3_value_text(argv[0]));
    sqlite3_result_int(ctx, bkLog::level());
}

// Implementaton of the REGEXP function
static void sqliteRegexp(sqlite3_context *ctx, int argc, sqlite3_value **argv)
{
    if (argc < 2) return;
    const char *pattern = (const char *) sqlite3_value_text(argv[0]);
    const char *text = (const char*) sqlite3_value_text(argv[1]);
    if (pattern && text) sqlite3_result_int(ctx, strRegexp(pattern, text));
}

// The Matchinfo Function
//
// The matchinfo function returns a blob value. If it is used within a query that does not use the full-text index
// (a "query by rowid" or "linear scan"), then the blob is zero bytes in size. Otherwise, the blob consists of zero or more
// 32-bit unsigned integers in machine byte-order. The exact number of integers in the returned array depends on both the query
// and the value of the second argument (if any) passed to the matchinfo function.
//
// The matchinfo function is called with either one or two arguments. As for all auxiliary functions, the first argument must be
// the special FTS hidden column. The second argument, if it is specified, must be a text value comprised only of the characters
// 'p', 'c', 'n', 'a', 'l', 's' and 'x'. If no second argument is explicitly supplied, it defaults to "pcx". The second argument
// is refered to as the "format string" below.
//
// Characters in the matchinfo format string are processed from left to right. Each character in the format string causes one or
// more 32-bit unsigned integer values to be added to the returned array. The "values" column in the following table contains the number
// of integer values appended to the output buffer for each supported format string character. In the formula given, cols is the number of
// columns in the FTS table, and phrases is the number of matchable phrases in the query.
//
//  p    1    The number of matchable phrases in the query.
//
//  c    1    The number of user defined columns in the FTS table (i.e. not including the docid or the FTS hidden column).
//
//  x    3 * cols * phrases     For each distinct combination of a phrase and table column, the following three values:
//
//             1. In the current row, the number of times the phrase appears in the column.
//             2. The total number of times the phrase appears in the column in all rows in the FTS table.
//             3. The total number of rows in the FTS table for which the column contains at least one instance of the phrase.
//
//             The first set of three values corresponds to the left-most column of the table (column 0) and the left-most matchable
//             phrase in the query (phrase 0). If the table has more than one column, the second set of three values in the output
//             array correspond to phrase 0 and column 1. Followed by phrase 0, column 2 and so on for all columns of the table.
//             And so on for phrase 1, column 0, then phrase 1, column 1 etc. In other words, the data for occurences of phrase p in
//             column c may be found using the following formula:
//
//                hits_this_row  = array[3 * (c + p*cols) + 0]
//                hits_all_rows  = array[3 * (c + p*cols) + 1]
//                docs_with_hits = array[3 * (c + p*cols) + 2]
//
// n    1    The number of rows in the FTS4 table. This value is only available when querying FTS4 tables, not FTS3.
//
// a    cols    For each column, the average number of tokens in the text values stored in the column (considering all rows in the FTS4 table).
//              This value is only available when querying FTS4 tables, not FTS3.
//
// l    cols     For each column, the length of the value stored in the current row of the FTS4 table, in tokens. This value is only available
//               when querying FTS4 tables, not FTS3. And only if the "matchinfo=fts3" directive was not specified as part of the
//               "CREATE VIRTUAL TABLE" statement used to create the FTS4 table.
//
// s    cols    For each column, the length of the longest subsequence of phrase matches that the column value has in common with the query text.
//              For example, if a table column contains the text 'a b c d e' and the query is 'a c "d e"', then the length of the longest common
//              subsequence is 2 (phrase "c" followed by phrase "d e").
//
static void sqliteRankBM25(sqlite3_context *ctx, int argc, sqlite3_value **argv)
{
    if (argc < 1) {
        sqlite3_result_double(ctx, 0);
        return;
    }
    int ndocs = 0, ncols = 0, nphrases = 0;
    double weight = 0, score = 0.0, idf = 0.0, bm25 = 0.0;
    double tdocs = 0.0, tchits = 0.0, tthits = 0.0, tdhits = 0.0, tseqs = 0.0, tlens = 0.0, tavgs = 0.0;

    // !!! Second arg to matchinfo MUST be pcxnals
    int *matchinfo = (int *)sqlite3_value_blob(argv[0]);
    if (matchinfo) {
        nphrases = matchinfo[0];
        ncols = matchinfo[1];
        ndocs = matchinfo[2 + nphrases * ncols * 3];
        int *averages = &matchinfo[2 + nphrases * ncols * 3 + 1];
        int *lengths = averages + ncols;
        int *sequences = lengths + ncols;

        for (int i = 0; i < nphrases; i++) {
            int *phrase = &matchinfo[2 + i * ncols * 3];
            tdocs += ndocs;
            for (int j = 1; j < ncols; j++) {
                double chits = phrase[3 * j];
                double thits = phrase[3 * j + 1];
                double dhits = phrase[3 * j + 2];
                tchits += chits;
                tthits += thits;
                tdhits += dhits;
                tseqs += sequences[j];
                tlens += lengths[j];
                tavgs += averages[j];
                if (chits > 0) {
                    weight += (chits * (1.0 - ((double)j / (double)ncols))) / (0.25 + 0.75 * ((double)lengths[j] / (double)averages[j]));
                }
            }
        }
        // Calculate BM25 rank, scale to 0..1 range
        idf = log((tdocs - tdhits + 0.5) / tdhits) / log(0.5 + tdocs);
        bm25 = weight / (2 + weight) * idf;
    }
    score += bm25;
    sqlite3_result_double(ctx, score);
}

static int sqliteBusyHandler(void *ptr, int code)
{
    return 1;
}

// Set or reset busy timeout or handler, -1 set indefinite busy handler otherwise timeout is set
static void sqliteTimeout(sqlite3_context *ctx, int argc, sqlite3_value **argv)
{
    bkSqliteSetTimeout(sqlite3_context_db_handle(ctx), argc > 0 ? sqlite3_value_int(argv[0]) : -1);
}

// Return current UNIX time in seconds
static void sqliteNow(sqlite3_context *ctx, int argc, sqlite3_value **argv)
{
    sqlite3_result_int(ctx, time(NULL));
}

// Return current UNIX time in milliseconds
static void sqliteMNow(sqlite3_context *ctx, int argc, sqlite3_value **argv)
{
	struct timeval tv;
	gettimeofday(&tv, NULL);
	sqlite3_result_int64(ctx, ((int64_t)((int64_t)(tv.tv_sec)*1000 + tv.tv_usec/1000)));
}

// Implementation of string concatenation function
struct ConcatCtx {
    int len;
    int count;
    char *data;
    char *close;
};

static void sqliteConcat(ConcatCtx *p, const char *data, int len)
{
    if (data) {
        p->data = (char*)realloc(p->data, p->len + len + 1);
        p->data[p->len] = 0;
        strncat(p->data, data, len);
        p->len += len;
    }

}
static void sqliteConcatStep(sqlite3_context* ctx, int argc, sqlite3_value**argv)
{
    ConcatCtx *p = (ConcatCtx *) sqlite3_aggregate_context(ctx, sizeof(*p));
    const char *txt = (const char*)sqlite3_value_text(argv[0]);
    const char *sep = (const char*)sqlite3_value_text(argv[1]);
    if (!txt) return;
    if (argc > 3) {
        const char *open = (const char*)sqlite3_value_text(argv[2]);
        const char *close = (const char*)sqlite3_value_text(argv[3]);
        if (!p->close && close) p->close = strdup(close);
        if (!p->data && open) sqliteConcat(p, open, strlen(open));
    }
    if (p->count && sep) sqliteConcat(p, sep, strlen(sep));
    sqliteConcat(p, txt, strlen(txt));
    p->count++;
}

static void sqliteConcatFinal(sqlite3_context* ctx)
{
    ConcatCtx *p = (ConcatCtx *) sqlite3_aggregate_context(ctx, 0);
    if (p && p->data) {
        if (p->close) {
            sqliteConcat(p, p->close, strlen(p->close));
            free(p->close);
        }
        sqlite3_result_text(ctx, p->data, p->len, free);
    } else {
        sqlite3_result_text(ctx, "", 0, SQLITE_STATIC);
    }
}

// Manipulating arrays
static void sqliteArray(sqlite3_context *ctx, int argc, sqlite3_value **argv)
{
    if (argc < 3) return;
    const char *data = (const char *) sqlite3_value_text(argv[0]);
    const char *op = (const char*) sqlite3_value_text(argv[1]);
    const char *sep = (const char*) sqlite3_value_text(argv[2]);
    if (!sep || !sep[0]) sep = ",";
    if (!op || !op[0]) op = "add";

    vector<string> items = strSplit(data ? data : "", sep);
    if (!strcmp(op, "add") || !strcmp(op, "set")) {
        if (op[0] == 's') items.clear();
        for (int i = 3; i < argc; i++) {
            const char *val = (const char*) sqlite3_value_text(argv[i]);
            if (!val || !val[0]) continue;
            items.push_back(val);
        }
    } else
    if (!strcmp(op, "del")) {
        for (int i = 3; i < argc; i++) {
            const char *val = (const char*) sqlite3_value_text(argv[i]);
            if (!val || !val[0]) continue;
            vector<string>::iterator it = std::find(items.begin(), items.end(), val);
            if (it != items.end()) items.erase(it);
        }
    } else
    if (!strcmp(op, "clear")) {
        items.clear();
    }
    sqlite3_result_text(ctx, toString(items, sep).c_str(), -1, SQLITE_TRANSIENT);
}

// Public interface to sqlite functions
void bkSqliteInit()
{
    static bool init = false;
    if (init) return;
    init = true;

    sqlite3_enable_shared_cache(1);
}

bool bkSqliteInitDb(sqlite3 *handle, int (*progress)(void *))
{
    if (!handle) return false;
    sqlite3_create_function(handle, "array", -1, SQLITE_UTF8, 0, sqliteArray, 0, 0);
    sqlite3_create_function(handle, "regexp", 2, SQLITE_UTF8, 0, sqliteRegexp, 0, 0);
    sqlite3_create_function(handle, "concat", -1, SQLITE_UTF8, 0, NULL, sqliteConcatStep, sqliteConcatFinal);
    sqlite3_create_function(handle, "busy_timeout", 1, SQLITE_UTF8, 0, sqliteTimeout, 0, 0);
    sqlite3_create_function(handle, "mnow", 0, SQLITE_UTF8, 0, sqliteMNow, 0, 0);
    sqlite3_create_function(handle, "now", 0, SQLITE_UTF8, 0, sqliteNow, 0, 0);
    sqlite3_create_function(handle, "logger", 1, SQLITE_UTF8, 0, sqliteLogger, 0, 0);
    sqlite3_create_function(handle, "rank_bm25", -1, SQLITE_UTF8, 0, sqliteRankBM25, 0, 0);
    sqlite3_progress_handler(handle, 1500, progress, NULL);

    return true;
}

void bkSqliteDbInit(sqlite3 *handle)
{
    bkSqliteInit();
    bkSqliteInitDb(handle, NULL);
}

void bkSqliteSetTimeout(sqlite3 *handle, int timeout)
{
    if (timeout >= 0) {
        sqlite3_busy_timeout(handle, timeout);
    } else {
        sqlite3_busy_handler(handle, sqliteBusyHandler, NULL);
    }
}

int bkSqlitePrepare(sqlite3 *db, sqlite3_stmt **stmt, string sql, int count, int timeout)
{
    int n = 0, rc;
    do {
        rc = sqlite3_prepare_v2(db, sql.c_str(), -1, stmt, 0);
        if (rc == SQLITE_BUSY || rc == SQLITE_LOCKED) {
            n++;
            usleep(timeout);
        }
    } while (n < count && (rc == SQLITE_BUSY || rc == SQLITE_LOCKED));
    return rc;
}

int bkSqliteStep(sqlite3_stmt *stmt, int count, int timeout)
{
    int n = 0, rc;
    do {
        rc = sqlite3_step(stmt);
        if (rc == SQLITE_LOCKED) {
            rc = sqlite3_reset(stmt);
            n++;
            usleep(timeout);
        } else
        if (rc == SQLITE_BUSY) {
            usleep(timeout);
            n++;
        }
    } while(n < count && (rc == SQLITE_BUSY || rc == SQLITE_LOCKED));
    return rc;
}
