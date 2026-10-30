import { readFile, writeFile } from "node:fs/promises";

const apiZodIndex = new URL("../../api-zod/src/index.ts", import.meta.url);
const source = await readFile(apiZodIndex, "utf8");
const cleaned = source
  .replace(/^export \* from ['"]\.\/generated\/types['"];?\s*$/gm, "")
  .replace(/\n{3,}/g, "\n\n");

if (cleaned !== source) {
  await writeFile(apiZodIndex, cleaned);
}
