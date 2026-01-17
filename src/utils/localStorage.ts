const isChromeExtension = () =>
  typeof chrome !== 'undefined' && !!chrome.storage?.local

export const storageSetJson = <T>(key: string, value: T): Promise<void> => {
  return new Promise((resolve) => {
    if (isChromeExtension()) {
      chrome.storage.local.set({ [key]: value }, resolve)
    } else {
      localStorage.setItem(key, JSON.stringify(value))
      resolve()
    }
  })
}

export const storageGetJson = <T>(key: string): Promise<T | null> => {
  return new Promise((resolve) => {
    if (isChromeExtension()) {
      chrome.storage.local.get(key, (result) => {
        resolve(result[key] ?? null)
      })
    } else {
      const value = localStorage.getItem(key)
      resolve(value ? JSON.parse(value) : null)
    }
  })
}

// API Key Storage
export type Provider = 'openai' | 'google' | 'anthropic'

export interface ApiKeys {
  openai?: string
  google?: string
  anthropic?: string
}

const STORAGE_KEY_API_KEYS = 'ask-video-api-keys'

export const getApiKeys = async (): Promise<ApiKeys> => {
  const keys = await storageGetJson<ApiKeys>(STORAGE_KEY_API_KEYS)
  return keys || {}
}

export const setApiKey = async (provider: Provider, key: string): Promise<void> => {
  const keys = await getApiKeys()
  if (key.trim()) {
    keys[provider] = key.trim()
  } else {
    delete keys[provider]
  }
  await storageSetJson(STORAGE_KEY_API_KEYS, keys)
}

export const getApiKey = async (provider: Provider): Promise<string | null> => {
  const keys = await getApiKeys()
  return keys[provider] || null
}

export const hasAnyApiKey = async (): Promise<boolean> => {
  const keys = await getApiKeys()
  return !!(keys.openai || keys.google || keys.anthropic)
}
