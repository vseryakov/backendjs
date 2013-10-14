/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  April 2007
 *
 */

#include "VLog.h"

static const char *_names[] = {
    "NONE",
    "ERROR",
    "NOTICE",
    "DEBUG",
    "DEV",
    "TEST",
};

static int _size(0);
static int _level(VLog::Log_Notice);
static char *_file(NULL);
static FILE *_out;

bool VLog::test(int level)
{
    return level > 0 && VLog::level() >= level;
}

int VLog::level(void)
{
    return _level;
}

int VLog::set(int level)
{
    return _level = level;
}

int VLog::set(const char *level)
{
    return set(fromString(level));
}

int VLog::setSize(int size)
{
    return _size = size;
}

const char *VLog::file()
{
    return _file;
}

const char *VLog::toString(int level)
{
    return level > 0 && level < VLog::Log_Max ? _names[level] : NULL;
}

int VLog::fromString(const char *str)
{
    int i;
    if (!str) return 0;

    if (isdigit(str[0])) {
        i = atoi(str);
        return i >= 0 && i < VLog::Log_Max ? i : 0;
    }

    for (i = 0; i < VLog::Log_Max; i++) {
        if (!strcasecmp(str, _names[i])) {
            return i;
        }
    }
    return 0;
}

int VLog::setChannel(FILE *fp)
{
	_out = fp;
	return 1;
}

FILE *VLog::getChannel()
{
	return _out ? _out : stdout;
}

int VLog::setFile(const char *path)
{
    // Redirect all output into log file
    if (!path) return 0;

    if (freopen(path, "a", stdout) == NULL || freopen(path, "a", stderr) == NULL) {
        LogError("%s: %s", path, strerror(errno));
    } else {
        if (_file) free(_file);
        _file = strdup(path);
        setvbuf(stdout, NULL, _IONBF, 0);
        setvbuf(stderr, NULL, _IONBF, 0);
    }
    return 1;
}

void VLog::rotate()
{
    // Rotate if reached the limit, keep up to 3 old files
    if (_size > 0 && _file) {
        struct stat st;
        if (stat(_file, &st)) return;
        if (st.st_size > _size * 1024 * 1024) {
            for (int i = 2; i > 0; i--) {
                char from[strlen(_file) + 10];
                char to[strlen(_file) + 10];
                sprintf(from, "%s.%d", _file, i);
                sprintf(to, "%s.%d", _file, i + 1);
                rename(from, to);
            }
            char to[strlen(_file) + 10];
            sprintf(to, "%s.1", _file);
            rename(_file, to);
        }
    }
}

void VLog::print(int level, const char *prefix, const char *fmt, ...)
{
    va_list ap;

    va_start(ap, fmt);
    vprint(level, prefix, fmt, ap);
    va_end(ap);
}

void VLog::vprint(int level, const char *prefix, const char *fmt, va_list ap)
{
    if (test(level)) {
        struct tm ltm;
        struct timeval tv;
        char tbuf[64];
        FILE *fp = _out ? _out : stdout;

        gettimeofday(&tv, NULL);
        localtime_r(&tv.tv_sec, &ltm);
        strftime(tbuf, 64, "%Y-%m-%d %H:%M:%S", &ltm);
        fprintf(fp, "[%s.%ld][%d.%p][%s] %s: ", tbuf, (long int)tv.tv_usec/1000, getpid(), (void*)pthread_self(), prefix ? prefix : "N/A", _names[level]);
        vfprintf(fp, fmt, ap);
        fprintf(fp, "\n");
    }
}

