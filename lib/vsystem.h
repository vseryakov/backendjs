/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  August 2010
 *
 */

#ifndef _V_SYSTEM_H_
#define _V_SYSTEM_H_

#if defined(__linux__) || defined(__APPLE__)
#define __UNIX__
#endif

#include <stdio.h>
#include <signal.h>
#include <stdlib.h>
#include <stdarg.h>
#include <inttypes.h>
#include <errno.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <math.h>
#include <string.h>
#include <unistd.h>
#include <sys/param.h>
#include <fcntl.h>
#include <utime.h>
#include <dirent.h>
#include <stdbool.h>
#include <stdint.h>
#include <sys/types.h>
#include <sys/time.h>
#include <zlib.h>
#include <execinfo.h>
#include <syslog.h>

#ifdef SQLITE3_MODULE
#include "sqlite3ext.h"
#else
#include "sqlite3.h"
#endif

#ifdef __UNIX__
#include <sys/ioctl.h>
#include <sys/un.h>
#include <sys/socket.h>
#include <netdb.h>
#include <poll.h>
#include <pthread.h>
#include <sys/wait.h>
#include <sys/resource.h>
#include <sys/mount.h>
#include <sys/reboot.h>
#include <netinet/in.h>
#include <netinet/ip.h>
#include <netinet/udp.h>
#include <netinet/in_systm.h>
#include <netinet/ip_icmp.h>
#include <arpa/inet.h>
#include <net/route.h>
#include <net/ethernet.h>
#include <resolv.h>
#include <termios.h>
#include <openssl/ssl.h>
#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/rand.h>
#endif

#ifdef __linux__
#include <linux/rtc.h>
#include <linux/dvb/frontend.h>
#include <linux/dvb/dmx.h>
#include <linux/input.h>
#include <linux/hidraw.h>
#include <linux/videodev2.h>
#include <net/if.h>
#include <alsa/asoundlib.h>
#include <mntent.h>
#include <sys/vfs.h>
#endif

#include <algorithm>
#include <vector>
#include <string>
#include <set>
#include <list>
#include <map>
#include <queue>
using namespace std;

#ifdef UNICODE
typedef wchar_t TCHAR;
#define _tcslen     wcslen
#define _tcscspn    wcscspn
#define _tcsstr     wcsstr
#define _tcsncpy    wcsncpy
#define _tcschr     wcschr
define  _tcsncmp    wcsncmp
#define _tcsspn     wcsspn
#else
typedef char TCHAR;
#define _tcslen     strlen
#define _tcscspn    strcspn
#define _tcsstr     strstr
#define _tcsncpy    strncpy
#define _tcschr     strchr
#define _tcsncmp    strncmp
#define _tcsspn     strspn
#endif
#define _T(x) (x)

#endif
