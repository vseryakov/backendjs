/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  April 2007
 *
 */

#include "bklib.h"
#include "bkunzip.h"

#define UNZ_BUFSIZE                 16384
#define UNZ_MAXFILENAMEINZIP        256
#define SIZECENTRALDIRITEM          0x2e
#define SIZEZIPLOCALHEADER          0x1e
#define BUFREADCOMMENT              0x400
#define RAND_HEAD_LEN               12
#define ZCR_SEED2                   3141592654UL

#define CRC32(c, b)                     ((*(pcrc_32_tab+(((int)(c) ^ (b)) & 0xff))) ^ ((c) >> 8))
#define zdecode(pkeys,pcrc_32_tab,c)    (_update_keys(pkeys, pcrc_32_tab, c ^= _decrypt_byte(pkeys, pcrc_32_tab)))
#define zencode(pkeys,pcrc_32_tab,c,t)  (t = _decrypt_byte(pkeys, pcrc_32_tab), _update_keys(pkeys, pcrc_32_tab, c), t ^ (c))

static int _decrypt_byte(unsigned long *pkeys, const z_crc_t *pcrc_32_tab)
{
    unsigned temp;
    temp = ((unsigned) (*(pkeys + 2)) & 0xffff) | 2;
    return (int) (((temp * (temp ^ 1)) >> 8) & 0xff);
}

static int _update_keys(unsigned long *pkeys, const z_crc_t *pcrc_32_tab, int c)
{
    register int keyshift;

    (*(pkeys + 0)) = CRC32((*(pkeys + 0)), c);
    (*(pkeys + 1)) += (*(pkeys + 0)) & 0xff;
    (*(pkeys + 1)) = (*(pkeys + 1)) * 134775813L + 1;
    keyshift = (int) ((*(pkeys + 1)) >> 24);
    (*(pkeys + 2)) = CRC32((*(pkeys + 2)), keyshift);

    return c;
}

static void _init_keys(const char *passwd, unsigned long *pkeys, const z_crc_t *pcrc_32_tab)
{
    *(pkeys + 0) = 305419896L;
    *(pkeys + 1) = 591751049L;
    *(pkeys + 2) = 878082192L;

    while (*passwd != '\0') {
        _update_keys(pkeys, pcrc_32_tab, (int) *passwd);
        passwd++;
    }
}

static int _get_byte(FILE *fp, int *pi)
{
    unsigned char c;

    if (fread(&c, 1, 1, fp) == 1) {
        *pi = (int) c;
        return 1;
    }
    return 0;
}

static int _get_short(FILE *fp, uint32_t * pX)
{
    uint32_t x;
    int i, rc;

    rc = _get_byte(fp, &i);
    x = i;

    if (rc) {
        rc = _get_byte(fp, &i);
    }
    x += ((uint32_t) i) << 8;
    *pX = rc ? x : 0;

    return rc;
}


static int _get_long(FILE *fp, uint32_t * pX)
{
    uint32_t x;
    int i, rc;

    rc = _get_byte(fp, &i);
    x = i;

    if (rc) {
        rc = _get_byte(fp, &i);
    }
    x += ((uint32_t) i) << 8;

    if (rc) {
        rc = _get_byte(fp, &i);
    }
    x += ((uint32_t) i) << 16;

    if (rc) {
        rc = _get_byte(fp, &i);
    }
    x += ((uint32_t) i) << 24;

    *pX = rc ? x : 0;

    return rc;
}

