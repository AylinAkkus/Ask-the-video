import { useEffect, useState, useRef } from 'react'
import { WorkerMessageTypes, PageState } from '../../background/types'
import { TranscriptResult } from '../../contentScript/youtubeTranscript'
import { streamChatResponse, ChatMessage as LLMChatMessage, MODELS, ModelId } from '../../utils/llm'
import { parseTimestampLinks } from '../../utils/timestampUtils'
import { storageGetJson, storageSetJson } from '../../utils/localStorage'
import './VideoChat.css'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

interface StoredChat {
  id: string
  videoId: string
  videoTitle: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

interface VideoInfo {
  videoId: string
  videoTitle: string | null
}

const STORAGE_KEY_CHATS = 'ask-video-chats'
const STORAGE_KEY_MODEL = 'ask-video-model'

const SUGGESTED_PROMPTS = [
  { label: 'Summarize', prompt: 'Summarize this video in a few bullet points' },
  { label: 'Key points', prompt: 'What are the key points discussed in this video?' },
  { label: 'Main takeaway', prompt: 'What is the main takeaway from this video?' },
]

const VideoChat = () => {
  const [pageState, setPageState] = useState<PageState>('loading')
  const [transcript, setTranscript] = useState<TranscriptResult | null>(null)
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([])
  const [question, setQuestion] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [isThinking, setIsThinking] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [showMenu, setShowMenu] = useState(false)
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [showChatsMenu, setShowChatsMenu] = useState(false)
  const [selectedModel, setSelectedModel] = useState<ModelId>('gpt-5-mini')
  const [storedChats, setStoredChats] = useState<StoredChat[]>([])
  const [currentChatId, setCurrentChatId] = useState<string | null>(null)
  const [loadedChatVideoId, setLoadedChatVideoId] = useState<string | null>(null) // Track if viewing a past chat for different video
  
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  
  // Refs to track current values for message handler (avoids stale closures)
  const currentVideoIdRef = useRef<string | null>(null)
  
  // Keep ref in sync with state
  useEffect(() => {
    currentVideoIdRef.current = videoInfo?.videoId || null
  }, [videoInfo?.videoId])

  // Load stored model preference and chats on mount
  useEffect(() => {
    storageGetJson<ModelId>(STORAGE_KEY_MODEL).then((model) => {
      if (model) setSelectedModel(model)
    })
    loadStoredChats()
  }, [])

  // Close menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
        setShowModelMenu(false)
        setShowChatsMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const loadStoredChats = async () => {
    const chats = await storageGetJson<StoredChat[]>(STORAGE_KEY_CHATS)
    if (chats) {
      setStoredChats(chats.sort((a, b) => b.updatedAt - a.updatedAt))
    }
  }

  const saveCurrentChat = async (messages: ChatMessage[]) => {
    if (!videoInfo?.videoId || messages.length === 0) return

    const chats = await storageGetJson<StoredChat[]>(STORAGE_KEY_CHATS) || []
    
    const chatId = currentChatId || `${videoInfo.videoId}-${Date.now()}`
    const existingIndex = chats.findIndex(c => c.id === chatId)
    
    const chat: StoredChat = {
      id: chatId,
      videoId: videoInfo.videoId,
      videoTitle: videoInfo.videoTitle || 'Untitled Video',
      messages,
      createdAt: existingIndex >= 0 ? chats[existingIndex].createdAt : Date.now(),
      updatedAt: Date.now(),
    }

    if (existingIndex >= 0) {
      chats[existingIndex] = chat
    } else {
      chats.unshift(chat)
      setCurrentChatId(chatId)
    }

    // Keep only last 50 chats
    const trimmedChats = chats.slice(0, 50)
    await storageSetJson(STORAGE_KEY_CHATS, trimmedChats)
    setStoredChats(trimmedChats)
  }

  const handleModelChange = async (model: ModelId) => {
    setSelectedModel(model)
    await storageSetJson(STORAGE_KEY_MODEL, model)
    setShowModelMenu(false)
    setShowMenu(false)
  }

  const handleNewChat = () => {
    setChatHistory([])
    setCurrentChatId(null)
    setShowMenu(false)
  }

  const handleLoadChat = (chat: StoredChat) => {
    setChatHistory(chat.messages)
    setCurrentChatId(chat.id)
    setShowChatsMenu(false)
    setShowMenu(false)
    
    // Track if this chat is for a different video than current
    if (chat.videoId !== videoInfo?.videoId) {
      setLoadedChatVideoId(chat.videoId)
    } else {
      setLoadedChatVideoId(null)
    }
  }

  // Notify background when side panel opens/closes for toggle behavior
  useEffect(() => {
    // Get current window ID and notify background we're open
    chrome.windows.getCurrent().then(win => {
      chrome.runtime.sendMessage({ type: 'sidePanelOpened', windowId: win.id })
    })

    // Listen for close command from background
    const handleClose = (message: { type: string }) => {
      if (message.type === 'closeSidePanel') {
        window.close()
      }
    }
    chrome.runtime.onMessage.addListener(handleClose)

    // Notify on unmount (before close)
    return () => {
      chrome.runtime.onMessage.removeListener(handleClose)
      chrome.windows.getCurrent().then(win => {
        chrome.runtime.sendMessage({ type: 'sidePanelClosed', windowId: win.id })
      })
    }
  }, [])

  useEffect(() => {
    const handleMessage = (message: { type: string; payload?: any }) => {
      switch (message.type) {
        case WorkerMessageTypes.navigationStarted:
          // New video detected, transcript loading
          console.log('📥 Side panel: navigationStarted', message.payload)
          const newVideoId = message.payload?.videoId
          const isNewVideo = newVideoId && newVideoId !== currentVideoIdRef.current
          
          setPageState('loading')
          setTranscript(null)
          setErrorMessage(null)
          setLoadedChatVideoId(null)
          
          // Always update videoInfo with new video, clear title until transcript loads
          if (newVideoId) {
            setVideoInfo({
              videoId: newVideoId,
              videoTitle: null,
            })
          }
          
          // Clear chat if navigating to different video
          if (isNewVideo) {
            console.log('📥 Clearing chat - new video:', newVideoId, 'was:', currentVideoIdRef.current)
            setChatHistory([])
            setCurrentChatId(null)
          }
          break
          
        case WorkerMessageTypes.noVideoPage:
          // Navigated away from video page
          console.log('📥 Side panel: noVideoPage')
          setPageState('no_video')
          setTranscript(null)
          setVideoInfo(null)
          setLoadedChatVideoId(null)
          // Don't clear chat history - user might want to continue viewing
          break
          
        case WorkerMessageTypes.transcriptLoaded:
          // Transcript ready
          console.log('📥 Side panel: transcriptLoaded', message.payload?.videoId)
          const data: TranscriptResult = message.payload
          const transcriptIsNewVideo = data.videoId && data.videoId !== currentVideoIdRef.current
          
          // Clear chat if this is a different video than what we had
          if (transcriptIsNewVideo) {
            console.log('📥 Transcript for new video, clearing chat')
            setChatHistory([])
            setCurrentChatId(null)
          }
          
          setTranscript(data)
          setPageState('ready')
          setErrorMessage(null)
          setLoadedChatVideoId(null)
          
          if (data.videoId) {
            setVideoInfo({
              videoId: data.videoId,
              videoTitle: data.metadata?.title || data.videoTitle || null,
            })
          }
          break
          
        case WorkerMessageTypes.transcriptError:
          console.log('📥 Side panel: transcriptError', message.payload)
          setErrorMessage(message.payload?.error || 'Failed to load transcript')
          setPageState('error')
          break
          
        case 'tabActivated':
        case 'refreshState':
          // User switched to a different tab OR clicked "Ask AI" button again
          console.log('📥 Side panel:', message.type, message.payload)
          const tabState = message.payload
          const tabVideoId = tabState.transcript?.videoId || tabState.videoId
          const tabIsNewVideo = tabVideoId && tabVideoId !== currentVideoIdRef.current
          
          setPageState(tabState.pageState || 'no_video')
          setLoadedChatVideoId(null)
          
          if (tabState.transcript) {
            setTranscript(tabState.transcript)
            setVideoInfo({
              videoId: tabState.transcript.videoId,
              videoTitle: tabState.transcript.metadata?.title || tabState.transcript.videoTitle || null,
            })
          } else {
            setTranscript(null)
            if (tabState.videoId) {
              setVideoInfo({
                videoId: tabState.videoId,
                videoTitle: tabState.videoTitle || null,
              })
            } else {
              setVideoInfo(null)
            }
          }
          
          // Clear chat if different video
          if (tabIsNewVideo) {
            setChatHistory([])
            setCurrentChatId(null)
          }
          break
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage)

    // Request initial state
    chrome.runtime.sendMessage({ type: WorkerMessageTypes.tabStateRequest }, (response) => {
      if (chrome.runtime.lastError) {
        // Content script not ready, try getTranscript as fallback
        chrome.runtime.sendMessage({ type: WorkerMessageTypes.getTranscript }, (resp) => {
          if (resp?.success && resp.data) {
            setTranscript(resp.data)
            setPageState('ready')
            if (resp.data.videoId) {
              setVideoInfo({
                videoId: resp.data.videoId,
                videoTitle: resp.data.metadata?.title || resp.data.videoTitle || null,
              })
            }
          } else {
            setPageState('no_video')
          }
        })
        return
      }
      
      if (response) {
        setPageState(response.pageState || 'no_video')
        if (response.transcript) {
          setTranscript(response.transcript)
          setVideoInfo({
            videoId: response.transcript.videoId,
            videoTitle: response.transcript.metadata?.title || response.transcript.videoTitle || null,
          })
        } else if (response.videoId) {
          setVideoInfo({
            videoId: response.videoId,
            videoTitle: response.videoTitle || null,
          })
        }
      } else {
        setPageState('no_video')
      }
    })

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage)
    }
  }, []) // Empty deps - handler uses refs for current state

  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
    }
  }, [chatHistory])

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + 'px'
    }
  }, [question])

  const sendMessage = async (content: string) => {
    if (!content.trim() || !transcript?.transcript || isProcessing) return

    const userMessage: ChatMessage = {
      role: 'user',
      content: content.trim(),
      timestamp: Date.now(),
    }

    const newHistory = [...chatHistory, userMessage]
    setChatHistory(newHistory)
    setQuestion('')
    setIsProcessing(true)
    setIsThinking(true)
    setStreamingContent('')

    try {
      const llmHistory: LLMChatMessage[] = chatHistory.map(msg => ({
        role: msg.role,
        content: msg.content,
      }))

      const response = await streamChatResponse(
        transcript.transcript,
        llmHistory,
        userMessage.content,
        (_chunk, fullText) => {
          setIsThinking(false)
          setStreamingContent(fullText)
        },
        transcript.metadata,
        selectedModel
      )

      if (response.error) {
        throw new Error(response.errorMessage || 'Failed to get response')
      }

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: response.response,
        timestamp: Date.now(),
      }

      const finalHistory = [...newHistory, assistantMessage]
      setChatHistory(finalHistory)
      setStreamingContent('')
      saveCurrentChat(finalHistory)

      chrome.runtime.sendMessage({
        type: WorkerMessageTypes.chatResponse,
        payload: { response: response.response },
      })
    } catch (error) {
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: Date.now(),
      }
      const finalHistory = [...newHistory, errorMessage]
      setChatHistory(finalHistory)
      setStreamingContent('')
    } finally {
      setIsProcessing(false)
      setIsThinking(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(question)
    }
  }

  const formatChatPreview = (chat: StoredChat) => {
    const firstUserMsg = chat.messages.find(m => m.role === 'user')
    return firstUserMsg?.content.slice(0, 40) + (firstUserMsg && firstUserMsg.content.length > 40 ? '...' : '') || 'Empty chat'
  }

  // Header component
  const Header = () => (
    <div className="vc-header">
      <button className="vc-icon-btn" onClick={handleNewChat} title="New chat">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      </button>
      
      <div className="vc-menu-container" ref={menuRef}>
        <button className="vc-icon-btn" onClick={() => setShowMenu(!showMenu)} title="Menu">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="6" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="18" r="2" />
          </svg>
        </button>
        
        {showMenu && (
          <div className="vc-menu">
            <button 
              className="vc-menu-item"
              onClick={() => { setShowModelMenu(!showModelMenu); setShowChatsMenu(false) }}
            >
              <span>{MODELS.find(m => m.id === selectedModel)?.name}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
            
            <button 
              className="vc-menu-item"
              onClick={() => { setShowChatsMenu(!showChatsMenu); setShowModelMenu(false) }}
            >
              <span>Switch Chat</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>

            {/* Model submenu */}
            {showModelMenu && (
              <div className="vc-submenu">
                {MODELS.map((model) => (
                  <button
                    key={model.id}
                    className={`vc-menu-item ${selectedModel === model.id ? 'vc-menu-item-active' : ''}`}
                    onClick={() => handleModelChange(model.id)}
                  >
                    {model.name}
                    {selectedModel === model.id && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Chats submenu */}
            {showChatsMenu && (
              <div className="vc-submenu vc-submenu-chats">
                {storedChats.length === 0 ? (
                  <div className="vc-menu-empty">No past chats</div>
                ) : (
                  storedChats.slice(0, 10).map((chat) => (
                    <button
                      key={chat.id}
                      className={`vc-menu-item vc-chat-item ${currentChatId === chat.id ? 'vc-menu-item-active' : ''}`}
                      onClick={() => handleLoadChat(chat)}
                    >
                      <div className="vc-chat-item-content">
                        <span className="vc-chat-item-title">{chat.videoTitle.slice(0, 30)}{chat.videoTitle.length > 30 ? '...' : ''}</span>
                        <span className="vc-chat-item-preview">{formatChatPreview(chat)}</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )

  // Determine if we can send messages
  const canSend = pageState === 'ready' && transcript?.transcript && !isProcessing && !loadedChatVideoId
  const isTranscriptLoading = pageState === 'loading'
  const isViewingPastChat = loadedChatVideoId !== null && loadedChatVideoId !== videoInfo?.videoId

  // Error state (full screen)
  if (pageState === 'error') {
    return (
      <div className="vc-container">
        <Header />
        <div className="vc-center-content">
          <div className="vc-error-icon">!</div>
          <p className="vc-text-muted">{errorMessage || 'Failed to load transcript'}</p>
          <p className="vc-text-small">Make sure you're on a YouTube video with captions.</p>
        </div>
      </div>
    )
  }

  // No video state - but still allow browsing past chats
  if (pageState === 'no_video' && chatHistory.length === 0) {
    return (
      <div className="vc-container">
        <Header />
        <div className="vc-center-content">
          <p className="vc-text-muted">Navigate to a YouTube video to start.</p>
          {storedChats.length > 0 && (
            <p className="vc-text-small" style={{ marginTop: '8px' }}>
              Or browse your past chats from the menu above.
            </p>
          )}
        </div>
      </div>
    )
  }

  const videoTitle = transcript?.metadata?.title || videoInfo?.videoTitle || 'Video'
  const displayTitle = loadedChatVideoId 
    ? storedChats.find(c => c.videoId === loadedChatVideoId)?.videoTitle || 'Past Chat'
    : videoTitle

  return (
    <div className="vc-container">
      <Header />
      
      {/* Loading banner */}
      {isTranscriptLoading && (
        <div className="vc-loading-banner">
          <div className="vc-loading-spinner" />
          <span>Loading transcript...</span>
        </div>
      )}
      
      {/* Past chat warning banner */}
      {isViewingPastChat && (
        <div className="vc-warning-banner">
          <span>Viewing past chat. Navigate to this video to continue.</span>
        </div>
      )}
      
      {/* Chat area */}
      <div className="vc-chat-area" ref={scrollAreaRef}>
        {chatHistory.length === 0 && !isTranscriptLoading ? (
          <div className="vc-empty-state">
            <h2>Ask about this video</h2>
            <p className="vc-text-muted">
              I can answer questions based on the transcript.
            </p>
            
            <div className="vc-prompts">
              {SUGGESTED_PROMPTS.map((item, idx) => (
                <button
                  key={idx}
                  className="vc-prompt-btn"
                  onClick={() => sendMessage(item.prompt)}
                  disabled={!canSend}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ) : chatHistory.length === 0 && isTranscriptLoading ? (
          <div className="vc-empty-state">
            <h2>Ask about this video</h2>
            <p className="vc-text-muted">
              Transcript is loading. You can start typing your question.
            </p>
          </div>
        ) : (
          <div className="vc-messages">
            {chatHistory.map((msg, index) => (
              <div key={index} className={`vc-message vc-message-${msg.role}`}>
                <div className="vc-message-content">
                  {msg.role === 'assistant' 
                    ? parseTimestampLinks(msg.content, loadedChatVideoId || videoInfo?.videoId || '')
                    : msg.content
                  }
                </div>
              </div>
            ))}
            {isProcessing && (
              <div className="vc-message vc-message-assistant">
                {isThinking ? (
                  <div className="vc-thinking">
                    <div className="vc-thinking-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 6v6l4 2" />
                      </svg>
                    </div>
                    <span>Thinking...</span>
                  </div>
                ) : (
                  <div className="vc-message-content vc-streaming">
                    {parseTimestampLinks(streamingContent, videoInfo?.videoId || '')}
                    <span className="vc-cursor" />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="vc-input-area">
        <div className={`vc-context-pill ${isTranscriptLoading ? 'vc-context-pill-loading' : ''} ${isViewingPastChat ? 'vc-context-pill-warning' : ''}`}>
          <span className="vc-context-icon">{isTranscriptLoading ? '⏳' : '▶'}</span>
          <span className="vc-context-text" title={displayTitle}>
            {displayTitle.length > 35 ? displayTitle.slice(0, 35) + '...' : displayTitle}
          </span>
        </div>
        
        <div className="vc-input-wrapper">
          <textarea
            ref={inputRef}
            className="vc-input"
            placeholder={isTranscriptLoading ? "Type your question while transcript loads..." : isViewingPastChat ? "Navigate to video to chat" : "Ask anything..."}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isProcessing || isViewingPastChat}
            rows={1}
          />
          <button
            className="vc-send-btn"
            onClick={() => sendMessage(question)}
            disabled={!question.trim() || !canSend}
            title={isTranscriptLoading ? "Waiting for transcript..." : isViewingPastChat ? "Navigate to video first" : "Send message"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 2L11 13M22 2L15 22L11 13L2 9L22 2Z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

export default VideoChat
