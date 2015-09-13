/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  April 2007
 *
 */

#ifndef _BK_LOG_H_
#define _BK_LOG_H_

#include "bksystem.h"

// Printing messages with time and line info
#define LogError(fmt...)               if (bkLog::test(Log_Error)) bkLog::print(Log_Error, __PRETTY_FUNCTION__, fmt);
#define LogWarn(fmt...)                if (bkLog::test(Log_Warn)) bkLog::print(Log_Warn, __FUNCTION__, fmt);
#define LogNotice(fmt...)              if (bkLog::test(Log_Notice)) bkLog::print(Log_Notice, __FUNCTION__, fmt);
#define LogInfo(fmt...)                if (bkLog::test(Log_Info)) bkLog::print(Log_Info, __FUNCTION__, fmt);
#define LogDebug(fmt...)               if (bkLog::test(Log_Debug)) bkLog::print(Log_Debug, __PRETTY_FUNCTION__, fmt);
#define LogDev(fmt...)                 if (bkLog::test(Log_Dev)) bkLog::print(Log_Dev, __PRETTY_FUNCTION__, fmt);
#define LogTest(fmt...)                if (bkLog::test(Log_Test)) bkLog::print(Log_Test, __PRETTY_FUNCTION__, fmt);

#define Log_None                       -1
#define Log_Error                      -1
#define Log_Warn                        0
#define Log_Notice                      1
#define Log_Info                        2
#define Log_Debug                       3
#define Log_Dev                         4
#define Log_Test                        5

class bkLog {
public:
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
