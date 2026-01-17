import { WorkerMessageTypes } from './types'

/**
 * Simple controller for working with browser tabs
 */
class TabsController {
  /**
   * Hash table for remembering loaded contentScripts
   * Key - browser tab id. If tab id is present in this table, we conclude
   * that contentScript has loaded on this tab
   */
  tabsWithLoadedSidebar: { [key: number]: boolean } = {}

  /**
   * List of contentScripts that need to be dynamically loaded on the page
   */
  targetContentScriptFiles: string[] = []

  /**
   * Mark the tab where contentScript was loaded
   * @param tabId - browser tab id
   */
  setTabContentScriptLoaded = (tabId: number | undefined) => {
    if (!tabId) return
    this.tabsWithLoadedSidebar[tabId] = true
  }

  /**
   * Check if contentScript was loaded on this tab
   * @param tabId - browser tab id
   */
  isTabContentScriptLoaded = (tabId: number): boolean => {
    if (!tabId) return false

    return this.tabsWithLoadedSidebar[tabId]
  }

  /**
   * Set contentScript files that will be loaded on the page
   * @param files - list (or single) of contentScript files
   */
  setContentScriptFiles = (files: string[] | undefined): void => {
    if (!files) return
    this.targetContentScriptFiles = [...this.targetContentScriptFiles, ...files]
  }

  /**
   * Load contentScript files on a specific tab
   * @param tabId - browser tab id
   */
  injectContentScriptFilesToTab = async (tabId: number): Promise<void> => {
    if (!tabId || this.targetContentScriptFiles.length == 0) return Promise.reject()

    return chrome.scripting
      .executeScript({
        target: { tabId: tabId },
        files: [...this.targetContentScriptFiles],
      })
      .then(() => {
        this.setTabContentScriptLoaded(tabId)
      })
  }
}

const tabsController: TabsController = new TabsController()

// Export for use by other modules
export { tabsController }

/**
 * Listen for content script init message to track auto-injected scripts
 */
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === WorkerMessageTypes.sidebarLoaded && sender.tab?.id) {
    tabsController.setTabContentScriptLoaded(sender.tab.id)
  }
})

/**
 * Get the name of the contentScript file that will be dynamically loaded on the page when
 * the extension is already installed, but the current tab hasn't been reloaded.
 *
 * We use the file order from manifest.json to get the needed one, since during development and
 * production build, file names in manifests won't match.
 *
 * For example:
 *  - during development js: ['src/contentScript/Sidebar/index.tsx']
 *  - during build "js": ["assets/index.tsx-loader-ef2a399d.js"]
 *
 */
const contentScriptFile1 = chrome.runtime.getManifest()?.content_scripts?.[0].js
// const contentScriptFile2 = chrome.runtime.getManifest()?.content_scripts?.[1].js
tabsController.setContentScriptFiles(contentScriptFile1)
// tabsController.setContentScriptFiles(contentScriptFile2)

/**
 * Check if URL is a YouTube page where we want our content script
 */
const isYouTubeUrl = (url: string | undefined): boolean => {
  return !!url && url.includes('youtube.com')
}

/**
 * Inject content script if needed for a given tab
 */
const injectIfNeeded = async (tabId: number, url: string | undefined) => {
  if (!isYouTubeUrl(url)) return
  if (tabsController.isTabContentScriptLoaded(tabId)) return
  
  try {
    await tabsController.injectContentScriptFilesToTab(tabId)
  } catch (e) {
    // Injection can fail on restricted pages, that's OK
  }
}

/**
 * Handle browser tab activation (switching between tabs)
 */
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId)
  await injectIfNeeded(activeInfo.tabId, tab.url)
})

/**
 * Handle tab URL changes (SPA navigation, including YouTube)
 * This catches when user navigates within YouTube without full page reload
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only act when navigation is complete
  if (changeInfo.status === 'complete') {
    await injectIfNeeded(tabId, tab.url)
  }
})
