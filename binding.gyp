{
    "targets": [
    {
        "target_name": "backend",
        "defines": [  
           "SQLITE_USE_URI",
           "SQLITE_ENABLE_STAT3=1",
           "SQLITE_ENABLE_FTS4=1",
           "SQLITE_ENABLE_FTS3_PARENTHESIS=1",
           "SQLITE_ENABLE_COLUMN_METADATA=1",
           "SQLITE_ALLOW_COVERING_INDEX_SCAN=1",
           "SQLITE_ENABLE_UNLOCK_NOTIFY",
           "SQLITE_ENABLE_LOAD_EXTENSION",
           "SQLITE_SOUNDEX",
           "HAVE_INTTYPES_H=1",
           "HAVE_STDINT_H=1",
           "HAVE_USLEEP=1",
           "HAVE_LOCALTIME_R=1",
           "HAVE_GMTIME_R=1",
           "HAVE_STRERROR_R=1",
           "HAVE_READLINE=1",
           "<!@(if pkg-config --exists libpq; then echo USE_PGSQL; fi)"
        ],
        "include_dirs": [
           ".",
           "lib",
           "include",
           "build/include",
           "/opt/local/include"
        ],
        "libraries": [
           "-L/opt/local/lib -Llib -lleveldb -lsnappy -lnanomsg -lpcre",
           "$(shell /opt/local/lib/mysql56/bin/mysql_config --libs_r)",
           "$(shell pkg-config --silence-errors --static --libs libpq)",
           "$(shell PKG_CONFIG_PATH=$$(pwd)/lib/pkgconfig pkg-config --static --libs Wand)"
        ],
        "sources": [
           "lib/node_backend.cpp",
           "lib/node_debug.cpp",
           "lib/node_sqlite.cpp",
           "lib/node_syslog.cpp",
           "lib/node_nanomsg.cpp",
           "lib/node_pgsql.cpp",
           "lib/node_mysql.cpp",
           "lib/node_leveldb.cpp",
           "lib/node_cache.cpp",
           "lib/vsqlite.cpp",
           "lib/vlog.cpp",
           "lib/vlib.cpp",
           "lib/sqlite3.c",
           "lib/regexp.cpp"
        ],
        "conditions": [
           [ 'OS=="mac"', {
             "xcode_settings": {
                "GCC_ENABLE_CPP_RTTI": "YES",
                "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
                "OTHER_CFLAGS": [
                   "-g",
                   "-fno-omit-frame-pointer",
                   "$(shell /opt/local/lib/mysql56/bin/mysql_config --cflags)",
                   "$(shell pkg-config --silence-errors --cflags libpq)",
                   "$(shell ./bin/MagickWand-config --cflags)"
                ],
             }
           }],
           [ 'OS=="linux"', {
             "cflags_cc+": [
                "-g",
                "-fno-omit-frame-pointer",
                "$(shell mysql_config --cflags)",
                "$(shell pkg-config --silence-errors --cflags libpq)",
                "$(shell ./bin/MagickWand-config --cflags)",
                "-frtti",
                "-fexceptions",
                "-rdynamic"
             ]
           }]
        ]
    }]
}
