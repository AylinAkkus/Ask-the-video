import { useEffect } from 'react'
import App from '../App/App'

export const SidePanel = () => {
  useEffect(() => {
    const handleMessage = (message: { type: string }) => {
      if (message.type === 'closeSidePanel') {
        window.close()
      }
    }
    
    chrome.runtime.onMessage.addListener(handleMessage)
    return () => chrome.runtime.onMessage.removeListener(handleMessage)
  }, [])

  return <App />
}

export default SidePanel
