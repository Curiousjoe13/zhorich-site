import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"
import * as ExternalPlugin from "./.quartz/plugins"
import type { ExplorerOptions } from "./.quartz/plugins"

const explorerCollator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" })

ExternalPlugin.Explorer({
  sortFn: ((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1

    const aSlug = typeof a.data?.slug === "string" ? a.data.slug : ""
    const bSlug = typeof b.data?.slug === "string" ? b.data.slug : ""
    const aName = aSlug.split("/").filter(Boolean).pop() ?? a.displayName
    const bName = bSlug.split("/").filter(Boolean).pop() ?? b.displayName
    return explorerCollator.compare(aName, bName)
  }) satisfies ExplorerOptions["sortFn"],
})

const config = await loadQuartzConfig()
export default config
export const layout = await loadQuartzLayout()
