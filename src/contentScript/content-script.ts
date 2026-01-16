import { WorkerMessageTypes } from '../background/types'
import { extractVideoTranscript, TranscriptResult } from './youtubeTranscript'

let currentVideoId: string | null = null
let transcriptCache: TranscriptResult | null = null

/**
 * Check if current URL is a YouTube video page
 */
function isYouTubeVideoPage(): boolean {
  return window.location.hostname === 'www.youtube.com' && 
         window.location.pathname === '/watch' &&
         window.location.search.includes('v=')
}

/**
 * Get video ID from URL
 */
function getVideoId(): string | null {
  const urlParams = new URLSearchParams(window.location.search)
  return urlParams.get('v')
}

/**
 * Extract and send transcript to background script
 */
async function extractAndSendTranscript() {
  try {
    const videoId = getVideoId()
    
    console.log('🔍 extractAndSendTranscript called:', {
      urlVideoId: videoId,
      cachedVideoId: currentVideoId,
      hasCache: !!transcriptCache,
    })
    
    // Don't re-fetch if we already have this video's transcript
    if (videoId === currentVideoId && transcriptCache) {
      console.log('📋 Using cached transcript for video:', videoId)
      return
    }

    console.log('🎬 Extracting FRESH transcript for video:', videoId)
    
    // Extract transcript
    const result = await extractVideoTranscript()
    
    // Cache the result
    currentVideoId = videoId
    transcriptCache = result

    if (result.success) {
      console.log('✅ Transcript extracted successfully:', {
        videoId: result.videoId,
        title: result.metadata?.title,
        channel: result.metadata?.channelName,
        segmentCount: result.transcript?.length,
      })
      console.log('📤 Sending transcript to background script')
      chrome.runtime.sendMessage({
        type: WorkerMessageTypes.transcriptLoaded,
        payload: result,
      })
    } else {
      console.warn('❌ Transcript extraction failed:', result.error)
      chrome.runtime.sendMessage({
        type: WorkerMessageTypes.transcriptError,
        payload: { error: result.error },
      })
    }
  } catch (error) {
    console.error('Error in extractAndSendTranscript:', error)
    chrome.runtime.sendMessage({
      type: WorkerMessageTypes.transcriptError,
      payload: { error: error instanceof Error ? error.message : 'Unknown error' },
    })
  }
}

/**
 * Initialize content script for YouTube video pages
 */
const initializeContentScript = () => {
  console.log('🎬 YouTube transcript extension initialized')
  
  chrome.runtime.sendMessage({ type: WorkerMessageTypes.sidebarLoaded, payload: true })

  if (isYouTubeVideoPage()) {
    // Wait a bit for YouTube to load its player data
    setTimeout(() => {
      extractAndSendTranscript()
    }, 1500)
  }
}

// Initialize immediately if DOM is ready, otherwise wait for it
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeContentScript)
} else {
  // DOM is already ready, but add a small delay to ensure all scripts are loaded
  setTimeout(initializeContentScript, 100)
}

// Listen for URL changes (YouTube is a SPA)
let lastUrl = location.href
new MutationObserver(() => {
  const url = location.href
  if (url !== lastUrl) {
    lastUrl = url
    console.log('🔄 URL changed:', url)
    
    if (isYouTubeVideoPage()) {
      // Clear previous cache immediately on navigation
      console.log('🧹 Clearing cache due to URL change')
      currentVideoId = null
      transcriptCache = null
      
      // Wait longer for YouTube to fully load the new video page
      setTimeout(() => {
        console.log('⏰ Timeout elapsed, extracting transcript for new video')
        extractAndSendTranscript()
      }, 2500)
    } else {
      // Clear cache if we navigate away from video page
      console.log('📤 Navigated away from video page, clearing cache')
      currentVideoId = null
      transcriptCache = null
    }
  }
}).observe(document, { subtree: true, childList: true })

// Listen for messages from background/side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === WorkerMessageTypes.getTranscript) {
    // Side panel is requesting the current transcript
    if (transcriptCache) {
      sendResponse({ success: true, data: transcriptCache })
    } else {
      sendResponse({ success: false, error: 'No transcript available' })
    }
    return true
  } else if (message.type === 'seekVideo') {
    // Side panel wants to seek to a specific timestamp
    const seconds = message.payload?.seconds
    if (seconds !== undefined) {
      seekVideoToTimestamp(seconds)
    }
    return true
  }
})

/**
 * Seek YouTube video to specific timestamp
 */
function seekVideoToTimestamp(seconds: number) {
  try {
    // Find the YouTube video player
    const video = document.querySelector('video') as HTMLVideoElement
    
    if (video) {
      video.currentTime = seconds
      
      // If video is paused, play it
      if (video.paused) {
        video.play().catch(err => {
          console.warn('Could not auto-play video:', err)
        })
      }
      
      console.log(`⏩ Seeked to ${seconds}s`)
    } else {
      console.warn('Could not find video element')
    }
  } catch (error) {
    console.error('Error seeking video:', error)
  }
}
