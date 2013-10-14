--
-- Generic SQL functions
--

--
-- Concatenates 2 strings unless the first string already contains exact copy of the second one
--
CREATE OR REPLACE FUNCTION str_concat(VARCHAR, VARCHAR, VARCHAR DEFAULT ' ') RETURNS VARCHAR STABLE AS $$
DECLARE
    str VARCHAR;
BEGIN
    IF $2 IS NULL THEN RETURN $1; END IF;
    IF $1 IS NULL THEN RETURN $2; END IF;
    IF POSITION($2 IN $1) > 0 THEN RETURN $1; END IF;
    RETURN $1||COALESCE($3,'')||$2;
END;$$ LANGUAGE plpgsql;

--
-- Split string into array using regexp as second parameter, default separator is comma.
--
CREATE OR REPLACE FUNCTION str_split(VARCHAR, VARCHAR DEFAULT ',') RETURNS TEXT[] STABLE AS $$
    SELECT ARRAY_AGG(DISTINCT TRIM(term)) AS term FROM (SELECT REGEXP_SPLIT_TO_TABLE($1, $2) AS term) t WHERE term IS NOT NULL AND term<>'';
$$ LANGUAGE SQL;

--
-- Return canonical date time string
--
CREATE OR REPLACE FUNCTION str_timestamp(str text) RETURNS TEXT AS $$
    var rc = null;
    try { rc = (new Date(str)).toISOString() } catch(e) { rc = null }
    return rc;
$$ LANGUAGE plv8 IMMUTABLE STRICT;

