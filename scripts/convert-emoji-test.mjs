#!/usr/bin/env node
import { promises as fs } from "fs";
import path from "path";
import process from "process";

const DEFAULT_INPUT = path.resolve("data/emoji/emoji-test.txt");
const DEFAULT_OUTPUT_JSON = path.resolve("data/emoji/emoji-master.json");
const DEFAULT_OUTPUT_CSV = path.resolve("data/emoji/emoji-master.csv");
const ALLOWED_STATUSES = new Set(["fully-qualified"]);
const FE_VARIATION_SELECTOR = "FE0F";
const EMOJI_VARIATION_PATH = path.resolve("data/emoji/emoji-variation-sequences.txt");
const DEFAULT_EMOJI_STYLE_OVERRIDES = [
  { base: "26AA", emoji: "⚪️", codepoints: ["26AA", FE_VARIATION_SELECTOR] },
  { base: "26AB", emoji: "⚫️", codepoints: ["26AB", FE_VARIATION_SELECTOR] },
  { base: "2660", emoji: "♠️", codepoints: ["2660", FE_VARIATION_SELECTOR] },
  { base: "2663", emoji: "♣️", codepoints: ["2663", FE_VARIATION_SELECTOR] },
  { base: "2665", emoji: "♥️", codepoints: ["2665", FE_VARIATION_SELECTOR] },
  { base: "2666", emoji: "♦️", codepoints: ["2666", FE_VARIATION_SELECTOR] },
  { base: "2702", emoji: "✂️", codepoints: ["2702", FE_VARIATION_SELECTOR] },
  { base: "2708", emoji: "✈️", codepoints: ["2708", FE_VARIATION_SELECTOR] },
  { base: "2709", emoji: "✉️", codepoints: ["2709", FE_VARIATION_SELECTOR] },
  { base: "270F", emoji: "✏️", codepoints: ["270F", FE_VARIATION_SELECTOR] },
  { base: "2712", emoji: "✒️", codepoints: ["2712", FE_VARIATION_SELECTOR] },
  { base: "2714", emoji: "✔️", codepoints: ["2714", FE_VARIATION_SELECTOR] },
  { base: "2716", emoji: "✖️", codepoints: ["2716", FE_VARIATION_SELECTOR] },
  { base: "2728", emoji: "✨", codepoints: ["2728", FE_VARIATION_SELECTOR] },
  { base: "2733", emoji: "✳️", codepoints: ["2733", FE_VARIATION_SELECTOR] },
  { base: "2744", emoji: "❄️", codepoints: ["2744", FE_VARIATION_SELECTOR] },
  { base: "2747", emoji: "❇️", codepoints: ["2747", FE_VARIATION_SELECTOR] },
  { base: "2764", emoji: "❤️", codepoints: ["2764", FE_VARIATION_SELECTOR] },
  { base: "2795", emoji: "➕", codepoints: ["2795", FE_VARIATION_SELECTOR] },
  { base: "2796", emoji: "➖", codepoints: ["2796", FE_VARIATION_SELECTOR] },
  { base: "2797", emoji: "➗", codepoints: ["2797", FE_VARIATION_SELECTOR] },
  { base: "27A1", emoji: "➡️", codepoints: ["27A1", FE_VARIATION_SELECTOR] },
  { base: "2B05", emoji: "⬅️", codepoints: ["2B05", FE_VARIATION_SELECTOR] },
  { base: "2B06", emoji: "⬆️", codepoints: ["2B06", FE_VARIATION_SELECTOR] },
  { base: "2B07", emoji: "⬇️", codepoints: ["2B07", FE_VARIATION_SELECTOR] },
  { base: "2B55", emoji: "⭕️", codepoints: ["2B55", FE_VARIATION_SELECTOR] },
];

