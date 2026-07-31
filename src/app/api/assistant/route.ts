import { jsonResponse, readJsonBody, routeErrorResponse } from '@/server/errors';
import { enforceRateLimit } from '@/server/rate-limit';
import {
  isAssistantConfigured,
  requestReportExplanation,
  validateAssistantOptions,
} from '@/server/assistant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const limit = await enforceRateLimit('assistant', request);
  if (!limit.ok) {
    return jsonResponse({ message: limit.message }, limit.status);
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
