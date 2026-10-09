/**
 * Opt-in workaround for D1 /query's case-sensitive trigger BEGIN splitter.
 * Input must already be a valid, single SQLite CREATE TRIGGER definition.
 * Preserve literals, identifiers, comments and all bytes except that keyword.
 * The transport itself deliberately continues to send arbitrary SQL unchanged.
 */
export function prepareD1RestTriggerDefinition(sql) {
  const refuse = () => { throw new Error('remote_trigger_definition_unsupported'); };
  if (typeof sql !== 'string' || !sql.trim()) refuse();
  const tokens = [];
  let i = 0;
  while (i < sql.length) {
    if (/\s/u.test(sql[i])) { i += 1; continue; }
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i + 2);
      i = end < 0 ? sql.length : end + 1;
      continue;
    }
    if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      if (end < 0) refuse();
      i = end + 2;
      continue;
    }
    const start = i;
    if (['\'', '"', '`', '['].includes(sql[i])) {
      const close = sql[i] === '[' ? ']' : sql[i];
      i += 1;
      let closed = false;
      while (i < sql.length) {
        if (sql[i] !== close) { i += 1; continue; }
        if (close !== ']' && sql[i + 1] === close) { i += 2; continue; }
        i += 1; closed = true; break;
      }
      if (!closed) refuse();
      tokens.push({ kind: 'quoted', start, end: i });
    } else if (/[A-Za-z_]/u.test(sql[i])) {
      i += 1;
      while (i < sql.length && /[A-Za-z0-9_$]/u.test(sql[i])) i += 1;
      tokens.push({ kind: 'word', value: sql.slice(start, i).toUpperCase(), start, end: i });
    } else {
      tokens.push({ kind: 'punctuation', value: sql[i], start, end: ++i });
    }
  }
  if (tokens[0]?.value !== 'CREATE' || tokens[1]?.value !== 'TRIGGER') refuse();
  const begins = tokens.filter(token => token.kind === 'word' && token.value === 'BEGIN');
  if (begins.length !== 1) refuse();
  const last = tokens.at(-1)?.value === ';' ? tokens.at(-2) : tokens.at(-1);
  if (last?.kind !== 'word' || last.value !== 'END') refuse();
  const begin = begins[0];
  return sql.slice(0, begin.start) + 'BEGIN' + sql.slice(begin.end);
}
