import { WorkerMessageTypes } from './types'

// Track side panel open state per window
const sidePanelOpen = new Map<number, boolean>()

// Handle side panel toggle from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'toggleSidePanel') {
    const windowId = sender.tab?.windowId
    if (windowId !== undefined) {
      const isOpen = sidePanelOpen.get(windowId) ?? false
      if (isOpen) {
        // Panel is open - close it
        console.log('🔄 Side panel open, closing...')
        // Tell side panel to close itself
        chrome.runtime.sendMessage({ type: 'closeSidePanel' }).catch(() => {})
        sidePanelOpen.set(windowId, false)
      } else {
        chrome.sidePanel.open({ windowId })
        sidePanelOpen.set(windowId, true)
      }
    }
  } else if (message.type === 'sidePanelClosed') {
    // Side panel notifies us when it closes
    const windowId = message.windowId
    if (windowId !== undefined) {
      sidePanelOpen.set(windowId, false)
    }
  } else if (message.type === 'sidePanelOpened') {
    // Side panel notifies us when it opens
    const windowId = message.windowId
    if (windowId !== undefined) {
      sidePanelOpen.set(windowId, true)
    }
  }
})

// set action button behavior in extension menu to open side panel on click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
