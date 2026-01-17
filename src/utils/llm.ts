import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import { TranscriptSegment } from '../contentScript/youtubeTranscript';
import { formatTimestamp } from './timestampUtils';
import { getApiKey, Provider } from './localStorage';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatResponse {
  response: string;
  error?: boolean;
  errorMessage?: string;
}

export type ModelId =
  | 'gpt-5.2'
  | 'gpt-5-mini'
  | 'gemini-3-pro-preview'
  | 'gemini-3-flash-preview'
  | 'claude-sonnet-4-5'
  | 'claude-opus-4-5';

export interface ModelConfig {
  id: ModelId;
  name: string;
  provider: Provider;
}

export const MODELS: ModelConfig[] = [
  { id: 'gpt-5-mini', name: 'GPT-5 Mini', provider: 'openai' },
  { id: 'gpt-5.2', name: 'GPT-5.2', provider: 'openai' },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', provider: 'google' },
  { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro', provider: 'google' },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', provider: 'anthropic' },
  { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', provider: 'anthropic' },
];

export const getModelConfig = (modelId: ModelId): ModelConfig => {
  return MODELS.find((m) => m.id === modelId) || MODELS[0];
};

const getOpenAIClient = async (): Promise<OpenAI> => {
  const apiKey = await getApiKey('openai');
  if (!apiKey) {
    throw new Error('OpenAI API key not configured. Please add your API key in Settings.');
  }
  return new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
};

const getGoogleClient = async (): Promise<GoogleGenerativeAI> => {
  const apiKey = await getApiKey('google');
  if (!apiKey) {
    throw new Error('Google API key not configured. Please add your API key in Settings.');
  }
  return new GoogleGenerativeAI(apiKey);
};

const getAnthropicClient = async (): Promise<Anthropic> => {
  const apiKey = await getApiKey('anthropic');
  if (!apiKey) {
    throw new Error('Anthropic API key not configured. Please add your API key in Settings.');
  }
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
};

function formatTranscriptForLLM(transcript: TranscriptSegment[]): string {
  return transcript
    .map((segment) => {
      const timestamp = formatTimestamp(segment.start);
      return `[${timestamp}] ${segment.text}`;
    })
    .join('\n');
}

const systemPrompt = `You are a helpful AI assistant that answers questions about YouTube videos based on their transcripts and metadata.

Your role is to:
1. Provide accurate, helpful answers based on the video transcript and metadata provided
2. Reference specific timestamps when relevant to help users find the content in the video
3. Use the format [MM:SS] or [HH:MM:SS] for timestamps (e.g., [2:34] or [1:15:42])
4. Consider the video's title, channel, description, and other metadata for context
5. Be concise but thorough in your responses
6. If the transcript doesn't contain information to answer a question, say so clearly
7. Maintain a friendly, conversational tone

When referencing timestamps:
- Include the timestamp in brackets like [2:34] when citing specific parts of the video
- You can reference multiple timestamps if relevant
- Make timestamp references clickable by using the exact format [MM:SS]
`;

interface VideoMetadata {
  title: string;
  channelName: string;
  description?: string;
  uploadDate?: string;
  viewCount?: string;
  duration?: string;
}

function buildMessages(
  transcript: TranscriptSegment[],
  chatHistory: ChatMessage[],
  question: string,
  metadata?: VideoMetadata
): ChatMessage[] {
  const formattedTranscript = formatTranscriptForLLM(transcript);

  let metadataContext = '';
  if (metadata) {
    metadataContext = `Video Information:
- Title: ${metadata.title}
- Channel: ${metadata.channelName}
${metadata.duration ? `- Duration: ${metadata.duration}` : ''}
${metadata.viewCount ? `- Views: ${metadata.viewCount}` : ''}
${metadata.description ? `- Description: ${metadata.description.substring(0, 500)}${metadata.description.length > 500 ? '...' : ''}` : ''}

`;
  }

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `${metadataContext}Video Transcript with timestamps:\n\n${formattedTranscript}` },
    ...chatHistory,
    { role: 'user', content: question },
  ];
}

// OpenAI streaming
async function streamOpenAI(
  messages: ChatMessage[],
  model: ModelId,
  onChunk: (chunk: string, fullText: string) => void
): Promise<string> {
  const client = await getOpenAIClient();
  const stream = await client.chat.completions.create({
    model: model,
    messages: messages as any,
    stream: true,
  });

  let fullResponse = '';
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || '';
    if (content) {
      fullResponse += content;
      onChunk(content, fullResponse);
    }
  }
  return fullResponse;
}

