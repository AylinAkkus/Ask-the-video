import React from 'react'

/**
 * Parse timestamp links in text and make them clickable
 * Timestamps in format [MM:SS] or [HH:MM:SS]
 */
export function parseTimestampLinks(text: string, videoId: string): React.ReactNode {
  // Regex to match timestamps like [1:23] or [1:23:45]
  const timestampRegex = /\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]/g
  
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match

  while ((match = timestampRegex.exec(text)) !== null) {
    // Add text before the timestamp
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index))
    }

    const fullMatch = match[0] // e.g., "[1:23]"
    const hours = match[3] ? parseInt(match[1]) : 0
    const minutes = match[3] ? parseInt(match[2]) : parseInt(match[1])
    const seconds = match[3] ? parseInt(match[3]) : parseInt(match[2])

    // Calculate total seconds
    const totalSeconds = hours * 3600 + minutes * 60 + seconds

    // Create clickable link
    parts.push(
      <a
        key={match.index}
        href={`https://www.youtube.com/watch?v=${videoId}&t=${totalSeconds}s`}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: '#1976d2',
          textDecoration: 'none',
          fontWeight: 600,
          cursor: 'pointer',
        }}
        onClick={(e) => {
          e.preventDefault()
          // Try to seek in the current tab's video player
          seekToTimestamp(totalSeconds)
        }}
      >
        {fullMatch}
      </a>
    )

    lastIndex = match.index + fullMatch.length
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex))
  }

  return parts.length > 0 ? <>{parts}</> : text
}

/**
 * Seek to a specific timestamp in the YouTube video
 */
function seekToTimestamp(seconds: number) {
  // Send message to content script to seek the video
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, {
        type: 'seekVideo',
        payload: { seconds },
      })
    }
  })
}

/**
 * Format seconds to timestamp string
 */
export function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

