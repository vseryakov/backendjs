//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  backendjs 2018
//

const fs = require('fs');
const util = require('util');
const path = require('path');
const bkutils = require('bkjs-utils');
const logger = require(__dirname + '/logger');
const child = require("child_process");
const os = require("os");

// Common utilities and useful functions
const lib = {
    name: 'lib',
    deferTimeout: 50,
    deferId: 1,
    maxStackDepth: 250,
    geoHashRanges: [ [12, 0], [8, 0.019], [7, 0.076], [6, 0.61], [5, 2.4], [4, 20.0], [3, 78.0], [2, 630.0], [1, 2500.0], [1, 99999] ],
    rxNumber: /^(-|\+)?([0-9]+|[0-9]+\.[0-9]+)$/,
    rxFloat: /^(-|\+)?([0-9]+)?\.[0-9]+$/,
    rxUuid: /^([0-9a-z]{1,5}_)?[0-9a-z]{32}(_[0-9a-z]+)?$/,
    rxUrl: /^https?:\/\/.+/,
    rxAscii: /[\x20-\x7F]/,
    rxEmail: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,16}$/i,
    rxEmail1: /[^@<> ]+@[^@<> ]+/,
    rxEmail2: /<?([^@<> ]+@[^@<> ]+)>?/,
    rxPhone: /^([0-9 .+()-]+)/,
    rxPhone2: /[^0-9]/g,
    rxEmpty: /^\s*$/,
    rxGeo: /^[0-9.]+,[0-9.]+$/,
    rxLine: /[\r\n]\n?/,
    rxIpaddress: /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}(\/[0-9]{1,2})?$/,
    rxNumericType: /^(int|smallint|bigint|now|clock|mtime|random|counter|real|float|double|numeric|number|decimal|long)/i,
    rxObjectType: /^(obj|object|list|set|array)$/i,
    rxTextType: /^(str|string|text)$/i,
    rxCamel: /(?:[-_.])(\w)/g,
    rxSplit: /[,|]/,
    locales: {},
    locale: "",
    hashids: {},
    base64: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
    uriSafe: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._~-",
    base36: "0123456789abcdefghijklmnopqrstuvwxyz",
    base62: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
    base62Dict: "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
    base64Dict: {},
    whitespace: " \r\n\t\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000\u008D\u009F\u0080\u0090\u009B\u0010\u0009\u0000\u0003\u0004\u0017\u0019\u0011\u0012\u0013\u0014\u2028\u2029\u2060\u202C",
    unicodeAsciiMap: {
        "\u00AB": "\"", "\u00BB": "\"", "\u201C": "\"", "\u201D": "\"", "\u02BA": "\"", "\u02EE": "\"", "\u201F": "\"", "\u275D": "\"", "\u275E": "\"", "\u301D": "\"", "\u301E": "\"",
        "\uFF02": "\"", "\u2018": "'", "\u2019": "'", "\u02BB": "'", "\u02C8": "'", "\u02BC": "'", "\u02BD": "'", "\u02B9": "'", "\u201B": "'", "\uFF07": "'", "\u00B4": "'", "\u02CA": "'",
        "\u0060": "'", "\u02CB": "'", "\u275B": "'", "\u275C": "'", "\u0313": "'", "\u0314": "'", "\uFE10": "'", "\uFE11": "'", "\u00F7": "/", "\u00BC": "1/4", "\u00BD": "1/2", "\u00BE": "3/4",
        "\u29F8": "/", "\u0337": "/", "\u0338": "/", "\u2044": "/", "\u2215": "/", "\uFF0F": "/", "\u29F9": "\\", "\u29F5": "\\", "\u20E5": "\\", "\uFE68": "\\", "\uFF3C": "\\", "\u0332": "_",
        "\uFF3F": "_", "\u20D2": "|", "\u20D3": "|", "\u2223": "|", "\uFF5C": "|", "\u23B8": "|", "\u23B9": "|", "\u23D0": "|", "\u239C": "|", "\u239F": "|", "\u23BC": "-", "\u23BD": "-",
        "\u2015": "-", "\uFE63": "-", "\uFF0D": "-", "\u2010": "-", "\u2043": "-", "\uFE6B": "@", "\uFF20": "@", "\uFE69": "$", "\uFF04": "$", "\u01C3": "!", "\uFE15": "!", "\uFE57": "!",
        "\uFF01": "!", "\uFE5F": "#", "\uFF03": "#", "\uFE6A": "%", "\uFF05": "%", "\uFE60": "&", "\uFF06": "&", "\u201A": ", ", "\u0326": ", ", "\uFE50": ", ", "\uFE51": ", ", "\uFF0C": ", ",
        "\uFF64": ", ", "\u2768": "(", "\u276A": "(", "\uFE59": "(", "\uFF08": "(", "\u27EE": "(", "\u2985": "(", "\u2769": ")", "\u276B": ")", "\uFE5A": ")", "\uFF09": ")", "\u27EF": ")",
        "\u2986": ")", "\u204E": "*", "\u2217": "*", "\u229B": "*", "\u2722": "*", "\u2723": "*", "\u2724": "*", "\u2725": "*", "\u2731": "*", "\u2732": "*", "\u2733": "*", "\u273A": "*",
        "\u273B": "*", "\u273C": "*", "\u273D": "*", "\u2743": "*", "\u2749": "*", "\u274A": "*", "\u274B": "*", "\u29C6": "*", "\uFE61": "*", "\uFF0A": "*", "\u02D6": "+", "\uFE62": "+",
        "\uFF0B": "+", "\u3002": ".", "\uFE52": ".", "\uFF0E": ".", "\uFF61": ".", "\uFF10": "0", "\uFF11": "1", "\uFF12": "2", "\uFF13": "3", "\uFF14": "4", "\uFF15": "5", "\uFF16": "6",
        "\uFF17": "7", "\uFF18": "8", "\uFF19": "9", "\u02D0": ":", "\u02F8": ":", "\u2982": ":", "\uA789": ":", "\uFE13": ":", "\uFF1A": ":", "\u204F": ";", "\uFE14": ";", "\uFE54": ";",
        "\uFF1B": ";", "\uFE64": "<", "\uFF1C": "<", "\u0347": "=", "\uA78A": "=", "\uFE66": "=", "\uFF1D": "=", "\uFE65": ">", "\uFF1E": ">", "\uFE16": "?", "\uFE56": "?", "\uFF1F": "?",
        "\uFF21": "A", "\u1D00": "A", "\uFF22": "B", "\u0299": "B", "\uFF23": "C", "\u1D04": "C", "\uFF24": "D", "\u1D05": "D", "\uFF25": "E", "\u1D07": "E", "\uFF26": "F", "\uA730": "F",
        "\uFF27": "G", "\u0262": "G", "\uFF28": "H", "\u029C": "H", "\uFF29": "I", "\u026A": "I", "\uFF2A": "J", "\u1D0A": "J", "\uFF2B": "K", "\u1D0B": "K", "\uFF2C": "L", "\u029F": "L",
        "\uFF2D": "M", "\u1D0D": "M", "\uFF2E": "N", "\u0274": "N", "\uFF2F": "O", "\u1D0F": "O", "\uFF30": "P", "\u1D18": "P", "\uFF31": "Q", "\uFF32": "R", "\u0280": "R", "\uFF33": "S",
        "\uA731": "S", "\uFF34": "T", "\u1D1B": "T", "\uFF35": "U", "\u1D1C": "U", "\uFF36": "V", "\u1D20": "V", "\uFF37": "W", "\u1D21": "W", "\uFF38": "X", "\uFF39": "Y", "\u028F": "Y",
        "\uFF3A": "Z", "\u1D22": "Z", "\u02C6": "^", "\u0302": "^", "\uFF3E": "^", "\u1DCD": "^", "\u2774": "{", "\uFE5B": "{", "\uFF5B": "{", "\u2775": "}", "\uFE5C": "}", "\uFF5D": "}",
        "\uFF3B": "[", "\uFF3D": "]", "\u02DC": "~", "\u02F7": "~", "\u0303": "~", "\u0330": "~", "\u0334": "~", "\u223C": "~", "\uFF5E": "~", "\u00A0": "'", "\u2000": "'", "\u2001": " ",
        "\u2002": " ", "\u2003": " ", "\u2004": " ", "\u2005": " ", "\u2006": " ", "\u2007": " ", "\u2008": " ", "\u2009": " ", "\u200A": " ", "\u202F": " ", "\u205F": " ", "\u3000": " ", "\u008D": " ",
        "\u009F": " ", "\u0080": " ", "\u0090": " ", "\u009B": " ", "\u0010": " ", "\u0009": " ", "\u0000": " ", "\u0003": " ", "\u0004": " ", "\u0017": " ", "\u0019": " ", "\u0011": " ", "\u0012": " ",
        "\u0013": " ", "\u0014": " ", "\u2017": "_", "\u2014": "-", "\u2013": "-", "\u2039": ">", "\u203A": "<", "\u203C": "!!", "\u201E": "\"",
        "\u2026": "...", "\u2028": " ", "\u2029": " ", "\u2060": " ", "\u202C": " ",
    },
    htmlEntities: {
        'AElig': 'Æ','AMP': '','Aacute': 'Á','Abreve': 'Ă','Acirc': 'Â',
        'Acy': 'А','Afr': '𝔄','Agrave': 'À','Alpha': 'Α','Amacr': 'Ā',
        'And': '⩓','Aogon': 'Ą','Aopf': '𝔸','ApplyFunction': '','Aring': 'Å',
        'Ascr': '𝒜','Assign': '≔','Atilde': 'Ã','Auml': 'Ä','Backslash': '∖',
        'Barv': '⫧','Barwed': '⌆','Bcy': 'Б','Because': '∵','Bernoullis': 'ℬ',
        'Beta': 'Β','Bfr': '𝔅','Bopf': '𝔹','Breve': '˘','Bscr': 'ℬ',
        'Bumpeq': '≎','CHcy': 'Ч','COPY': '©','Cacute': 'Ć','Cap': '⋒',
        'CapitalDifferentialD': 'ⅅ','Cayleys': 'ℭ','Ccaron': 'Č','Ccedil': 'Ç','Ccirc': 'Ĉ',
        'Cconint': '∰','Cdot': 'Ċ','Cedilla': '¸','CenterDot': '·','Cfr': 'ℭ',
        'Chi': 'Χ','CircleDot': '⊙','CircleMinus': '⊖','CirclePlus': '⊕','CircleTimes': '⊗',
        'ClockwiseContourIntegral': '∲','CloseCurlyDoubleQuote': '”','CloseCurlyQuote': '’','Colon': '∷','Colone': '⩴',
        'Congruent': '≡','Conint': '∯','ContourIntegral': '∮','Copf': 'ℂ','Coproduct': '∐',
        'CounterClockwiseContourIntegral': '∳','Cross': '⨯','Cscr': '𝒞','Cup': '⋓','CupCap': '≍',
        'DD': 'ⅅ','DDotrahd': '⤑','DJcy': 'Ђ','DScy': 'Ѕ','DZcy': 'Џ',
        'Dagger': '‡','Darr': '↡','Dashv': '⫤','Dcaron': 'Ď','Dcy': 'Д',
        'Del': '∇','Delta': 'Δ','Dfr': '𝔇','DiacriticalAcute': '´','DiacriticalDot': '˙',
        'DiacriticalDoubleAcute': '˝','DiacriticalGrave': '`','DiacriticalTilde': '˜','Diamond': '⋄','DifferentialD': 'ⅆ',
        'Dopf': '𝔻','Dot': '¨','DotDot': '⃜','DotEqual': '≐','DoubleContourIntegral': '∯',
        'DoubleDot': '¨','DoubleDownArrow': '⇓','DoubleLeftArrow': '⇐','DoubleLeftRightArrow': '⇔','DoubleLeftTee': '⫤',
        'DoubleLongLeftArrow': '⟸','DoubleLongLeftRightArrow': '⟺','DoubleLongRightArrow': '⟹','DoubleRightArrow': '⇒','DoubleRightTee': '⊨',
        'DoubleUpArrow': '⇑','DoubleUpDownArrow': '⇕','DoubleVerticalBar': '∥','DownArrow': '↓','DownArrowBar': '⤓',
        'DownArrowUpArrow': '⇵','DownBreve': '̑','DownLeftRightVector': '⥐','DownLeftTeeVector': '⥞','DownLeftVector': '↽',
        'DownLeftVectorBar': '⥖','DownRightTeeVector': '⥟','DownRightVector': '⇁','DownRightVectorBar': '⥗','DownTee': '⊤',
        'DownTeeArrow': '↧','Downarrow': '⇓','Dscr': '𝒟','Dstrok': 'Đ','ENG': 'Ŋ',
        'ETH': 'Ð','Eacute': 'É','Ecaron': 'Ě','Ecirc': 'Ê','Ecy': 'Э',
        'Edot': 'Ė','Efr': '𝔈','Egrave': 'È','Element': '∈','Emacr': 'Ē',
        'EmptySmallSquare': '◻','EmptyVerySmallSquare': '▫','Eogon': 'Ę','Eopf': '𝔼','Epsilon': 'Ε',
        'Equal': '⩵','EqualTilde': '≂','Equilibrium': '⇌','Escr': 'ℰ','Esim': '⩳',
        'Eta': 'Η','Euml': 'Ë','Exists': '∃','ExponentialE': 'ⅇ','Fcy': 'Ф',
        'Ffr': '𝔉','FilledSmallSquare': '◼','FilledVerySmallSquare': '▪','Fopf': '𝔽','ForAll': '∀',
        'Fouriertrf': 'ℱ','Fscr': 'ℱ','GJcy': 'Ѓ','GT': '>','Gamma': 'Γ',
        'Gammad': 'Ϝ','Gbreve': 'Ğ','Gcedil': 'Ģ','Gcirc': 'Ĝ','Gcy': 'Г',
        'Gdot': 'Ġ','Gfr': '𝔊','Gg': '⋙','Gopf': '𝔾','GreaterEqual': '≥',
        'GreaterEqualLess': '⋛','GreaterFullEqual': '≧','GreaterGreater': '⪢','GreaterLess': '≷','GreaterSlantEqual': '⩾',
        'GreaterTilde': '≳','Gscr': '𝒢','Gt': '≫','HARDcy': 'Ъ','Hacek': 'ˇ',
        'Hat': '^','Hcirc': 'Ĥ','Hfr': 'ℌ','HilbertSpace': 'ℋ','Hopf': 'ℍ',
        'HorizontalLine': '─','Hscr': 'ℋ','Hstrok': 'Ħ','HumpDownHump': '≎','HumpEqual': '≏',
        'IEcy': 'Е','IJlig': 'Ĳ','IOcy': 'Ё','Iacute': 'Í','Icirc': 'Î',
        'Icy': 'И','Idot': 'İ','Ifr': 'ℑ','Igrave': 'Ì','Im': 'ℑ',
        'Imacr': 'Ī','ImaginaryI': 'ⅈ','Implies': '⇒','Int': '∬','Integral': '∫',
        'Intersection': '⋂','InvisibleComma': '','InvisibleTimes': '','Iogon': 'Į','Iopf': '𝕀',
        'Iota': 'Ι','Iscr': 'ℐ','Itilde': 'Ĩ','Iukcy': 'І','Iuml': 'Ï',
        'Jcirc': 'Ĵ','Jcy': 'Й','Jfr': '𝔍','Jopf': '𝕁','Jscr': '𝒥',
        'Jsercy': 'Ј','Jukcy': 'Є','KHcy': 'Х','KJcy': 'Ќ','Kappa': 'Κ',
        'Kcedil': 'Ķ','Kcy': 'К','Kfr': '𝔎','Kopf': '𝕂','Kscr': '𝒦',
        'LJcy': 'Љ','LT': '<','Lacute': 'Ĺ','Lambda': 'Λ','Lang': '⟪',
        'Laplacetrf': 'ℒ','Larr': '↞','Lcaron': 'Ľ','Lcedil': 'Ļ','Lcy': 'Л',
        'LeftAngleBracket': '⟨','LeftArrow': '←','LeftArrowBar': '⇤','LeftArrowRightArrow': '⇆','LeftCeiling': '⌈',
        'LeftDoubleBracket': '⟦','LeftDownTeeVector': '⥡','LeftDownVector': '⇃','LeftDownVectorBar': '⥙','LeftFloor': '⌊',
        'LeftRightArrow': '↔','LeftRightVector': '⥎','LeftTee': '⊣','LeftTeeArrow': '↤','LeftTeeVector': '⥚',
        'LeftTriangle': '⊲','LeftTriangleBar': '⧏','LeftTriangleEqual': '⊴','LeftUpDownVector': '⥑','LeftUpTeeVector': '⥠',
        'LeftUpVector': '↿','LeftUpVectorBar': '⥘','LeftVector': '↼','LeftVectorBar': '⥒','Leftarrow': '⇐',
        'Leftrightarrow': '⇔','LessEqualGreater': '⋚','LessFullEqual': '≦','LessGreater': '≶','LessLess': '⪡',
        'LessSlantEqual': '⩽','LessTilde': '≲','Lfr': '𝔏','Ll': '⋘','Lleftarrow': '⇚',
        'Lmidot': 'Ŀ','LongLeftArrow': '⟵','LongLeftRightArrow': '⟷','LongRightArrow': '⟶','Longleftarrow': '⟸',
        'Longleftrightarrow': '⟺','Longrightarrow': '⟹','Lopf': '𝕃','LowerLeftArrow': '↙','LowerRightArrow': '↘',
        'Lscr': 'ℒ','Lsh': '↰','Lstrok': 'Ł','Lt': '≪','Map': '⤅',
        'Mcy': 'М','MediumSpace': ' ','Mellintrf': 'ℳ','Mfr': '𝔐','MinusPlus': '∓',
        'Mopf': '𝕄','Mscr': 'ℳ','Mu': 'Μ','NJcy': 'Њ','Nacute': 'Ń',
        'Ncaron': 'Ň','Ncedil': 'Ņ','Ncy': 'Н','NegativeMediumSpace': '','NegativeThickSpace': '',
        'NegativeThinSpace': '','NegativeVeryThinSpace': '','NestedGreaterGreater': '≫','NestedLessLess': '≪','NewLine': '\n',
        'Nfr': '𝔑','NoBreak': '','NonBreakingSpace': ' ','Nopf': 'ℕ','Not': '⫬',
        'NotCongruent': '≢','NotCupCap': '≭','NotDoubleVerticalBar': '∦','NotElement': '∉','NotEqual': '≠',
        'NotEqualTilde': '≂̸','NotExists': '∄','NotGreater': '≯','NotGreaterEqual': '≱','NotGreaterFullEqual': '≧̸',
        'NotGreaterGreater': '≫̸','NotGreaterLess': '≹','NotGreaterSlantEqual': '⩾̸','NotGreaterTilde': '≵','NotHumpDownHump': '≎̸',
        'NotHumpEqual': '≏̸','NotLeftTriangle': '⋪','NotLeftTriangleBar': '⧏̸','NotLeftTriangleEqual': '⋬','NotLess': '≮',
        'NotLessEqual': '≰','NotLessGreater': '≸','NotLessLess': '≪̸','NotLessSlantEqual': '⩽̸','NotLessTilde': '≴',
        'NotNestedGreaterGreater': '⪢̸','NotNestedLessLess': '⪡̸','NotPrecedes': '⊀','NotPrecedesEqual': '⪯̸','NotPrecedesSlantEqual': '⋠',
        'NotReverseElement': '∌','NotRightTriangle': '⋫','NotRightTriangleBar': '⧐̸','NotRightTriangleEqual': '⋭','NotSquareSubset': '⊏̸',
        'NotSquareSubsetEqual': '⋢','NotSquareSuperset': '⊐̸','NotSquareSupersetEqual': '⋣','NotSubset': '⊂⃒','NotSubsetEqual': '⊈',
        'NotSucceeds': '⊁','NotSucceedsEqual': '⪰̸','NotSucceedsSlantEqual': '⋡','NotSucceedsTilde': '≿̸','NotSuperset': '⊃⃒',
        'NotSupersetEqual': '⊉','NotTilde': '≁','NotTildeEqual': '≄','NotTildeFullEqual': '≇','NotTildeTilde': '≉',
        'NotVerticalBar': '∤','Nscr': '𝒩','Ntilde': 'Ñ','Nu': 'Ν','OElig': 'Œ',
        'Oacute': 'Ó','Ocirc': 'Ô','Ocy': 'О','Odblac': 'Ő','Ofr': '𝔒',
        'Ograve': 'Ò','Omacr': 'Ō','Omega': 'Ω','Omicron': 'Ο','Oopf': '𝕆',
        'OpenCurlyDoubleQuote': '“','OpenCurlyQuote': '‘','Or': '⩔','Oscr': '𝒪','Oslash': 'Ø',
        'Otilde': 'Õ','Otimes': '⨷','Ouml': 'Ö','OverBar': '‾','OverBrace': '⏞',
        'OverBracket': '⎴','OverParenthesis': '⏜','PartialD': '∂','Pcy': 'П','Pfr': '𝔓',
        'Phi': 'Φ','Pi': 'Π','PlusMinus': '±','Poincareplane': 'ℌ','Popf': 'ℙ',
        'Pr': '⪻','Precedes': '≺','PrecedesEqual': '⪯','PrecedesSlantEqual': '≼','PrecedesTilde': '≾',
        'Prime': '″','Product': '∏','Proportion': '∷','Proportional': '∝','Pscr': '𝒫',
        'Psi': 'Ψ','QUOT': '"','Qfr': '𝔔','Qopf': 'ℚ','Qscr': '𝒬',
        'RBarr': '⤐','REG': '®','Racute': 'Ŕ','Rang': '⟫','Rarr': '↠',
        'Rarrtl': '⤖','Rcaron': 'Ř','Rcedil': 'Ŗ','Rcy': 'Р','Re': 'ℜ',
        'ReverseElement': '∋','ReverseEquilibrium': '⇋','ReverseUpEquilibrium': '⥯','Rfr': 'ℜ','Rho': 'Ρ',
        'RightAngleBracket': '⟩','RightArrow': '→','RightArrowBar': '⇥','RightArrowLeftArrow': '⇄','RightCeiling': '⌉',
        'RightDoubleBracket': '⟧','RightDownTeeVector': '⥝','RightDownVector': '⇂','RightDownVectorBar': '⥕','RightFloor': '⌋',
        'RightTee': '⊢','RightTeeArrow': '↦','RightTeeVector': '⥛','RightTriangle': '⊳','RightTriangleBar': '⧐',
        'RightTriangleEqual': '⊵','RightUpDownVector': '⥏','RightUpTeeVector': '⥜','RightUpVector': '↾','RightUpVectorBar': '⥔',
        'RightVector': '⇀','RightVectorBar': '⥓','Rightarrow': '⇒','Ropf': 'ℝ','RoundImplies': '⥰',
        'Rrightarrow': '⇛','Rscr': 'ℛ','Rsh': '↱','RuleDelayed': '⧴','SHCHcy': 'Щ',
        'SHcy': 'Ш','SOFTcy': 'Ь','Sacute': 'Ś','Sc': '⪼','Scaron': 'Š',
        'Scedil': 'Ş','Scirc': 'Ŝ','Scy': 'С','Sfr': '𝔖','ShortDownArrow': '↓',
        'ShortLeftArrow': '←','ShortRightArrow': '→','ShortUpArrow': '↑','Sigma': 'Σ','SmallCircle': '∘',
        'Sopf': '𝕊','Sqrt': '√','Square': '□','SquareIntersection': '⊓','SquareSubset': '⊏',
        'SquareSubsetEqual': '⊑','SquareSuperset': '⊐','SquareSupersetEqual': '⊒','SquareUnion': '⊔','Sscr': '𝒮',
        'Star': '⋆','Sub': '⋐','Subset': '⋐','SubsetEqual': '⊆','Succeeds': '≻',
        'SucceedsEqual': '⪰','SucceedsSlantEqual': '≽','SucceedsTilde': '≿','SuchThat': '∋','Sum': '∑',
        'Sup': '⋑','Superset': '⊃','SupersetEqual': '⊇','Supset': '⋑','THORN': 'Þ',
        'TRADE': '™','TSHcy': 'Ћ','TScy': 'Ц','Tab': '  ','Tau': 'Τ',
        'Tcaron': 'Ť','Tcedil': 'Ţ','Tcy': 'Т','Tfr': '𝔗','Therefore': '∴',
        'Theta': 'Θ','ThickSpace': '  ','ThinSpace': ' ','Tilde': '∼','TildeEqual': '≃',
        'TildeFullEqual': '≅','TildeTilde': '≈','Topf': '𝕋','TripleDot': '⃛','Tscr': '𝒯',
        'Tstrok': 'Ŧ','Uacute': 'Ú','Uarr': '↟','Uarrocir': '⥉','Ubrcy': 'Ў',
        'Ubreve': 'Ŭ','Ucirc': 'Û','Ucy': 'У','Udblac': 'Ű','Ufr': '𝔘',
        'Ugrave': 'Ù','Umacr': 'Ū','UnderBar': '_','UnderBrace': '⏟','UnderBracket': '⎵',
        'UnderParenthesis': '⏝','Union': '⋃','UnionPlus': '⊎','Uogon': 'Ų','Uopf': '𝕌',
        'UpArrow': '↑','UpArrowBar': '⤒','UpArrowDownArrow': '⇅','UpDownArrow': '↕','UpEquilibrium': '⥮',
        'UpTee': '⊥','UpTeeArrow': '↥','Uparrow': '⇑','Updownarrow': '⇕','UpperLeftArrow': '↖',
        'UpperRightArrow': '↗','Upsi': 'ϒ','Upsilon': 'Υ','Uring': 'Ů','Uscr': '𝒰',
        'Utilde': 'Ũ','Uuml': 'Ü','VDash': '⊫','Vbar': '⫫','Vcy': 'В',
        'Vdash': '⊩','Vdashl': '⫦','Vee': '⋁','Verbar': '‖','Vert': '‖',
        'VerticalBar': '∣','VerticalLine': '|','VerticalSeparator': '❘','VerticalTilde': '≀','VeryThinSpace': ' ',
        'Vfr': '𝔙','Vopf': '𝕍','Vscr': '𝒱','Vvdash': '⊪','Wcirc': 'Ŵ',
        'Wedge': '⋀','Wfr': '𝔚','Wopf': '𝕎','Wscr': '𝒲','Xfr': '𝔛',
        'Xi': 'Ξ','Xopf': '𝕏','Xscr': '𝒳','YAcy': 'Я','YIcy': 'Ї',
        'YUcy': 'Ю','Yacute': 'Ý','Ycirc': 'Ŷ','Ycy': 'Ы','Yfr': '𝔜',
        'Yopf': '𝕐','Yscr': '𝒴','Yuml': 'Ÿ','ZHcy': 'Ж','Zacute': 'Ź',
        'Zcaron': 'Ž','Zcy': 'З','Zdot': 'Ż','ZeroWidthSpace': '','Zeta': 'Ζ',
        'Zfr': 'ℨ','Zopf': 'ℤ','Zscr': '𝒵','aacute': 'á','abreve': 'ă',
        'ac': '∾','acE': '∾̳','acd': '∿','acirc': 'â','acute': '´',
        'acy': 'а','aelig': 'æ','af': '','afr': '𝔞','agrave': 'à',
        'alefsym': 'ℵ','aleph': 'ℵ','alpha': 'α','amacr': 'ā','amalg': '⨿',
        'amp': '','and': '∧','andand': '⩕','andd': '⩜','andslope': '⩘',
        'andv': '⩚','ang': '∠','ange': '⦤','angle': '∠','angmsd': '∡',
        'angmsdaa': '⦨','angmsdab': '⦩','angmsdac': '⦪','angmsdad': '⦫','angmsdae': '⦬',
        'angmsdaf': '⦭','angmsdag': '⦮','angmsdah': '⦯','angrt': '∟','angrtvb': '⊾',
        'angrtvbd': '⦝','angsph': '∢','angst': 'Å','angzarr': '⍼','aogon': 'ą',
        'aopf': '𝕒','ap': '≈','apE': '⩰','apacir': '⩯','ape': '≊',
        'apid': '≋','apos': "'",'approx': '≈','approxeq': '≊','aring': 'å',
        'ascr': '𝒶','ast': '*','asymp': '≈','asympeq': '≍','atilde': 'ã',
        'auml': 'ä','awconint': '∳','awint': '⨑','bNot': '⫭','backcong': '≌',
        'backepsilon': '϶','backprime': '‵','backsim': '∽','backsimeq': '⋍','barvee': '⊽',
        'barwed': '⌅','barwedge': '⌅','bbrk': '⎵','bbrktbrk': '⎶','bcong': '≌',
        'bcy': 'б','bdquo': '„','becaus': '∵','because': '∵','bemptyv': '⦰',
        'bepsi': '϶','bernou': 'ℬ','beta': 'β','beth': 'ℶ','between': '≬',
        'bfr': '𝔟','bigcap': '⋂','bigcirc': '◯','bigcup': '⋃','bigodot': '⨀',
        'bigoplus': '⨁','bigotimes': '⨂','bigsqcup': '⨆','bigstar': '★','bigtriangledown': '▽',
        'bigtriangleup': '△','biguplus': '⨄','bigvee': '⋁','bigwedge': '⋀','bkarow': '⤍',
        'blacklozenge': '⧫','blacksquare': '▪','blacktriangle': '▴','blacktriangledown': '▾','blacktriangleleft': '◂',
        'blacktriangleright': '▸','blank': '␣','blk12': '▒','blk14': '░','blk34': '▓',
        'block': '█','bne': '=⃥','bnequiv': '≡⃥','bnot': '⌐','bopf': '𝕓',
        'bot': '⊥','bottom': '⊥','bowtie': '⋈','boxDL': '╗','boxDR': '╔',
        'boxDl': '╖','boxDr': '╓','boxH': '═','boxHD': '╦','boxHU': '╩',
        'boxHd': '╤','boxHu': '╧','boxUL': '╝','boxUR': '╚','boxUl': '╜',
        'boxUr': '╙','boxV': '║','boxVH': '╬','boxVL': '╣','boxVR': '╠',
        'boxVh': '╫','boxVl': '╢','boxVr': '╟','boxbox': '⧉','boxdL': '╕',
        'boxdR': '╒','boxdl': '┐','boxdr': '┌','boxh': '─','boxhD': '╥',
        'boxhU': '╨','boxhd': '┬','boxhu': '┴','boxminus': '⊟','boxplus': '⊞',
        'boxtimes': '⊠','boxuL': '╛','boxuR': '╘','boxul': '┘','boxur': '└',
        'boxv': '│','boxvH': '╪','boxvL': '╡','boxvR': '╞','boxvh': '┼',
        'boxvl': '┤','boxvr': '├','bprime': '‵','breve': '˘','brvbar': '¦',
        'bscr': '𝒷','bsemi': '⁏','bsim': '∽','bsime': '⋍','bsol': '\\',
        'bsolb': '⧅','bsolhsub': '⟈','bull': '•','bullet': '•','bump': '≎',
        'bumpE': '⪮','bumpe': '≏','bumpeq': '≏','cacute': 'ć','cap': '∩',
        'capand': '⩄','capbrcup': '⩉','capcap': '⩋','capcup': '⩇','capdot': '⩀',
        'caps': '∩︀','caret': '⁁','caron': 'ˇ','ccaps': '⩍','ccaron': 'č',
        'ccedil': 'ç','ccirc': 'ĉ','ccups': '⩌','ccupssm': '⩐','cdot': 'ċ',
        'cedil': '¸','cemptyv': '⦲','cent': '¢','centerdot': '·','cfr': '𝔠',
        'chcy': 'ч','check': '✓','checkmark': '✓','chi': 'χ','cir': '○',
        'cirE': '⧃','circ': 'ˆ','circeq': '≗','circlearrowleft': '↺','circlearrowright': '↻',
        'circledR': '®','circledS': 'Ⓢ','circledast': '⊛','circledcirc': '⊚','circleddash': '⊝',
        'cire': '≗','cirfnint': '⨐','cirmid': '⫯','cirscir': '⧂','clubs': '♣',
        'clubsuit': '♣','colon': ':','colone': '≔','coloneq': '≔','comma': ',',
        'commat': '@','comp': '∁','compfn': '∘','complement': '∁','complexes': 'ℂ',
        'cong': '≅','congdot': '⩭','conint': '∮','copf': '𝕔','coprod': '∐',
        'copy': '©','copysr': '℗','crarr': '↵','cross': '✗','cscr': '𝒸',
        'csub': '⫏','csube': '⫑','csup': '⫐','csupe': '⫒','ctdot': '⋯',
        'cudarrl': '⤸','cudarrr': '⤵','cuepr': '⋞','cuesc': '⋟','cularr': '↶',
        'cularrp': '⤽','cup': '∪','cupbrcap': '⩈','cupcap': '⩆','cupcup': '⩊',
        'cupdot': '⊍','cupor': '⩅','cups': '∪︀','curarr': '↷','curarrm': '⤼',
        'curlyeqprec': '⋞','curlyeqsucc': '⋟','curlyvee': '⋎','curlywedge': '⋏','curren': '¤',
        'curvearrowleft': '↶','curvearrowright': '↷','cuvee': '⋎','cuwed': '⋏','cwconint': '∲',
        'cwint': '∱','cylcty': '⌭','dArr': '⇓','dHar': '⥥','dagger': '†',
        'daleth': 'ℸ','darr': '↓','dash': '‐','dashv': '⊣','dbkarow': '⤏',
        'dblac': '˝','dcaron': 'ď','dcy': 'д','dd': 'ⅆ','ddagger': '‡',
        'ddarr': '⇊','ddotseq': '⩷','deg': '°','delta': 'δ','demptyv': '⦱',
        'dfisht': '⥿','dfr': '𝔡','dharl': '⇃','dharr': '⇂','diam': '⋄',
        'diamond': '⋄','diamondsuit': '♦','diams': '♦','die': '¨','digamma': 'ϝ',
        'disin': '⋲','div': '÷','divide': '÷','divideontimes': '⋇','divonx': '⋇',
        'djcy': 'ђ','dlcorn': '⌞','dlcrop': '⌍','dollar': '$','dopf': '𝕕',
        'dot': '˙','doteq': '≐','doteqdot': '≑','dotminus': '∸','dotplus': '∔',
        'dotsquare': '⊡','doublebarwedge': '⌆','downarrow': '↓','downdownarrows': '⇊','downharpoonleft': '⇃',
        'downharpoonright': '⇂','drbkarow': '⤐','drcorn': '⌟','drcrop': '⌌','dscr': '𝒹',
        'dscy': 'ѕ','dsol': '⧶','dstrok': 'đ','dtdot': '⋱','dtri': '▿',
        'dtrif': '▾','duarr': '⇵','duhar': '⥯','dwangle': '⦦','dzcy': 'џ',
        'dzigrarr': '⟿','eDDot': '⩷','eDot': '≑','eacute': 'é','easter': '⩮',
        'ecaron': 'ě','ecir': '≖','ecirc': 'ê','ecolon': '≕','ecy': 'э',
        'edot': 'ė','ee': 'ⅇ','efDot': '≒','efr': '𝔢','eg': '⪚',
        'egrave': 'è','egs': '⪖','egsdot': '⪘','el': '⪙','elinters': '⏧',
        'ell': 'ℓ','els': '⪕','elsdot': '⪗','emacr': 'ē','empty': '∅',
        'emptyset': '∅','emptyv': '∅','emsp13': ' ','emsp14': ' ','emsp': ' ',
        'eng': 'ŋ','ensp': ' ','eogon': 'ę','eopf': '𝕖','epar': '⋕',
        'eparsl': '⧣','eplus': '⩱','epsi': 'ε','epsilon': 'ε','epsiv': 'ϵ',
        'eqcirc': '≖','eqcolon': '≕','eqsim': '≂','eqslantgtr': '⪖','eqslantless': '⪕',
        'equals': '=','equest': '≟','equiv': '≡','equivDD': '⩸','eqvparsl': '⧥',
        'erDot': '≓','erarr': '⥱','escr': 'ℯ','esdot': '≐','esim': '≂',
        'eta': 'η','eth': 'ð','euml': 'ë','euro': '€','excl': '!',
        'exist': '∃','expectation': 'ℰ','exponentiale': 'ⅇ','fallingdotseq': '≒','fcy': 'ф',
        'female': '♀','ffilig': 'ﬃ','fflig': 'ﬀ','ffllig': 'ﬄ','ffr': '𝔣',
        'filig': 'ﬁ','fjlig': 'fj','flat': '♭','fllig': 'ﬂ','fltns': '▱',
        'fnof': 'ƒ','fopf': '𝕗','forall': '∀','fork': '⋔','forkv': '⫙',
        'fpartint': '⨍','frac12': '½','frac13': '⅓','frac14': '¼','frac15': '⅕',
        'frac16': '⅙','frac18': '⅛','frac23': '⅔','frac25': '⅖','frac34': '¾',
        'frac35': '⅗','frac38': '⅜','frac45': '⅘','frac56': '⅚','frac58': '⅝',
        'frac78': '⅞','frasl': '⁄','frown': '⌢','fscr': '𝒻','gE': '≧',
        'gEl': '⪌','gacute': 'ǵ','gamma': 'γ','gammad': 'ϝ','gap': '⪆',
        'gbreve': 'ğ','gcirc': 'ĝ','gcy': 'г','gdot': 'ġ','ge': '≥',
        'gel': '⋛','geq': '≥','geqq': '≧','geqslant': '⩾','ges': '⩾',
        'gescc': '⪩','gesdot': '⪀','gesdoto': '⪂','gesdotol': '⪄','gesl': '⋛︀',
        'gesles': '⪔','gfr': '𝔤','gg': '≫','ggg': '⋙','gimel': 'ℷ',
        'gjcy': 'ѓ','gl': '≷','glE': '⪒','gla': '⪥','glj': '⪤',
        'gnE': '≩','gnap': '⪊','gnapprox': '⪊','gne': '⪈','gneq': '⪈',
        'gneqq': '≩','gnsim': '⋧','gopf': '𝕘','grave': '`','gscr': 'ℊ',
        'gsim': '≳','gsime': '⪎','gsiml': '⪐','gt': '>','gtcc': '⪧',
        'gtcir': '⩺','gtdot': '⋗','gtlPar': '⦕','gtquest': '⩼','gtrapprox': '⪆',
        'gtrarr': '⥸','gtrdot': '⋗','gtreqless': '⋛','gtreqqless': '⪌','gtrless': '≷',
        'gtrsim': '≳','gvertneqq': '≩︀','gvnE': '≩︀','hArr': '⇔','hairsp': ' ',
        'half': '½','hamilt': 'ℋ','hardcy': 'ъ','harr': '↔','harrcir': '⥈',
        'harrw': '↭','hbar': 'ℏ','hcirc': 'ĥ','hearts': '♥','heartsuit': '♥',
        'hellip': '…','hercon': '⊹','hfr': '𝔥','hksearow': '⤥','hkswarow': '⤦',
        'hoarr': '⇿','homtht': '∻','hookleftarrow': '↩','hookrightarrow': '↪','hopf': '𝕙',
        'horbar': '―','hscr': '𝒽','hslash': 'ℏ','hstrok': 'ħ','hybull': '⁃',
        'hyphen': '‐','iacute': 'í','ic': '','icirc': 'î','icy': 'и',
        'iecy': 'е','iexcl': '¡','iff': '⇔','ifr': '𝔦','igrave': 'ì',
        'ii': 'ⅈ','iiiint': '⨌','iiint': '∭','iinfin': '⧜','iiota': '℩',
        'ijlig': 'ĳ','imacr': 'ī','image': 'ℑ','imagline': 'ℐ','imagpart': 'ℑ',
        'imath': 'ı','imof': '⊷','imped': 'Ƶ','in': '∈','incare': '℅',
        'infin': '∞','infintie': '⧝','inodot': 'ı','int': '∫','intcal': '⊺',
        'integers': 'ℤ','intercal': '⊺','intlarhk': '⨗','intprod': '⨼','iocy': 'ё',
        'iogon': 'į','iopf': '𝕚','iota': 'ι','iprod': '⨼','iquest': '¿',
        'iscr': '𝒾','isin': '∈','isinE': '⋹','isindot': '⋵','isins': '⋴',
        'isinsv': '⋳','isinv': '∈','it': '','itilde': 'ĩ','iukcy': 'і',
        'iuml': 'ï','jcirc': 'ĵ','jcy': 'й','jfr': '𝔧','jmath': 'ȷ',
        'jopf': '𝕛','jscr': '𝒿','jsercy': 'ј','jukcy': 'є','kappa': 'κ',
        'kappav': 'ϰ','kcedil': 'ķ','kcy': 'к','kfr': '𝔨','kgreen': 'ĸ',
        'khcy': 'х','kjcy': 'ќ','kopf': '𝕜','kscr': '𝓀','lAarr': '⇚',
        'lArr': '⇐','lAtail': '⤛','lBarr': '⤎','lE': '≦','lEg': '⪋',
        'lHar': '⥢','lacute': 'ĺ','laemptyv': '⦴','lagran': 'ℒ','lambda': 'λ',
        'lang': '⟨','langd': '⦑','langle': '⟨','lap': '⪅','laquo': '«',
        'larr': '←','larrb': '⇤','larrbfs': '⤟','larrfs': '⤝','larrhk': '↩',
        'larrlp': '↫','larrpl': '⤹','larrsim': '⥳','larrtl': '↢','lat': '⪫',
        'latail': '⤙','late': '⪭','lates': '⪭︀','lbarr': '⤌','lbbrk': '❲',
        'lbrace': '{','lbrack': '[','lbrke': '⦋','lbrksld': '⦏','lbrkslu': '⦍',
        'lcaron': 'ľ','lcedil': 'ļ','lceil': '⌈','lcub': '{','lcy': 'л',
        'ldca': '⤶','ldquo': '“','ldquor': '„','ldrdhar': '⥧','ldrushar': '⥋',
        'ldsh': '↲','le': '≤','leftarrow': '←','leftarrowtail': '↢','leftharpoondown': '↽',
        'leftharpoonup': '↼','leftleftarrows': '⇇','leftrightarrow': '↔','leftrightarrows': '⇆','leftrightharpoons': '⇋',
        'leftrightsquigarrow': '↭','leftthreetimes': '⋋','leg': '⋚','leq': '≤','leqq': '≦',
        'leqslant': '⩽','les': '⩽','lescc': '⪨','lesdot': '⩿','lesdoto': '⪁',
        'lesdotor': '⪃','lesg': '⋚︀','lesges': '⪓','lessapprox': '⪅','lessdot': '⋖',
        'lesseqgtr': '⋚','lesseqqgtr': '⪋','lessgtr': '≶','lesssim': '≲','lfisht': '⥼',
        'lfloor': '⌊','lfr': '𝔩','lg': '≶','lgE': '⪑','lhard': '↽',
        'lharu': '↼','lharul': '⥪','lhblk': '▄','ljcy': 'љ','ll': '≪',
        'llarr': '⇇','llcorner': '⌞','llhard': '⥫','lltri': '◺','lmidot': 'ŀ',
        'lmoust': '⎰','lmoustache': '⎰','lnE': '≨','lnap': '⪉','lnapprox': '⪉',
        'lne': '⪇','lneq': '⪇','lneqq': '≨','lnsim': '⋦','loang': '⟬',
        'loarr': '⇽','lobrk': '⟦','longleftarrow': '⟵','longleftrightarrow': '⟷','longmapsto': '⟼',
        'longrightarrow': '⟶','looparrowleft': '↫','looparrowright': '↬','lopar': '⦅','lopf': '𝕝',
        'loplus': '⨭','lotimes': '⨴','lowast': '∗','lowbar': '_','loz': '◊',
        'lozenge': '◊','lozf': '⧫','lpar': '(','lparlt': '⦓','lrarr': '⇆',
        'lrcorner': '⌟','lrhar': '⇋','lrhard': '⥭','lrm': '','lrtri': '⊿',
        'lsaquo': '‹','lscr': '𝓁','lsh': '↰','lsim': '≲','lsime': '⪍',
        'lsimg': '⪏','lsqb': '[','lsquo': '‘','lsquor': '‚','lstrok': 'ł',
        'lt': '<','ltcc': '⪦','ltcir': '⩹','ltdot': '⋖','lthree': '⋋',
        'ltimes': '⋉','ltlarr': '⥶','ltquest': '⩻','ltrPar': '⦖','ltri': '◃',
        'ltrie': '⊴','ltrif': '◂','lurdshar': '⥊','luruhar': '⥦','lvertneqq': '≨︀',
        'lvnE': '≨︀','mDDot': '∺','macr': '¯','male': '♂','malt': '✠',
        'maltese': '✠','map': '↦','mapsto': '↦','mapstodown': '↧','mapstoleft': '↤',
        'mapstoup': '↥','marker': '▮','mcomma': '⨩','mcy': 'м','mdash': '—',
        'measuredangle': '∡','mfr': '𝔪','mho': '℧','micro': 'µ','mid': '∣',
        'midast': '*','midcir': '⫰','middot': '·','minus': '−','minusb': '⊟',
        'minusd': '∸','minusdu': '⨪','mlcp': '⫛','mldr': '…','mnplus': '∓',
        'models': '⊧','mopf': '𝕞','mp': '∓','mscr': '𝓂','mstpos': '∾',
        'mu': 'μ','multimap': '⊸','mumap': '⊸','nGg': '⋙̸','nGt': '≫⃒',
        'nGtv': '≫̸','nLeftarrow': '⇍','nLeftrightarrow': '⇎','nLl': '⋘̸','nLt': '≪⃒',
        'nLtv': '≪̸','nRightarrow': '⇏','nVDash': '⊯','nVdash': '⊮','nabla': '∇',
        'nacute': 'ń','nang': '∠⃒','nap': '≉','napE': '⩰̸','napid': '≋̸',
        'napos': 'ŉ','napprox': '≉','natur': '♮','natural': '♮','naturals': 'ℕ',
        'nbsp': ' ','nbump': '≎̸','nbumpe': '≏̸','ncap': '⩃','ncaron': 'ň',
        'ncedil': 'ņ','ncong': '≇','ncongdot': '⩭̸','ncup': '⩂','ncy': 'н',
        'ndash': '–','ne': '≠','neArr': '⇗','nearhk': '⤤','nearr': '↗',
        'nearrow': '↗','nedot': '≐̸','nequiv': '≢','nesear': '⤨','nesim': '≂̸',
        'nexist': '∄','nexists': '∄','nfr': '𝔫','ngE': '≧̸','nge': '≱',
        'ngeq': '≱','ngeqq': '≧̸','ngeqslant': '⩾̸','nges': '⩾̸','ngsim': '≵',
        'ngt': '≯','ngtr': '≯','nhArr': '⇎','nharr': '↮','nhpar': '⫲',
        'ni': '∋','nis': '⋼','nisd': '⋺','niv': '∋','njcy': 'њ',
        'nlArr': '⇍','nlE': '≦̸','nlarr': '↚','nldr': '‥','nle': '≰',
        'nleftarrow': '↚','nleftrightarrow': '↮','nleq': '≰','nleqq': '≦̸','nleqslant': '⩽̸',
        'nles': '⩽̸','nless': '≮','nlsim': '≴','nlt': '≮','nltri': '⋪',
        'nltrie': '⋬','nmid': '∤','nopf': '𝕟','not': '¬','notin': '∉',
        'notinE': '⋹̸','notindot': '⋵̸','notinva': '∉','notinvb': '⋷','notinvc': '⋶',
        'notni': '∌','notniva': '∌','notnivb': '⋾','notnivc': '⋽','npar': '∦',
        'nparallel': '∦','nparsl': '⫽⃥','npart': '∂̸','npolint': '⨔','npr': '⊀',
        'nprcue': '⋠','npre': '⪯̸','nprec': '⊀','npreceq': '⪯̸','nrArr': '⇏',
        'nrarr': '↛','nrarrc': '⤳̸','nrarrw': '↝̸','nrightarrow': '↛','nrtri': '⋫',
        'nrtrie': '⋭','nsc': '⊁','nsccue': '⋡','nsce': '⪰̸','nscr': '𝓃',
        'nshortmid': '∤','nshortparallel': '∦','nsim': '≁','nsime': '≄','nsimeq': '≄',
        'nsmid': '∤','nspar': '∦','nsqsube': '⋢','nsqsupe': '⋣','nsub': '⊄',
        'nsubE': '⫅̸','nsube': '⊈','nsubset': '⊂⃒','nsubseteq': '⊈','nsubseteqq': '⫅̸',
        'nsucc': '⊁','nsucceq': '⪰̸','nsup': '⊅','nsupE': '⫆̸','nsupe': '⊉',
        'nsupset': '⊃⃒','nsupseteq': '⊉','nsupseteqq': '⫆̸','ntgl': '≹','ntilde': 'ñ',
        'ntlg': '≸','ntriangleleft': '⋪','ntrianglelefteq': '⋬','ntriangleright': '⋫','ntrianglerighteq': '⋭',
        'nu': 'ν','num': '#','numero': '№','numsp': ' ','nvDash': '⊭',
        'nvHarr': '⤄','nvap': '≍⃒','nvdash': '⊬','nvge': '≥⃒','nvgt': '>⃒',
        'nvinfin': '⧞','nvlArr': '⤂','nvle': '≤⃒','nvlt': '<⃒','nvltrie': '⊴⃒',
        'nvrArr': '⤃','nvrtrie': '⊵⃒','nvsim': '∼⃒','nwArr': '⇖','nwarhk': '⤣',
        'nwarr': '↖','nwarrow': '↖','nwnear': '⤧','oS': 'Ⓢ','oacute': 'ó',
        'oast': '⊛','ocir': '⊚','ocirc': 'ô','ocy': 'о','odash': '⊝',
        'odblac': 'ő','odiv': '⨸','odot': '⊙','odsold': '⦼','oelig': 'œ',
        'ofcir': '⦿','ofr': '𝔬','ogon': '˛','ograve': 'ò','ogt': '⧁',
        'ohbar': '⦵','ohm': 'Ω','oint': '∮','olarr': '↺','olcir': '⦾',
        'olcross': '⦻','oline': '‾','olt': '⧀','omacr': 'ō','omega': 'ω',
        'omicron': 'ο','omid': '⦶','ominus': '⊖','oopf': '𝕠','opar': '⦷',
        'operp': '⦹','oplus': '⊕','or': '∨','orarr': '↻','ord': '⩝',
        'order': 'ℴ','orderof': 'ℴ','ordf': 'ª','ordm': 'º','origof': '⊶',
        'oror': '⩖','orslope': '⩗','orv': '⩛','oscr': 'ℴ','oslash': 'ø',
        'osol': '⊘','otilde': 'õ','otimes': '⊗','otimesas': '⨶','ouml': 'ö',
        'ovbar': '⌽','par': '∥','para': '¶','parallel': '∥','parsim': '⫳',
        'parsl': '⫽','part': '∂','pcy': 'п','percnt': '%','period': '.',
        'permil': '‰','perp': '⊥','pertenk': '‱','pfr': '𝔭','phi': 'φ',
        'phiv': 'ϕ','phmmat': 'ℳ','phone': '☎','pi': 'π','pitchfork': '⋔',
        'piv': 'ϖ','planck': 'ℏ','planckh': 'ℎ','plankv': 'ℏ','plus': '+',
        'plusacir': '⨣','plusb': '⊞','pluscir': '⨢','plusdo': '∔','plusdu': '⨥',
        'pluse': '⩲','plusmn': '±','plussim': '⨦','plustwo': '⨧','pm': '±',
        'pointint': '⨕','popf': '𝕡','pound': '£','pr': '≺','prE': '⪳',
        'prap': '⪷','prcue': '≼','pre': '⪯','prec': '≺','precapprox': '⪷',
        'preccurlyeq': '≼','preceq': '⪯','precnapprox': '⪹','precneqq': '⪵','precnsim': '⋨',
        'precsim': '≾','prime': '′','primes': 'ℙ','prnE': '⪵','prnap': '⪹',
        'prnsim': '⋨','prod': '∏','profalar': '⌮','profline': '⌒','profsurf': '⌓',
        'prop': '∝','propto': '∝','prsim': '≾','prurel': '⊰','pscr': '𝓅',
        'psi': 'ψ','puncsp': ' ','qfr': '𝔮','qint': '⨌','qopf': '𝕢',
        'qprime': '⁗','qscr': '𝓆','quaternions': 'ℍ','quatint': '⨖','quest': '?',
        'questeq': '≟','quot': '"','rAarr': '⇛','rArr': '⇒','rAtail': '⤜',
        'rBarr': '⤏','rHar': '⥤','race': '∽̱','racute': 'ŕ','radic': '√',
        'raemptyv': '⦳','rang': '⟩','rangd': '⦒','range': '⦥','rangle': '⟩',
        'raquo': '»','rarr': '→','rarrap': '⥵','rarrb': '⇥','rarrbfs': '⤠',
        'rarrc': '⤳','rarrfs': '⤞','rarrhk': '↪','rarrlp': '↬','rarrpl': '⥅',
        'rarrsim': '⥴','rarrtl': '↣','rarrw': '↝','ratail': '⤚','ratio': '∶',
        'rationals': 'ℚ','rbarr': '⤍','rbbrk': '❳','rbrace': '}','rbrack': ']',
        'rbrke': '⦌','rbrksld': '⦎','rbrkslu': '⦐','rcaron': 'ř','rcedil': 'ŗ',
        'rceil': '⌉','rcub': '}','rcy': 'р','rdca': '⤷','rdldhar': '⥩',
        'rdquo': '”','rdquor': '”','rdsh': '↳','real': 'ℜ','realine': 'ℛ',
        'realpart': 'ℜ','reals': 'ℝ','rect': '▭','reg': '®','rfisht': '⥽',
        'rfloor': '⌋','rfr': '𝔯','rhard': '⇁','rharu': '⇀','rharul': '⥬',
        'rho': 'ρ','rhov': 'ϱ','rightarrow': '→','rightarrowtail': '↣','rightharpoondown': '⇁',
        'rightharpoonup': '⇀','rightleftarrows': '⇄','rightleftharpoons': '⇌','rightrightarrows': '⇉','rightsquigarrow': '↝',
        'rightthreetimes': '⋌','ring': '˚','risingdotseq': '≓','rlarr': '⇄','rlhar': '⇌',
        'rlm': '','rmoust': '⎱','rmoustache': '⎱','rnmid': '⫮','roang': '⟭',
        'roarr': '⇾','robrk': '⟧','ropar': '⦆','ropf': '𝕣','roplus': '⨮',
        'rotimes': '⨵','rpar': ')','rpargt': '⦔','rppolint': '⨒','rrarr': '⇉',
        'rsaquo': '›','rscr': '𝓇','rsh': '↱','rsqb': ']','rsquo': '’',
        'rsquor': '’','rthree': '⋌','rtimes': '⋊','rtri': '▹','rtrie': '⊵',
        'rtrif': '▸','rtriltri': '⧎','ruluhar': '⥨','rx': '℞','sacute': 'ś',
        'sbquo': '‚','sc': '≻','scE': '⪴','scap': '⪸','scaron': 'š',
        'sccue': '≽','sce': '⪰','scedil': 'ş','scirc': 'ŝ','scnE': '⪶',
        'scnap': '⪺','scnsim': '⋩','scpolint': '⨓','scsim': '≿','scy': 'с',
        'sdot': '⋅','sdotb': '⊡','sdote': '⩦','seArr': '⇘','searhk': '⤥',
        'searr': '↘','searrow': '↘','sect': '§','semi': '','seswar': '⤩',
        'setminus': '∖','setmn': '∖','sext': '✶','sfr': '𝔰','sfrown': '⌢',
        'sharp': '♯','shchcy': 'щ','shcy': 'ш','shortmid': '∣','shortparallel': '∥',
        'shy': '','sigma': 'σ','sigmaf': 'ς','sigmav': 'ς','sim': '∼',
        'simdot': '⩪','sime': '≃','simeq': '≃','simg': '⪞','simgE': '⪠',
        'siml': '⪝','simlE': '⪟','simne': '≆','simplus': '⨤','simrarr': '⥲',
        'slarr': '←','smallsetminus': '∖','smashp': '⨳','smeparsl': '⧤','smid': '∣',
        'smile': '⌣','smt': '⪪','smte': '⪬','smtes': '⪬︀','softcy': 'ь',
        'sol': '/','solb': '⧄','solbar': '⌿','sopf': '𝕤','spades': '♠',
        'spadesuit': '♠','spar': '∥','sqcap': '⊓','sqcaps': '⊓︀','sqcup': '⊔',
        'sqcups': '⊔︀','sqsub': '⊏','sqsube': '⊑','sqsubset': '⊏','sqsubseteq': '⊑',
        'sqsup': '⊐','sqsupe': '⊒','sqsupset': '⊐','sqsupseteq': '⊒','squ': '□',
        'square': '□','squarf': '▪','squf': '▪','srarr': '→','sscr': '𝓈',
        'ssetmn': '∖','ssmile': '⌣','sstarf': '⋆','star': '☆','starf': '★',
        'straightepsilon': 'ϵ','straightphi': 'ϕ','strns': '¯','sub': '⊂','subE': '⫅',
        'subdot': '⪽','sube': '⊆','subedot': '⫃','submult': '⫁','subnE': '⫋',
        'subne': '⊊','subplus': '⪿','subrarr': '⥹','subset': '⊂','subseteq': '⊆',
        'subseteqq': '⫅','subsetneq': '⊊','subsetneqq': '⫋','subsim': '⫇','subsub': '⫕',
        'subsup': '⫓','succ': '≻','succapprox': '⪸','succcurlyeq': '≽','succeq': '⪰',
        'succnapprox': '⪺','succneqq': '⪶','succnsim': '⋩','succsim': '≿','sum': '∑',
        'sung': '♪','sup1': '¹','sup2': '²','sup3': '³','sup': '⊃',
        'supE': '⫆','supdot': '⪾','supdsub': '⫘','supe': '⊇','supedot': '⫄',
        'suphsol': '⟉','suphsub': '⫗','suplarr': '⥻','supmult': '⫂','supnE': '⫌',
        'supne': '⊋','supplus': '⫀','supset': '⊃','supseteq': '⊇','supseteqq': '⫆',
        'supsetneq': '⊋','supsetneqq': '⫌','supsim': '⫈','supsub': '⫔','supsup': '⫖',
        'swArr': '⇙','swarhk': '⤦','swarr': '↙','swarrow': '↙','swnwar': '⤪',
        'szlig': 'ß','target': '⌖','tau': 'τ','tbrk': '⎴','tcaron': 'ť',
        'tcedil': 'ţ','tcy': 'т','tdot': '⃛','telrec': '⌕','tfr': '𝔱',
        'there4': '∴','therefore': '∴','theta': 'θ','thetasym': 'ϑ','thetav': 'ϑ',
        'thickapprox': '≈','thicksim': '∼','thinsp': ' ','thkap': '≈','thksim': '∼',
        'thorn': 'þ','tilde': '˜','times': '×','timesb': '⊠','timesbar': '⨱',
        'timesd': '⨰','tint': '∭','toea': '⤨','top': '⊤','topbot': '⌶',
        'topcir': '⫱','topf': '𝕥','topfork': '⫚','tosa': '⤩','tprime': '‴',
        'trade': '™','triangle': '▵','triangledown': '▿','triangleleft': '◃','trianglelefteq': '⊴',
        'triangleq': '≜','triangleright': '▹','trianglerighteq': '⊵','tridot': '◬','trie': '≜',
        'triminus': '⨺','triplus': '⨹','trisb': '⧍','tritime': '⨻','trpezium': '⏢',
        'tscr': '𝓉','tscy': 'ц','tshcy': 'ћ','tstrok': 'ŧ','twixt': '≬',
        'twoheadleftarrow': '↞','twoheadrightarrow': '↠','uArr': '⇑','uHar': '⥣','uacute': 'ú',
        'uarr': '↑','ubrcy': 'ў','ubreve': 'ŭ','ucirc': 'û','ucy': 'у',
        'udarr': '⇅','udblac': 'ű','udhar': '⥮','ufisht': '⥾','ufr': '𝔲',
        'ugrave': 'ù','uharl': '↿','uharr': '↾','uhblk': '▀','ulcorn': '⌜',
        'ulcorner': '⌜','ulcrop': '⌏','ultri': '◸','umacr': 'ū','uml': '¨',
        'uogon': 'ų','uopf': '𝕦','uparrow': '↑','updownarrow': '↕','upharpoonleft': '↿',
        'upharpoonright': '↾','uplus': '⊎','upsi': 'υ','upsih': 'ϒ','upsilon': 'υ',
        'upuparrows': '⇈','urcorn': '⌝','urcorner': '⌝','urcrop': '⌎','uring': 'ů',
        'urtri': '◹','uscr': '𝓊','utdot': '⋰','utilde': 'ũ','utri': '▵',
        'utrif': '▴','uuarr': '⇈','uuml': 'ü','uwangle': '⦧','vArr': '⇕',
        'vBar': '⫨','vBarv': '⫩','vDash': '⊨','vangrt': '⦜','varepsilon': 'ϵ',
        'varkappa': 'ϰ','varnothing': '∅','varphi': 'ϕ','varpi': 'ϖ','varpropto': '∝',
        'varr': '↕','varrho': 'ϱ','varsigma': 'ς','varsubsetneq': '⊊︀','varsubsetneqq': '⫋︀',
        'varsupsetneq': '⊋︀','varsupsetneqq': '⫌︀','vartheta': 'ϑ','vartriangleleft': '⊲','vartriangleright': '⊳',
        'vcy': 'в','vdash': '⊢','vee': '∨','veebar': '⊻','veeeq': '≚',
        'vellip': '⋮','verbar': '|','vert': '|','vfr': '𝔳','vltri': '⊲',
        'vnsub': '⊂⃒','vnsup': '⊃⃒','vopf': '𝕧','vprop': '∝','vrtri': '⊳',
        'vscr': '𝓋','vsubnE': '⫋︀','vsubne': '⊊︀','vsupnE': '⫌︀','vsupne': '⊋︀',
        'vzigzag': '⦚','wcirc': 'ŵ','wedbar': '⩟','wedge': '∧','wedgeq': '≙',
        'weierp': '℘','wfr': '𝔴','wopf': '𝕨','wp': '℘','wr': '≀',
        'wreath': '≀','wscr': '𝓌','xcap': '⋂','xcirc': '◯','xcup': '⋃',
        'xdtri': '▽','xfr': '𝔵','xhArr': '⟺','xharr': '⟷','xi': 'ξ',
        'xlArr': '⟸','xlarr': '⟵','xmap': '⟼','xnis': '⋻','xodot': '⨀',
        'xopf': '𝕩','xoplus': '⨁','xotime': '⨂','xrArr': '⟹','xrarr': '⟶',
        'xscr': '𝓍','xsqcup': '⨆','xuplus': '⨄','xutri': '△','xvee': '⋁',
        'xwedge': '⋀','yacute': 'ý','yacy': 'я','ycirc': 'ŷ','ycy': 'ы',
        'yen': '¥','yfr': '𝔶','yicy': 'ї','yopf': '𝕪','yscr': '𝓎',
        'yucy': 'ю','yuml': 'ÿ','zacute': 'ź','zcaron': 'ž','zcy': 'з',
        'zdot': 'ż','zeetrf': 'ℨ','zeta': 'ζ','zfr': '𝔷','zhcy': 'ж',
    },
    strftimeFormat: "%Y-%m-%d %H:%M:%S %Z",
    strftimeMap: {
        weekDays: {
            "": [ 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat' ]
        },
        weekDaysFull: {
            "": [ 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday' ]
        },
        months: {
            "": [ 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec' ]
        },
        monthsFull: {
            "": [ 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December' ]
        },
    },
    tzMap: [
        // name, GMT offset, daylight, linux support
        ["EDT", "GMT-0400", true],
        ["EST", "GMT-0500", false],
        ["PDT", "GMT-0700", true],
        ["PST", "GMT-0800", false],
        ["CDT", "GMT-0500", true],
        ["CST", "GMT-0600", false],
        ["MDT", "GMT-0600", true],
        ["MST", "GMT-0700", false],
        ["HADT", "GMT-0900", true, false],
        ["HAST", "GMT-1000", false, false],
        ["AKDT", "GMT-0800", true, false],
        ["AKST", "GMT-0900", false, false],
        ["ADT", "GMT-0300", true, false],
        ["AST", "GMT-0400", false, false],
    ],
    // Respawn throttling
    respawn: { interval: 3000, timeout: 2000, delay: 30000, count: 4, time: null, events: 0 },
    // Empty function to be used when callback was no provided
    empty: {},
    emptylist: [],
    noop: function() {},
};

module.exports = lib;

// Run a callback if a valid function, all arguments after the callback will be passed as is
lib.tryCall = function(callback)
{
    if (typeof callback == "function") return callback.apply(null, Array.prototype.slice.call(arguments, 1));
    if (callback) logger.warn("tryCall:", arguments, new Error().stack);
}

// Run a callback inside try..catch block, all arguments after the callback will be passed as is, in case of error
// all arguments will be printed in the log
lib.tryCatch = function(callback)
{
    var args = Array.prototype.slice.call(arguments, 1);
    try {
        callback.apply(null, args);
    } catch (e) {
        args.unshift(e.stack);
        args.unshift("tryCatch:");
        logger.error.apply(logger, args);
    }
}

// Print all arguments into the console, for debugging purposes, if the first arg is an error only print the error
lib.log = function()
{
    if (util.isError(arguments[0])) return console.log(lib.traceError(arguments[0]));
    for (var i = 0; i < arguments.length; i++) {
        console.log(util.inspect(arguments[i], { depth: 5 }));
    }
}

// Simple i18n translation method compatible with other popular modules, supports the following usage:
// - __(name)
// - __(fmt, arg,...)
// - __({ phrase: "", locale: "" }, arg...
//
lib.__ = function()
{
    var lang = this.locale, txt, msg = arguments[0];

    if (typeof arguments[0] === "object" && arguments[0].phrase) {
        msg = arguments[0].phrase;
        lang = arguments[0].locale || lang;
    }
    var locale = lib.locales[lang];
    if (!locale && typeof lang == "string" && lang.indexOf("-") > 0) {
        locale = lib.locales[lang.split("-")[0]];
    }
    if (locale) {
        txt = locale[msg];
        if (!txt) logger.info("missing-locale:", lang, msg);
    }
    if (!txt) txt = msg;
    if (arguments.length == 1) return txt;
    return lib.sprintf(txt, Array.prototype.slice.call(arguments, 1));
}

// Return commandline argument value by name
lib.getArg = function(name, dflt)
{
    var idx = process.argv.lastIndexOf(name);
    var val = idx > -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : "";
    if (val[0] == "-") val = "";
    if (!val && typeof dflt != "undefined") val = dflt;
    return val;
}

// Return commandline argument value as a number
lib.getArgInt = function(name, dflt)
{
    return this.toNumber(this.getArg(name, dflt));
}

// Returns true of given arg(s) are present in the command line, name can be a string or an array of strings.
lib.isArg = function(name)
{
    if (!Array.isArray(name)) return process.argv.lastIndexOf(name) > 0;
    return name.some(function(x) { return process.argv.lastIndexOf(x) > 0 });
}

// Register the callback to be run later for the given message, the message may have the `__id` property which will be used for keeping track of the responses or it will be generated.
// The `parent` can be any object and is used to register the timer and keep reference to it.
//
// A timeout is created for this message, if `runCallback` for this message will not be called in time the timeout handler will call the callback
// anyway with the original message.
//
// The callback passed will be called with only one argument which is the message, what is inside the message this function does not care. If
// any errors must be passed, use the message object for it, no other arguments are expected.
lib.deferCallback = function(parent, msg, callback, timeout)
{
    if (!this.isObject(msg) || !callback) return;

    if (!msg.__deferId) msg.__deferId = this.deferId++;
    parent[msg.__deferId] = {
        callback: callback,
        timer: setTimeout(this.onDeferCallback.bind(parent, msg), timeout || this.deferTimeout)
    };
}

// To be called on timeout or when explicitely called by the `runCallback`, it is called in the context of the message.
lib.onDeferCallback = function(msg)
{
    var item = this[msg.__deferId];
    if (!item) return;
    delete this[msg.__deferId];
    clearTimeout(item.timer);
    logger.dev("onDeferCallback:", msg);
    try { item.callback(msg); } catch (e) { logger.error('onDeferCallback:', e, msg, e.stack); }
}

// Run delayed callback for the message previously registered with the `deferCallback` method.
// The message must have `id` property which is used to find the corresponding callback, if the msg is a JSON string it will be converted into the object.
//
// Same parent object must be used for `deferCallback` and this method.
lib.runCallback = function(parent, msg)
{
    if (msg && typeof msg == "string") msg = this.jsonParse(msg, { logger: "error" });
    if (!msg || !msg.__deferId || !parent[msg.__deferId]) return;
    setImmediate(this.onDeferCallback.bind(parent, msg));
}

// Assign or clear an interval timer, keep the reference in the given parent object
lib.deferInterval = function(parent, interval, name, callback)
{
    var tname = "_" + name + "Timer";
    var iname = "_" + name + "Interval";
    if (interval != parent[iname]) {
        if (parent[tname]) clearInterval(parent[tname]);
        if (interval > 0) {
            parent[tname] = setInterval(callback, interval);
            parent[iname] = interval;
        } else {
            delete parent[iname];
            delete parent[tname];
        }
    }
}

// Return object with geohash for given coordinates to be used for location search
//
// The options may contain the following properties:
//   - distance - limit the range key with the closest range smaller than then distance, required for search but for updates may be omitted
//   - minDistance - radius for the smallest bounding box in km containing single location, radius searches will combine neighboring boxes of
//      this size to cover the whole area with the given distance request, also this affects the length of geohash keys stored in the bk_location table
//      if not specified default `min-distance` value will be used.
lib.geoHash = function(latitude, longitude, options)
{
    if (!options) options = {};
    var minDistance = options.minDistance || 0.01;
    var range = this.geoHashRanges.filter(function(x) { return x[1] > minDistance })[0];
    var geohash = bkutils.geoHashEncode(latitude, longitude);
    return { geohash: geohash.substr(0, range[0]),
             _geohash: geohash,
             neighbors: options.distance ? bkutils.geoHashGrid(geohash.substr(0, range[0]), Math.ceil(options.distance / range[1])).slice(1) : [],
             latitude: latitude,
             longitude: longitude,
             minRange: range[1],
             minDistance: minDistance,
             distance: options.distance || 0 };
}

// Return distance between two locations
//
// The options can specify the following properties:
// - round - a number how to round the distance
//
//  Example: round to the nearest full 5 km and use only 1 decimal point, if the distance is 13, it will be 15.0
//
//      lib.geoDistance(34, -188, 34.4, -119, { round: 5.1 })
//
lib.geoDistance = function(latitude1, longitude1, latitude2, longitude2, options)
{
    var distance = bkutils.geoDistance(latitude1, longitude1, latitude2, longitude2);
    if (isNaN(distance) || distance === null || typeof distance == "undefined") return null;

    // Round the distance to the closes edge and fixed number of decimals
    if (options && typeof options.round == "number" && options.round > 0) {
        var decs = String(options.round).split(".")[1];
        distance = parseFloat(Number(Math.floor(distance/options.round)*options.round).toFixed(decs ? decs.length : 0));
        if (isNaN(distance)) return null;
    }
    return distance;
}

// Busy timer handler, supports commands:
// - init - start the timer with the given latency in ms
// - get - returns the latest latency
// - busy - returns true if busy i.e. latency is greater than configured
lib.busyTimer = function(name, val)
{
    switch (name) {
    case "init":
        bkutils.initBusy(val);
        break;
    case "get":
        return bkutils.getBusy();
    case "busy":
        return bkutils.isBusy();
    }
}

// Sort a list be version in descending order, an item can be a string or an object with
// a property to sort by, in such case `name` must be specified which property to use for sorting.
// The name format is assumed to be: `XXXXX-N.N.N`
lib.sortByVersion = function(list, name)
{
    if (!Array.isArray(list)) return [];
    return list.sort(function(a, b) {
        var v1 = typeof a == "string" ? a : a[name];
        var v2 = typeof b == "string" ? b : b[name];
        var n1 = v1 && v1.match(/^(.+)[ -]([0-9.]+)$/);
        if (n1) n1[2] = lib.toVersion(n1[2]);
        var n2 = v2 && v2.match(/^(.+)[ -]([0-9.]+)$/);
        if (n2) n2[2] = lib.toVersion(n2[2]);
        return !n1 || !n2 ? 0 : n1[1] > n2[1] ? -1 : n1[1] < n2[1] ? 1 : n2[2] - n1[2];
    });
}

// Return an object with user info from the /etc/passwd file, user can be uid or name, if user is ommitted the current user is returned
lib.getUser = function(user)
{
    return bkutils.getUser(user);
}

// Return an object with specified group info for the current user of for the given group id or name
lib.getGroup = function(group)
{
    return bkutils.getGroup(group);
}

// Drop root privileges and switch to a regular user
lib.dropPrivileges = function(uid, gid)
{
    if (process.getuid() == 0 && uid) {
        logger.debug('init: switching to', uid, gid);
        try { process.setgid(gid); } catch (e) { logger.error('setgid:', gid, e); }
        try { process.setuid(uid); } catch (e) { logger.error('setuid:', uid, e); }
    }
}

// Convert an IP address into integer
lib.ip2int = function(ip)
{
    return ip.split('.').reduce((int, oct) => (int << 8) + parseInt(oct, 10), 0) >>> 0;
}

// Convert an integer into IP address
lib.int2ip = function(int)
{
    return [(int >>> 24) & 0xFF, (int >>> 16) & 0xFF, (int >>> 8) & 0xFF, int & 0xFF].join('.');
}

// Return true if the given IP address is within the given CIDR block
lib.inCidr = function(ip, cidr)
{
    const [range, bits = 32] = cidr.split('/');
    const mask = ~(Math.pow(2, (32 - bits)) - 1);
    return (this.ip2int(ip) & mask) === (this.ip2int(range) & mask);
};

// Return first and last IP addresses for the CIDR block
lib.cidrRange = function(cidr)
{
    const [range, bits = 32] = cidr.split('/');
    const mask = ~(Math.pow(2, (32 - bits)) - 1);
    return [this.int2ip(this.ip2int(range) & mask), this.int2ip(this.ip2int(range) | ~mask)];
}


// Randomize the list items in place
lib.shuffle = function(list)
{
    if (!Array.isArray(list)) return [];
    if (list.length == 1) return list;
    for (var i = 0; i < list.length; i++) {
        var j = Math.round((list.length - 1) * this.randomFloat());
        if (i == j) {
            continue;
        }
        var item = list[j];
        list[j] = list[i];
        list[i] = item;
    }
    return list;
}

// Extract domain from the host name, takes all host parts except the first one
lib.domainName = function(host)
{
    if (typeof host != "string" || !host) return "";
    var name = this.strSplit(host, '.');
    return (name.length > 2 ? name.slice(1).join('.') : host).toLowerCase();
}

// Return a new Error object, msg can be a string or an object with message, code, status properties.
// The default error status is 400 if not specified.
lib.newError = function(msg, status, code)
{
    if (typeof msg == "string") msg = { status: typeof status == "number" ? status : 400, message: msg };
    var err = new Error(msg && msg.message || this.__("Internal error occurred, please try again later"));
    for (const p in msg) err[p] = msg[p];
    if (!err.status) err.status = 400;
    if (code) err.code = code;
    return err;
}

// Returns the error stack or the error itself, to be used in error messages
lib.traceError = function(err)
{
    return this.objDescr(err || "", { ignore: /^domain|req|res$/ }) + " " + (util.isError(err) && err.stack ? err.stack : "");
}

// Load a file with locale translations into memory
lib.loadLocale = function(file, callback)
{
    fs.readFile(file, function(err, data) {
        if (!err) {
            var d = lib.jsonParse(data.toString(), { logger: "error" });
            if (d) lib.locales[path.basename(file, ".json")] = d;
        }
        logger[err && err.code != "ENOENT" ? "error" : "debug"]("loadLocale:", file, err);
        if (typeof callback == "function") callback(err, d);
    });
}

// Run the process and return all output to the callback, this a simply wrapper around child_processes.exec so the lib.runProcess
// can be used without importing the child_processes module. All fatal errors are logged.
lib.execProcess = function(cmd, callback)
{
    return child.exec(cmd, (err, stdout, stderr) => {
        logger.debug('execProcess:', cmd, err, stderr);
        lib.tryCall(callback, err, typeof stdout == "string" ? stdout : "", typeof stderr == "string" ? stderr : "");
    });
}

// Return a list of matching processes, Linux only
lib.findProcess = function(options, callback)
{
    if (os.platform() == "linux") {
        lib.findFile("/proc", { include: /^\/proc\/[0-9]+$/, exclude: new RegExp("^/proc/" + process.pid + "$"), depth: 0, base: 1 }, (err, files) => {
            if (!err) {
                files = files.map((x) => ({ pid: x, cmd: lib.readFileSync(`/proc/${x}/cmdline`).replace(/\0/g," ").trim() })).
                        filter((x) => (options.filter ? x.cmd.match(options.filter) : x.cmd));
            }
            callback(err, files);
        });
    } else {
        lib.execProcess("/bin/ps agx -o pid,args", (err, stdout, stderr) => {
            var list = stdout.split("\n").
                              filter((x) => (lib.toNumber(x) != process.pid && (options.filter ? x.match(options.filter) : 1))).
                              map((x) => ({ pid: lib.toNumber(x), cmd: x.replace(/^[0-9]+/, "").trim() }));

            callback(err, list);
        });
    }
}

// Run specified command with the optional arguments, this is similar to child_process.spawn with callback being called after the process exited
//
//  Example
//
//          lib.spawProcess("ls", "-ls", { cwd: "/tmp" }, lib.log)
//
lib.spawnProcess = function(cmd, args, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = { stdio: "inherit", env: process.env, cwd: process.cwd() };
    if (!options.stdio) options.stdio = "inherit";
    if (!Array.isArray(args)) args = [ args ];
    var proc = child.spawn(cmd, args, options);
    proc.on("error", function(err) {
        logger.error("spawnProcess:", cmd, args, err);
        lib.tryCall(callback, err);
    });
    proc.on('exit', function (code, signal) {
        logger.debug("spawnProcess:", cmd, args, "exit", code || signal);
        lib.tryCall(callback, code || signal);
    });
    return proc;
}

// If respawning too fast, delay otherwise call the callback after a short timeout
lib.checkRespawn = function(callback)
{
    if (this.exiting) return;
    var now = Date.now();
    logger.debug('checkRespawn:', this.respawn, now - this.respawn.time);
    if (this.respawn.time && now - this.respawn.time < this.respawn.interval) {
        if (this.respawn.count && this.respawn.events >= this.respawn.count) {
            logger.log('checkRespawn:', 'throttling for', this.respawn.delay, 'after', this.respawn.events, 'respawns');
            this.respawn.events = 0;
            this.respawn.time = now;
            return setTimeout(callback, this.respawn.delay);
        }
        this.respawn.events++;
    } else {
        this.respawn.events = 0;
    }
    this.respawn.time = now;
    setTimeout(callback, this.respawn.timeout);
}

// Run a series of commands, `cmds` is an object where a property name is a command to execute and the value is an array of arguments or null.
// if `options.error` is 1, then stop on first error or if non-zero status on a process exit.
//
//  Example:
//
//          lib.spawnSeries({"ls": "-la",
//                            "ps": "augx",
//                            "du": { argv: "-sh", stdio: "inherit", cwd: "/tmp" },
//                            "uname": ["-a"] },
//                           lib.log)
//
lib.spawnSeries = function(cmds, options, callback)
{
    if (typeof options == "function") callback = options, options = null;
    if (!options) options = { stdio: "inherit", env: process.env, cwd: process.cwd };
    this.forEachSeries(Object.keys(cmds), function(cmd, next) {
        var argv = cmds[cmd], opts = options;
        switch (lib.typeName(argv)) {
        case "null":
            argv = [];
            break;

        case "object":
            opts = argv;
            argv = opts.argv;
            break;

        case "array":
        case "string":
            break;

        default:
            logger.error("spawnSeries:", "invalid arguments", cmd, argv);
            return next(options.error ? lib.newError("invalid args", cmd) : null);
        }
        if (!options.stdio) options.stdio = "inherit";
        if (typeof argv == "string") argv = [ argv ];
        lib.spawnProcess(cmd, argv, opts, function(err) {
            next(options.error ? err : null);
        });
    }, callback);
}

// Returns current time in microseconds
lib.clock = function()
{
    return bkutils.getTimeOfDay();
}

// Return number of seconds for current time
lib.now = function()
{
    return Math.round(Date.now()/1000);
}

// Return an ISO week number for given date, from https://www.epochconverter.com/weeknumbers
lib.weekOfYear = function(date, utc)
{
    date = this.toDate(date, null);
    if (!date) return 0;
    utc = utc ? "UTC": "";
    var target = new Date(date.valueOf());
    target[`set${utc}Date`](target[`get${utc}Date`]() - ((date[`get${utc}Day`]() + 6) % 7) + 3);
    var firstThursday = target.valueOf();
    target[`set${utc}Month`](0, 1);
    var day = target[`get${utc}Day`]();
    if (day != 4) target[`set${utc}Month`](0, 1 + ((4 - day) + 7) % 7);
    return 1 + Math.ceil((firstThursday - target) / 604800000);
}

// Returns true if the given date is in DST timezone
lib.isDST = function(date)
{
    var jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
    var jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
    return Math.max(jan, jul) != date.getTimezoneOffset();
}

// Return a timezone human name if matched (EST, PDT...), tz must be in GMT-NNNN format
lib.tzName = function(tz)
{
    if (!tz || typeof tz != "string") return "";
    var t = tz.indexOf(":") > 0 ? tz.replace(":", "") : tz;
    for (const i in this.tzMap) {
        if (t == this.tzMap[i][1]) return this.tzMap[i][0];
    }
    return tz;
}

// Returns 0 if the current time is not within specified valid time range or it is invalid. Only continious time rang eis support, it
// does not handle over the midninght ranges, i.e. time1 is always must be greater than time2.
//
// `options.tz` to specify timezone, no timezone means current timezone.
// `options.date` if given must be a list of dates in the format: YYY-MM-DD,...
lib.isTimeRange = function(time1, time2, options)
{
    if (!time1 && !time2) return 0;
    var now = new Date(), tz = options && options.tz;
    if (tz === "GMT" || tz === "UTC") {
        tz = 0;
    } else {
        tz = typeof tz == "string" && tz.match(/GMT(-|\+)?([0-9]{2}):?([0-9]{2})/);
        if (tz) tz = (parseInt(tz[2], 10) * 3600000 + parseInt(tz[3], 10) * 60000) * (tz[1] == "+" ? 1 : -1);
        if (!tz) tz = now.getTimezoneOffset() * -60000;
    }
    now = new Date(now.getTime() + tz);
    if (options && options.date) {
        if (lib.strftime(now, "%Y-%m-%d") != lib.strftime(lib.toDate(options.date), "%Y-%m-%d")) return 0;
    }
    var h0 = now.getUTCHours();
    var m0 = now.getUTCMinutes();
    if (time1) {
        const d = String(time1).match(/^(([0-9]+)|([0-9]+):([0-9]+)) *(am|AM|pm|PM)?$/);
        if (!d) return 0;
        let h1 = lib.toNumber(d[2] || d[3]);
        const m1 = lib.toNumber(d[4]);
        switch (d[5]) {
        case "am":
        case "AM":
            if (h1 >= 12) h1 -= 12;
            break;
        case "pm":
        case "PM":
            if (h1 < 12) h1 += 12;
            break;
        }
        logger.debug("isTimeRange:", "start:", h0, m0, " - ", h1, m1, d[5], "tz:", tz, "now:", now);
        if (h0*100+m0 < h1*100+m1) return 0;
    }
    if (time2) {
        const d = String(time2).match(/^(([0-9]+)|([0-9]+):([0-9]+)) *(am|AM|pm|PM)?$/);
        if (!d) return 0;
        let h1 = lib.toNumber(d[2] || d[3]);
        const m1 = lib.toNumber(d[4]);
        switch (d[5]) {
        case "am":
        case "AM":
            if (h1 > 12) h1 -= 12;
            break;
        case "pm":
        case "PM":
            if (h1 <= 12) h1 += 12;
            break;
        }
        logger.debug("isTimeRange:", "end:", h0, m0, " - ", h1, m1, d[5], "tz:", tz, "now:", now);
        if (h0*100+m0 > h1*100+m1) return 0;
    }
    return 1;
}

// Return object type, try to detect any distinguished type
lib.typeName = function(v)
{
    if (v === null) return "null";
    var t = typeof(v);
    if (t === "object") {
        switch (v.constructor && v.constructor.name) {
        case "Array":
        case "Buffer":
        case "Date":
        case "Error":
        case "RegExp":
            return v.constructor.name.toLowerCase();
        }
    }
    return t;
}

// Returns true of the argument is a generic object, not a null, Buffer, Date, RegExp or Array
lib.isObject = function(v)
{
    return this.typeName(v) === "object";
}

// Return true if the value is a number
lib.isNumber = function(val)
{
    return typeof val === "number" && !isNaN(val);
}

// Return true if the value is prefixed
lib.isPrefix = function(val, prefix)
{
    return typeof prefix == "string" && prefix &&
           typeof val == "string" && val.substr(0, prefix.length) == prefix;
}

// Returns true if the value represents an UUID
lib.isUuid = function(val, prefix)
{
    if (this.rxUuid.test(val)) {
        if (typeof prefix == "string" && prefix) {
            if (val.substr(0, prefix.length) != prefix) return false;
        }
        return true;
    }
    return false;
}

// Returns true if the value represent tuuid
lib.isTuuid = function(str)
{
    if (typeof str != "string" || !str) return 0;
    var idx = str.indexOf("_");
    if (idx > 0) str = str.substr(idx + 1);
    var bytes = Buffer.from(str, 'hex');
    if (bytes.length != 15) return 0;
    return 1;
}

// Returns true of a string contains Unicode characters
lib.isUnicode = function(str)
{
    return /[\u007F-\uFFFF]/g.test(str);
}

// Returns true if a number is positive, i.e. greater than zero
lib.isPositive = function(val)
{
    return this.isNumber(val) && val > 0;
}

// Returns the array if the value is non empty array or dflt value if given or undefined
lib.isArray = function(val, dflt)
{
    return Array.isArray(val) && val.length ? val : dflt;
}

// Return true of the given value considered empty
lib.isEmpty = function(val)
{
    switch (this.typeName(val)) {
    case "null":
    case "undefined":
        return true;
    case "buffer":
    case "array":
        return val.length == 0;
    case "number":
    case "date":
        return isNaN(val);
    case "regexp":
    case "boolean":
    case "function":
        return false;
    case "object":
        for (const p in val) return false;
        return true;
    case "string":
        return this.rxEmpty.test(val) ? true : false;
    default:
        return val ? false: true;
    }
}

// Returns true if the value is a number or string representing a number
lib.isNumeric = function(val)
{
    if (typeof val == "number") return true;
    if (typeof val != "string") return false;
    return this.rxNumber.test(val);
}

// Returns true if the given type belongs to the numeric family of data types
lib.isNumericType = function(type)
{
    return type && this.rxNumericType.test(String(type).trim());
}

// Returns true if the given date is valid
lib.isDate = function(d)
{
    return util.isDate(d) && !isNaN(d.getTime());
}

// Returns true if `name` exists in the array `list`, search is case sensitive. if `name` is an array it will return true if
// any element in the array exists in the `list`.
lib.isFlag = function(list, name)
{
    return Array.isArray(list) && (Array.isArray(name) ? name.some(function(x) { return list.indexOf(x) > -1 }) : list.indexOf(name) > -1);
}

// Returns first valid number from the list of arguments or 0
lib.validNum = function(...args)
{
    for (const i in args) {
        if (this.isNumber(args[i])) return args[i];
    }
    return 0;
}

// Returns first valid positive number from the list of arguments or 0
lib.validPositive = function(...args)
{
    for (const i in args) {
        if (this.isPositive(args[i])) return args[i];
    }
    return 0;
}

// Returns first valid boolean from the list of arguments or false
lib.validBool = function(...args)
{
    for (const i in args) {
        if (typeof args[i] == "boolean") return args[i];
    }
    return false;
}


