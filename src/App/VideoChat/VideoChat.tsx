import { useEffect, useState, useRef } from 'react'
import { WorkerMessageTypes, PageState } from '../../background/types'
import { TranscriptResult } from '../../contentScript/youtubeTranscript'
import { streamChatResponse, ChatMessage as LLMChatMessage, ModelId, getModelConfig, hasApiKey, MODELS } from '../../utils/llm'
import { parseTimestampLinks } from '../../utils/timestampUtils'
import { storageGetJson, storageSetJson, Provider, hasAnyApiKey as checkHasAnyKey } from '../../utils/localStorage'
import Settings from '../Settings/Settings'
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
  transcript?: TranscriptResult // Store transcript for resuming chats
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
  const [showChatsMenu, setShowChatsMenu] = useState(false)
  const [selectedModel, setSelectedModel] = useState<ModelId>('gemini-3-flash-preview')
  const [storedChats, setStoredChats] = useState<StoredChat[]>([])
  const [currentChatId, setCurrentChatId] = useState<string | null>(null)
  const [loadedChatVideoId, setLoadedChatVideoId] = useState<string | null>(null)
  const [loadedChatTranscript, setLoadedChatTranscript] = useState<TranscriptResult | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [hasCurrentProviderKey, setHasCurrentProviderKey] = useState(true)
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [apiKeyStatus, setApiKeyStatus] = useState<Record<Provider, boolean>>({
    openai: false,
    google: false,
    anthropic: false,
  })
  const [hasAnyKey, setHasAnyKey] = useState<boolean | null>(null) // null = loading
  
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const modelDropdownRef = useRef<HTMLDivElement>(null)
  
  const currentVideoIdRef = useRef<string | null>(null)
  
  useEffect(() => {
    currentVideoIdRef.current = videoInfo?.videoId || null
  }, [videoInfo?.videoId])

  useEffect(() => {
    storageGetJson<ModelId>(STORAGE_KEY_MODEL).then((model) => {
      if (model) setSelectedModel(model)
    })
    loadStoredChats()
    checkApiKeyStatus()
  }, [])

  // Check if current model has API key
  const checkApiKeyStatus = async () => {
    const modelConfig = getModelConfig(selectedModel)
    const hasKey = await hasApiKey(modelConfig.provider)
    setHasCurrentProviderKey(hasKey)
    
    // Check all providers
    const [openai, google, anthropic, anyKey] = await Promise.all([
      hasApiKey('openai'),
      hasApiKey('google'),
      hasApiKey('anthropic'),
      checkHasAnyKey(),
    ])
    setApiKeyStatus({ openai, google, anthropic })
    setHasAnyKey(anyKey)
  }

  // Re-check API key when model changes
  useEffect(() => {
    checkApiKeyStatus()
  }, [selectedModel])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
        setShowChatsMenu(false)
      }
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false)
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
    
    // Use the active transcript (either from current page or loaded chat)
    const activeTranscript = loadedChatTranscript || transcript
    
    const chat: StoredChat = {
      id: chatId,
      videoId: videoInfo.videoId,
      videoTitle: videoInfo.videoTitle || 'Untitled Video',
      messages,
      createdAt: existingIndex >= 0 ? chats[existingIndex].createdAt : Date.now(),
      updatedAt: Date.now(),
      transcript: activeTranscript || undefined,
    }

    if (existingIndex >= 0) {
      chats[existingIndex] = chat
    } else {
      chats.unshift(chat)
      setCurrentChatId(chatId)
    }

    const trimmedChats = chats.slice(0, 50)
    await storageSetJson(STORAGE_KEY_CHATS, trimmedChats)
    setStoredChats(trimmedChats)
  }

  const handleNewChat = () => {
    setChatHistory([])
    setCurrentChatId(null)
    setLoadedChatVideoId(null)
    setLoadedChatTranscript(null)
    setShowMenu(false)
  }

  const handleLoadChat = (chat: StoredChat) => {
    setChatHistory(chat.messages)
    setCurrentChatId(chat.id)
    setShowChatsMenu(false)
    setShowMenu(false)
    
    if (chat.videoId !== videoInfo?.videoId) {
      setLoadedChatVideoId(chat.videoId)
      // Use the stored transcript for continuing the chat
      setLoadedChatTranscript(chat.transcript || null)
    } else {
      setLoadedChatVideoId(null)
      setLoadedChatTranscript(null)
    }
  }

  const handleCloseSettings = async () => {
    setShowSettings(false)
    
    // Reload selected model in case it changed in settings
    const model = await storageGetJson<ModelId>(STORAGE_KEY_MODEL)
    if (model) setSelectedModel(model)
    
    // Re-check API key status
    await checkApiKeyStatus()
  }

  const handleModelSelect = async (modelId: ModelId) => {
    setSelectedModel(modelId)
    await storageSetJson(STORAGE_KEY_MODEL, modelId)
    setShowModelDropdown(false)
  }

  // Group models by provider
  const modelsByProvider = MODELS.reduce((acc, model) => {
    if (!acc[model.provider]) acc[model.provider] = []
    acc[model.provider].push(model)
    return acc
  }, {} as Record<Provider, typeof MODELS>)

  const providerLabels: Record<Provider, string> = {
    openai: 'OpenAI',
    google: 'Google AI',
    anthropic: 'Anthropic',
  }

  useEffect(() => {
    chrome.windows.getCurrent().then(win => {
      chrome.runtime.sendMessage({ type: 'sidePanelOpened', windowId: win.id })
    })

    const handleClose = (message: { type: string }) => {
      if (message.type === 'closeSidePanel') {
        window.close()
      }
    }
    chrome.runtime.onMessage.addListener(handleClose)

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
          const newVideoId = message.payload?.videoId
          const isNewVideo = newVideoId && newVideoId !== currentVideoIdRef.current
          
          setPageState('loading')
          setTranscript(null)
          setErrorMessage(null)
          setLoadedChatVideoId(null)
          setLoadedChatTranscript(null)
          
          if (newVideoId) {
            setVideoInfo({
              videoId: newVideoId,
              videoTitle: null,
            })
          }
          
          if (isNewVideo) {
            setChatHistory([])
            setCurrentChatId(null)
          }
          break
          
        case WorkerMessageTypes.noVideoPage:
          setPageState('no_video')
          setTranscript(null)
          setVideoInfo(null)
          setLoadedChatVideoId(null)
          setLoadedChatTranscript(null)
          break
          
        case WorkerMessageTypes.transcriptLoaded:
          const data: TranscriptResult = message.payload
          const transcriptIsNewVideo = data.videoId && data.videoId !== currentVideoIdRef.current
          
          if (transcriptIsNewVideo) {
            setChatHistory([])
            setCurrentChatId(null)
          }
          
          setTranscript(data)
          setPageState('ready')
          setErrorMessage(null)
          setLoadedChatVideoId(null)
          setLoadedChatTranscript(null)
          
          if (data.videoId) {
            setVideoInfo({
              videoId: data.videoId,
              videoTitle: data.metadata?.title || data.videoTitle || null,
            })
          }
          break
          
        case WorkerMessageTypes.transcriptError:
          setErrorMessage(message.payload?.error || 'Failed to load transcript')
          setPageState('error')
          break
          
        case 'tabActivated':
        case 'refreshState':
          const tabState = message.payload
          const tabVideoId = tabState.transcript?.videoId || tabState.videoId
          const tabIsNewVideo = tabVideoId && tabVideoId !== currentVideoIdRef.current
          
          setPageState(tabState.pageState || 'no_video')
          setLoadedChatVideoId(null)
          setLoadedChatTranscript(null)
          
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
          
          if (tabIsNewVideo) {
            setChatHistory([])
            setCurrentChatId(null)
          }
          break
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage)

    chrome.runtime.sendMessage({ type: WorkerMessageTypes.tabStateRequest }, (response) => {
      if (chrome.runtime.lastError) {
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
  }, [])

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
    // Use loaded chat transcript if viewing a past chat, otherwise use current page transcript
    const activeTranscript = loadedChatTranscript || transcript
    if (!content.trim() || !activeTranscript?.transcript || isProcessing) return

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
        activeTranscript.transcript,
        llmHistory,
        userMessage.content,
        (_chunk, fullText) => {
          setIsThinking(false)
          setStreamingContent(fullText)
        },
        activeTranscript.metadata,
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
      const errorMsg: ChatMessage = {
        role: 'assistant',
        content: `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: Date.now(),
      }
      const finalHistory = [...newHistory, errorMsg]
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

  const currentModelConfig = getModelConfig(selectedModel)

  const Header = () => (
    <div className="vc-header">
      {/* Model dropdown on the left */}
      <div className="vc-model-dropdown-container" ref={modelDropdownRef}>
        <button 
          className="vc-model-dropdown-trigger" 
          onClick={() => setShowModelDropdown(!showModelDropdown)}
        >
          <span>{currentModelConfig.name}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        
        {showModelDropdown && (
          <div className="vc-model-dropdown">
            {(Object.keys(modelsByProvider) as Provider[]).map((provider) => (
              <div key={provider} className="vc-model-dropdown-group">
                <div className="vc-model-dropdown-group-header">
                  <span>{providerLabels[provider]}</span>
                  {!apiKeyStatus[provider] && (
                    <span className="vc-model-dropdown-warning" title="API key not configured">!</span>
                  )}
                </div>
                {modelsByProvider[provider].map((model) => (
                  <button
                    key={model.id}
                    className={`vc-model-dropdown-item ${selectedModel === model.id ? 'vc-model-dropdown-item-active' : ''} ${!apiKeyStatus[provider] ? 'vc-model-dropdown-item-disabled' : ''}`}
                    onClick={() => apiKeyStatus[provider] && handleModelSelect(model.id)}
                    disabled={!apiKeyStatus[provider]}
                  >
                    <span>{model.name}</span>
                    {selectedModel === model.id && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right side buttons */}
      <div className="vc-header-actions">
        <button className="vc-icon-btn" onClick={handleNewChat} title="New chat">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        </button>

        <button className="vc-icon-btn" onClick={() => setShowSettings(true)} title="Settings">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
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
                onClick={() => setShowChatsMenu(!showChatsMenu)}
              >
                <span>Switch Chat</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>

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
    </div>
  )

  // Show settings view
  if (showSettings) {
    return <Settings onBack={handleCloseSettings} />
  }

  // Loading state while checking API keys
  if (hasAnyKey === null) {
    return (
      <div className="vc-container">
        <div className="vc-center-content">
          <div className="vc-loader" />
        </div>
      </div>
    )
  }

  // Show setup screen if no API keys configured
  if (hasAnyKey === false) {
    return (
      <div className="vc-container">
        <div className="vc-setup-screen">
          <div className="vc-setup-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
          </div>
          <h1>Welcome to VidChat</h1>
          <p className="vc-setup-subtitle">
            Chat with any YouTube video using AI. To get started, add an API key from one of these providers:
          </p>
          
          <div className="vc-setup-providers">
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="vc-setup-provider">
              <span className="vc-setup-provider-name">Google AI</span>
              <span className="vc-setup-provider-badge">Free tier</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
              </svg>
            </a>
            <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="vc-setup-provider">
              <span className="vc-setup-provider-name">OpenAI</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
              </svg>
            </a>
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="vc-setup-provider">
              <span className="vc-setup-provider-name">Anthropic</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
              </svg>
            </a>
          </div>

          <button className="vc-setup-btn" onClick={() => setShowSettings(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Enter API Key
          </button>
          
          <p className="vc-setup-note">
            Your keys are stored locally and never sent to our servers.
          </p>
        </div>
      </div>
    )
  }

  // Can send if we have a transcript (either from current page or loaded past chat)
  const activeTranscript = loadedChatTranscript || transcript
  const hasActiveTranscript = !!activeTranscript?.transcript
  const canSend = hasActiveTranscript && !isProcessing && hasCurrentProviderKey
  const isTranscriptLoading = pageState === 'loading' && !loadedChatTranscript
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
      
      {/* API Key missing banner */}
      {!hasCurrentProviderKey && (
        <div className="vc-api-key-banner" onClick={() => setShowSettings(true)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
          </svg>
          <span>Add API key for {currentModelConfig.name} in Settings</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </div>
      )}
      
      {/* Loading banner */}
      {isTranscriptLoading && (
        <div className="vc-loading-banner">
          <div className="vc-loading-spinner" />
          <span>Loading transcript...</span>
        </div>
      )}
      
      {/* Past chat info banner */}
      {isViewingPastChat && (
        <div className={`vc-info-banner ${loadedChatTranscript ? '' : 'vc-warning-banner'}`}>
          <span>
            {loadedChatTranscript 
              ? 'Viewing past chat. You can continue this conversation.'
              : 'Viewing past chat without transcript. Navigate to video to continue.'}
          </span>
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
        <div className={`vc-context-pill ${isTranscriptLoading ? 'vc-context-pill-loading' : ''} ${isViewingPastChat && !loadedChatTranscript ? 'vc-context-pill-warning' : ''}`}>
          <span className="vc-context-icon">{isTranscriptLoading ? '⏳' : '▶'}</span>
          <span className="vc-context-text" title={displayTitle}>
            {displayTitle.length > 35 ? displayTitle.slice(0, 35) + '...' : displayTitle}
          </span>
        </div>
        
        <div className="vc-input-wrapper">
          <textarea
            ref={inputRef}
            className="vc-input"
            placeholder={
              !hasCurrentProviderKey 
                ? "Add API key in Settings to chat..." 
                : isTranscriptLoading 
                  ? "Type your question while transcript loads..." 
                  : isViewingPastChat && !loadedChatTranscript
                    ? "Navigate to video to chat (no stored transcript)" 
                    : "Ask anything..."
            }
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isProcessing || !hasCurrentProviderKey || (isViewingPastChat && !loadedChatTranscript)}
            rows={1}
          />
          <button
            className="vc-send-btn"
            onClick={() => sendMessage(question)}
            disabled={!question.trim() || !canSend}
            title={
              !hasCurrentProviderKey 
                ? "API key required" 
                : isTranscriptLoading 
                  ? "Waiting for transcript..." 
                  : !hasActiveTranscript
                    ? "No transcript available" 
                    : "Send message"
            }
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
