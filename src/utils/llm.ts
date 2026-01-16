import OpenAI from 'openai';
import { TranscriptSegment } from '../contentScript/youtubeTranscript';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatResponse {
  response: string;
  error?: boolean;
  errorMessage?: string;
}

const getClient = () => {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('VITE_OPENAI_API_KEY is not set. Please create a .env.local file with your API key.');
  }

  return new OpenAI({
    apiKey,
    dangerouslyAllowBrowser: true,
  });
};

/**
 * Format transcript segments into a readable string
 */
function formatTranscriptForLLM(transcript: TranscriptSegment[]): string {
  return transcript.map(segment => {
    const timestamp = formatTimestamp(segment.start);
    return `[${timestamp}] ${segment.text}`;
  }).join('\n');
}

/**
 * Format timestamp in seconds to MM:SS or HH:MM:SS format
 */
function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
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

Example responses:
- "The main topic is discussed at [1:23], where the speaker explains..."
- "According to the video at [5:45], the three key points are..."
- "This concept is introduced around [0:30] and elaborated further at [3:15]..."
`;

interface VideoMetadata {
  title: string;
  channelName: string;
  description?: string;
  uploadDate?: string;
  viewCount?: string;
  duration?: string;
}

/**
 * Get chat response from LLM based on video transcript and question
 */
export async function getChatResponse(
  transcript: TranscriptSegment[],
  chatHistory: ChatMessage[],
  question: string,
  metadata?: VideoMetadata
): Promise<ChatResponse> {
  try {
    console.log('💬 Fetching chat response for question:', question);
    console.log('📊 Video metadata received by LLM:', {
      title: metadata?.title,
      channel: metadata?.channelName,
      segmentCount: transcript.length,
    });

    const client = getClient();

    // Format transcript for LLM
    const formattedTranscript = formatTranscriptForLLM(transcript);
    
    // Format metadata for context
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

    // Build messages array
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: `${metadataContext}Video Transcript with timestamps:\n\n${formattedTranscript}`,
      },
      ...chatHistory,
      {
        role: 'user',
        content: question,
      },
    ];

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messages as any,
      temperature: 0.7,
      max_tokens: 1000,
    });

    const aiResponse = response.choices[0]?.message?.content || '';

    console.log('✅ Chat response generated');

    return {
      response: aiResponse,
    };
  } catch (error) {
    console.error('❌ Error fetching chat response:', error);
    return {
      response: '',
      error: true,
      errorMessage: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}