// Locate the Central directory of a zipfile (at the end, just before the global comment)
static uint32_t _get_central_dir(FILE *fp)
{
    unsigned char *buf;
    uint32_t uSizeFile;
    uint32_t uBackRead;
    uint32_t uMaxBack = 0xffff;    /* maximum size of global comment */
    uint32_t uPosFound = 0;

    if (fseek(fp, 0, SEEK_END) != 0) {
        return 0;
    }

    uSizeFile = ftell(fp);
    if (uMaxBack > uSizeFile) {
        uMaxBack = uSizeFile;
    }

    buf = (unsigned char *)malloc(BUFREADCOMMENT + 4);
    if (buf == NULL) {
        return 0;
    }
    uBackRead = 4;
    while (uBackRead < uMaxBack) {
        uint32_t i, uReadSize, uReadPos;

        if (uBackRead + BUFREADCOMMENT > uMaxBack) {
            uBackRead = uMaxBack;
        } else {
            uBackRead += BUFREADCOMMENT;
        }
        uReadPos = uSizeFile - uBackRead;
        uReadSize = ((BUFREADCOMMENT + 4) < (uSizeFile - uReadPos)) ? (BUFREADCOMMENT + 4) : (uSizeFile - uReadPos);
        if (fseek(fp, uReadPos, SEEK_SET) != 0) {
            break;
        }
        if (fread(buf, 1, uReadSize, fp) != uReadSize) {
            break;
        }

        for (i = (int) uReadSize - 3; (i--) > 0;) {
            if (((*(buf + i)) == 0x50) && ((*(buf + i + 1)) == 0x4b) && ((*(buf + i + 2)) == 0x05) && ((*(buf + i + 3)) == 0x06)) {
                uPosFound = uReadPos + i;
                break;
            }
        }
        if (uPosFound != 0) {
            break;
        }
    }
    free(buf);

    return uPosFound;
}

int bkUnzip::get_current_file_info(Info *pinfo)
{
    Info file_info;
    uint32_t offset;
    uint32_t uDate, uMagic, uSizeRead;
    struct tm ltm;
    long lSeek = 0;

    if (fseek(_unzip.fp, _unzip.pos_in_central_dir + _unzip.byte_before_the_zipfile, SEEK_SET) != 0) {
        return 0;
    }

    /* we check the magic */
    if (_get_long(_unzip.fp, &uMagic) == 0) {
        return 0;
    }
    if (uMagic != 0x02014b50) {
        return 0;
    }

    if (_get_short(_unzip.fp, &file_info.version) == 0) {
        return 0;
    }

    if (_get_short(_unzip.fp, &file_info.version_needed) == 0) {
        return 0;
    }

    if (_get_short(_unzip.fp, &file_info.flag) == 0) {
        return 0;
    }

    if (_get_short(_unzip.fp, &file_info.compression_method) == 0) {
        return 0;
    }

    if (_get_long(_unzip.fp, &file_info.dosDate) == 0) {
        return 0;
    }

    uDate = (uint32_t) (file_info.dosDate >> 16);
    ltm.tm_mday = (unsigned int) (uDate & 0x1f);
    ltm.tm_mon = (unsigned int) ((((uDate) & 0x1E0) / 0x20) - 1);
    ltm.tm_year = (unsigned int) (((uDate & 0x0FE00) / 0x0200) + 1980) - 1900;
    ltm.tm_hour = (unsigned int) ((file_info.dosDate & 0xF800) / 0x800);
    ltm.tm_min = (unsigned int) ((file_info.dosDate & 0x7E0) / 0x20);
    ltm.tm_sec = (unsigned int) (2 * (file_info.dosDate & 0x1f));
    ltm.tm_isdst = 0;
    file_info.timestamp = mktime(&ltm);

    if (_get_long(_unzip.fp, &file_info.crc) == 0) {
        return 0;
    }

    if (_get_long(_unzip.fp, &file_info.compressed_size) == 0) {
        return 0;
    }

    if (_get_long(_unzip.fp, &file_info.uncompressed_size) == 0) {
        return 0;
    }

    if (_get_short(_unzip.fp, &file_info.size_filename) == 0) {
        return 0;
    }

    if (_get_short(_unzip.fp, &file_info.size_file_extra) == 0) {
        return 0;
    }

    if (_get_short(_unzip.fp, &file_info.size_file_comment) == 0) {
        return 0;
    }

    if (_get_short(_unzip.fp, &file_info.disk_num_start) == 0) {
        return 0;
    }

    if (_get_short(_unzip.fp, &file_info.internal_fa) == 0) {
        return 0;
    }

    if (_get_long(_unzip.fp, &file_info.external_fa) == 0) {
        return 0;
    }

    if (_get_long(_unzip.fp, &offset) == 0) {
        return 0;
    }

    lSeek += file_info.size_filename;
    uSizeRead = file_info.size_filename;

    if (file_info.size_filename > 0) {
        char buf[file_info.size_filename + 1];
        if (fread(buf, 1, uSizeRead, _unzip.fp) != uSizeRead) {
            return 0;
        }
        buf[uSizeRead] = 0;
        file_info.file.append(buf);
    }
    lSeek -= uSizeRead;

    uSizeRead = file_info.size_file_extra;

    if (lSeek != 0) {
        if (fseek(_unzip.fp, lSeek, SEEK_CUR) == 0) {
            lSeek = 0;
        } else {
            return 0;
        }
    }
    if (file_info.size_file_extra > 0) {
        char buf[file_info.size_file_extra + 1];
        if (fread(buf, 1, uSizeRead, _unzip.fp) != uSizeRead) {
            return 0;
        }
        buf[uSizeRead] = 0;
        file_info.extra.append(buf);
    }
    lSeek += file_info.size_file_extra - uSizeRead;

    uSizeRead = file_info.size_file_comment;

    if (lSeek != 0) {
        if (fseek(_unzip.fp, lSeek, SEEK_CUR) == 0) {
            lSeek = 0;
        } else {
            return 0;
        }
    }
    if (file_info.size_file_comment > 0) {
        char buf[file_info.size_file_comment + 1];
        if (fread(buf, 1, uSizeRead, _unzip.fp) != uSizeRead) {
            return 0;
        }
        buf[uSizeRead] = 0;
        file_info.comment.append(buf);
    }
    lSeek += file_info.size_file_comment - uSizeRead;

    file_info.offset = offset;

    if (pinfo != NULL) {
        *pinfo = file_info;
    }
    return 1;
}

