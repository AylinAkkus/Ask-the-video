import { defineManifest } from '@crxjs/vite-plugin'
import packageData from '../package.json'
// import { getI18nTextEmulation } from './utils/i18n'

const isDev: boolean = process.env.NODE_ENV == 'development'

export default defineManifest({
  name: `__MSG_appName__${isDev ? ` ➡️ Dev` : ''}`,
  description: '__MSG_shortDesc__',
  version: packageData.version,
  default_locale: 'en',
  manifest_version: 3,
  icons: {
    16: 'public/img/icon-16.png',
    32: 'public/img/icon-34.png',
    48: 'public/img/icon-48.png',
    128: 'public/img/icon-128.png',
  },
  action: {
    default_icon: 'public/img/icon-48.png',
    // default_icon: 'img/logo.png',
    //default_popup: 'popup.html'
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  side_panel: {
    default_path: 'sidepanel.html',
  },
  content_scripts: [
    {
      matches: ['https://www.youtube.com/watch*'],
      js: ['src/contentScript/content-script.ts'],
      run_at: 'document_end',
    },
  ],
  web_accessible_resources: [
    {
      resources: [
        'public/img/icon-16.png',
        'public/img/icon-34.png',
        'public/img/icon-48.png',
        'public/img/icon-128.png',
      ],
      matches: [],
    },
    {
      resources: ['public/img/icon-128.png'],
      matches: ['http://*/*', 'https://*/*'],
    },
  ],
  permissions: [
    // 'activeTab',
    'tabs',
    'storage',
    'scripting',
    'sidePanel',
  ],
  host_permissions: ['https://localhost:3000/*', '<all_urls>'],
} as any)
