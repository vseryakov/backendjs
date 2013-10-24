//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Author: Dm. Mayorov <arrabon@dimview.org>
//  April 2007
//
//  Tokenizer based on native tokenizer from sqlite3 with additional support for exceptions,
//  the first case is animals and animation both result in anim which is wrong for search, we want to keep
//  animals as animal, this is very popular word
//
//  FTS3 tokenizer interface is just copied here without messing with fts3_tokenizer.h header file that is never distributed outside of the source tree
//
//  SpellingCorrector
//  This started as a simple Bayesian spelling correcting, but then grew into search query
//  re-writing and now does the following:
//
// - Corrects spelling errors of distance 1 for N-grams up to _max_ngrams (crew and title only);
// - Connects words in N-grams with NEAR/0 instead of spaces for FTS;
// - Corrects spelling errors of distance 1 for individual words towards stemmed words (because
//   FTS uses stemming);
// - Time permitting, corrects spelling errors of distance 2 for individual words;
// - Handles special cases like ',' and ':' in search terms.
//

#include "vsqlite.h"
#include <pcre.h>
#include <stdint.h>

#define MAX_TOKEN_SIZE 32
#define isDelim(ch) (((ch) & 0x80) == 0 && ((ch) < 0x30 || !charMap[(ch) - 0x30]))
#define isSpecial(ch) (specialMap[(int)(ch)])

typedef struct sqlite3_tokenizer_module sqlite3_tokenizer_module;
typedef struct {
    const sqlite3_tokenizer_module *pModule;
} sqlite3_tokenizer;
typedef struct {
    sqlite3_tokenizer *pTokenizer;
} sqlite3_tokenizer_cursor;
struct sqlite3_tokenizer_module {
    int iVersion;
    int (*xCreate)(int argc, const char * const *argv, sqlite3_tokenizer **ppTokenizer);
    int (*xDestroy)(sqlite3_tokenizer *pTokenizer);
    int (*xOpen)(sqlite3_tokenizer *pTokenizer, const char *pInput, int nBytes, sqlite3_tokenizer_cursor **ppCursor);
    int (*xClose)(sqlite3_tokenizer_cursor *pCursor);
    int (*xNext)(sqlite3_tokenizer_cursor *pCursor, const char **ppToken, int *pnBytes, int *piStartOffset, int *piEndOffset, int *piPosition);
    int (*xLanguageid)(sqlite3_tokenizer_cursor *pCsr, int iLangid);
};
typedef struct {
    sqlite3_tokenizer base;
} vporter_tokenizer;
typedef struct vporter_tokenizer_cursor {
    sqlite3_tokenizer_cursor base;
    const char *zInput;                  // input we are tokenizing
    int nInput;                          // size of the input
    int iOffset;                         // current position in zInput
    int iToken;                          // index of next token to be returned
    char zToken[MAX_TOKEN_SIZE + 1];     // storage for current token
} vporter_tokenizer_cursor;

static int_map _stopwords;
static string_map _stemming;
static vector_map _synonyms;

// Delimiter characters that may be part of a token based on stemming rules, for words like sci-fi
static char specialMap[255];

/*
 ** Characters that can be part of a token.  We assume any character
 ** whose value is greater than 0x80 (any UTF character) can be
 ** part of a token.  In other words, delimiters all must have
 ** values of 0x7f or lower.
 */
static const char charMap[] = {
        /* x0 x1 x2 x3 x4 x5 x6 x7 x8 x9 xA xB xC xD xE xF */
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, /* 3x */
        0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, /* 4x */
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, /* 5x */
        0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, /* 6x */
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, /* 7x */
};

static int vporterCreate(int argc, const char * const *argv, sqlite3_tokenizer **ppTokenizer)
{
    vporter_tokenizer *t = (vporter_tokenizer *) sqlite3_malloc(sizeof(*t));
    if (t == NULL) return SQLITE_NOMEM;
    memset(t, 0, sizeof(*t));
    *ppTokenizer = &t->base;
    return SQLITE_OK;
}

static int vporterDestroy(sqlite3_tokenizer *pTokenizer)
{
    sqlite3_free(pTokenizer);
    return SQLITE_OK;
}