int bkUnzip::check_header(unsigned int *piSizeVar, uint32_t *poffset_local_extrafield, unsigned int *psize_local_extrafield)
{
    uint32_t uMagic, uData, uFlags;
    uint32_t size_filename;
    uint32_t size_extra_field;

    *piSizeVar = 0;
    *poffset_local_extrafield = 0;
    *psize_local_extrafield = 0;

    if (fseek(_unzip.fp, _unzip.offset_curfile + _unzip.byte_before_the_zipfile, SEEK_SET) != 0) {
        return 0;
    }

    if (_get_long(_unzip.fp, &uMagic) == 0) {
        return 0;
    }
    if (uMagic != 0x04034b50) {
        return 0;
    }

    if (_get_short(_unzip.fp, &uData) == 0) {
        return 0;
    }

    if (_get_short(_unzip.fp, &uFlags) == 0) {
        return 0;
    }

    if (_get_short(_unzip.fp, &uData) == 0) {
        return 0;
    }
    if (uData != _info.compression_method) {
        return 0;
    }

    if (_info.compression_method != 0 && _info.compression_method != Z_DEFLATED) {
        return 0;
    }

    if (_get_long(_unzip.fp, &uData) == 0) {
        return 0;
    }

    if (_get_long(_unzip.fp, &uData) == 0) {
        return 0;
    }
    if (uData != _info.crc && (uFlags & 8) == 0) {
        return 0;
    }

    if (_get_long(_unzip.fp, &uData) == 0) {
        return 0;
    }
    if (uData != _info.compressed_size && (uFlags & 8) == 0) {
        return 0;
    }

    if (_get_long(_unzip.fp, &uData) == 0) {
        return 0;
    }
    if (uData != _info.uncompressed_size && (uFlags & 8) == 0) {
        return 0;
    }

    if (_get_short(_unzip.fp, &size_filename) == 0) {
        return 0;
    }
    if (size_filename != _info.size_filename) {
        return 0;
    }

    *piSizeVar += (unsigned int) size_filename;
    if (_get_short(_unzip.fp, &size_extra_field) == 0) {
        return 0;
    }

    *poffset_local_extrafield = _unzip.offset_curfile + SIZEZIPLOCALHEADER + size_filename;
    *psize_local_extrafield = (unsigned int) size_extra_field;
    *piSizeVar += (unsigned int) size_extra_field;

    return 1;
}

