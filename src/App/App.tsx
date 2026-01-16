import '@mantine/core/styles.css'
import { Stack, MantineProvider } from '@mantine/core'
import VideoChat from './VideoChat/VideoChat'

import './App.css'

const App = () => {
  return (
    <MantineProvider
      theme={{
        primaryColor: 'blue',
        defaultRadius: 'md',
      }}
    >
      <Stack style={{ height: '100vh', padding: '0' }} gap={0}>
        <VideoChat />
      </Stack>
    </MantineProvider>
  )
}

export default App