static int vporterOpen(sqlite3_tokenizer *pTokenizer, const char *zInput, int nInput, sqlite3_tokenizer_cursor **ppCursor)
{
    vporter_tokenizer_cursor *c;

    c = (vporter_tokenizer_cursor *)sqlite3_malloc(sizeof(*c));
    if (c == NULL) return SQLITE_NOMEM;
    memset(c, 0, sizeof(*c));

    c->zInput = zInput;
    c->nInput = nInput;
    if (zInput == 0) {
        c->nInput = 0;
    } else
    if (nInput < 0) {
        c->nInput = (int) strlen(zInput);
    }

    *ppCursor = &c->base;
    return SQLITE_OK;
}

static int vporterClose(sqlite3_tokenizer_cursor *pCursor)
{
    vporter_tokenizer_cursor *c = (vporter_tokenizer_cursor *) pCursor;
    sqlite3_free(c);
    return SQLITE_OK;
}

/*
 ** Vowel or consonant
 */
static const char cType[] = { 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 2, 1 };

/*
 ** isConsonant() and isVowel() determine if their first character in
 ** the string they point to is a consonant or a vowel, according
 ** to Porter ruls.
 **
 ** A consonate is any letter other than 'a', 'e', 'i', 'o', or 'u'.
 ** 'Y' is a consonant unless it follows another consonant,
 ** in which case it is a vowel.
 **
 ** In these routine, the letters are in reverse order.  So the 'y' rule
 ** is that 'y' is a consonant unless it is followed by another
 ** consonent.
 */
static int isVowel(const char*);
static int isConsonant(const char *z)
{
    int j;
    char x = *z;
    if (x == 0) return 0;
    j = cType[x - 'a'];
    if (j < 2) return j;
    return z[1] == 0 || isVowel(z + 1);
}
static int isVowel(const char *z)
{
    int j;
    char x = *z;
    if (x == 0) return 0;
    j = cType[x - 'a'];
    if (j < 2) return 1 - j;
    return isConsonant(z + 1);
}

/*
 ** Let any sequence of one or more vowels be represented by V and let
 ** C be sequence of one or more consonants.  Then every word can be
 ** represented as:
 **
 **           [C] (VC){m} [V]
 **
 ** In prose:  A word is an optional consonant followed by zero or
 ** vowel-consonant pairs followed by an optional vowel.  "m" is the
 ** number of vowel consonant pairs.  This routine computes the value
 ** of m for the first i bytes of a word.
 **
 ** Return true if the m-value for z is 1 or more.  In other words,
 ** return true if z contains at least one vowel that is followed
 ** by a consonant.
 **
 ** In this routine z[] is in reverse order.  So we are really looking
 ** for an instance of of a consonant followed by a vowel.
 */
static int m_gt_0(const char *z)
{
    while (isVowel(z)) {
        z++;
    }
    if (*z == 0) return 0;
    while (isConsonant(z)) {
        z++;
    }
    return *z != 0;
}

/* Like mgt0 above except we are looking for a value of m which is
 ** exactly 1
 */
static int m_eq_1(const char *z)
{
    while (isVowel(z)) {
        z++;
    }
    if (*z == 0) return 0;
    while (isConsonant(z)) {
        z++;
    }
    if (*z == 0) return 0;
    while (isVowel(z)) {
        z++;
    }
    if (*z == 0) return 1;
    while (isConsonant(z)) {
        z++;
    }
    return *z == 0;
}

/* Like mgt0 above except we are looking for a value of m>1 instead
 ** or m>0
 */
static int m_gt_1(const char *z)
{
    while (isVowel(z)) {
        z++;
    }
    if (*z == 0) return 0;
    while (isConsonant(z)) {
        z++;
    }
    if (*z == 0) return 0;
    while (isVowel(z)) {
        z++;
    }
    if (*z == 0) return 0;
    while (isConsonant(z)) {
        z++;
    }
    return *z != 0;
}

/*
 ** Return TRUE if there is a vowel anywhere within z[0..n-1]
 */
static int hasVowel(const char *z)
{
    while (isConsonant(z)) {
        z++;
    }
    return *z != 0;
}

/*
 ** Return TRUE if the word ends in a double consonant.
 **
 ** The text is reversed here. So we are really looking at
 ** the first two characters of z[].
 */
static int doubleConsonant(const char *z)
{
    return isConsonant(z) && z[0] == z[1];
}