int bkUnzip::open_file(int *method, int *level, int raw, string password)
{
    unsigned int iSizeVar;
    uint32_t offset_local_extrafield;      /* offset of the static extra field */
    unsigned int size_local_extrafield;         /* size of the static extra field */
    char source[12];

    if (!_unzip.current_file_ok) {
        return 0;
    }

    if (_file != NULL) {
        close_file();
    }

    if (check_header(&iSizeVar, &offset_local_extrafield, &size_local_extrafield) == 0) {
        return 0;
    }

    _file = new File();
    _file->read_buffer = (char *) malloc(UNZ_BUFSIZE);
    _file->offset_local_extrafield = offset_local_extrafield;
    _file->size_local_extrafield = size_local_extrafield;
    _file->pos_local_extrafield = 0;
    _file->raw = raw;

    if (_file->read_buffer == NULL) {
        delete _file;
        return 0;
    }

    _file->stream_initialised = 0;

    if (method != NULL) {
        *method = (int) _info.compression_method;
    }

    if (level != NULL) {
        *level = 6;
        switch (_info.flag & 0x06) {
        case 6:
            *level = 1;
            break;

        case 4:
            *level = 2;
            break;

        case 2:
            *level = 9;
            break;
        }
    }

    if (_info.compression_method != 0 && _info.compression_method != Z_DEFLATED) {
        delete _file;
        return 0;
    }

    _file->crc32_wait = _info.crc;
    _file->crc32 = 0;
    _file->compression_method = _info.compression_method;
    _file->byte_before_the_zipfile = _unzip.byte_before_the_zipfile;
    _file->stream.total_out = 0;

    if ((_info.compression_method == Z_DEFLATED) && (!raw)) {
        _file->stream.zalloc = (alloc_func) 0;
        _file->stream.zfree = (free_func) 0;
        _file->stream.opaque = NULL;
        _file->stream.next_in = NULL;
        _file->stream.avail_in = 0;

        if (inflateInit2(&_file->stream, -MAX_WBITS) == Z_OK) {
            _file->stream_initialised = 1;
        } else {
            free(_file);
            return 0;
        }
    }

    _file->rest_read_compressed = _info.compressed_size;
    _file->rest_read_uncompressed = _info.uncompressed_size;
    _file->pos_in_zipfile = _unzip.offset_curfile + SIZEZIPLOCALHEADER + iSizeVar;
    _file->stream.avail_in = (unsigned int) 0;

    if (!password.empty()) {
        _unzip.pcrc_32_tab = get_crc_table();
        _init_keys(password.c_str(), _unzip.keys, _unzip.pcrc_32_tab);

        if (fseek(_unzip.fp, _file->pos_in_zipfile + _file->byte_before_the_zipfile, SEEK_SET) != 0) {
            close_file();
            return 0;
        }
        if (fread(source, 1, 12, _unzip.fp) < 12) {
            close_file();
            return 0;
        }

        for (int i = 0; i < 12; i++) {
            zdecode(_unzip.keys, _unzip.pcrc_32_tab, source[i]);
        }
        _file->pos_in_zipfile += 12;
        _unzip.encrypted = 1;
    }

    return 1;
}

