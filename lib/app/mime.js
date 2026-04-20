/*
 *  Author: Vlad Seryakov vseryakov@gmail.com
 *  backendjs 2018
 */

const app = require(__dirname + '/../app');

/**
 * Return MIME type for given file name
 * @param {string} file - file name
 * @memberof module:app
 * @method getMimeType
 */
app.getMimeType = function(file)
{
    if (typeof file != "string") return;
    const dot = file.lastIndexOf(".");
    if (dot > 0) {
        return app.mimeTypes[file.slice(dot + 1).toLowerCase()];
    }
}

/**
 * Return file extension for givem MIME type
 * @param {string} type - MIME type
 * @memberof module:app
 * @method getExtension
 */
app.getExtension = function(type)
{
    if (typeof type != "string") return;
    const semi = type.indexOf(";");
    if (semi > -1) {
        type = type.substr(0, semi).trim();
    }
    if (!type) return;
    for (const ext in app.mimeTypes) {
        if (app.mimeTypes[ext] === type) return ext;
    }
}

/**
 * List of basic mime types
 * @memberof module:app
 * @var {object} mimeTypes
 */
app.mimeTypes = {
    aac: 'audio/aac',
    avi: 'video/x-msvideo',
    avif: 'image/avif',
    av1: 'video/av1',
    atom: 'application/atom+xml',
    bin: 'application/octet-stream',
    bmp: 'image/bmp',
    css: 'text/css',
    csv: 'text/csv',
    crt: 'application/x-x509-ca-cert',
    der: 'application/x-x509-ca-cert',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    eot: 'application/vnd.ms-fontobject',
    epub: 'application/epub+zip',
    exe: 'application/x-msdos-program',
    gif: 'image/gif',
    gz: 'application/gzip',
    htm: 'text/html',
    html: 'text/html',
    heic: 'image/heic',
    heics: 'image/heic-sequence',
    heif: 'image/heif',
    heifs: 'image/heif-sequence',
    hej2: 'image/hej2k',
    ico: 'image/x-icon',
    ics: 'text/calendar',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    jpe: 'image/jpeg',
    js: 'text/javascript',
    json: 'application/json',
    jsonld: 'application/ld+json',
    jar: 'application/java-archive',
    md: 'text/markdown',
    markdown: 'text/markdown',
    map: 'application/json',
    manifest: 'text/cache-manifest',
    mhtml: 'message/rfc822',
    mid: 'audio/x-midi',
    midi: 'audio/x-midi',
    mjs: 'text/javascript',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    mpeg: 'video/mpeg',
    mpg: 'video/mpeg',
    m4v: 'video/x-m4v',
    mkv: 'video/x-matroska',
    mk3d: 'video/x-matroska',
    mks: 'video/x-matroska',
    mng: 'video/x-mng',
    mov: 'video/quicktime',
    ogv: 'video/ogg',
    oga: 'audio/ogg',
    ogx: 'application/ogg',
    opus: 'audio/opus',
    otf: 'font/otf',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
    odt: 'application/vnd.oasis.opendocument.text',
    qt: 'video/quicktime',
    pem: 'application/x-x509-ca-cert',
    pdf: 'application/pdf',
    png: 'image/png',
    pnm: 'image/x-portable-anymap',
    pbm: 'image/x-portable-bitmap',
    pgm: 'image/x-portable-graymap',
    ppm: 'image/x-portable-pixmap',
    psd: 'image/vnd.adobe.photoshop',
    p12: 'application/x-pkcs12',
    pfx: 'application/x-pkcs12',
    p7b: 'application/x-pkcs7-certificates',
    rtf: 'application/rtf',
    rtx: 'text/richtext',
    rss: 'application/rss+xml',
    svg: 'image/svg+xml',
    sub: 'text/vnd.dvb.subtitle',
    srt: 'application/x-subrip',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    ts: 'video/mp2t',
    ttf: 'font/ttf',
    txt: 'text/plain',
    war: 'application/java-archive',
    wav: 'audio/wav',
    wasm: 'application/wasm',
    webm: 'video/webm',
    weba: 'audio/webm',
    webmanifest: 'application/manifest+json',
    webp: 'image/webp',
    woff: 'font/woff',
    woff2: 'font/woff2',
    wsdl: 'application/wsdl+xml',
    vcf: 'text/x-vcard',
    vob: 'video/x-ms-vob',
    xhtml: 'application/xhtml+xml',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xml: 'application/xml',
    xbm: 'image/x-xbitmap',
    xpm: 'image/x-xpixmap',
    zip: 'application/zip',
    yaml: 'text/yaml',
    yml: 'text/yaml',
    '3gp': 'video/3gpp',
    '3g2': 'video/3gpp2',
}