/*
 ** Return TRUE if the word ends with three letters which
 ** are consonant-vowel-consonent and where the final consonant
 ** is not 'w', 'x', or 'y'.
 **
 ** The word is reversed here.  So we are really checking the
 ** first three letters and the first one cannot be in [wxy].
 */
static int star_oh(const char *z)
{
    return isConsonant(z) && z[0] != 'w' && z[0] != 'x' && z[0] != 'y' && isVowel(z + 1) && isConsonant(z + 2);
}

/*
 ** If the word ends with zFrom and xCond() is true for the stem
 ** of the word that preceeds the zFrom ending, then change the
 ** ending to zTo.
 **
 ** The input word *pz and zFrom are both in reverse order.  zTo
 ** is in normal order.
 **
 ** Return TRUE if zFrom matches.  Return FALSE if zFrom does not
 ** match.  Not that TRUE is returned even if xCond() fails and
 ** no substitution occurs.
 */
static int stem(char **pz, const char *zFrom, const char *zTo, int(*xCond)(const char*))
{
    char *z = *pz;
    while (*zFrom && *zFrom == *z) {
        z++;
        zFrom++;
    }
    if (*zFrom != 0) return 0;
    if (xCond && !xCond(z)) return 1;
    while (*zTo) {
        *(--z) = *(zTo++);
    }
    *pz = z;
    return 1;
}

/*
 ** This is the fallback stemmer used when the vporter stemmer is
 ** inappropriate.  The input word is copied into the output as is but
 ** cut if exceeds max token size
 */
static void copy_stemmer(const char *zIn, int nIn, char *zOut, int *pnOut)
{
    int i;
    for (i = 0; i < nIn && i < MAX_TOKEN_SIZE; i++) zOut[i] = zIn[i];
    zOut[i] = 0;
    *pnOut = i;
}

/*
 ** Stem the input word zIn[0..nIn-1].  Store the output in zOut.
 ** zOut is at least big enough to hold nIn bytes.  Write the actual
 ** size of the output word (exclusive of the '\0' terminator) into *pnOut.
 **
 ** Any upper-case characters in the US-ASCII character set ([A-Z])
 ** are converted to lower case.  Upper-case UTF characters are
 ** unchanged.
 **
 ** If the input word contains not digits but does characters not
 ** in [a-zA-Z] then no stemming is attempted and this routine just
 ** copies the input into the input into the output
 **
 ** Stemming never increases the length of the word.  So there is
 ** no chance of overflowing the zOut buffer.
 */
