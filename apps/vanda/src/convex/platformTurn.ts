/**
 * A turn the platform starts in a conversation, not one the owner typed. It is
 * saved as a user message wrapped in this tag; the chat hides it.
 */
const PLATFORM_TURN = /^\s*<vanda_platform_turn>[\s\S]*<\/vanda_platform_turn>\s*$/;

export const platformTurn = (text: string): string =>
  `<vanda_platform_turn>${text}</vanda_platform_turn>`;

export const isPlatformTurn = (text: string): boolean => PLATFORM_TURN.test(text);
