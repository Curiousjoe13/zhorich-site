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

      // The highest numbered "Основная очередь игр N" is always the current
      // queue. Completed/dropped rows from it and every older numbered queue are
      // rendered as one archive table. The source Markdown tables stay untouched.
      const numberedMainQueues = sections
        .map((item, sourceIndex) => {
          const match = item.title.match(/основная очередь игр\s*(\d+)\s*$/iu)
          return match ? { item, number: Number(match[1]), sourceIndex } : null
        })
        .filter(Boolean)
        .sort((a, b) => a.number - b.number || a.sourceIndex - b.sourceIndex)

      if (numberedMainQueues.length) {
        const currentQueue = numberedMainQueues[numberedMainQueues.length - 1].item
        const mainQueueSections = new Set(numberedMainQueues.map((entry) => entry.item))
        const specialisedQueues = sections.filter((item) => !mainQueueSections.has(item))

        const queueTables = numberedMainQueues.map(({ item, number }) => {
          const container = item.nodes.find((node) => {
            if (node.nodeType !== 1) return false
            return node.tagName === 'TABLE' || Boolean(node.querySelector('table'))
          })
          const table = container?.tagName === 'TABLE' ? container : container?.querySelector('table')
          const headings = table
            ? Array.from(table.querySelectorAll('thead th'), (cell) => cell.textContent.trim().toLocaleLowerCase('ru'))
            : []
          return {
            item,
            number,
            container,
            table,
            gameIndex: headings.indexOf('игра'),
            statusIndex: headings.indexOf('статус'),
          }
        })

        const currentTable = queueTables[queueTables.length - 1]
        if (currentTable?.table) {
          const archiveRows = []
          const activeRows = []

          function cellParts(cell) {
            const parts = [[]]
            cell.childNodes.forEach((node) => {
              if (node.nodeType === 1 && node.tagName === 'BR') parts.push([])
              else parts[parts.length - 1].push(node.cloneNode(true))
            })
            while (parts.length > 1 && !parts[parts.length - 1].some((node) => {
              return node.nodeType === 1 || node.textContent.trim()
            })) parts.pop()
            return parts
          }

          function splitCombinedRow(sourceRow, gameIndex, statusIndex) {
            const cells = Array.from(sourceRow.cells)
            const parts = cells.map(cellParts)
            const relevantCounts = [gameIndex, statusIndex]
              .filter((index) => index >= 0)
              .map((index) => parts[index].length)
            const partCount = Math.max(1, ...relevantCounts)
            if (partCount === 1) return [sourceRow.cloneNode(true)]

            return Array.from({ length: partCount }, (_, partIndex) => {
              const row = sourceRow.cloneNode(true)
              Array.from(row.cells).forEach((cell, cellIndex) => {
                if (cellIndex === 0) return
                const variants = parts[cellIndex]
                const selected = variants.length === 1
                  ? variants[0]
                  : variants[partIndex] || []
                cell.replaceChildren(...selected.map((node) => node.cloneNode(true)))
              })
              return row
            })
          }

          queueTables.forEach((queue) => {
            if (!queue.table) return
            const isCurrent = queue === currentTable
            queue.table.querySelectorAll('tbody tr').forEach((sourceRow) => {
              splitCombinedRow(sourceRow, queue.gameIndex, queue.statusIndex).forEach((row) => {
                const status = queue.statusIndex === -1 ? '' : row.cells[queue.statusIndex]?.textContent || ''
                const isFinished = /[✅❌]/u.test(status)
                if (!isCurrent || isFinished) archiveRows.push(row)
                else activeRows.push(row)
              })
            })
          })

          function renumber(rows) {
            let number = 0
            rows.forEach((row) => {
              const numberCell = row.cells[0]
              if (!numberCell || !/^\d+$/.test(numberCell.textContent.trim())) return
              numberCell.textContent = String(++number)
            })
          }

          function tableWithRows(source, rows) {
            const container = source.container.cloneNode(true)
            const table = container.tagName === 'TABLE' ? container : container.querySelector('table')
            const body = table.tBodies[0] || table.createTBody()
            body.replaceChildren(...rows)
            return container
          }

          renumber(activeRows)
          renumber(archiveRows)
          currentQueue.title = 'В процессе'
          const sourceMainQueueNodes = numberedMainQueues.flatMap(({ item }) => item.nodes)
          const currentSupportingNodes = currentQueue.nodes.filter((node) => {
            if (node === currentTable.container) return false
            return !(node.nodeType === 1 && /^H[1-6]$/.test(node.tagName) && /полный список прохождений/iu.test(node.textContent))
          })
          sourceMainQueueNodes.forEach((node) => node.parentNode?.removeChild(node))
          currentQueue.nodes = [
            tableWithRows(currentTable, activeRows),
            ...currentSupportingNodes,
          ]

          const orderedSections = [currentQueue, ...specialisedQueues]
          if (archiveRows.length) {
            orderedSections.push({
              title: 'Пройдено',
              nodes: [tableWithRows(currentTable, archiveRows)],
            })
          }

          sections.splice(0, sections.length, ...orderedSections)
        }
      }

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

  function setupHeadingIcons() {
    const emoji = /^(\p{Extended_Pictographic}(?:\uFE0E|\uFE0F)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0E|\uFE0F)?)*)\s*/u
    document.querySelectorAll('article h1:not([data-icon-ready]), article h2:not([data-icon-ready]), article h3:not([data-icon-ready])').forEach((heading) => {
      heading.dataset.iconReady = 'true'
      const first = heading.firstChild
      if (!first || first.nodeType !== Node.TEXT_NODE) return
      const match = first.textContent.match(emoji)
      if (!match) return

      const icon = document.createElement('span')
      icon.className = 'heading-icon'
      icon.setAttribute('aria-hidden', 'true')
      icon.textContent = match[1]
      first.textContent = first.textContent.slice(match[0].length)
      heading.insertBefore(icon, first)
    })
  }

  function setupTables() {
    document.querySelectorAll('.table-container table:not([data-layout-ready])').forEach((table) => {
      const headings = Array.from(table.querySelectorAll('thead th')).map((cell) => cell.textContent.trim().toLocaleLowerCase('ru'))
      if (headings.includes('№') && headings.includes('игра')) table.classList.add('game-queue-table')
      if (headings.includes('босс')) table.classList.add('boss-stats-table')
      table.dataset.layoutReady = 'true'
    })
  }

  function setupSiteEnhancements() {
    setupFolderListings()
    setupMixaTabs()
    setupHeadingIcons()
    setupTables()
  }

  function initializeExplorer() {
    const list = document.querySelector('.explorer-ul')
    if (!list || list.querySelector('.folder-container, a.nav-file-title')) return

    document.dispatchEvent(new CustomEvent('nav', {
      detail: { url: document.body.dataset.slug || 'index' }
    }))
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupSiteEnhancements()
    initializeExplorer()
  })
  document.addEventListener('nav', setupSiteEnhancements)
  setupFolderListings()
  setupMixaTabs()
  setupHeadingIcons()
  setupTables()
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