function printUsage() {
  console.log(`Usage: node scripts/convert-emoji-test.mjs [options]

Options:
  --input <path>    Path to emoji-test.txt (default: ${DEFAULT_INPUT})
  --output <path>   Output file path (default: ${DEFAULT_OUTPUT_JSON} for JSON or ${DEFAULT_OUTPUT_CSV} for CSV)
  --format <fmt>    Output format: json | csv | both (default: json)
  --include-components  Include entries with status "component" (default: false)
  --help           Show this help

Example:
  node scripts/convert-emoji-test.mjs --format both`);
}

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    output: null,
    format: "json",
    includeComponents: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--input":
        args.input = argv[++i];
        break;
      case "--output":
        args.output = argv[++i];
        break;
      case "--format":
        args.format = argv[++i];
        break;
      case "--include-components":
        args.includeComponents = true;
        break;
      case "--help":
        printUsage();
        process.exit(0);
      default:
        console.error(`Unknown argument: ${arg}`);
        printUsage();
        process.exit(1);
    }
  }

  const normalizedFormat = args.format.toLowerCase();
  if (!["json", "csv", "both"].includes(normalizedFormat)) {
    console.error("Invalid --format. Use json, csv, or both.");
    process.exit(1);
  }
  args.format = normalizedFormat;
  return args;
}

function normalizeShortName(name) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function deriveKeywords(shortName) {
  return Array.from(
    new Set(
      shortName
        .split("_")
        .map((word) => word.trim())
        .filter(Boolean),
    ),
  );
}

function parseEmojiStyleOverrides(content) {
  const lines = content.split(/\r?\n/);
  const map = new Map();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const hashIndex = line.indexOf("#");
    const descriptor = hashIndex >= 0 ? line.slice(0, hashIndex).trim() : line;
    const [codepointPart, typePart = ""] = descriptor.split(";").map((part) => part.trim());
    if (!codepointPart || !typePart) continue;

    const typeLower = typePart.toLowerCase();
    if (!typeLower.includes("emoji")) continue;

    const codepoints = codepointPart
      .split(/\s+/)
      .map((cp) => cp.trim().toUpperCase())
      .filter(Boolean);

    if (!codepoints.includes(FE_VARIATION_SELECTOR)) continue;

    const nonFe0f = codepoints.filter((cp) => cp !== FE_VARIATION_SELECTOR);
    if (nonFe0f.length !== 1) continue;

    const emoji = codepoints
      .map((cp) => String.fromCodePoint(parseInt(cp, 16)))
      .join("");
    if (!emoji) continue;

    map.set(nonFe0f[0], { codepoints, emoji });
  }

  return map;
}

function parseEmojiTest(content, includeComponents, variationOverrides) {
  const lines = content.split(/\r?\n/);
  let currentGroup = "";
  let currentSubgroup = "";
  let sortOrder = 1;
  const records = [];

  for (const line of lines) {
    if (!line || line.startsWith("#")) {
      if (line.startsWith("# group:")) {
        currentGroup = line.slice("# group:".length).trim();
      } else if (line.startsWith("# subgroup:")) {
        currentSubgroup = line.slice("# subgroup:".length).trim();
      }
      continue;
    }

    const hashIndex = line.indexOf("#");
    if (hashIndex === -1) continue;

    const comment = line.slice(hashIndex + 1).trim();
    const descriptor = line.slice(0, hashIndex).trim();
    const parts = descriptor.split(";");
    if (parts.length < 2) continue;

    const codepointsPart = parts[0].trim();
    const status = parts[1].trim().split(/\s+/)[0];

    if (!includeComponents && !ALLOWED_STATUSES.has(status)) {
      continue;
    }
    if (includeComponents && status !== "fully-qualified" && status !== "component") {
      continue;
    }

    const firstSpace = comment.indexOf(" ");
    if (firstSpace === -1) continue;

    const emojiChar = comment.slice(0, firstSpace);
    const descriptiveRaw = comment.slice(firstSpace + 1).trim();
    if (!emojiChar || !descriptiveRaw) continue;

    const descriptiveName = descriptiveRaw.replace(/^E\d+(?:\.\d+)?\s+/, "").trim();
    if (!descriptiveName) continue;

    const shortName = normalizeShortName(descriptiveName);
    if (!shortName) {
      console.warn("Empty short_name derived from:", descriptiveName, "line:", line);
      continue;
    }
    const keywords = deriveKeywords(shortName);

    const codepoints = codepointsPart
      .split(/\s+/)
      .map((cp) => cp.trim().toUpperCase())
      .filter(Boolean);

    const record = {
      emoji: emojiChar,
      short_name: shortName,
      keywords,
      category: currentGroup || null,
      subcategory: currentSubgroup || null,
      codepoints,
      sort_order: sortOrder,
    };

    const baseWithoutFe0f = record.codepoints.filter((cp) => cp !== FE_VARIATION_SELECTOR);
    const overrideKey = baseWithoutFe0f.length === 1 ? baseWithoutFe0f[0] : null;
    const override = overrideKey ? variationOverrides?.get(overrideKey) : undefined;

    if (override) {
      record.codepoints = override.codepoints;
      record.emoji = override.emoji;
    }

    records.push(record);

    sortOrder += 1;
  }

  return records;
}

