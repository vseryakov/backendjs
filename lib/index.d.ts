
export interface ConfigOptions {
    name: string;
    descr: string;
    type?: string;
    obj?: string;
    make?: string;
    array?: boolean;
    push?: boolean;
    pass?: number;
    env?: string;
    merge?: boolean;
    dot?: boolean;
    map_type?: string;
    name_type?: string;
    same_type?: boolean;
    no_value?: string | string[];
    sort?: boolean;
    unique?: boolean;
    camel?: string;
    no_camel?: boolean;
    not_empty?: boolean;
    empty?: boolean;
    auto_type?: boolean | Record<string, string>;
    example?: string;
    callback?: (value: any, obj: ConfigOptions) => void;
    onupdate?: string | ((value: any, obj: ConfigOptions) => void);
    separator?: string;
    delimiter?: string;
    ephemeral?: boolean;
    strip?: string;
    once?: boolean;
    existing?: boolean;
    nreplace?: Record<string, string>;
    vreplace?: Record<string, string>;
}

export interface DbRequestOptions {
    pool?: string;
    tryCatch?: boolean | ((err: Error, ...args: any[]) => void);
    logger_db?: string;
    logger_error?: string;
    ignore_error?: RegExp | string[];
    noprocessrows?: boolean;
    noconvertrows?: boolean;
    nopreparequery?: boolean;
    total?: boolean;
    info_query?: boolean;
    result_query?: boolean;
    returning?: string;
    cached?: boolean;
    nocache?: boolean;
    ops?: Record<string, string>;
    typesOps?: Record<string, string>;
    select?: string | string[];
    start?: string | number | Record<string, any>;
    page?: number;
    count?: number;
    first?: boolean;
    last?: boolean;
    join?: string;
    joinOps?: Record<string, string>;
    sort?: string | string[] | Record<string, any> | Record<string, any>[];
    desc?: boolean;
    cacheKey?: string;
    cacheKeyName?: string;
    no_columns?: boolean;
    query?: Record<string, any>;
    upsert?: boolean;
    useCapacity?: string;
    factorCapacity?: number;
    tableCapacity?: string;
    capacity?: Record<string, any>;
    batch?: boolean;
    sync?: boolean;
    concurrency?: number;
    limit?: number;
    noscan?: boolean;
    fullscan?: boolean;
    syncMode?: boolean;
}

export interface DbResultInfo {
    inserted_oid?: string;
    affected_rows?: number;
    next_token?: string | number | Record<string, any>;
    consumed_capacity?: number;
}

export type DbResultCallback<T = Record<string, any>> = (
    err: Error | null,
    rows: T[],
    info?: DbResultInfo
) => void;

export interface DbRequestColumn {
    name: string;
    type: DbColumnType;
    op: string;
    value: any;
    join: string;
    alias: string;
    col?: DbTableColumn;
}

export interface DbTable {
    [name: string]: DbTableColumn | Record<string, any> | undefined;
    _$db?: Record<string, any>;
    _$sqlite?: Record<string, any>;
    _$pg?: Record<string, any>;
    _$dynamodb?: Record<string, any>;
    _$elasticsearch?: Record<string, any>;
}

export type DbColumnType =
    | "int"
    | "bigint"
    | "long"
    | "real"
    | "float"
    | "number"
    | "bool"
    | "boolean"
    | "text"
    | "varchar"
    | "str"
    | "string"
    | "keyword"
    | "date"
    | "time"
    | "timestamp"
    | "mtime"
    | "json"
    | "obj"
    | "object"
    | "array"
    | "list"
    | "set"
    | "random"
    | "uuid"
    | "suuid"
    | "sfuuid"
    | "now"
    | "counter";

export interface DbTableColumn {
    type?: DbColumnType;
    primary?: number;
    index?: number;
    [index: `index${number}`]: number | undefined;
    value?: any;
    dflt?: any;
    keyword?: boolean;
    read_only?: boolean;
    prefix?: string;
    join?: string[];
    separator?: string;

    length?: number;
    not_null?: boolean;
    auto?: boolean;
    unique?: boolean;

    foreign?: {
        table: string;
        name: string;
        on_delete?: string;
        custom?: string;
    };

    split?: Record<string, any>;

    convert?: {
        lower?: boolean;
        upper?: boolean;
        cap?: boolean;
        strip?: RegExp;
        replace?: RegExp;
        trim?: boolean;
        multiplier?: number;
        increment?: number | string;
        decimal?: number;
        epoch?: boolean;
        clock?: boolean;
        format?: (val: any, req: Record<string, any>) => any;
    };

    validate?: {
        max?: number;
        max_list?: number;
        trunc?: boolean;
        skip_empty?: boolean;
        not_empty?: boolean;
    };

    cleanup?: boolean | {
        roles?: string[];
        no_roles?: string[];
    };

    _$db?: string | Record<string, any>;
    _$sqlite?: string | Record<string, any>;
    _$pg?: string | Record<string, any>;
    _$dynamodb?: Record<string, any>;
    _$elasticsearch?: Record<string, any>;
}

export interface DbConfigOptions {
    typesMap?: Record<string, string>;
    opsMap?: Record<string, string>;
    features?: {
        multi?: boolean | number;
        ifexists?: boolean | number;
        auto?: boolean | number;
        not_null?: boolean | number;
        [name: string]: boolean | number | undefined;
    };
}