bool bkUnzip::open()
{
    uint32_t number_disk;          /* number of the current dist, used for spaning ZIP, unsupported, always 0 */
    uint32_t central_pos, uL;
    uint32_t number_disk_with_CD;  /* number the the disk with central dir, used for spaning ZIP, unsupported, always 0 */
    uint32_t number_entry_CD;      /* total number of entries in the central dir (same than number_entry on nospan) */

    _unzip.fp = fopen(_name.c_str(), "r+b");
    if (_unzip.fp == NULL) {
        LogError("error opening %s: %s", _name.c_str(), strerror(errno));
        return 0;
    }

    central_pos = _get_central_dir(_unzip.fp);
    if (central_pos == 0) {
        goto err;
    }

    if (fseek(_unzip.fp, central_pos, SEEK_SET) != 0) {
        goto err;
    }

    /* the signature, already checked */
    if (_get_long(_unzip.fp, &uL) == 0) {
        goto err;
    }

    /* number of this disk */
    if (_get_short(_unzip.fp, &number_disk) == 0) {
        goto err;
    }

    /* number of the disk with the start of the central directory */
    if (_get_short(_unzip.fp, &number_disk_with_CD) == 0) {
        goto err;
    }

    /* total number of entries in the central dir on this disk */
    if (_get_short(_unzip.fp, &_unzip.number_entry) == 0) {
        goto err;
    }

    /* total number of entries in the central dir */
    if (_get_short(_unzip.fp, &number_entry_CD) == 0) {
        goto err;
    }

    if ((number_entry_CD != _unzip.number_entry) || (number_disk_with_CD != 0) || (number_disk != 0)) {
        goto err;
    }

    /* size of the central directory */
    if (_get_long(_unzip.fp, &_unzip.size_central_dir) == 0) {
        goto err;
    }

    /* offset of start of central directory with respect to the starting disk number */
    if (_get_long(_unzip.fp, &_unzip.offset_central_dir) == 0)
        goto err;

    /* zipfile comment length */
    if (_get_short(_unzip.fp, &_unzip.size_comment) == 0)
        goto err;

    if (central_pos < _unzip.offset_central_dir + _unzip.size_central_dir) {
        goto err;
    }

    _unzip.byte_before_the_zipfile = central_pos - (_unzip.offset_central_dir + _unzip.size_central_dir);
    _unzip.central_pos = central_pos;
    _unzip.encrypted = 0;

    first_file();

    return 1;

err:
    fclose(_unzip.fp);
    _unzip.fp = NULL;
    return 0;
}

void bkUnzip::close()
{
    close_file();

    if (_unzip.fp) {
        fclose(_unzip.fp);
        _unzip.fp = NULL;
    }
}

void bkUnzip::close_file()
{
    if (_file == NULL) {
        return;
    }

    if (_file->read_buffer != NULL) {
        free(_file->read_buffer);
    }

    if (_file->stream_initialised) {
        inflateEnd(&_file->stream);
    }

    delete _file;
    _file = NULL;
}

int bkUnzip::get_file_count()
{
    return _unzip.number_entry;
}

int bkUnzip::first_file()
{
    int rc;

    _unzip.num_file = 0;
    _unzip.pos_in_central_dir = _unzip.offset_central_dir;
    rc = get_current_file_info(&_info);
    _unzip.offset_curfile = _info.offset;
    _unzip.current_file_ok = (rc == 1);

    return rc;
}

int bkUnzip::next_file()
{
    int rc;

    if (!_unzip.current_file_ok) {
        return 0;
    }

    if (_unzip.number_entry != 0xffff) {
        // 2^16 files overflow hack
        if (_unzip.num_file + 1 == _unzip.number_entry) {
            return 0;
        }
    }

    _unzip.num_file++;
    _unzip.pos_in_central_dir += SIZECENTRALDIRITEM + _info.size_filename + _info.size_file_extra + _info.size_file_comment;
    rc = get_current_file_info(&_info);
    _unzip.offset_curfile = _info.offset;
    _unzip.current_file_ok = rc;

    return rc;
}

