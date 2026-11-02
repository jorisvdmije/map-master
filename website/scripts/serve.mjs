import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createStaticServer } from "./lib/static-server.mjs";

const directory = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");
const { basePath } = JSON.parse(readFileSync(resolve(directory, ".build-info.json"), "utf8"));
const server = createStaticServer({ directory, basePath });
server.listen(5180, "127.0.0.1", () => console.log(`Static Next.js export: http://127.0.0.1:5180${basePath}/`));
