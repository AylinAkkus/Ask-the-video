# AskTheVideo - YouTube Video Chat Extension

A Chrome extension that lets you chat with YouTube videos using AI. Ask questions about any video and get answers based on the transcript with timestamp references.

## Features

- 🎬 **Automatic Transcript Extraction** - Fetches video transcripts from YouTube videos
- 💬 **AI-Powered Q&A** - Ask questions about video content and get intelligent responses
- ⏰ **Timestamp References** - Responses include clickable timestamps that jump to relevant parts
- 🎯 **Smart Caption Selection** - Prefers manual captions over auto-generated ones
- 📱 **Side Panel Interface** - Clean chat interface in Chrome's side panel

## How It Works

1. **Open any YouTube video** - The extension automatically detects YouTube video pages
2. **Transcript extraction** - Fetches the video's transcript (manual captions preferred)
3. **Chat in side panel** - Click the extension icon to open the chat interface
4. **Ask questions** - Type your questions about the video content
5. **Get answers with timestamps** - AI responds with relevant information and timestamp links

## Architecture

### Components

- **Content Script** (`src/contentScript/`)
  - Extracts YouTube video transcripts from page data
  - Handles video seeking when clicking timestamps
  - Only runs on YouTube video pages

- **Background Script** (`src/background/`)
  - Manages transcript storage across tabs
  - Handles messaging between content script and side panel
  - Coordinates chat history

- **Side Panel** (`src/App/VideoChat/`)
  - Chat interface for asking questions
  - Displays video info and transcript status
  - Shows conversation history with timestamp links

- **LLM Integration** (`src/utils/llm.ts`)
  - Sends transcript and questions to OpenAI
  - Formats responses with timestamp references
  - Maintains conversation context

### Transcript Extraction

The extension uses YouTube's embedded `ytInitialPlayerResponse` data to:
1. Extract available caption tracks from the page
2. Select the best track (manual > auto-generated, English preferred)
3. Fetch the transcript in JSON3 format
4. Parse into timestamped segments

## Setup

1. Clone the repository
2. Install dependencies: `npm install` or `yarn install`
3. Create a `.env.local` file with your OpenAI API key:
   ```
   VITE_OPENAI_API_KEY=your_api_key_here
   ```
4. Build the extension: `npm run build`
5. Load the `dist` folder as an unpacked extension in Chrome

## Development

```bash
# Install dependencies
yarn install

# Development mode with hot reload
yarn dev

# Build for production
yarn build

# Create zip for distribution
yarn zip
```

## Usage

1. Navigate to any YouTube video page
2. Click the extension icon to open the side panel
3. Wait for the transcript to load (you'll see a green checkmark)
4. Start asking questions about the video!

### Example Questions

- "What is this video about?"
- "Summarize the main points"
- "What does the speaker say about [topic]?"
- "When does [specific concept] get explained?"

## Technologies

- **React** + **TypeScript** - UI components and type safety
- **Mantine UI** - Component library
- **OpenAI API** - AI-powered chat responses
- **Chrome Extension Manifest V3** - Latest extension API
- **Vite** - Fast build tool

## License

MIT