int bkUnzip::search_file(string fileName)
{
    int rc;
    Info cur_file_infoSaved;
    uint32_t cur_file_offsetSaved;
    uint32_t num_fileSaved;
    uint32_t pos_in_central_dirSaved;

    if (fileName.empty()) {
        return 0;
    }

    if (!_unzip.current_file_ok) {
        return 0;
    }

    // Save the current state
    num_fileSaved = _unzip.num_file;
    pos_in_central_dirSaved = _unzip.pos_in_central_dir;
    cur_file_infoSaved = _info;
    cur_file_offsetSaved = _unzip.offset_curfile;

    rc = first_file();
    while (rc) {
        if (get_current_file_info(&_info)) {
            if (_info.file == fileName) {
                return 1;
            }
            rc = next_file();
        }
    }

    // We failed, so restore the state of the 'current file' to where we were.
    _unzip.num_file = num_fileSaved;
    _unzip.pos_in_central_dir = pos_in_central_dirSaved;
    _info = cur_file_infoSaved;
    _unzip.offset_curfile = cur_file_offsetSaved;
    return 0;
}

int bkUnzip::open_file(string password)
{
    return open_file(NULL, NULL, 0, password);
}

int bkUnzip::read_file(void *buf, uint len)
{
    int iRead = 0, rc = Z_OK;

    if (buf == NULL || len <= 0) {
        return 0;
    }

    if (_file == NULL || _file->read_buffer == NULL) {
        return 0;
    }

    _file->stream.next_out = (Bytef *) buf;
    _file->stream.avail_out = (unsigned int) len;

    if (len > _file->rest_read_uncompressed && !_file->raw) {
        _file->stream.avail_out = (unsigned int)_file->rest_read_uncompressed;
    }

    if (len > _file->rest_read_compressed + _file->stream.avail_in &&
        _file->raw) {
        _file->stream.avail_out = (unsigned int) _file->rest_read_compressed + _file->stream.avail_in;
    }

    while (_file->stream.avail_out > 0) {
        if (_file->stream.avail_in == 0 && _file->rest_read_compressed > 0) {
            unsigned int uReadThis = UNZ_BUFSIZE;

            if (_file->rest_read_compressed < uReadThis) {
                uReadThis = (unsigned int) _file->rest_read_compressed;
            }
            if (uReadThis == 0) {
                return 0;
            }
            if (fseek(_unzip.fp, _file->pos_in_zipfile + _file->byte_before_the_zipfile, SEEK_SET) != 0) {
                return 0;
            }
            if (fread(_file->read_buffer, 1, uReadThis, _unzip.fp) != uReadThis) {
                return 0;
            }

            if (_unzip.encrypted) {
                for (uint i = 0; i < uReadThis; i++) {
                    _file->read_buffer[i] = zdecode(_unzip.keys, _unzip.pcrc_32_tab, _file->read_buffer[i]);
                }
            }

            _file->pos_in_zipfile += uReadThis;
            _file->rest_read_compressed -= uReadThis;
            _file->stream.next_in = (Bytef *) _file->read_buffer;
            _file->stream.avail_in = (unsigned int) uReadThis;
        }

        if (_file->compression_method == 0 || _file->raw) {
            unsigned int uDoCopy;

            if (_file->stream.avail_in == 0 && _file->rest_read_compressed == 0) {
                return (iRead == 0) ? 0 : iRead;
            }

            if (_file->stream.avail_out < _file->stream.avail_in) {
                uDoCopy = _file->stream.avail_out;
            } else {
                uDoCopy = _file->stream.avail_in;
            }

            for (uint i = 0; i < uDoCopy; i++) {
                *(_file->stream.next_out + i) = *(_file->stream.next_in + i);
            }

            _file->crc32 = crc32(_file->crc32, _file->stream.next_out, uDoCopy);
            _file->rest_read_uncompressed -= uDoCopy;
            _file->stream.avail_in -= uDoCopy;
            _file->stream.avail_out -= uDoCopy;
            _file->stream.next_out += uDoCopy;
            _file->stream.next_in += uDoCopy;
            _file->stream.total_out += uDoCopy;
            iRead += uDoCopy;
        } else {
            uint32_t uTotalOutBefore, uTotalOutAfter;
            const Bytef *bufBefore;
            uint32_t uOutThis;
            int flush = Z_SYNC_FLUSH;

            uTotalOutBefore = _file->stream.total_out;
            bufBefore = _file->stream.next_out;

            rc = inflate(&_file->stream, flush);

            if (rc >= 0 && _file->stream.msg != NULL) {
                rc = Z_DATA_ERROR;
            }

            uTotalOutAfter = _file->stream.total_out;
            uOutThis = uTotalOutAfter - uTotalOutBefore;
            _file->crc32 = crc32(_file->crc32, bufBefore, (unsigned int) (uOutThis));
            _file->rest_read_uncompressed -= uOutThis;
            iRead += (unsigned int) (uTotalOutAfter - uTotalOutBefore);

            if (rc == Z_STREAM_END) {
                return (iRead == 0) ? 0 : iRead;
            }
            if (rc != Z_OK) {
                break;
            }
        }
    }

    if (rc == Z_OK) {
        return iRead;
    }
    return 0;
}

