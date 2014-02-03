/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  Author: Dm. Mayorov <arrabon@dimview.org>
 *  April 2007
 *
 */

#ifndef _V_SQLITE_H_
#define _V_SQLITE_H_

#include "vlib.h"

// Database intitalization
void vsqlite_init();
bool vsqlite_init_db(sqlite3 *handle, int (*progress)(void *));
void vsqlite_set_timeout(sqlite3 *handle, int timeout);

// Try operations multiple times
int vsqlite_prepare(sqlite3 *db, sqlite3_stmt **stmt, string sql, int count = 1, int timeout = 100);
int vsqlite_step(sqlite3_stmt *stmt, int count = 1, int timeout = 100);

extern "C" {
void vsqlite_db_init(sqlite3 *handle);
}

#endif