static bool vporter_stemmer(const char *zIn, int nIn, char *zOut, int *pnOut)
{
    int i, j;
    char zReverse[MAX_TOKEN_SIZE + 7];
    char *z, *z2;

    if (nIn < 3 || nIn >= MAX_TOKEN_SIZE) {
        // The word is too big or too small for the vporter stemmer. Fallback to the copy stemmer
        copy_stemmer(zIn, nIn, zOut, pnOut);
        return false;
    }
    // Exception word
    string_map::const_iterator ex = _stemming.find(strToLower(string(zIn, nIn)));
    if (ex != _stemming.end()) {
        snprintf(zOut, MAX_TOKEN_SIZE, "%s", ex->second.c_str());
        *pnOut = ex->second.length();
        return true;
    }
    for (i = 0, j = sizeof(zReverse) - 6; i < nIn; i++, j--) {
        char c = zIn[i];
        if (c >= 'A' && c <= 'Z') {
            zReverse[j] = c + 'a' - 'A';
        } else
        if (c >= 'a' && c <= 'z') {
            zReverse[j] = c;
        } else {
            // The use of a character not in [a-zA-Z] means that we fallback to the copy stemmer
            copy_stemmer(zIn, nIn, zOut, pnOut);
            return false;
        }
    }
    memset(&zReverse[sizeof(zReverse) - 5], 0, 5);
    z = &zReverse[j + 1];

    /* Step 1a */
    if (z[0] == 's') {
        if (!stem(&z, "sess", "ss", 0) && !stem(&z, "sei", "i", 0) && !stem(&z, "ss", "ss", 0)) {
            z++;
        }
    }

    /* Step 1b */
    z2 = z;
    if (stem(&z, "dee", "ee", m_gt_0)) {
        /* Do nothing.  The work was all in the test */
    } else
    if ((stem(&z, "gni", "", hasVowel) || stem(&z, "de", "", hasVowel)) && z != z2) {
        if (stem(&z, "ta", "ate", 0) || stem(&z, "lb", "ble", 0) || stem(&z, "zi", "ize", 0)) {
            /* Do nothing.  The work was all in the test */
        } else
        if (doubleConsonant(z) && (*z != 'l' && *z != 's' && *z != 'z')) {
            z++;
        } else
        if (m_eq_1(z) && star_oh(z)) {
            *(--z) = 'e';
        }
    }

    /* Step 1c */
    if (z[0] == 'y' && hasVowel(z + 1)) {
        z[0] = 'i';
    }

    /* Step 2 */
    switch (z[1]) {
    case 'a':
        stem(&z, "lanoita", "ate", m_gt_0) || stem(&z, "lanoit", "tion", m_gt_0);
        break;
    case 'c':
        stem(&z, "icne", "ence", m_gt_0) || stem(&z, "icna", "ance", m_gt_0);
        break;
    case 'e':
        stem(&z, "rezi", "ize", m_gt_0);
        break;
    case 'g':
        stem(&z, "igol", "log", m_gt_0);
        break;
    case 'l':
        stem(&z, "ilb", "ble", m_gt_0) || stem(&z, "illa", "al", m_gt_0) || stem(&z, "iltne", "ent", m_gt_0) || stem(&z, "ile", "e", m_gt_0) || stem(&z, "ilsuo", "ous", m_gt_0);
        break;
    case 'o':
        stem(&z, "noitazi", "ize", m_gt_0) || stem(&z, "noita", "ate", m_gt_0) || stem(&z, "rota", "ate", m_gt_0);
        break;
    case 's':
        stem(&z, "msila", "al", m_gt_0) || stem(&z, "ssenevi", "ive", m_gt_0) || stem(&z, "ssenluf", "ful", m_gt_0) || stem(&z, "ssensuo", "ous", m_gt_0);
        break;
    case 't':
        stem(&z, "itila", "al", m_gt_0) || stem(&z, "itivi", "ive", m_gt_0) || stem(&z, "itilib", "ble", m_gt_0);
        break;
    }

    /* Step 3 */
    switch (z[0]) {
    case 'e':
        stem(&z, "etaci", "ic", m_gt_0) || stem(&z, "evita", "", m_gt_0) || stem(&z, "ezila", "al", m_gt_0);
        break;
    case 'i':
        stem(&z, "itici", "ic", m_gt_0);
        break;
    case 'l':
        stem(&z, "laci", "ic", m_gt_0) || stem(&z, "luf", "", m_gt_0);
        break;
    case 's':
        stem(&z, "ssen", "", m_gt_0);
        break;
    }

    /* Step 4 */
    switch (z[1]) {
    case 'a':
        if (z[0] == 'l' && m_gt_1(z + 2)) {
            z += 2;
        }
        break;
    case 'c':
        if (z[0] == 'e' && z[2] == 'n' && (z[3] == 'a' || z[3] == 'e') && m_gt_1(z + 4)) {
            z += 4;
        }
        break;
    case 'e':
        if (z[0] == 'r' && m_gt_1(z + 2)) {
            z += 2;
        }
        break;
    case 'i':
        if (z[0] == 'c' && m_gt_1(z + 2)) {
            z += 2;
        }
        break;
    case 'l':
        if (z[0] == 'e' && z[2] == 'b' && (z[3] == 'a' || z[3] == 'i') && m_gt_1(z + 4)) {
            z += 4;
        }
        break;
    case 'n':
        if (z[0] == 't') {
            if (z[2] == 'a') {
                if (m_gt_1(z + 3)) {
                    z += 3;
                }
            } else
            if (z[2] == 'e') {
                stem(&z, "tneme", "", m_gt_1) || stem(&z, "tnem", "", m_gt_1) || stem(&z, "tne", "", m_gt_1);
            }
        }
        break;
    case 'o':
        if (z[0] == 'u') {
            if (m_gt_1(z + 2)) {
                z += 2;
            }
        } else
            if (z[3] == 's' || z[3] == 't') {
                stem(&z, "noi", "", m_gt_1);
            }
        break;
    case 's':
        if (z[0] == 'm' && z[2] == 'i' && m_gt_1(z + 3)) {
            z += 3;
        }
        break;
    case 't':
        stem(&z, "eta", "", m_gt_1) || stem(&z, "iti", "", m_gt_1);
        break;
    case 'u':
        if (z[0] == 's' && z[2] == 'o' && m_gt_1(z + 3)) {
            z += 3;
        }
        break;
    case 'v':
    case 'z':
        if (z[0] == 'e' && z[2] == 'i' && m_gt_1(z + 3)) {
            z += 3;
        }
        break;
    }

    /* Step 5a */
    if (z[0] == 'e') {
        if (m_gt_1(z + 1)) {
            z++;
        } else
        if (m_eq_1(z + 1) && !star_oh(z + 1)) {
            z++;
        }
    }

    /* Step 5b */
    if (m_gt_1(z) && z[0] == 'l' && z[1] == 'l') {
        z++;
    }

    // z[] is now the stemmed word in reverse order.  Flip it back around into forward order and return.
    *pnOut = i = (int) strlen(z);
    zOut[i] = 0;
    while (*z) {
        zOut[--i] = *(z++);
    }
    return true;
}

