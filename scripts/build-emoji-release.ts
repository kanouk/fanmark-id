import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { generateCatalog, generateModuleSource, validateRecords } from './generate-emoji-catalog.ts';
import type { EmojiMasterRecord } from './generate-emoji-catalog.ts';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
};

// Existing IDs are references held by licenses, favorites, and discovery rows.
// A catalog release cannot remove or reassign them, even if Unicode changes.
export function assertIdentityContinuity(previous: EmojiMasterRecord[], next: EmojiMasterRecord[]) {
  validateRecords(previous);
  validateRecords(next);
  const byId = new Map(next.map(record => [record.id, record]));
  for (const old of previous) {
    const current = byId.get(old.id);
    if (!current || current.emoji !== old.emoji || canonical(current.codepoints) !== canonical(old.codepoints)) {
      throw new Error('Catalog release removes or reassigns an existing emoji identity');
    }
  }
}

function artifacts(records: EmojiMasterRecord[]) {
  validateRecords(records);
  // Sorting by UUID makes the source digest independent of DB result order.
  // sort_order is preserved and still controls the generated frontend catalog.
  const sorted = records.map(({id,emoji,short_name,keywords,category,subcategory,codepoints,sort_order}) =>
    ({id,emoji,short_name,keywords,category,subcategory,codepoints,sort_order})
  ).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const recordsSource = `${canonical(sorted)}\n`;
  const moduleSource = generateModuleSource(generateCatalog(sorted));
  const manifest = {
    schemaVersion: 1,
    recordsSHA256: digest(recordsSource),
    moduleSHA256: digest(moduleSource),
    identitySHA256: digest(canonical(sorted.map(({id,emoji,codepoints}) => ({id,emoji,codepoints})))),
    entryCount: sorted.length,
  };
  return {recordsSource,moduleSource,manifest,version:digest(canonical(manifest))};
}

export function createEmojiReleaseArtifacts(records: unknown) {
  validateRecords(records);
  const built = artifacts(records);
  return {
    records: JSON.parse(built.recordsSource) as EmojiMasterRecord[],
    recordsSource: built.recordsSource,
    moduleSource: built.moduleSource,
    manifest: {...built.manifest,version:built.version},
    version: built.version,
  };
}

export async function verifyRelease(directory: string) {
  const manifest = JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8'));
  const recordsSource = await fs.readFile(path.join(directory,'records.json'),'utf8');
  const records: unknown = JSON.parse(recordsSource);
  const expected = createEmojiReleaseArtifacts(records);
  const moduleSource = await fs.readFile(path.join(directory,'emojiCatalog.ts'),'utf8');
  if (canonical(manifest) !== canonical(expected.manifest) ||
      recordsSource !== expected.recordsSource || moduleSource !== expected.moduleSource) {
    throw new Error('Emoji release integrity or version mismatch');
  }
  return {version:expected.version,records};
}

export async function buildRelease(input: string, releasesDirectory: string, previousDirectory?: string) {
  const records: unknown = JSON.parse(await fs.readFile(input,'utf8'));
  validateRecords(records);
  if (previousDirectory) {
    const previous = await verifyRelease(previousDirectory);
    assertIdentityContinuity(previous.records,records);
  }
  const built = createEmojiReleaseArtifacts(records);
  await fs.mkdir(releasesDirectory,{recursive:true});
  const target = path.join(releasesDirectory,built.version);
  let exists = false;
  try {
    await fs.lstat(target);
    exists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (exists) {
    const existing = await verifyRelease(target);
    if (existing.version !== built.version) throw new Error('Release directory contains a different version');
    return {directory:target,version:built.version};
  }
  const staging = path.join(releasesDirectory,`.staging-${randomUUID()}`);
  await fs.mkdir(staging,{mode:0o700});
  try {
    await fs.writeFile(path.join(staging,'records.json'),built.recordsSource,{flag:'wx'});
    await fs.writeFile(path.join(staging,'emojiCatalog.ts'),built.moduleSource,{flag:'wx'});
    await fs.writeFile(path.join(staging,'manifest.json'),JSON.stringify(built.manifest,null,2)+'\n',{flag:'wx'});
    await verifyRelease(staging);
    // Only a complete verified directory receives the immutable version name.
    await fs.rename(staging,target);
  } finally {
    await fs.rm(staging,{recursive:true,force:true});
  }
  return {directory:target,version:built.version};
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [input,output,previous,...extra] = process.argv.slice(2);
  if (!input || !output || extra.length) {
    console.error('Usage: build-emoji-release.ts UUID_RECORDS_JSON RELEASES_DIRECTORY [PREVIOUS_RELEASE_DIRECTORY]');
    process.exitCode=1;
  } else {
    buildRelease(input,output,previous).then(result => console.log(JSON.stringify(result))).catch(() => {
      console.error('Emoji release validation/build failed; no release was activated.');
      process.exitCode=1;
    });
  }
}
