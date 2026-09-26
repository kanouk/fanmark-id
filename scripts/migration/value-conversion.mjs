// Input values come from PostgreSQL text projections, not JSON numeric fields.
// SQL NULL is represented by null; the literal strings "null" and "" stay distinct.
const integerPattern = /^-?(?:0|[1-9]\d*)$/;
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const invalid = (kind) => { throw new Error(`invalid_or_unsupported_${kind}`); };

function integer(value, min, max) {
  if (!integerPattern.test(value)) return invalid('integer');
  const exact = BigInt(value);
  if (exact < min || exact > max) return invalid('integer_range');
  if (exact < BigInt(Number.MIN_SAFE_INTEGER) || exact > BigInt(Number.MAX_SAFE_INTEGER)) return invalid('unsafe_integer');
  return Number(exact);
}

export function moneyCents(value) {
  if (typeof value !== 'string') return invalid('money_source');
  const match = /^(-?)(\d{1,8})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return invalid('numeric_10_2');
  const magnitude = BigInt(match[2])*100n + BigInt((match[3] ?? '').padEnd(2,'0'));
  return Number(match[1] === '-' ? -magnitude : magnitude);
}

export function utcMicroseconds(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value) || value.startsWith('0000')) return invalid('utc_microseconds');
  // Date validates only whole seconds. The six-digit fraction is never passed
  // through Date and remains byte-for-byte intact in the returned source text.
  const wholeSeconds = `${value.slice(0,19)}.000Z`;
  const parsed = new Date(wholeSeconds);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== wholeSeconds) return invalid('utc_microseconds');
  return value;
}

export function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalid('calendar_date');
  utcMicroseconds(`${value}T00:00:00.000000Z`);
  return value;
}

function uuid(value) {
  if (!uuidPattern.test(value)) return invalid('uuid');
  return value.toLowerCase();
}

function parseJson(value) {
  try { return JSON.parse(value); } catch { return invalid('json'); }
}

function assertJsonNumbers(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) return invalid('json_numeric_range');
  } else if (Array.isArray(value)) {
    value.forEach(assertJsonNumbers);
  } else if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(assertJsonNumbers);
  }
}

function jsonArray(value, elementType) {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return invalid('array');
  const converted = parsed.map(element => {
    if (element === null) return null;
    if (elementType === 'text' && typeof element === 'string') return element;
    if (elementType === 'uuid' && typeof element === 'string') return uuid(element);
    if (elementType === 'smallint' && typeof element === 'number' && Number.isInteger(element)) return integer(String(element),-32768n,32767n);
    return invalid('array_element');
  });
  // The source exporter must also record/prove ndim <= 1 and lower bound 1.
  // JSON alone cannot represent PostgreSQL non-default array lower bounds.
  return JSON.stringify(converted);
}

const supportedTypes = new Set(['text','uuid','boolean','smallint','integer','bigint','numeric(10,2)','numeric','timestamp with time zone','date','jsonb','text[]','uuid[]','smallint[]']);

export function convertPgText(type, value) {
  if (!supportedTypes.has(type)) return invalid('type');
  if (value === null) return null;
  if (typeof value !== 'string') return invalid('text_source');
  switch(type) {
    case 'text': return value;
    case 'uuid': return uuid(value);
    case 'boolean':
      if (value === 't' || value === 'true') return 1;
      if (value === 'f' || value === 'false') return 0;
      return invalid('boolean');
    case 'smallint': return integer(value,-32768n,32767n);
    case 'integer': return integer(value,-2147483648n,2147483647n);
    case 'bigint': return integer(value,-9223372036854775808n,9223372036854775807n);
    case 'numeric(10,2)': return moneyCents(value);
    case 'numeric':
      if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return invalid('numeric');
      return value;
    case 'timestamp with time zone': return utcMicroseconds(value);
    case 'date': return calendarDate(value);
    case 'jsonb':
      assertJsonNumbers(parseJson(value));
      return value; // Validate without reserializing and rounding decimal digits.
    case 'text[]': return jsonArray(value,'text');
    case 'uuid[]': return jsonArray(value,'uuid');
    case 'smallint[]': return jsonArray(value,'smallint');
    default: return invalid('type');
  }
}