async function writeJson(records, outputPath) {
  const json = JSON.stringify(records, null, 2);
  await fs.writeFile(outputPath, `${json}\n`, "utf-8");
  console.log(`JSON exported: ${outputPath} (${records.length} records)`);
}

function escapeCsvValue(value) {
  if (value == null) return "";
  const stringValue = String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

async function writeCsv(records, outputPath) {
  const header = [
    "emoji",
    "short_name",
    "codepoints",
    "keywords",
    "category",
    "subcategory",
    "sort_order",
  ];
  const lines = [header.join(",")];

  for (const record of records) {
    const row = [
      escapeCsvValue(record.emoji),
      escapeCsvValue(record.short_name),
      escapeCsvValue(record.codepoints.join(" ")),
      escapeCsvValue(record.keywords.join(" ")),
      escapeCsvValue(record.category ?? ""),
      escapeCsvValue(record.subcategory ?? ""),
      escapeCsvValue(record.sort_order ?? ""),
    ];
    lines.push(row.join(","));
  }

  await fs.writeFile(outputPath, `${lines.join("\n")}\n`, "utf-8");
  console.log(`CSV exported: ${outputPath} (${records.length} records)`);
}

async function main() {
  const args = parseArgs(process.argv);
  const inputPath = path.resolve(args.input);
  const raw = await fs.readFile(inputPath, "utf-8");

  let variationOverrides = null;
  try {
    const variationContent = await fs.readFile(EMOJI_VARIATION_PATH, "utf-8");
    variationOverrides = parseEmojiStyleOverrides(variationContent);
  } catch (error) {
    console.warn(
      `[convert-emoji-test] Variation sequences file not found or failed to parse: ${EMOJI_VARIATION_PATH}. Continuing without emoji-style overrides.`,
    );
  }

  const overridesMap = variationOverrides ?? new Map();
  DEFAULT_EMOJI_STYLE_OVERRIDES.forEach(({ base, emoji, codepoints }) => {
    if (!overridesMap.has(base)) {
      overridesMap.set(base, { codepoints, emoji });
    }
  });

  const records = parseEmojiTest(raw, args.includeComponents, overridesMap);

  if (records.length === 0) {
    console.error("No emoji records were parsed. Check the input file or options.");
    process.exit(1);
  }

  const outputs = [];
  if (args.format === "json" || args.format === "both") {
    const outputPath = path.resolve(args.output ?? DEFAULT_OUTPUT_JSON);
    await writeJson(records, outputPath);
    outputs.push(outputPath);
  }
  if (args.format === "csv" || args.format === "both") {
    const outputPath = path.resolve(
      args.output && args.format !== "both" ? args.output : DEFAULT_OUTPUT_CSV,
    );
    await writeCsv(records, outputPath);
    outputs.push(outputPath);
  }

  console.log(`Done. Generated files:
- ${outputs.map((out) => path.relative(process.cwd(), out)).join("\n- ")}`);
}

main().catch((error) => {
  console.error("Failed to convert emoji-test.txt:", error);
  process.exit(1);
});
