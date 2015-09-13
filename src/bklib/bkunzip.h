/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  April 2007
 *
 */


#ifndef _BK_UNZIP_H_
#define _BK_UNZIP_H_

#ifndef Z_U4
#define z_crc_t unsigned long
#endif

class bkUnzip {
public:
    bkUnzip(string path): _name(path), _file(NULL) {}
    ~bkUnzip() { close(); }

    // Open zip archive, return true on success
    bool open();

    // Close zip archive
    void close();

    // Return number of file sin the archive
    int get_file_count();

    // Seek to the first file in the archive
    int first_file();

    // Seek to the next file in the archive
    int next_file();

    // Search for the file by name
    int search_file(string name);

    // Open current file in the archive
    int open_file(string password = string());

    // Close current file
    void close_file();

    // Read/uncompress data from the current opened file, this can be repeated until it returns 0
    int read_file(void *buf, uint len);

    // Return extra filed for current file
    string get_file_extra();

    // Return file name for the current file
    string get_file_name();

    // Return archive comment
    string get_comment();

    // Return file size for the current file
    long long get_file_size();

    // Return file mode attributes, for chmod
    int get_file_mode();

    // Safely unzip file from the archive, store in temp file and then rename
    static int unzip(string zipfile, string filename, string outfile);

    // Safely unzip all files, all files extracted relatively to dir
    static int unzip(string zipfile, string dir);

    // Retrn contents of a file in a string
    static string toString(string zipfile, string filename);

protected:

    class Info {
    public:
        uint32_t version;            // version made by
        uint32_t version_needed;     // version needed to extract
        uint32_t flag;               // general purpose bit flag
        uint32_t compression_method; // compression method
        uint32_t dosDate;            // last mod file date in Dos fmt
        uint32_t crc;                // crc-32
        uint32_t compressed_size;    // compressed size
        uint32_t uncompressed_size;  // uncompressed size
        uint32_t size_filename;      // filename length
        uint32_t size_file_extra;    // extra field length
        uint32_t size_file_comment;  // file comment length
        uint32_t disk_num_start;     // disk number start
        uint32_t internal_fa;        // internal file attributes
        uint32_t external_fa;        // external file attributes
        uint32_t offset;
        time_t timestamp;
        string file;
        string extra;
        string comment;
    };

    class File {
    public:
        z_stream stream;                        // zLib stream structure for inflate
        char *read_buffer;                      // internal buffer for compressed data
        uint32_t pos_in_zipfile;                   // position in byte on the zipfile, for fseek
        uint32_t stream_initialised;               // flag set if stream structure is initialised
        uint32_t offset_local_extrafield;          // offset of the static extra field
        unsigned int size_local_extrafield;     // size of the static extra field
        uint32_t pos_local_extrafield;             // position in the static extra field in read
        uint32_t crc32;                            // crc32 of all data uncompressed
        uint32_t crc32_wait;                       // crc32 we must obtain after decompress all
        uint32_t rest_read_compressed;             // number of byte to be decompressed
        uint32_t rest_read_uncompressed;           // number of byte to be obtained after decomp
        uint32_t compression_method;               // compression method (0==store)
        uint32_t byte_before_the_zipfile;          // byte before the zipfile, (>0 for sfx)
        bool raw;
    };

    class Unzip {
    public:
        Unzip(): fp(NULL) {}
        ~Unzip() { if (fp) fclose(fp); fp = NULL; }

        FILE *fp;
        bool encrypted;                           // requires password
        uint32_t byte_before_the_zipfile;          // byte before the zipfile, (>0 for sfx)
        uint32_t num_file;                         // number of the current file in the zipfile
        uint32_t pos_in_central_dir;               // pos of the current file in the central dir
        uint32_t current_file_ok;                  // flag about the usability of the current file
        uint32_t central_pos;                      // position of the beginning of the central dir
        uint32_t size_central_dir;                 // size of the central directory
        uint32_t offset_central_dir;               // offset of start of central directory with respect to the starting disk number
        uint32_t offset_curfile;                   // relative offset of static header 4 bytes
        uint32_t number_entry;                     // total number of entries in the central dir on this disk
        uint32_t size_comment;                     // size of the global comment of the zipfile
        unsigned long keys[3];                    // keys defining the pseudo-random sequence
        const z_crc_t *pcrc_32_tab;
    };

    int open_file(int *method, int *level, int raw, string password);
    int check_header(unsigned int *piSizeVar, uint32_t *poffset_local_extrafield, unsigned int *psize_local_extrafield);
    int get_current_file_info(Info *info);
    int extract(string filename, string outfile);

    string _name;
    Info _info;
    File *_file;
    Unzip _unzip;
};

#endif

