import { useState, useEffect } from 'react'
import { getApiKeys, setApiKey, ApiKeys, Provider } from '../../utils/localStorage'
import './Settings.css'

interface SettingsProps {
  onBack: () => void
}

interface ProviderConfig {
  id: Provider
  name: string
  placeholder: string
  helpUrl: string
  helpText: string
}

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    placeholder: 'sk-...',
    helpUrl: 'https://platform.openai.com/api-keys',
    helpText: 'Get API key',
  },
  {
    id: 'google',
    name: 'Google AI',
    placeholder: 'AIza...',
    helpUrl: 'https://aistudio.google.com/apikey',
    helpText: 'Get API key',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    placeholder: 'sk-ant-...',
    helpUrl: 'https://console.anthropic.com/settings/keys',
    helpText: 'Get API key',
  },
]

const Settings = ({ onBack }: SettingsProps) => {
  const [keys, setKeys] = useState<ApiKeys>({})
  const [saving, setSaving] = useState<Provider | null>(null)
  const [showKey, setShowKey] = useState<Record<Provider, boolean>>({
    openai: false,
    google: false,
    anthropic: false,
  })
  const [version, setVersion] = useState<string>('1.0.0')

  useEffect(() => {
    const init = async () => {
      const apiKeys = await getApiKeys()
      setKeys(apiKeys)
      
      // Get version from manifest
      chrome.runtime.getManifest && setVersion(chrome.runtime.getManifest().version)
    }
    
    init()
  }, [])

  const handleSave = async (provider: Provider, value: string) => {
    setSaving(provider)
    await setApiKey(provider, value)
    setKeys((prev) => ({
      ...prev,
      [provider]: value.trim() || undefined,
    }))
    setSaving(null)
  }

  const toggleShowKey = (provider: Provider) => {
    setShowKey((prev) => ({ ...prev, [provider]: !prev[provider] }))
  }

  return (
    <div className="settings-container">
      <div className="settings-header">
        <button className="settings-back-btn" onClick={onBack} title="Back to chat">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <h1>Settings</h1>
      </div>

      <div className="settings-content">
        <div className="settings-section">
          <h2>API Keys</h2>
          <p className="settings-description">
            Add your API keys to use different AI models. Keys are stored locally in your browser.
          </p>

          <div className="settings-providers">
            {PROVIDERS.map((provider) => (
              <div key={provider.id} className="settings-provider">
                <div className="settings-provider-header">
                  <label htmlFor={`key-${provider.id}`}>{provider.name}</label>
                  <a
                    href={provider.helpUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="settings-help-link"
                  >
                    {provider.helpText}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
                    </svg>
                  </a>
                </div>
                <div className="settings-input-wrapper">
                  <input
                    id={`key-${provider.id}`}
                    type={showKey[provider.id] ? 'text' : 'password'}
                    placeholder={provider.placeholder}
                    value={keys[provider.id] || ''}
                    onChange={(e) => setKeys((prev) => ({ ...prev, [provider.id]: e.target.value }))}
                    onBlur={(e) => handleSave(provider.id, e.target.value)}
                    className="settings-input"
                  />
                  <button
                    type="button"
                    className="settings-toggle-visibility"
                    onClick={() => toggleShowKey(provider.id)}
                    title={showKey[provider.id] ? 'Hide' : 'Show'}
                  >
                    {showKey[provider.id] ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                  {saving === provider.id && <span className="settings-saving">Saving...</span>}
                  {keys[provider.id] && saving !== provider.id && (
                    <span className="settings-saved">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="settings-section settings-info">
          <h2>About</h2>
          <p>
            VidChat lets you chat with YouTube videos using AI. Your API keys are stored locally and never sent to our servers. We don't even have any servers.
          </p>
          <p className="settings-version">Version {version}</p>
        </div>
      </div>
    </div>
  )
}

export default Settings
