/**
 * Background script handler for transcript and chat messaging
 */

import { WorkerMessageTypes, PageState, TabState } from './types'
import { TranscriptResult } from '../contentScript/youtubeTranscript'

// Store transcripts by tab ID
const transcriptStore: Map<number, TranscriptResult> = new Map()

// Store page state by tab ID
const pageStateStore: Map<number, TabState> = new Map()

// Store chat history by tab ID
interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

const chatHistoryStore: Map<number, ChatMessage[]> = new Map()

/**
 * Listen for messages from content scripts and side panel
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id

  switch (message.type) {
    case WorkerMessageTypes.navigationStarted:
      // Content script detected navigation to a video page, transcript loading
      if (tabId) {
        console.log('🚀 Navigation started for tab:', tabId, 'videoId:', message.payload?.videoId)
        
        pageStateStore.set(tabId, {
          pageState: 'loading',
          videoId: message.payload?.videoId,
        })
        
        // Notify side panel
        chrome.runtime.sendMessage({
          type: WorkerMessageTypes.navigationStarted,
          payload: message.payload,
        }).catch(() => {})
      }
      break

    case WorkerMessageTypes.noVideoPage:
      // Content script detected navigation away from video page
      if (tabId) {
        console.log('📤 No video page for tab:', tabId)
        
        pageStateStore.set(tabId, { pageState: 'no_video' })
        transcriptStore.delete(tabId)
        
        // Notify side panel
        chrome.runtime.sendMessage({
          type: WorkerMessageTypes.noVideoPage,
        }).catch(() => {})
      }
      break

    case WorkerMessageTypes.transcriptLoaded:
      // Content script has loaded a transcript
      if (tabId) {
        console.log('📋 Transcript loaded for tab:', tabId, {
          videoId: message.payload.videoId,
          title: message.payload.metadata?.title,
          segmentCount: message.payload.transcript?.length,
        })
        
        // Check if this is a new video (different videoId)
        const previousTranscript = transcriptStore.get(tabId)
        const isNewVideo = previousTranscript?.videoId !== message.payload.videoId
        
        if (isNewVideo) {
          console.log('🔄 Background: NEW VIDEO! Old:', previousTranscript?.videoId, 'New:', message.payload.videoId)
        }
        
        transcriptStore.set(tabId, message.payload)
        pageStateStore.set(tabId, {
          pageState: 'ready',
          videoId: message.payload.videoId,
          videoTitle: message.payload.metadata?.title || message.payload.videoTitle,
        })
        
        // Clear chat history if navigating to a new video
        if (isNewVideo && chatHistoryStore.has(tabId)) {
          console.log('🧹 Background: Clearing chat history for tab:', tabId)
          chatHistoryStore.delete(tabId)
        }
        
        // Notify side panel if it's open
        console.log('📤 Background: Forwarding transcript to side panel')
        chrome.runtime.sendMessage({
          type: WorkerMessageTypes.transcriptLoaded,
          payload: message.payload,
        }).catch(() => {
          // Side panel might not be open, that's OK
        })
      }
      break

    case WorkerMessageTypes.transcriptError:
      console.error('❌ Transcript error:', message.payload)
      
      if (tabId) {
        pageStateStore.set(tabId, {
          pageState: 'error',
          error: message.payload?.error,
        })
      }
      
      // Notify side panel
      chrome.runtime.sendMessage({
        type: WorkerMessageTypes.transcriptError,
        payload: message.payload,
      }).catch(() => {
        // Side panel might not be open, that's OK
      })
      break

    case WorkerMessageTypes.tabStateRequest:
      // Side panel is requesting state for current tab
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const currentTab = tabs[0]
        const currentTabId = currentTab?.id
        
        // If we have cached state, use it
        if (currentTabId && pageStateStore.has(currentTabId)) {
          const state = pageStateStore.get(currentTabId)!
          const transcript = transcriptStore.get(currentTabId)
          console.log('📤 Background: returning cached state for tab:', currentTabId, state.pageState)
          sendResponse({
            ...state,
            transcript: transcript || null,
          })
          return
        }
        
        // No cached state - try to query content script directly
        if (currentTabId && currentTab?.url?.includes('youtube.com/watch')) {
          console.log('📤 Background: no cached state, querying content script for tab:', currentTabId)
          try {
            const contentResponse = await chrome.tabs.sendMessage(currentTabId, { 
              type: WorkerMessageTypes.tabStateRequest 
            })
            if (contentResponse) {
              console.log('📤 Background: got response from content script:', contentResponse)
              // Cache the state
              pageStateStore.set(currentTabId, {
                pageState: contentResponse.pageState,
                videoId: contentResponse.videoId,
                videoTitle: contentResponse.videoTitle,
              })
              if (contentResponse.pageState === 'ready' && contentResponse.transcript) {
                transcriptStore.set(currentTabId, contentResponse.transcript)
              }
              sendResponse(contentResponse)
              return
            }
          } catch (e) {
            console.log('📤 Background: content script not responding, tab:', currentTabId)
          }
        }
        
        // No state available
        console.log('📤 Background: no state available for tab:', currentTabId)
        sendResponse({ pageState: 'no_video' })
      })
      return true

    case WorkerMessageTypes.getTranscript:
      // Side panel is requesting transcript for current tab
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentTabId = tabs[0]?.id
        
        if (currentTabId && transcriptStore.has(currentTabId)) {
          sendResponse({
            success: true,
            data: transcriptStore.get(currentTabId),
          })
        } else {
          sendResponse({
            success: false,
            error: 'No transcript available for current tab',
          })
        }
      })
      return true // Will respond asynchronously

    case WorkerMessageTypes.sendChatMessage:
      // This will be handled by the LLM module directly from the side panel
      // But we can store chat history here
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentTabId = tabs[0]?.id
        if (currentTabId) {
          const history = chatHistoryStore.get(currentTabId) || []
          
          // Add user message
          history.push({
            role: 'user',
            content: message.payload.question,
            timestamp: Date.now(),
          })
          
          chatHistoryStore.set(currentTabId, history)
        }
      })
      break

    case WorkerMessageTypes.chatResponse:
      // Store AI response in history
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentTabId = tabs[0]?.id
        if (currentTabId) {
          const history = chatHistoryStore.get(currentTabId) || []
          
          history.push({
            role: 'assistant',
            content: message.payload.response,
            timestamp: Date.now(),
          })
          
          chatHistoryStore.set(currentTabId, history)
        }
      })
      break
  }
})

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  transcriptStore.delete(tabId)
  chatHistoryStore.delete(tabId)
  pageStateStore.delete(tabId)
})

// Notify side panel when user switches tabs
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tabId = activeInfo.tabId
  console.log('🔀 Tab activated:', tabId)
  
  let state = pageStateStore.get(tabId)
  let transcript = transcriptStore.get(tabId)
  
  // If no cached state, try to query content script
  if (!state) {
    try {
      const tab = await chrome.tabs.get(tabId)
      if (tab.url?.includes('youtube.com/watch')) {
        console.log('🔀 No cached state for tab, querying content script')
        const response = await chrome.tabs.sendMessage(tabId, { 
          type: WorkerMessageTypes.tabStateRequest 
        })
        if (response) {
          state = {
            pageState: response.pageState,
            videoId: response.videoId,
            videoTitle: response.videoTitle,
          }
          pageStateStore.set(tabId, state)
          if (response.transcript) {
            transcript = response.transcript
            transcriptStore.set(tabId, response.transcript)
          }
        }
      }
    } catch (e) {
      console.log('🔀 Could not query content script for tab:', tabId)
    }
  }
  
  // Send tab state to side panel
  chrome.runtime.sendMessage({
    type: 'tabActivated',
    payload: {
      ...(state || { pageState: 'no_video' }),
      transcript: transcript || null,
    },
  }).catch(() => {
    // Side panel might not be open
  })
})

// Export helper function to get transcript for current tab
export function getTranscriptForCurrentTab(): Promise<TranscriptResult | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id
      
      if (tabId && transcriptStore.has(tabId)) {
        resolve(transcriptStore.get(tabId) || null)
      } else {
        resolve(null)
      }
    })
  })
}

// Export helper function to get chat history for current tab
export function getChatHistoryForCurrentTab(): Promise<ChatMessage[]> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id
      
      if (tabId && chatHistoryStore.has(tabId)) {
        resolve(chatHistoryStore.get(tabId) || [])
      } else {
        resolve([])
      }
    })
  })
}

