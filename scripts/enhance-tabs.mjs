import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const publicRoot = fileURLToPath(new URL("../public/", import.meta.url))

async function* htmlFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) yield* htmlFiles(path)
    else if (entry.isFile() && entry.name.endsWith(".html")) yield path
  }
}

const script = String.raw`<script>
(() => {
  function setupFolderListings() {
    const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' })
    document.querySelectorAll('.page-listing ul.section-ul:not([data-sorted])').forEach((list) => {
      const items = Array.from(list.children)
      items.sort((a, b) => {
        const aHref = a.querySelector('a.internal')?.getAttribute('href') || ''
        const bHref = b.querySelector('a.internal')?.getAttribute('href') || ''
        const aSlug = decodeURIComponent(aHref).split('/').filter(Boolean).pop() || ''
        const bSlug = decodeURIComponent(bHref).split('/').filter(Boolean).pop() || ''
        return collator.compare(aSlug, bSlug)
      })
      items.forEach((item) => list.appendChild(item))
      list.dataset.sorted = 'true'
    })
  }

  function setupMixaTabs() {
    document.querySelectorAll('.mixa-tabs-start:not([data-ready])').forEach((start, groupIndex) => {
      const end = Array.from(start.parentElement.children)
        .slice(Array.from(start.parentElement.children).indexOf(start) + 1)
        .find((node) => node.classList && node.classList.contains('mixa-tabs-end'))
      if (!end) return

      const nodes = []
      let current = start.nextSibling
      while (current && current !== end) {
        const next = current.nextSibling
        nodes.push(current)
        current = next
      }

      const sections = []
      let section = null
      for (const node of nodes) {
        if (node.nodeType === 1 && node.tagName === 'H1') {
          section = { title: node.textContent.trim(), nodes: [] }
          sections.push(section)
          node.remove()
        } else if (section) {
          section.nodes.push(node)
        }
      }
      if (sections.length < 2) return

      const tabs = document.createElement('div')
      tabs.className = 'mixa-tabs mixa-tabs-lifted'
      const nav = document.createElement('div')
      nav.className = 'mixa-tabs-nav'
      nav.setAttribute('role', 'tablist')
      const panels = document.createElement('div')
      panels.className = 'mixa-tabs-panels'

      sections.forEach((item, index) => {
        // In Mixa notes, a Markdown horizontal rule is commonly placed before the next
        // H1 for readability. It should separate source sections, not appear
        // as a line at the bottom of the resulting tab.
        while (item.nodes.length && item.nodes[item.nodes.length - 1].nodeType === 3 && !item.nodes[item.nodes.length - 1].textContent.trim()) {
          item.nodes.pop()
        }
        if (item.nodes.length && item.nodes[item.nodes.length - 1].nodeType === 1 && item.nodes[item.nodes.length - 1].tagName === 'HR') {
          item.nodes.pop()
        }

        const id = 'mixa-tab-' + groupIndex + '-' + index
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'mixa-tab-button'
        button.textContent = item.title
        button.setAttribute('role', 'tab')
        button.setAttribute('aria-controls', id)
        button.setAttribute('aria-selected', index === 0 ? 'true' : 'false')

        const panel = document.createElement('section')
        panel.id = id
        panel.className = 'mixa-tab-panel'
        panel.setAttribute('role', 'tabpanel')
        panel.hidden = index !== 0
        item.nodes.forEach((node) => panel.appendChild(node))

        button.addEventListener('click', () => {
          nav.querySelectorAll('[role="tab"]').forEach((tab) => tab.setAttribute('aria-selected', 'false'))
          panels.querySelectorAll('[role="tabpanel"]').forEach((candidate) => { candidate.hidden = true })
          button.setAttribute('aria-selected', 'true')
          panel.hidden = false
        })
        nav.appendChild(button)
        panels.appendChild(panel)
      })

      tabs.append(nav, panels)
      start.replaceWith(tabs)
      end.remove()

      // Quartz transclusions can hoist Markdown rules that separated source
      // H1 sections to immediately after the generated tabs container.
      // Remove only that consecutive group; rules elsewhere stay untouched.
      let trailing = tabs.nextElementSibling
      while (trailing && trailing.tagName === 'HR') {
        const next = trailing.nextElementSibling
        trailing.remove()
        trailing = next
      }

      tabs.dataset.ready = 'true'
    })
  }

  function setupSiteEnhancements() {
    setupFolderListings()
    setupMixaTabs()
  }

  function initializeExplorer() {
    const list = document.querySelector('.explorer-ul')
    if (!list || list.querySelector('.folder-container, a.nav-file-title')) return

    document.dispatchEvent(new CustomEvent('render', {
      detail: { url: location.pathname.replace(/^\//, '') }
    }))
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupSiteEnhancements()
    initializeExplorer()
  })
  document.addEventListener('nav', setupSiteEnhancements)
  setupFolderListings()
  setupMixaTabs()
  initializeExplorer()
})()
</script>`

let changed = 0
for await (const file of htmlFiles(publicRoot)) {
  const source = await readFile(file, "utf8")
  if (source.includes("setupMixaTabs")) continue
  const prepared = source.replace("</body>", `${script}</body>`)
  await writeFile(file, prepared, "utf8")
  changed += 1
}

console.log(`Enhanced lifted tabs in ${changed} HTML file(s)`)
