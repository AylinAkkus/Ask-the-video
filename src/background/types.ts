export enum WorkerMessageTypes {
  sidebarLoaded = 'sidebarLoaded',
  panelState = 'panelState',
  transcriptLoaded = 'transcriptLoaded',
  transcriptError = 'transcriptError',
  sendChatMessage = 'sendChatMessage',
  chatResponse = 'chatResponse',
  getTranscript = 'getTranscript',
  transcriptResponse = 'transcriptResponse',
  // Navigation state messages
  navigationStarted = 'navigationStarted',  // Video page detected, transcript loading
  noVideoPage = 'noVideoPage',              // Navigated away from video page
  tabStateRequest = 'tabStateRequest',      // Side panel requesting current tab state
}

export type PageState = 'no_video' | 'loading' | 'ready' | 'error'

export interface TabState {
  pageState: PageState
  videoId?: string
  videoTitle?: string
  error?: string
}
