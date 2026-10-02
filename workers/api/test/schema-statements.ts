// Trusted checked-in migrations only. Quoted literals/comments do not contribute
// BEGIN/CASE/END tokens; trigger body semicolons stay in the same statement.
export function checkedInSqlStatements(sql: string): string[] {
  const result: string[] = [];
  let start = 0;
  let depth = 0;
  let trigger = false;
  let words: string[] = [];
  for (const token of sql.matchAll(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|[A-Za-z_]\w*|;/gu)) {
    const value = token[0];
    if (/^(?:--|\/\*|'|")/u.test(value)) continue;
    const word = value.toUpperCase();
    if (word !== ";") {
      words.push(word);
      if (words[0] === "CREATE" && word === "TRIGGER") trigger = true;
      if (trigger && (word === "BEGIN" || word === "CASE")) depth += 1;
      if (trigger && word === "END") depth -= 1;
    } else if (depth === 0) {
      const statement = sql.slice(start, token.index).trim();
      if (statement.replace(/--[^\n]*/gu, "").trim()) result.push(statement);
      start = token.index! + 1;
      words = [];
      trigger = false;
    }
  }
  if (sql.slice(start).replace(/--[^\n]*/gu, "").trim()) throw new Error("Incomplete fixture SQL");
  return result;
}

