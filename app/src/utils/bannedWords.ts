// Banned words filter - matches smart contract
export const BANNED_WORDS = [
  'pedo', 'child', 'rape', 'suicide', 'kill', 'porn', 'dick', 'cock',
  'pussy', 'fuck', 'nigger', 'hitler', 'terror', 'bomb', 'isis',
  'murder', 'death', 'underage', 'minor', 'assault'
];

export function containsBannedWords(text: string): boolean {
  const lowerText = text.toLowerCase();
  return BANNED_WORDS.some(word => lowerText.includes(word));
}

export function getBannedWordsInText(text: string): string[] {
  const lowerText = text.toLowerCase();
  return BANNED_WORDS.filter(word => lowerText.includes(word));
}

export function validateMarketQuestion(question: string): {
  valid: boolean;
  error?: string;
} {
  if (question.length < 10) {
    return { valid: false, error: 'Question too short (min 10 chars)' };
  }
  if (question.length > 200) {
    return { valid: false, error: 'Question too long (max 200 chars)' };
  }
  if (containsBannedWords(question)) {
    const bannedFound = getBannedWordsInText(question);
    return {
      valid: false,
      error: `Contains banned words: ${bannedFound.join(', ')}. Keep it clean!`
    };
  }
  return { valid: true };
}

export function validateMarketDescription(description: string): {
  valid: boolean;
  error?: string;
} {
  if (description.length > 500) {
    return { valid: false, error: 'Description too long (max 500 chars)' };
  }
  if (containsBannedWords(description)) {
    const bannedFound = getBannedWordsInText(description);
    return {
      valid: false,
      error: `Contains banned words: ${bannedFound.join(', ')}. Keep it clean!`
    };
  }
  return { valid: true };
}
