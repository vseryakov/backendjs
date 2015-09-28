/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  April 2007
 *
 */

#ifndef _BK_SQLITE_H_
#define _BK_SQLITE_H_

#include "bklib.h"
#include "sqlite3.h"

// Database intitalization
void bkSqliteInit();
bool bkSqliteInitDb(sqlite3 *handle, int (*progress)(void *));
void bkSqliteSetTimeout(sqlite3 *handle, int timeout);

// Try operations multiple times
int bkSqlitePrepare(sqlite3 *db, sqlite3_stmt **stmt, string sql, int count = 1, int timeout = 100);
int bkSqliteStep(sqlite3_stmt *stmt, int count = 1, int timeout = 100);

extern "C" {
void bkSqliteDbInit(sqlite3 *handle);
}

#endif
