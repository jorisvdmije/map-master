import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lexer } from "marked";
import { compile as compileSvelte } from "svelte/compiler";
import { parse, compileScript, compileTemplate } from "@vue/compiler-sfc";

const site = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(site, "..");
const installed = resolve(site, "node_modules");
const evidence = resolve(repo, "artifacts/documentation/frameworks");
const workspace = mkdtempSync(join(tmpdir(), "map-master-frameworks-"));
const source = readFileSync(resolve(repo, "docs/frameworks.md"), "utf8");
const snippets = new Map();
let section;
for (const token of lexer(source)) {
  if (token.type === "heading" && token.depth === 2) section = token.text;
  if (token.type === "code") {
    const title = token.lang?.match(/\btitle="([^"]+)"/)?.[1];
    if (title) {
      assert.ok(!snippets.has(title), `Duplicate framework example: ${title}`);
      snippets.set(title, { section, code: token.text, language: token.lang.split(/\s+/)[0] });
    }
  }
}

function snippet(title, section, language) {
  const item = snippets.get(title);
  assert.ok(item, `Missing published example ${title} in docs/frameworks.md`);
  assert.equal(item.section, section, `Unexpected section for ${title}`);
  assert.equal(item.language, language, `Unexpected language for ${title}`);
  return item.code;
}

const version = name => JSON.parse(readFileSync(join(installed, name, "package.json"), "utf8")).version;
const json = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
function run(packageName, binary, args, cwd) {
  const directory = join(installed, packageName);
  const metadata = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  const entry = typeof metadata.bin === "string" ? metadata.bin : metadata.bin[binary];
  try {
    return execFileSync(process.execPath, [resolve(directory, entry), ...args], {
      cwd, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    process.stderr.write(`${error.stdout ?? ""}${error.stderr ?? ""}`);
    throw new Error(`${binary} rejected the published example in ${cwd}`, { cause: error });
  }
}

mkdirSync(evidence, { recursive: true });
const modules = join(workspace, "node_modules");
mkdirSync(modules);
for (const entry of readdirSync(installed)) {
  if (entry !== "@jorisvdmije") symlinkSync(join(installed, entry), join(modules, entry), "dir");
}
// Resolve the same public package and MapLibre declarations an application sees.
const library = join(modules, "@jorisvdmije/map-master");
mkdirSync(library, { recursive: true });
copyFileSync(join(repo, "package.json"), join(library, "package.json"));
symlinkSync(join(repo, "dist"), join(library, "dist"), "dir");
json(join(workspace, "package.json"), { private: true, type: "module" });

const baseOptions = {
  target: "ES2022", module: "ESNext", moduleResolution: "Bundler",
  lib: ["ES2022", "DOM", "DOM.Iterable"], strict: true, skipLibCheck: true,
  preserveSymlinks: true, esModuleInterop: true, noEmitOnError: true,
};
const worker = snippet("map-worker.ts", "Shared worker setup", "ts");
const cases = [
  { name: "React", file: "MapEditor.tsx", language: "tsx", compiler: "typescript", types: ["react", "vite/client"], jsx: "react-jsx" },
  { name: "Vue", file: "MapEditor.vue", language: "vue", compiler: "vue-tsc", types: ["vite/client"] },
  { name: "Svelte", file: "MapEditor.svelte", language: "svelte", compiler: "svelte-check", types: ["svelte", "vite/client"] },
  { name: "Angular", file: "map-editor.component.ts", language: "ts", compiler: "@angular/compiler-cli", types: ["vite/client"] },
];
const report = { passed: false, node: process.version, typescript: version("typescript"), examples: [] };
try {
  for (const item of cases) {
    const directory = join(workspace, item.name.toLowerCase());
    mkdirSync(directory);
    const code = snippet(item.file, item.name, item.language);
    writeFileSync(join(directory, item.file), code);
    writeFileSync(join(directory, "map-worker.ts"), worker);
    const options = { ...baseOptions, types: item.types, outDir: "./build" };
    if (item.jsx) options.jsx = item.jsx;
    if (item.name === "Angular") {
      options.experimentalDecorators = true;
      options.useDefineForClassFields = false;
    }
    const config = { compilerOptions: options, include: ["*.ts", "*.tsx", "*.vue", "*.svelte"] };
    if (item.name === "Angular") config.angularCompilerOptions = { strictTemplates: true, strictInjectionParameters: true };
    const configPath = join(directory, "tsconfig.json");
    json(configPath, config);

    if (item.name === "React") run("typescript", "tsc", ["-p", configPath], directory);
    if (item.name === "Vue") {
      run("vue-tsc", "vue-tsc", ["--noEmit", "-p", configPath], directory);
      const parsed = parse(code, { filename: item.file });
      assert.deepEqual(parsed.errors, []);
      const script = compileScript(parsed.descriptor, { id: "map-editor" });
      const template = compileTemplate({
        source: parsed.descriptor.template.content, filename: item.file, id: "map-editor",
        compilerOptions: { bindingMetadata: script.bindings },
      });
      assert.deepEqual(template.errors, []);
      mkdirSync(join(directory, "build"));
      writeFileSync(join(directory, "build/script.ts"), script.content);
      writeFileSync(join(directory, "build/template.js"), template.code);
    }
    if (item.name === "Svelte") {
      run("svelte-check", "svelte-check", ["--workspace", directory, "--tsconfig", configPath, "--fail-on-warnings"], directory);
      mkdirSync(join(directory, "build"));
      for (const generate of ["client", "server"]) {
        const output = compileSvelte(code, { filename: item.file, generate });
        assert.deepEqual(output.warnings, []);
        writeFileSync(join(directory, `build/${generate}.js`), output.js.code);
      }
    }
    if (item.name === "Angular") run("@angular/compiler-cli", "ngc", ["-p", configPath], directory);

    const result = {
      framework: item.name, compiler: item.compiler, version: version(item.compiler),
      file: item.file, sha256: createHash("sha256").update(code).digest("hex"),
    };
    report.examples.push(result);
    console.log(`✓ ${item.name}: published component, template and shared worker (${item.compiler} ${result.version})`);
  }
  report.passed = true;
} catch (error) {
  report.error = error.message;
  process.stderr.write(`Framework example evidence retained in ${workspace}\n`);
  throw error;
} finally {
  json(join(evidence, "verification.json"), report);
  if (report.passed) rmSync(workspace, { recursive: true, force: true });
}
