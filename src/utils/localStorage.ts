/* eslint-disable no-undef */

const isChromeExtension = () =>
  typeof chrome !== 'undefined' && !!chrome.storage?.local

export const storageSet = (key: string, value: string | number | boolean) => {
  if (isChromeExtension()) {
    chrome.storage.local.set({ [key]: value })
  } else {
    localStorage.setItem(key, value.toString())
  }
}

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

export const storageGet = (key: string, callback: (arg: any) => void) => {
  if (isChromeExtension()) {
    chrome.storage.local.get(key, (result) => {
      const value = result[key]

      if (typeof callback === 'function') {
        callback(value)
      }
    })
  } else {
    const value = localStorage.getItem(key)
    if (typeof callback === 'function') {
      callback(value)
    }
  }
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

export const storageWatch = (key: string, callback: (data: string) => any) => {
  if (isChromeExtension()) {
    chrome.storage.onChanged.addListener((changes) => {
      if (typeof callback === 'function' && changes[key]) {
        callback(changes[key].newValue)
      }
    })
  }
}
