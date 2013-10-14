/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  Author: Dm. Mayorov <arrabon@dimview.org>
 *  April 2007
 *
 */

#ifndef _V_SQLITE_H_
#define _V_SQLITE_H_

#include "Vlib.h"

// Database intitalization
void vsqlite_init();
bool vsqlite_init_db(sqlite3 *handle, int (*progress)(void *));
void vsqlite_set_timeout(sqlite3 *handle, int timeout);

// Very distinct synonyms
vector<string> vsqlite_synonyms_list();
vector<string> vsqlite_get_synonyms(const string key);
vector<string> vsqlite_find_synonyms(const string search);
void vsqlite_add_synonyms(vector<string> list);

// Common stop words to be ignored in search
int_map &vsqlite_stopwords_list();
void vsqlite_add_stopword(const string word);
bool vsqlite_stopword_contains(const string word);

// Tokenizer  and stemming interface
string_map &vsqlite_stemming_list();
void vsqlite_add_stemming(const string word, const string rule);
string vsqlite_do_stemming(const string);
vector<string> vsqlite_tokenize(const string text);
// Load different tokens/synonyms/stemm rules from file
bool vsqlite_load(string type, string file);

// Try operations multiple times
int vsqlite_prepare(sqlite3 *db, sqlite3_stmt **stmt, string sql, int count = 1, int timeout = 100);
int vsqlite_step(sqlite3_stmt *stmt, int count = 1, int timeout = 100);

extern "C" {
void vsqlite_db_init(sqlite3 *handle);
}

#endif