string bkUnzip::get_file_name()
{
    Info info;

    get_current_file_info(&info);
    return info.file;
}

long long bkUnzip::get_file_size()
{
    Info info;

    if (get_current_file_info(&info)) {
        return info.uncompressed_size;
    }
    return 0;
}

int bkUnzip::get_file_mode()
{
    Info info;

    if (get_current_file_info(&info)) {
        return (info.external_fa >> 16) & 0xffff;
    }
    return 0;
}

string bkUnzip::get_file_extra()
{
    uint32_t size_to_read;

    if (_file == NULL) {
        return string();
    }

    size_to_read = (_file->size_local_extrafield - _file->pos_local_extrafield);

    if (size_to_read == 0) {
        return string();
    }

    if (fseek(_unzip.fp, _file->offset_local_extrafield + _file->pos_local_extrafield, SEEK_SET) != 0) {
        return 0;
    }

    char buf[size_to_read + 1];
    if (fread(buf, 1, size_to_read, _unzip.fp) != size_to_read) {
        return 0;
    }
    buf[size_to_read] = 0;

    return string(buf);
}

string bkUnzip::get_comment()
{
    if (_unzip.size_comment <= 0) {
        return string();
    }


    if (fseek(_unzip.fp, _unzip.central_pos + 22, SEEK_SET) != 0) {
        return string();
    }

    char buf[_unzip.size_comment + 1];
    if (fread(buf, 1, _unzip.size_comment, _unzip.fp) != _unzip.size_comment) {
        return string();
    }
    buf[_unzip.size_comment] = 0;

    return string(buf);
}

int bkUnzip::extract(string filename, string outfile)
{
    char buffer[4096];
    string outname(!outfile.empty() ? outfile : filename);
    string tmp = outname + ".tmp";
    int fd = ::open(tmp.c_str(), O_CREAT|O_WRONLY, S_IRUSR|S_IWUSR);
    if (fd < 0) {
        LogError("Can not create file %s: %s", tmp.c_str(), strerror(errno));
        return 0;
    }

    while (1) {
        int bytes = read_file(buffer, sizeof(buffer));
        if (bytes == 0) {
            break;
        }

        if (bytes < 0) {
            LogError("Error reading %s %d from %s: %s", filename.c_str(), bytes, _name.c_str(), strerror(errno));
            ::unlink(tmp.c_str());
            return 0;
        }

        if (::write(fd, buffer, bytes) != bytes) {
            LogError("error in writing to %s %d bytes: %s", tmp.c_str(), bytes, strerror(errno));
            unlink(tmp.c_str());
            return 0;
        }
    }
    ::close(fd);
#ifdef _UNIX
    sync();
#endif
    int mode = get_file_mode();
    if (mode) {
        ::chmod(tmp.c_str(), mode);
    }

    if (::rename(tmp.c_str(), outname.c_str())) {
        LogError("error renaming %s: %s", tmp.c_str(), strerror(errno));
        ::unlink(tmp.c_str());
        return 0;
    }
    return 1;
}

