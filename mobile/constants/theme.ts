/**
 * PocketLlama — Theme constants.
 * Black & white ChatGPT-inspired design tokens.
 */

export const Colors = {
  /** Primary background — pure black. */
  background: '#000000',
  /** Elevated surface — very dark gray. */
  surface: '#111111',
  /** Card / container background. */
  card: '#1A1A1A',
  /** Primary text — white. */
  text: '#FFFFFF',
  /** Secondary / muted text. */
  textSecondary: '#888888',
  /** Tertiary text — dimmer. */
  textTertiary: '#555555',
  /** Accent color — white on black. */
  accent: '#FFFFFF',
  /** Border / divider color. */
  border: '#2A2A2A',
  /** User message bubble background. */
  userBubble: '#2A2A2A',
  /** Assistant message bubble background. */
  assistantBubble: '#111111',
  /** Danger / destructive action. */
  danger: '#FF4444',
  /** Success indicator. */
  success: '#44CC44',
  /** Warning indicator. */
  warning: '#FFAA00',
  /** Input field background. */
  inputBackground: '#1A1A1A',
  /** Overlay / modal backdrop. */
  overlay: 'rgba(0, 0, 0, 0.7)',
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const FontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 28,
  title: 34,
} as const;

export const BorderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 9999,
} as const;
