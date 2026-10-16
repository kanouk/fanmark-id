import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

// Execute the actual TSX entry point. Only imported UI/catalog/browser adapters
// are replaced; the startup and failure branches remain the shipped source.
const source = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  transformers: { before: [(context) => {
    const visit = (node) => {
      if (ts.isPropertyAccessExpression(node) && node.name.text === "env" &&
          ts.isMetaProperty(node.expression) && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword) {
        return ts.factory.createIdentifier("__startupEnvironment");
      }
      return ts.visitEachChild(node, visit, context);
    };
    return (node) => ts.visitNode(node, visit);
  }] },
}).outputText;

function runStartup({ catalog, serviceWorker = true, rootPresent = true, worker = true } = {}) {
  const calls = [];
  const root = { textContent: "", children: [], replaceChildren(...children) { this.children = children; } };
  function element(tag) {
    return { tag, textContent: "", children: [], attributes: {}, listeners: {},
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(key, listener) { this.listeners[key] = listener; },
      append(...children) { this.children.push(...children); } };
  }
  const imports = {
    react: { default: { createElement: (...args) => ({ args }) } },
    "react-dom/client": { createRoot(target) { assert.equal(target, root); return { render() { calls.push("render"); } }; } },
    "./App.tsx": { default: "App" },
    "./index.css": {},
    "@/components/ThemeProvider": { ThemeProvider: "ThemeProvider" },
    "virtual:pwa-register": { registerSW(options) { assert.equal(options.immediate, true); assert.deepEqual(Object.keys(options), ["immediate"]); calls.push("registerSW"); } },
    "@/lib/emojiConversion": { installEmojiCatalog() { calls.push("installCatalog"); } },
    "@/lib/emoji-catalog-worker": { loadEmojiCatalogFromWorker() { calls.push("fetchCatalog"); return catalog; } },
    "@/data/emojiCatalog": { emojiCatalogEntries: [], emojiToId: {} },
  };
  runInNewContext(compiled, {
    exports: {},
    require(name) { assert.ok(Object.hasOwn(imports, name), `Unexpected startup dependency: ${name}`); return imports[name]; },
    __startupEnvironment: worker ? { VITE_EMOJI_CATALOG_BACKEND: "worker", VITE_FANMARK_API_BASE_URL: "https://worker.example.test" } : {},
    navigator: serviceWorker ? { serviceWorker: {} } : {},
    document: { getElementById(id) { assert.equal(id, "root"); return rootPresent ? root : null; }, createElement: element },
    window: { location: { reload() { calls.push("reload"); } } },
  });
  return { calls, root };
}

test("a stalled catalog cannot prevent the PWA update check; application stays gated", async () => {
  let resolveCatalog;
  const pending = new Promise((resolve) => { resolveCatalog = resolve; });
  const state = runStartup({ catalog: pending });
  assert.deepEqual(state.calls, ["registerSW", "fetchCatalog"]);
  await setImmediate();
  assert.ok(!state.calls.includes("render"));
  resolveCatalog({ items: [] });
  await setImmediate();
  assert.deepEqual(state.calls, ["registerSW", "fetchCatalog", "installCatalog", "render"]);
});

test("catalog rejection keeps update registration and renders a retry error without fallback", async () => {
  const state = runStartup({ catalog: Promise.reject(new Error("synthetic catalog unavailable")) });
  await setImmediate();
  assert.deepEqual(state.calls, ["registerSW", "fetchCatalog"]);
  const main = state.root.children[0];
  assert.equal(main.attributes.role, "alert");
  assert.equal(main.children[0].children[0].textContent, "絵文字カタログを読み込めませんでした");
  const retry = main.children[0].children[2];
  assert.equal(retry.textContent, "再読み込み");
  retry.listeners.click();
  assert.equal(state.calls.at(-1), "reload");
});

test("a browser without Service Worker support still loads and renders the selected catalog", async () => {
  const state = runStartup({ serviceWorker: false, catalog: Promise.resolve({ items: [] }) });
  await setImmediate();
  assert.deepEqual(state.calls, ["fetchCatalog", "installCatalog", "render"]);
});

test("missing application root starts neither update registration nor catalog loading", async () => {
  const state = runStartup({ rootPresent: false });
  await setImmediate();
  assert.deepEqual(state.calls, []);
});

test("the default bundled catalog path retains registration and application rendering", async () => {
  const state = runStartup({ worker: false });
  await setImmediate();
  assert.deepEqual(state.calls, ["registerSW", "installCatalog", "render"]);
});