int bkUnzip::unzip(string zipfile, string filename, string outfile)
{
    bkUnzip unzip(zipfile);

    if (!unzip.open()) {
        LogError("Can not open file '%s'", zipfile.c_str());
        return 0;
    }

    if (!unzip.search_file(filename)) {
        LogError("Can not find %s inside the zipfile %s", filename.c_str(), zipfile.c_str());
        return 0;
    }

    if (!unzip.open_file()) {
        LogError("Can not open %s inside the zipfile %s", filename.c_str(), zipfile.c_str());
        return 0;
    }
    return unzip.extract(filename, outfile);
}

int bkUnzip::unzip(string zipfile, string dir)
{
    bkUnzip unzip(zipfile);

    if (!unzip.open()) {
        LogError("Can not open file '%s'", zipfile.c_str());
        return 0;
    }

    while (1) {
        if (!unzip.open_file()) {
            LogError("%s: cannot open file", zipfile.c_str());
            return 0;
        }

        // All paths are absolute from the root but zip does not store leading slash
        string outname = dir;
        if (outname.size() > 0 && *(outname.end() - 1) != '/') outname += "/";
        outname += unzip.get_file_name();
        uint mode = unzip.get_file_mode();
        long long size = unzip.get_file_size();

        if (outname != dir) {
            string outdir = outname.substr(0, outname.find_last_of('/'));
            LogDebug("file=%s, dir=%s, mode=%o, size=%lld", outname.c_str(), outdir.c_str(), mode, size);

            // Deal with broken zip files made by some tools like scala/sbt without storing proper file mode/type
            if (S_ISDIR(mode) || *(outname.end() - 1) == '/') {
                if (!bkMakePath(outdir)) {
                    LogError("%s: mkdir error %s: %s", zipfile.c_str(), outname.c_str(), strerror(errno));
                }
            } else
#ifdef __UNIX__
            if (S_ISLNK(mode)) {
                string link;
                char buffer[4096];
                while (1) {
                    int bytes = unzip.read_file(buffer, sizeof(buffer));
                    if (bytes == 0) {
                        break;
                    }
                    if (bytes < 0) {
                        LogError("%s: read error from %s: %s", zipfile.c_str(), outname.c_str(), strerror(errno));
                        link.clear();
                        break;
                    }
                    link.append(buffer, bytes);
                }
                if (link.size()) {
                    if (!bkMakePath(outdir)) {
                        LogError("%s: mkdir error %s: %s", zipfile.c_str(), outname.c_str(), strerror(errno));
                    }
                    unlink(outname.c_str());
                    if (symlink(link.c_str(), outname.c_str())) {
                        LogError("%s: link error %s->%s: %s", zipfile.c_str(), outname.c_str(), link.c_str(), strerror(errno));
                    }
                }

            } else
#endif
            if (!mode || S_ISREG(mode)) {
                if (!bkMakePath(outdir)) {
                    LogError("%s: mkdir error %s: %s", zipfile.c_str(), outname.c_str(), strerror(errno));
                }
                unzip.extract(outname, outname);
            }
        }
        unzip.close_file();

        if (!unzip.next_file()) {
            break;
        }
    }
    return 1;
}

string bkUnzip::toString(string zipfile, string filename)
{
    char buffer[4096];

    bkUnzip unzip(zipfile);

    if (!unzip.open()) {
        LogError("Can not open file '%s'", zipfile.c_str());
        return string();
    }

    if (!unzip.search_file(filename)) {
        LogError("Can not find %s inside the zipfile %s", filename.c_str(), zipfile.c_str());
        return string();
    }

    if (!unzip.open_file()) {
        LogError("Can not open %s inside the zipfile %s", filename.c_str(), zipfile.c_str());
        return string();
    }
    string out;

    while (1) {
        int bytes = unzip.read_file(buffer, sizeof(buffer));
        if (bytes == 0) {
            break;
        }

        if (bytes < 0) {
            LogError("Error reading %s %d from %s: %s", filename.c_str(), bytes, zipfile.c_str(), strerror(errno));
            return string();
        }

        out.append(string(buffer, bytes));
    }
    return out;
}

