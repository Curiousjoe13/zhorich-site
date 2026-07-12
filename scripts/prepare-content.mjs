import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const contentRoot = fileURLToPath(new URL("../content/", import.meta.url))

async function* markdownFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) yield* markdownFiles(path)
    else if (entry.isFile() && entry.name.endsWith(".md")) yield path
  }
}

function removeLegacyLiftedTabs(source) {
  const lines = source.split(/\r?\n/)
  const result = []
  let legacyTabDepth = 0

  for (const line of lines) {
    if (/^\s*:::tab\{type=lifted\}\s*$/.test(line)) {
      legacyTabDepth += 1
      continue
    }

    if (legacyTabDepth > 0 && /^\s*:::\s*$/.test(line)) {
      legacyTabDepth -= 1
      continue
    }

    result.push(line)
  }

  return result.join("\n")
}

let changed = 0
for await (const file of markdownFiles(contentRoot)) {
  const source = await readFile(file, "utf8")
  const prepared = removeLegacyLiftedTabs(source)
  if (prepared !== source) {
    await writeFile(file, prepared, "utf8")
    changed += 1
  }
}

console.log(`Prepared Quartz content: ${changed} Markdown file(s) updated`)
