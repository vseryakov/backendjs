/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  April 2007
 *
 */

#ifndef _V_LOG_H_
#define _V_LOG_H_

#include "bksystem.h"

// Printing messages with time and line info
#ifdef PG_EXTENSION
#define LogError(fmt...)               elog(ERROR, fmt);
#define LogNotice(fmt...)              elog(NOTICE, fmt);
#define LogDebug(fmt...)               elog(INFO, fmt);
#define LogDev(fmt...)                 elog(DEBUG5, fmt);
#define LogTest(fmt...)                elog(DEBUG1, fmt);
#else
#define LogError(fmt...)               if (VLog::test(VLog::Log_Error)) VLog::print(VLog::Log_Error, __PRETTY_FUNCTION__, fmt);
#define LogNotice(fmt...)              if (VLog::test(VLog::Log_Notice)) VLog::print(VLog::Log_Notice, __FUNCTION__, fmt);
#define LogDebug(fmt...)               if (VLog::test(VLog::Log_Debug)) VLog::print(VLog::Log_Debug, __PRETTY_FUNCTION__, fmt);
#define LogDev(fmt...)                 if (VLog::test(VLog::Log_Dev)) VLog::print(VLog::Log_Dev, __PRETTY_FUNCTION__, fmt);
#define LogTest(fmt...)                if (VLog::test(VLog::Log_Test)) VLog::print(VLog::Log_Test, __PRETTY_FUNCTION__, fmt);
#endif

class VLog {
public:
    // Log levels
    typedef enum {
        Log_None = 0,
        Log_Error,
        Log_Notice,
        Log_Debug,
        Log_Dev,
        Log_Test,
        Log_Max
    } Level;

    // Returns true if log level is enabled
    static bool test(int level);

    // Current log level
    static int level(void);

    // Set level by id or name
    static int set(int level);
    static int set(const char *level);

    // Set max size in Mb of the log file, once reached, log files will be rotated
    static int setSize(int size);

    // Rotate if reached the limit, keep up to nfiles old
    static void rotate(int nfiles = 2);

    // Redirect log into given file
    static int setFile(const char *path);
    static const char *file();

    // Assign output channel, default is stdout
    static int setChannel(FILE *fp);
    static FILE *getChannel();

    // Print message in the log or stdout
    static void print(int level, const char *prefix, const char *fmt, ...);
    static void vprint(int level, const char *prefix, const char *fmt, va_list ap);

    // Convert to/from level strings
    static const char *toString(int level);
    static int fromString(const char *level);
};

#endif
