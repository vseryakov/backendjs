{
    "target_defaults": {
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
           "LEVELDB_PLATFORM_POSIX",
           "SNAPPY=1",
           "NDEBUG",
        ],
        "include_dirs": [
           ".",
           "lib",
           "lib/snappy",
           "lib/lmdb",
           "lib/sqlite",
           "lib/leveldb/include",
           "lib/leveldb",
           "include",
           "build/include",
           "/opt/local/include"
        ]
    },
    "targets": [
    {
        "target_name": "backend",
        "defines": [
           "<!@(if which mysql_config 2>/dev/null 1>&2; then echo USE_MYSQL; fi)",
           "<!@(if pkg-config --exists libpq; then echo USE_PGSQL; fi)",
           "<!@(PKG_CONFIG_PATH=`pwd`/build/lib/pkgconfig; if pkg-config --exists Wand; then echo USE_WAND; fi)",
           "<!@(PKG_CONFIG_PATH=`pwd`/build/lib/pkgconfig; if pkg-config --exists libnanomsg; then echo USE_NANOMSG; fi)",
        ],
        "libraries": [
           "-L/opt/local/lib",
           "$(shell mysql_config --libs_r 2>/dev/null)",
           "$(shell pkg-config --silence-errors --static --libs libpq)",
           "$(shell PKG_CONFIG_PATH=$$(pwd)/lib/pkgconfig pkg-config --static --libs libnanomsg)",
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
           "lib/node_lmdb.cpp",
           "lib/node_cache.cpp",
           "lib/bksqlite.cpp",
           "lib/bklog.cpp",
           "lib/bklib.cpp",
           "lib/regexp.cpp",
           "lib/sqlite/sqlite3.cpp",
           "lib/lmdb/mdb.c",
           "lib/lmdb/midl.c",
           "lib/snappy/snappy.cc",
           "lib/snappy/snappy-sinksource.cc",
           "lib/snappy/snappy-stubs-internal.cc",
           "lib/leveldb/db/builder.cc",
           "lib/leveldb/db/db_impl.cc",
           "lib/leveldb/db/db_iter.cc",
           "lib/leveldb/db/filename.cc",
           "lib/leveldb/db/dbformat.cc",
           "lib/leveldb/db/log_reader.cc",
           "lib/leveldb/db/log_writer.cc",
           "lib/leveldb/db/memtable.cc",
           "lib/leveldb/db/repair.cc",
           "lib/leveldb/db/table_cache.cc",
           "lib/leveldb/db/version_edit.cc",
           "lib/leveldb/db/version_set.cc",
           "lib/leveldb/db/write_batch.cc",
           "lib/leveldb/helpers/memenv/memenv.cc",
           "lib/leveldb/table/block.cc",
           "lib/leveldb/table/block_builder.cc",
           "lib/leveldb/table/filter_block.cc",
           "lib/leveldb/table/format.cc",
           "lib/leveldb/table/iterator.cc",
           "lib/leveldb/table/merger.cc",
           "lib/leveldb/table/table.cc",
           "lib/leveldb/table/table_builder.cc",
           "lib/leveldb/table/two_level_iterator.cc",
           "lib/leveldb/util/arena.cc",
           "lib/leveldb/util/bloom.cc",
           "lib/leveldb/util/cache.cc",
           "lib/leveldb/util/coding.cc",
           "lib/leveldb/util/comparator.cc",
           "lib/leveldb/util/crc32c.cc",
           "lib/leveldb/util/env.cc",
           "lib/leveldb/util/env_posix.cc",
           "lib/leveldb/util/filter_policy.cc",
           "lib/leveldb/util/hash.cc",
           "lib/leveldb/util/logging.cc",
           "lib/leveldb/util/options.cc",
           "lib/leveldb/util/status.cc",
           "lib/leveldb/port/port_posix.cc",
        ],
        "conditions": [
           [ 'OS=="mac"', {
             "defines": [
                "OS_MACOSX",
             ],
             "xcode_settings": {
                "OTHER_CFLAGS": [
                   "-g -fPIC",
                   "$(shell mysql_config --cflags 2>/dev/null)",
                   "$(shell pkg-config --silence-errors --cflags libpq)",
                   "$(shell PKG_CONFIG_PATH=$$(pwd)/lib/pkgconfig pkg-config --cflags Wand)"
                ],
             }
           }],
           [ 'OS=="linux"', {
             "defines": [
                "OS_LINUX",
             ],
             "cflags_cc+": [
                "-g -fPIC -rdynamic",
                "$(shell mysql_config --cflags 2>/dev/null)",
                "$(shell pkg-config --silence-errors --cflags libpq)",
                "$(shell PKG_CONFIG_PATH=$$(pwd)/lib/pkgconfig pkg-config --cflags Wand)",
             ]
           }]
        ]
    }]
}