// Google Gemini streaming
async function streamGoogle(
  messages: ChatMessage[],
  model: ModelId,
  onChunk: (chunk: string, fullText: string) => void
): Promise<string> {
  const client = await getGoogleClient();
  const genModel = client.getGenerativeModel({ model });

  // Convert messages to Gemini format
  const systemMessage = messages.find((m) => m.role === 'system');
  const chatMessages = messages.filter((m) => m.role !== 'system');

  // Build contents array for Gemini
  const contents = chatMessages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const result = await genModel.generateContentStream({
    contents,
    systemInstruction: systemMessage?.content,
  });

  let fullResponse = '';
  for await (const chunk of result.stream) {
    const content = chunk.text();
    if (content) {
      fullResponse += content;
      onChunk(content, fullResponse);
    }
  }
  return fullResponse;
}

// Anthropic Claude streaming
async function streamAnthropic(
  messages: ChatMessage[],
  model: ModelId,
  onChunk: (chunk: string, fullText: string) => void
): Promise<string> {
  const client = await getAnthropicClient();

  // Extract system message
  const systemMessage = messages.find((m) => m.role === 'system');
  const chatMessages = messages.filter((m) => m.role !== 'system');

  // Convert to Anthropic format
  const anthropicMessages = chatMessages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const stream = await client.messages.stream({
    model: model,
    max_tokens: 4096,
    system: systemMessage?.content,
    messages: anthropicMessages,
  });

  let fullResponse = '';
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      const content = event.delta.text;
      if (content) {
        fullResponse += content;
        onChunk(content, fullResponse);
      }
    }
  }
  return fullResponse;
}

export async function streamChatResponse(
  transcript: TranscriptSegment[],
  chatHistory: ChatMessage[],
  question: string,
  onChunk: (chunk: string, fullText: string) => void,
  metadata?: VideoMetadata,
  model: ModelId = 'gemini-3-flash-preview'
): Promise<ChatResponse> {
  try {
    const messages = buildMessages(transcript, chatHistory, question, metadata);
    const modelConfig = getModelConfig(model);

    let fullResponse: string;

    switch (modelConfig.provider) {
      case 'openai':
        fullResponse = await streamOpenAI(messages, model, onChunk);
        break;
      case 'google':
        fullResponse = await streamGoogle(messages, model, onChunk);
        break;
      case 'anthropic':
        fullResponse = await streamAnthropic(messages, model, onChunk);
        break;
      default:
        throw new Error(`Unknown provider: ${modelConfig.provider}`);
    }

    return { response: fullResponse };
  } catch (error) {
    return {
      response: '',
      error: true,
      errorMessage: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

// Check if a provider has an API key configured
export async function hasApiKey(provider: Provider): Promise<boolean> {
  const key = await getApiKey(provider);
  return !!key;
}

// Provider default models
export const PROVIDER_DEFAULTS: Record<Provider, ModelId> = {
  google: 'gemini-3-flash-preview',
  openai: 'gpt-5-mini',
  anthropic: 'claude-sonnet-4-5',
};

// Priority order for fallback (Google → OpenAI → Anthropic)
const PROVIDER_PRIORITY: Provider[] = ['google', 'openai', 'anthropic'];

// Get all providers that have API keys configured
export async function getAvailableProviders(): Promise<Provider[]> {
  const available: Provider[] = [];
  for (const provider of PROVIDER_PRIORITY) {
    if (await hasApiKey(provider)) {
      available.push(provider);
    }
  }
  return available;
}

// Auto-select best available model
export async function autoSelectModel(currentModel?: ModelId): Promise<ModelId | null> {
  const availableProviders = await getAvailableProviders();
  
  // If no providers available, return null
  if (availableProviders.length === 0) {
    return null;
  }
  
  // If current model's provider has a key, keep it
  if (currentModel) {
    const currentProvider = getModelConfig(currentModel).provider;
    if (availableProviders.includes(currentProvider)) {
      return currentModel;
    }
  }
  
  // Otherwise, select first available provider's default
  return PROVIDER_DEFAULTS[availableProviders[0]];
}