/*
 ** Extract the next token from a tokenization cursor.  The cursor must have been opened by a prior call to vporterOpen().
 */
static int vporterNext(sqlite3_tokenizer_cursor *pCursor, const char **pzToken, int *pnBytes, int *piStartOffset, int *piEndOffset, int *piPosition)
{
    vporter_tokenizer_cursor *c = (vporter_tokenizer_cursor *) pCursor;
    const char *z = c->zInput;

    while (c->iOffset < c->nInput) {
        int iStart, iEnd, iDigits;

        // Scan past delimiter characters
        while (c->iOffset < c->nInput && isDelim(z[c->iOffset])) c->iOffset++;

        // Count non-delimiter characters.
        iStart = iDigits = c->iOffset;

        while (c->iOffset < c->nInput && !isDelim(z[c->iOffset])) {
            if (isdigit(z[c->iOffset])) iDigits++;
            c->iOffset++;
        }
        iEnd = c->iOffset;

        // Handle floats because of channel numbers and also any floating number should be searched as a whole
        if (iDigits > iStart && iDigits == c->iOffset && z[iDigits] == '.') {
            for (iDigits++; iDigits < c->nInput; iDigits++) {
                // Found delimiter first, all digits
                if (isDelim(z[iDigits])) {
                    c->iOffset = iDigits;
                    break;
                }
                // Stop on first non digit and non-delimiter, this is not a float number
                if (!isdigit(z[iDigits])) {
                    break;
                }
            }
        }

        // Handle words with defis, we may want to preserve special words like sci-fi
        if (isSpecial(z[c->iOffset])) {
            for (iEnd++; iEnd < c->nInput && !isDelim(z[iEnd]); iEnd++) {}
            if (_stemming.find(strToLower(string(&z[iStart], iEnd - iStart))) != _stemming.end()) {
                c->iOffset = iEnd;
            }
        }

        if (c->iOffset > iStart) {
            int n = c->iOffset - iStart;
            // Ignore stop words
            if (!vsqlite_stopword_contains(strToLower(string(&z[iStart], n)))) {
                vporter_stemmer(&z[iStart], n, c->zToken, pnBytes);
                *pzToken = c->zToken;
                *piStartOffset = iStart;
                *piEndOffset = c->iOffset;
                *piPosition = c->iToken++;
                return SQLITE_OK;
            }
        }
    }
    return SQLITE_DONE;
}

// Convenience function to enable logging
static void sqliteLogger(sqlite3_context *ctx, int argc, sqlite3_value **argv)
{
    if (argc > 0) VLog::set((const char*)sqlite3_value_text(argv[0]));
    sqlite3_result_int(ctx, VLog::level());
}

