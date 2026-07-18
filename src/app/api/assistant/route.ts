import {
  getClientIdentifier,
  jsonResponse,
  readJsonBody,
  routeErrorResponse,
  withinRateLimit,
} from '@/server/errors';
import {
  isAssistantConfigured,
  requestReportExplanation,
  validateAssistantOptions,
} from '@/server/assistant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  if (!withinRateLimit('assistant', getClientIdentifier(request), 10)) {
    return jsonResponse({ message: 'The AI assistant is busy.' }, 429);
  }
  if (!isAssistantConfigured()) {
    console.error('Assistant request rejected: GEMINI_API_KEY is not configured.');
    return jsonResponse({ message: 'The AI assistant is temporarily unavailable.' }, 503);
  }

  try {
    const options = validateAssistantOptions(await readJsonBody(request));
    const answer = await requestReportExplanation(options);
    return jsonResponse({ answer });
  } catch (error) {
    return routeErrorResponse(
      error,
      'The AI assistant is temporarily unavailable.',
      'Assistant request failed',
    );
  }
}
