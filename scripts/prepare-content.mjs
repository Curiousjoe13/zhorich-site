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

function markLegacyLiftedTabs(source) {
  const lines = source.split(/\r?\n/)
  const result = []
  let legacyTabDepth = 0

  function removeTrailingRule() {
    let index = result.length - 1
    while (index >= 0 && /^\s*$/.test(result[index])) index -= 1
    if (index >= 0 && /^\s*---\s*$/.test(result[index])) {
      result.splice(index, 1)
    }
  }

  for (const line of lines) {
    if (/^\s*:::tab\{type=lifted\}\s*$/.test(line)) {
      legacyTabDepth += 1
      result.push('<div class="mixa-tabs-start" data-tabs-style="lifted"></div>')
      continue
    }

    if (legacyTabDepth > 0 && /^\s*:::\s*$/.test(line)) {
      legacyTabDepth -= 1
      removeTrailingRule()
      result.push('<div class="mixa-tabs-end"></div>')
      continue
    }

    result.push(line)
  }

  // A rule at the very end of a note duplicates Quartz's footer separator.
  removeTrailingRule()
  return result.join("\n")
}

let changed = 0
for await (const file of markdownFiles(contentRoot)) {
  const source = await readFile(file, "utf8")
  const prepared = markLegacyLiftedTabs(source)
  if (prepared !== source) {
    await writeFile(file, prepared, "utf8")
    changed += 1
  }
}

console.log(`Prepared Quartz content: ${changed} Markdown file(s) updated`)