// Implementaton of the REGEXP function
static void sqliteRegexp(sqlite3_context *ctx, int argc, sqlite3_value **argv)
{
    if (argc < 2) return;
    const char *pattern = (const char *) sqlite3_value_text(argv[0]);
    const char *text = (const char*) sqlite3_value_text(argv[1]);
    if (!pattern || !text) return;

    char *err = NULL;
    int offset, errcode;
    pcre *rx = pcre_compile2(pattern, PCRE_UTF8|PCRE_CASELESS, &errcode, (const char **) &err, &offset, NULL);
    if (!rx) {
        sqlite3_result_error(ctx, err, strlen(err));
        return;
    }
    errcode = pcre_exec(rx, NULL, text, strlen(text), 0, 0, NULL, 0);
    if (errcode < 0) {
        char *errmsg;
        switch (errcode) {
        case PCRE_ERROR_NOMATCH:
            sqlite3_result_int(ctx, 0);
            break;

        case PCRE_ERROR_NOMEMORY:
            sqlite3_result_error_nomem(ctx);
            break;

        default:
            errmsg = sqlite3_mprintf("pcre_exec: Error code %d\n", errcode);
            if (!errmsg) {
                sqlite3_result_error_nomem(ctx);
            } else {
                sqlite3_result_error(ctx, errmsg, strlen(errmsg));
            }
            sqlite3_free(errmsg);
        }
    } else {
        sqlite3_result_int(ctx, 1);
    }
    pcre_free(rx);
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

        // Calc phrase weights, ignore id(first column) because it may contain key words in some records
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
    vsqlite_set_timeout(sqlite3_context_db_handle(ctx), argc > 0 ? sqlite3_value_int(argv[0]) : -1);
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

// Implementtion of string concatenation function
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

static const sqlite3_tokenizer_module _vporterTokenizerModule = { 0, vporterCreate, vporterDestroy, vporterOpen, vporterClose, vporterNext, 0 };

// Public interface to sqlite functions
void vsqlite_init()
{
    static bool init = false;
    if (init) return;
    init = true;

    sqlite3_enable_shared_cache(1);
    memset(specialMap, 0, sizeof(specialMap));
}

bool vsqlite_init_db(sqlite3 *handle, int (*progress)(void *))
{
    sqlite3_stmt *stmt;
    const sqlite3_tokenizer_module *p = &_vporterTokenizerModule;

    LogDev("%p: %s", handle, handle ? sqlite3_db_filename(handle, "main") : "");

    if (!handle) return false;
    sqlite3_create_function(handle, "regexp", 2, SQLITE_UTF8, 0, sqliteRegexp, 0, 0);
    sqlite3_create_function(handle, "concat", -1, SQLITE_UTF8, 0, NULL, sqliteConcatStep, sqliteConcatFinal);
    sqlite3_create_function(handle, "busy_timeout", 1, SQLITE_UTF8, 0, sqliteTimeout, 0, 0);
    sqlite3_create_function(handle, "mnow", 0, SQLITE_UTF8, 0, sqliteMNow, 0, 0);
    sqlite3_create_function(handle, "now", 0, SQLITE_UTF8, 0, sqliteNow, 0, 0);
    sqlite3_create_function(handle, "logger", 1, SQLITE_UTF8, 0, sqliteLogger, 0, 0);
    sqlite3_create_function(handle, "rank_bm25", -1, SQLITE_UTF8, 0, sqliteRankBM25, 0, 0);
    sqlite3_progress_handler(handle, 1500, progress, NULL);

    // Define out tokenizer with different name: backend_porter
    if (sqlite3_prepare_v2(handle, "SELECT fts3_tokenizer(?, ?)", -1, &stmt, 0) != SQLITE_OK) {
        LogError("tokenizer: prepare: %s", sqlite3_errmsg(handle));
        return false;
    }
    if (sqlite3_bind_text(stmt, 1, "backend_porter", -1, SQLITE_STATIC) != SQLITE_OK ||
        sqlite3_bind_blob(stmt, 2, &p, sizeof(p), SQLITE_STATIC) != SQLITE_OK) {
        LogError("tokenizer: bind: %s", sqlite3_errmsg(handle));
    }
    int rc = sqlite3_step(stmt);
    if (rc != SQLITE_DONE && rc != SQLITE_ROW) {
        LogError("tokenizer: step: %s", sqlite3_errmsg(handle));
    }
    if (sqlite3_finalize(stmt) != SQLITE_OK) {
        LogError("tokenizer: finalize: %s", sqlite3_errmsg(handle));
    }
    return true;
}

void vsqlite_db_init(sqlite3 *handle)
{
    vsqlite_init();
    vsqlite_init_db(handle, NULL);
}

void vsqlite_set_timeout(sqlite3 *handle, int timeout)
{
    if (timeout >= 0) {
        sqlite3_busy_timeout(handle, timeout);
    } else {
        sqlite3_busy_handler(handle, sqliteBusyHandler, NULL);
    }
}

vector<string> vsqlite_synonyms_list()
{
    vector<string> rc;
    vector_map::const_iterator it = _synonyms.begin();
    while (it != _synonyms.end()) {
    	const vector<string> &list = it->second;
        rc.push_back(it->first + "|" + toString(list, "|"));
        it++;
    }
    return rc;
}

int_map &vsqlite_stopwords_list()
{
    return _stopwords;
}

bool vsqlite_stopword_contains(const string word)
{
    return _stopwords.find(strToLower(word)) != _stopwords.end();
}

string_map &vsqlite_stemming_list()
{
    return _stemming;
}

string vsqlite_do_stemming(const string word)
{
    int len;
    char out[word.size() + 1];
    vporter_stemmer(word.c_str(), word.size(), out, &len);
    return string(out, len);
}

vector<string> vsqlite_tokenize(const string text)
{
    vector<string> rc;
    const sqlite3_tokenizer_module *p = &_vporterTokenizerModule;
    sqlite3_tokenizer *tokenizer = 0;
    sqlite3_tokenizer_cursor *cursor = 0;
    const char *zToken;
    int nToken, iStart, iEnd, iPos;

    if (p->xCreate(0, 0, &tokenizer) != SQLITE_OK) return rc;
    if (p->xOpen(tokenizer, text.c_str(), text.size(), &cursor) == SQLITE_OK) {
        while (p->xNext(cursor, &zToken, &nToken, &iStart, &iEnd, &iPos) == SQLITE_OK) {
            rc.push_back(string(zToken, nToken));
        }
    }
    p->xClose(cursor);
    p->xDestroy(tokenizer);
    return rc;
}

vector<string> vsqlite_get_synonyms(const string key)
{
    vector_map::const_iterator rc = _synonyms.find(key);
    if (rc != _synonyms.end()) return rc->second;
    return vector<string>();
}

vector<string> vsqlite_find_synonyms(const string search)
{
    vector<string> rc, words = strSplit(strToLower(search), " ");
    for (uint i = 0; i < words.size(); i++) {
        vector_map::const_iterator rc = _synonyms.find(words[i]);
        if (rc == _synonyms.end() && i < words.size() - 1) {
            rc = _synonyms.find(words[i] + " " + words[i + 1]);
        }
        // Only first match
        if (rc != _synonyms.end()) return rc->second;
    }
    return rc;
}

void vsqlite_add_synonyms(vector<string> list)
{
    for (uint i = 0; i < list.size(); i++) {
        if (list[i].size()) _synonyms[list[i]] = list;
    }
}

void vsqlite_add_stopword(const string word)
{
    if (word.size()) _stopwords[word] = 1;
}

void vsqlite_add_stemming(const string word, const string rule)
{
	if (!word.size() || !rule.size()) return;
	_stemming[word] = rule;
    // Mark all special delimiters so we can stem special words
    for (int j = 0; word[j]; j++) {
        if (isDelim(word[j])) specialMap[(int)word[j]] = 1;
    }
}

bool vsqlite_load(string type, string file)
{
    FILE *fp = fopen(file.c_str(), "r");
    if (!fp) return false;

    if (type == "synonyms") _synonyms.clear();
    if (type == "stopwords") _stopwords.clear();
    if (type == "stemming") _stemming.clear();

    int lines = 0;
    char str[2048];
    while (!feof(fp)) {
        fgets(str, sizeof(str), fp);
        vector<string> words = strSplit(strTrim(str), "|");
        if (type == "stopwords") {
        	for (uint i = 0;i < words.size(); i++) {
        		vsqlite_add_stopword(words[i]);
        	}
        } else
        if (type == "synonyms") {
        	vsqlite_add_synonyms(words);
        } else
        if (type == "stemming") {
        	if (words.size() == 2) vsqlite_add_stemming(words[0], words[1]);
        }
        lines++;
    }
    fclose(fp);
    LogDev("%d lines, type=%s, file=%s", lines, type.c_str(), file.c_str());
    return true;
}

int vsqlite_prepare(sqlite3 *db, sqlite3_stmt **stmt, string sql, int count, int timeout)
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

int vsqlite_step(sqlite3_stmt *stmt, int count, int timeout)
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
