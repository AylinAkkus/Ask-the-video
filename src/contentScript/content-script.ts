import { WorkerMessageTypes } from '../background/types'
import { extractVideoTranscript, TranscriptResult } from './youtubeTranscript'

let currentVideoId: string | null = null
let transcriptCache: TranscriptResult | null = null
let askAiButton: HTMLElement | null = null
let pendingExtractionId: number = 0 // Used to cancel stale extractions
let infoCardObserver: MutationObserver | null = null

// Selectors for YouTube's info overlays that appear in top-right
const INFO_OVERLAY_SELECTORS = [
  '.iv-branding',           // Channel branding watermark
  '.ytp-ce-element',        // Card elements  
  '.ytp-ce-covering-overlay',
  '.ytp-paid-content-overlay',
  '.ytp-cards-teaser',      // Cards teaser (the "i" icon)
  '.branding-img-container', // Branding image
]

/**
 * Check if any info overlay is visible in the player
 */
function isInfoOverlayVisible(): boolean {
  for (const selector of INFO_OVERLAY_SELECTORS) {
    const el = document.querySelector(selector) as HTMLElement
    if (!el) continue
    
    // Check actual rendered dimensions - element must have real size
    const rect = el.getBoundingClientRect()
    if (rect.width < 10 || rect.height < 10) continue
    
    // Check CSS visibility
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    if (parseFloat(style.opacity) < 0.1) continue
    
    // Element is actually visible with real dimensions
    return true
  }
  return false
}

/**
 * Update button position based on info overlay visibility
 */
function updateButtonPosition() {
  if (!askAiButton) return
  
  const hasOverlay = isInfoOverlayVisible()
  // Move left when overlay is present (give ~60px clearance)
  askAiButton.style.right = hasOverlay ? '76px' : '16px'
}

/**
 * Start observing for info overlay changes
 */
function startInfoOverlayObserver() {
  if (infoCardObserver) return
  
  const player = document.querySelector('#movie_player') || document.querySelector('.html5-video-player')
  if (!player) return
  
  infoCardObserver = new MutationObserver(() => {
    updateButtonPosition()
  })
  
  infoCardObserver.observe(player, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style'],
  })
  
  // Also check periodically since some changes might be missed
  setInterval(updateButtonPosition, 1000)
}

/**
 * Stop observing info overlay
 */
function stopInfoOverlayObserver() {
  if (infoCardObserver) {
    infoCardObserver.disconnect()
    infoCardObserver = null
  }
}

/**
 * Create and inject the "Ask AI" overlay button on the video player
 */
