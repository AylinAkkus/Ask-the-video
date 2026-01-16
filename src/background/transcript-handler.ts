/**
 * Background script handler for transcript and chat messaging
 */

import { WorkerMessageTypes } from './types'
import { TranscriptResult } from '../contentScript/youtubeTranscript'

// Store transcripts by tab ID
const transcriptStore: Map<number, TranscriptResult> = new Map()

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
      
      // Notify side panel
      chrome.runtime.sendMessage({
        type: WorkerMessageTypes.transcriptError,
        payload: message.payload,
      }).catch(() => {
        // Side panel might not be open, that's OK
      })
      break

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

