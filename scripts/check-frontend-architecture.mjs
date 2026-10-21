import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const CAPABILITIES = new Set(['VITE_BROADCAST_SEND_BACKEND', 'VITE_BROADCAST_TEST_SEND_BACKEND', 'VITE_ADMIN_DATA_RESET_BACKEND']);

export function frontendViolations(source, filename = 'fixture.tsx') {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const errors = [];
  function visit(node) {
    const module = ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
      ? node.moduleSpecifier
      : ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        ts.isIdentifier(node.expression) && node.expression.text === 'require')
        ? node.arguments[0] : undefined;
    if (module && ts.isStringLiteral(module) && /supabase|(?:^|\/)data\/emojiCatalog(?:\.|$)/iu.test(module.text)) {
      errors.push('retired frontend dependency: ' + module.text);
    }
    if (ts.isPropertyAccessExpression(node) && /VITE_.*_BACKEND/u.test(node.name.text) &&
        !CAPABILITIES.has(node.name.text)) errors.push('retired backend selector: ' + node.name.text);
    ts.forEachChild(node, visit);
  }
  visit(file);
  return errors;
}

export async function checkFrontendArchitecture(root = fileURLToPath(new URL('../', import.meta.url))) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(filename);
      else if (/\.tsx?$/u.test(filename) && !filename.endsWith('.test.ts')) files.push(filename);
    }
  }
  await walk(path.join(root, 'src'));
  const violations = [];
  for (const filename of files) {
    for (const message of frontendViolations(await readFile(filename, 'utf8'), filename)) {
      violations.push(path.relative(root, filename) + ': ' + message);
    }
  }
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (manifest.dependencies?.['@supabase/supabase-js']) violations.push('retired Supabase frontend dependency');
  if (violations.length) throw new Error(violations.join('\n'));
  return { frontendFiles: files.length, retiredDependencies: 0, retiredBackendSelectors: 0 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await checkFrontendArchitecture()));
}
