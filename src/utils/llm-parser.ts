import { createLogger } from './logger';

const logger = createLogger('llm-parser');

/**
 * Parses JSON from LLM responses, handling various formats including markdown code blocks
 * @param response - The raw response from the LLM
 * @param context - Optional context for better error messages
 * @returns Parsed JSON object
 * @throws Error with descriptive message if parsing fails
 */
export function parseLLMResponse<T = any>(response: string, context?: string): T {
  if (!response || typeof response !== 'string') {
    throw new Error(`Invalid response format${context ? ` in ${context}` : ''}: Response is empty or not a string`);
  }

  // Trim whitespace
  let cleanResponse = response.trim();

  // Remove markdown code blocks
  // Handle various formats: ```json, ```, ```javascript, etc.
  const codeBlockRegex = /^```(?:json|javascript|js)?\s*\n?([\s\S]*?)\n?```$/;
  const match = cleanResponse.match(codeBlockRegex);
  
  if (match && match[1]) {
    cleanResponse = match[1].trim();
    logger.debug('Removed markdown code blocks from LLM response', { context });
  }

  // Additional cleanup - remove any leading/trailing backticks that might remain
  cleanResponse = cleanResponse.replace(/^`+|`+$/g, '').trim();

  try {
    const parsed = JSON.parse(cleanResponse);
    return parsed;
  } catch (error) {
    logger.error('Failed to parse LLM response', { 
      context,
      error: error instanceof Error ? error.message : String(error),
      responsePreview: cleanResponse.substring(0, 200) + (cleanResponse.length > 200 ? '...' : ''),
      originalResponse: response.substring(0, 200) + (response.length > 200 ? '...' : '')
    });
    
    throw new Error(
      `Failed to parse JSON from LLM response${context ? ` in ${context}` : ''}. ` +
      `Error: ${error instanceof Error ? error.message : String(error)}. ` +
      `Response preview: ${cleanResponse.substring(0, 100)}...`
    );
  }
}

/**
 * Attempts to extract and parse JSON from a response that might contain additional text
 * This is useful when the LLM includes explanatory text along with JSON
 * @param response - The raw response from the LLM
 * @param context - Optional context for better error messages
 * @returns Parsed JSON object or null if no valid JSON found
 */
export function extractJSONFromResponse<T = any>(response: string, context?: string): T | null {
  if (!response || typeof response !== 'string') {
    return null;
  }

  // First try the standard parsing
  try {
    return parseLLMResponse<T>(response, context);
  } catch {
    // If that fails, try to find JSON within the text
  }

  // Look for JSON objects in the text - try multiple patterns
  const patterns = [
    /\{[\s\S]*\}/,  // Basic JSON object
    /```json\s*(\{[\s\S]*?\})\s*```/,  // JSON in code blocks
    /```\s*(\{[\s\S]*?\})\s*```/,  // JSON in generic code blocks
  ];
  
  for (const pattern of patterns) {
    const match = response.match(pattern);
    if (match) {
      const jsonText = match[1] || match[0]; // Use capture group if available, otherwise full match
      try {
        const parsed = JSON.parse(jsonText);
        logger.debug('Extracted JSON from mixed content response', { context, pattern: pattern.source });
        return parsed;
      } catch (error) {
        logger.debug('Failed to parse JSON with pattern', { 
          context,
          pattern: pattern.source,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
  
  // Try to find the last complete JSON object in the response
  const lastBraceIndex = response.lastIndexOf('}');
  if (lastBraceIndex > 0) {
    const firstBraceIndex = response.indexOf('{');
    if (firstBraceIndex >= 0 && firstBraceIndex < lastBraceIndex) {
      const jsonCandidate = response.substring(firstBraceIndex, lastBraceIndex + 1);
      try {
        const parsed = JSON.parse(jsonCandidate);
        logger.debug('Extracted JSON by finding brace boundaries', { context });
        return parsed;
      } catch (error) {
        logger.debug('Failed to parse JSON candidate from brace boundaries', { 
          context,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  logger.warn('No valid JSON found in LLM response', { context });
  return null;
}

/**
 * Validates that a parsed object has the expected structure
 * @param obj - The parsed object to validate
 * @param requiredFields - Array of required field names
 * @param context - Optional context for better error messages
 * @throws Error if validation fails
 */
export function validateLLMResponseStructure(
  obj: any, 
  requiredFields: string[], 
  context?: string
): void {
  if (!obj || typeof obj !== 'object') {
    throw new Error(`Invalid response structure${context ? ` in ${context}` : ''}: Expected object, got ${typeof obj}`);
  }

  const missingFields = requiredFields.filter(field => !(field in obj));
  if (missingFields.length > 0) {
    throw new Error(
      `Missing required fields${context ? ` in ${context}` : ''}: ${missingFields.join(', ')}. ` +
      `Available fields: ${Object.keys(obj).join(', ')}`
    );
  }
} 