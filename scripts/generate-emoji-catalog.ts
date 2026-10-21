import { promises as fs } from "fs";
import path from "path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const INPUT_PATH = path.resolve("data/emoji/emoji-master.json");
const OUTPUT_PATH = path.resolve("src/data/emojiCatalog.ts");

import { generateCatalog, generateModuleSource, validateRecords } from "./emoji-catalog-core.ts";
import type { EmojiMasterRecord } from "./emoji-catalog-core.ts";
export { generateCatalog, generateModuleSource, validateRecords } from "./emoji-catalog-core.ts";
export type { EmojiMasterRecord } from "./emoji-catalog-core.ts";

export function parseArguments(argv: string[]) {
  let input: string | undefined;
  let output = OUTPUT_PATH;
  let outputSeen = false;
  for (let i = 0; i < argv.length; i++) {
    const option = argv[i];
    const value = argv[++i];
    if (!value || value.startsWith("--")) throw new Error("Expected a path after --input or --output");
    if (option === "--input" && input === undefined) input = path.resolve(value);
    else if (option === "--output" && !outputSeen) { output = path.resolve(value); outputSeen = true; }
    else throw new Error("Unknown or repeated catalog option");
  }
  if (input === output) throw new Error("Input and output paths must differ");
  return { input, output };
}

export const main = async (argv = process.argv.slice(2)) => {
  const { input, output } = parseArguments(argv);

  const jsonRaw = await fs.readFile(input ?? INPUT_PATH, "utf-8");
  const parsed: unknown = JSON.parse(jsonRaw);
  validateRecords(parsed);
  const records: EmojiMasterRecord[] = parsed;

  const catalog = generateCatalog(records);
  const moduleSource = generateModuleSource(catalog);

  await fs.mkdir(path.dirname(output), { recursive: true });
  const temporary = `${output}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, moduleSource, { encoding: "utf-8", flag: "wx" });
    await fs.rename(temporary, output);
  } finally {
    await fs.rm(temporary, { force: true });
  }

  console.log(`Emoji catalog generated: ${path.relative(process.cwd(), output)}`);
  console.log(`Entries: ${catalog.entries.length}`);
};

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main().catch((error) => {
  console.error("Failed to generate emoji catalog:", error);
  process.exit(1);
});
