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
           "HAVE_READLINE=1"
           "MAGICKCORE_HDRI_ENABLE=0",
           "MAGICKCORE_QUANTUM_DEPTH=16"
        ],
        "include_dirs": [
           ".",
           "lib",
           "include",
           "build/include",
           "build/include/ImageMagick-6",
           "/opt/local/include",
           "<!@(pg_config --includedir)",
        ],
        "libraries": [
           "-L/opt/local/lib -Llib -L<!@(pg_config --libdir) -lMagickCore-6.Q16 -lMagickWand-6.Q16 -lleveldb -lsnappy -lnanomsg -lpq -lpcre",
        ],
        "sources": [
           "lib/node_backend.cpp",
           "lib/node_debug.cpp",
           "lib/node_sqlite.cpp",
           "lib/node_syslog.cpp",
           "lib/node_nanomsg.cpp",
           "lib/node_pgsql.cpp",
           "lib/node_leveldb.cpp",
           "lib/node_cache.cpp",
           "lib/vsqlite.cpp",
           "lib/vlog.cpp",
           "lib/vlib.cpp",
           "lib/sqlite3.c"
        ],
        "conditions": [
           [ 'OS=="mac"', {
             "xcode_settings": {
                "GCC_ENABLE_CPP_RTTI": "YES",
                "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
                "OTHER_CFLAGS": [
                   "-g",
                   "-fno-omit-frame-pointer",
                ],
             }
           }],
           [ 'OS=="linux"', {
             "cflags_cc+": [
               "-g",
               "-fno-omit-frame-pointer",
               "-frtti",
               "-fexceptions",
               "-rdynamic"
             ],
             "cflags": [
                "-g",
                "-fno-omit-frame-pointer",
                "-rdynamic"
             ]
           }]
        ]
    }]
}