function injectAskAiButton() {
  // Don't duplicate
  if (document.getElementById('ask-ai-overlay-btn')) return

  // Target the video container that has proper positioning
  const playerContainer = document.querySelector('.html5-video-container') as HTMLElement
  if (!playerContainer) return

  // Ensure container can hold absolute children
  playerContainer.style.position = 'relative'

  // Create button
  const btn = document.createElement('button')
  btn.id = 'ask-ai-overlay-btn'
  btn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 32 32" fill="none" style="vertical-align: middle; margin-right: 6px;">
      <rect x="2" y="5" width="28" height="18" rx="4.5" fill="#FF0000"/>
      <path d="M6 23L6 28L12 23" fill="#FF0000"/>
      <path d="M12.5 10L12.5 19L20.5 14.5L12.5 10Z" fill="#fff"/>
    </svg>
    <span style="vertical-align: middle;">Ask AI</span>
  `
  
  // Check initial overlay state
  const hasOverlay = isInfoOverlayVisible()
  
  // Inline styles - dark glassmorphism that fits YouTube
  Object.assign(btn.style, {
    position: 'absolute',
    top: '16px',
    right: hasOverlay ? '76px' : '16px',
    zIndex: '2000',
    padding: '8px 14px 8px 12px',
    fontSize: '14px',
    fontWeight: '600',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: '#fff',
    background: 'rgba(0, 0, 0, 0.75)',
    border: '1.5px solid rgba(255, 255, 255, 0.5)',
    borderRadius: '24px',
    cursor: 'pointer',
    transition: 'all 0.2s ease', // Smooth transition for position changes
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
    display: 'flex',
    alignItems: 'center',
  })

  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    e.preventDefault()
    chrome.runtime.sendMessage({ type: 'toggleSidePanel' })
  })

  // Hover effect
  btn.addEventListener('mouseenter', () => {
    btn.style.background = 'rgba(0, 0, 0, 0.9)'
    btn.style.transform = 'scale(1.05)'
    btn.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.5)'
  })
  btn.addEventListener('mouseleave', () => {
    btn.style.background = 'rgba(0, 0, 0, 0.75)'
    btn.style.transform = 'scale(1)'
    btn.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.4)'
  })

  playerContainer.appendChild(btn)
  askAiButton = btn
  
  // Start watching for info overlays
  startInfoOverlayObserver()
  
  console.log('✨ Ask AI button injected')
}

/**
 * Remove the Ask AI button
 */
function removeAskAiButton() {
  stopInfoOverlayObserver()
  const btn = document.getElementById('ask-ai-overlay-btn')
  if (btn) btn.remove()
  askAiButton = null
}

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
async function extractAndSendTranscript(extractionId: number) {
  try {
    const videoId = getVideoId()
    
    console.log('🔍 extractAndSendTranscript called:', {
      extractionId,
      currentExtractionId: pendingExtractionId,
      urlVideoId: videoId,
      cachedVideoId: currentVideoId,
      hasCache: !!transcriptCache,
    })
    
    // Abort if this extraction was superseded by a newer one
    if (extractionId !== pendingExtractionId) {
      console.log('⏭️ Skipping stale extraction:', extractionId, 'current:', pendingExtractionId)
      return
    }
    
    // Don't re-fetch if we already have this video's transcript
    if (videoId === currentVideoId && transcriptCache) {
      console.log('📋 Using cached transcript for video:', videoId)
      return
    }

    console.log('🎬 Extracting FRESH transcript for video:', videoId)
    
    // Extract transcript
    const result = await extractVideoTranscript()
    
    // CRITICAL: Check again after async work - URL might have changed
    const currentUrlVideoId = getVideoId()
    if (extractionId !== pendingExtractionId) {
      console.log('⏭️ Extraction completed but superseded:', extractionId, 'current:', pendingExtractionId)
      return
    }
    if (currentUrlVideoId !== videoId) {
      console.log('⏭️ URL changed during extraction. Expected:', videoId, 'Got:', currentUrlVideoId)
      return
    }
    
    // Also verify the extracted transcript matches what we requested
    if (result.success && result.videoId && result.videoId !== videoId) {
      console.log('⚠️ Transcript videoId mismatch! URL:', videoId, 'Transcript:', result.videoId)
      // Don't cache mismatched data - trigger a retry
      return
    }
    
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
    // Immediately notify that we're on a video page and loading
    const videoId = getVideoId()
    console.log('📤 Initial navigationStarted for video:', videoId)
    chrome.runtime.sendMessage({
      type: WorkerMessageTypes.navigationStarted,
      payload: { videoId },
    })
    
    // Wait a bit for YouTube to load its player data
    const extractionId = ++pendingExtractionId
    setTimeout(() => {
      extractAndSendTranscript(extractionId)
      injectAskAiButton()
    }, 1500)
  } else {
    // Not on a video page
    chrome.runtime.sendMessage({
      type: WorkerMessageTypes.noVideoPage,
    })
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
      removeAskAiButton()
      
      // Immediately notify that we're loading a new video
      const newVideoId = getVideoId()
      console.log('📤 Sending navigationStarted for video:', newVideoId)
      chrome.runtime.sendMessage({
        type: WorkerMessageTypes.navigationStarted,
        payload: { videoId: newVideoId },
      })
      
      // Invalidate any pending extractions and start a new one
      const extractionId = ++pendingExtractionId
      console.log('🔄 New extraction ID:', extractionId, 'for video:', newVideoId)
      
      // Wait longer for YouTube to fully load the new video page
      setTimeout(() => {
        console.log('⏰ Timeout elapsed, extracting transcript for video:', newVideoId, 'extractionId:', extractionId)
        extractAndSendTranscript(extractionId)
        injectAskAiButton()
      }, 2500)
    } else {
      // Clear cache if we navigate away from video page
      console.log('📤 Navigated away from video page, sending noVideoPage')
      currentVideoId = null
      transcriptCache = null
      removeAskAiButton()
      
      // Notify side panel that we're no longer on a video page
      chrome.runtime.sendMessage({
        type: WorkerMessageTypes.noVideoPage,
      })
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
  } else if (message.type === WorkerMessageTypes.tabStateRequest) {
    // Side panel is requesting current tab state (e.g., after tab switch)
    console.log('📥 Content script: tabStateRequest received')
    if (!isYouTubeVideoPage()) {
      console.log('📤 Content script: responding with no_video')
      sendResponse({ pageState: 'no_video' })
    } else if (transcriptCache) {
      console.log('📤 Content script: responding with ready, videoId:', transcriptCache.videoId)
      sendResponse({ 
        pageState: 'ready',
        videoId: transcriptCache.videoId,
        videoTitle: transcriptCache.metadata?.title || transcriptCache.videoTitle,
        transcript: transcriptCache,
      })
    } else {
      // On video page but transcript not ready yet
      console.log('📤 Content script: responding with loading, videoId:', getVideoId())
      sendResponse({ 
        pageState: 'loading',
        videoId: getVideoId(),
      })
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
