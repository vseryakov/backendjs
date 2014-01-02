#
# Vlad Seryakov vseryakov@gmail.com
#

# SDK defaults
PLATFORM		?= $(shell uname -s)
SYS			= /usr
SDK			= $(SYS)
DIR			:= $(shell pwd)

# Path to utilities and tools
CC			= $(SDK)/bin/$(CROSS)gcc
CXX			= $(SDK)/bin/$(CROSS)g++
RANLIB			= $(SDK)/bin/$(CROSS)ranlib
AR			= $(SDK)/bin/$(CROSS)ar
CP			= install -C
RM			= rm
MKDIR			= mkdir

ifeq ($(PLATFORM),Linux)
SDK_FLAGS		:= -rdynamic -DHAVE_POSIX_FALLOCATE=1 -DHAVE_INTTYPES_H=1 -DHAVE_STDINT_H=1 -DHAVE_USLEEP=1 -DHAVE_LOCALTIME_R=1 -DHAVE_GMTIME_R=1 -DHAVE_STRERROR_R=1 -DHAVE_READLINE=1 
SYS_LIBS		:= -ldl -lpthread
endif

ifeq ($(PLATFORM),Darwin)
SDK			:= /usr
SYS			:= /opt/local
SDK_FLAGS		:= -D_DARWIN_C_SOURCE -DHAVE_POSIX_FALLOCATE=0 -DHAVE_INTTYPES_H=1 -DHAVE_STDINT_H=1 -DHAVE_USLEEP=1 -DHAVE_LOCALTIME_R=1 -DHAVE_GMTIME_R=1 -DHAVE_STRERROR_R=1 -DHAVE_READLINE=1 
SDK_LIBS		:= -headerpad_max_install_names
endif

# SDK flags
SDK_FLAGS		+= -g -Wall -Wfatal-errors -fPIC -fno-omit-frame-pointer -pipe -D_FILE_OFFSET_BITS=64 -D_ISOC99_SOURCE -D_XOPEN_SOURCE=600 -D__STDC_CONSTANT_MACROS -DAPPNAME=$(APPNAME) -DAPPVER=$(APPVER)
SDK_INCLUDES		+= -I. -I../lib -I../../lib -I$(SDK)/include -I$(SYS)/include
SDK_LIBS		+= -L$(SYS)/lib -L$(SDK)/lib -lpcre -lz

# Sqlite flags for embedding
SQLITE_FLAGS		+= -DSQLITE_USE_URI -DSQLITE_ENABLE_STAT3=1 -DSQLITE_ENABLE_FTS4=1 -DSQLITE_ENABLE_FTS3_PARENTHESIS=1 -DSQLITE_ENABLE_COLUMN_METADATA=1 -DSQLITE_ENABLE_UNLOCK_NOTIFY -DSQLITE_ENABLE_LOAD_EXTENSION -DSQLITE_SOUNDEX -DSQLITE_ALLOW_COVERING_INDEX_SCAN=1

# Common flags for compilation
CXXFLAGS		= $(SDK_FLAGS) $(SDK_INCLUDES) $(SQLITE_FLAGS)

# Core sources
SOURCES			+= vlog.cpp vsqlite.cpp vlib.cpp sqlite3.c
HEADERS			+= vlog.h vsystem.h vsqlite.h vlib.h sqlite3.h

# Resolve all objects
OBJECTS			= $(addsuffix .o, $(basename $(SOURCES)))

# Objects depend on pre-compiled headers as well
$(OBJECTS): $(HEADERS)

%.o: %.cpp
	$(CXX) -c $(CXXFLAGS) -o $@ $<

%.o: %.mm
	$(CXX) -c $(CXXFLAGS) -o $@ $<

%.o: %.c
	$(CC) -c $(CXXFLAGS) -o $@ $<

moc-%.cpp: %.h
	$(MOC) $(SDK_INCLUDES) $(QT_INCLUDES) $(PLATFORM_FLAGS) -o $@ $<

clean: $(CLEAN)
	$(RM) -rf *~ *.o *.a *.so *.gch moc-* *.sqlext *.node sqlite3

sqlite3: sqlite3_shell.o $(OBJECTS) 
	$(CXX) -o $@ $(CXXFLAGS) $(OBJECTS) $< -lreadline $(SDK_LIBS) $(SYS_LIBS)

indent:
	indent -kr -l125 -nbfda -nprs -npsl -nut -br -brs -ce -cdw -nbbo *.h *.c *.cpp

.PHONY: INSTALL CLEAN install uninstall bundle

