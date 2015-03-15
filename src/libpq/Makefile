all: compile

compile:
	gcc -c -DFRONTEND -pthread -D_REENTRANT -D_THREAD_SAFE -D_POSIX_PTHREAD_SEMANTICS -DUNSAFE_STAT_OK -g *.c

fixup:
	sed -i '' -E 's/"(common|lib|libpq|mb|utils)\//"/' *.c *.h

clean:
	rm -rf *.o *.so *.a test

test: compile
	gcc -o test *.o -lssl -lcrypto

	
