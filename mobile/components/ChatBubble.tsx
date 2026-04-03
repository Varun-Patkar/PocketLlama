/**
 * PocketLlama — Chat bubble component.
 * Renders a single message with role-based styling.
 * User messages are right-aligned, assistant messages left-aligned.
 * Supports markdown rendering for assistant responses and image thumbnails for user messages.
 */

import React, { useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Markdown from 'react-native-markdown-display';
import { Message } from '../types';
import { Colors, FontSize, Spacing, BorderRadius } from '../constants/theme';
import { Ionicons } from '@expo/vector-icons';
import BranchNavigator from './BranchNavigator';

interface ChatBubbleProps {
  message: Message;
  /** Whether this message is currently being streamed (shows typing indicator). */
  isStreaming?: boolean;
  /** Whether this is the last assistant message (shows retry button). */
  isLastAssistant?: boolean;
  /** Called when user taps edit on their message. */
  onEdit?: (message: Message) => void;
  /** Called when user taps retry on assistant message. */
  onRetry?: () => void;
  /** Called when user taps an image to view full-screen. */
  onImagePress?: (imageBase64: string) => void;
  /** Number of sibling branches at this message's position (for branch nav). */
  siblingCount?: number;
  /** 1-based index of the currently active branch. */
  currentBranchIndex?: number;
  /** Called to switch to the previous branch. */
  onPrevBranch?: () => void;
  /** Called to switch to the next branch. */
  onNextBranch?: () => void;
}

export default function ChatBubble({
  message, isStreaming, isLastAssistant, onEdit, onRetry, onImagePress,
  siblingCount, currentBranchIndex, onPrevBranch, onNextBranch,
}: ChatBubbleProps) {
  const { width } = useWindowDimensions();
  const isUser = message.role === 'user';
  const maxBubbleWidth = width * 0.8;
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const hasThinking = !isUser && !!message.thinking;

  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
      {/* Thinking block — collapsible, shown above the main bubble */}
      {hasThinking && (
        <View style={[styles.thinkingContainer, { maxWidth: maxBubbleWidth }]}>
          <TouchableOpacity
            style={styles.thinkingHeader}
            onPress={() => setThinkingExpanded(!thinkingExpanded)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={thinkingExpanded ? 'chevron-down' : 'chevron-forward'}
              size={14}
              color={Colors.textTertiary}
            />
            <Text style={styles.thinkingLabel}>
              {isStreaming && !message.content ? 'Thinking...' : 'Thought Process'}
            </Text>
          </TouchableOpacity>
          {thinkingExpanded && (
            <View style={styles.thinkingBody}>
              <Text style={styles.thinkingText}>{message.thinking}</Text>
            </View>
          )}
        </View>
      )}

      {/* Show "Thinking..." status when thinking but no answer yet and block is collapsed */}
      {isStreaming && message.thinking && !message.content && !hasThinking && (
        <View style={[styles.bubble, styles.bubbleAssistant, { maxWidth: maxBubbleWidth }]}>
          <Text style={styles.typingIndicator}>Thinking...</Text>
        </View>
      )}

      <View
        style={[
          styles.bubble,
          isUser ? styles.bubbleUser : styles.bubbleAssistant,
          { maxWidth: maxBubbleWidth },
        ]}
      >
        {/* Image thumbnails — tappable for full-screen view */}
        {message.images && message.images.length > 0 && (
          <View style={styles.imageRow}>
            {message.images.map((img, i) => (
              <TouchableOpacity key={i} onPress={() => onImagePress?.(img)} activeOpacity={0.8}>
                <Image
                  source={{ uri: `data:image/jpeg;base64,${img}` }}
                  style={styles.thumbnail}
                  resizeMode="cover"
                />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Message content */}
        {isUser ? (
          <Text style={styles.userText}>{message.content}</Text>
        ) : (
          <View style={styles.markdownContainer}>
            {message.content ? (
              <Markdown style={markdownStyles}>{message.content}</Markdown>
            ) : isStreaming && !message.thinking ? (
              <Text style={styles.typingIndicator}>●●●</Text>
            ) : !message.content && !isStreaming ? null : null}
          </View>
        )}

        {/* Streaming indicator for assistant (shown alongside content) */}
        {isStreaming && message.content.length > 0 && (
          <Text style={styles.streamingCursor}>▍</Text>
        )}
      </View>

      {/* Action buttons — shown below the bubble, not during streaming */}
      {!isStreaming && (
        <View style={[styles.actions, isUser ? styles.actionsUser : styles.actionsAssistant]}>
          {/* Branch navigator */}
          {siblingCount && siblingCount > 1 && currentBranchIndex && onPrevBranch && onNextBranch && (
            <BranchNavigator
              currentIndex={currentBranchIndex}
              totalBranches={siblingCount}
              onPrevious={onPrevBranch}
              onNext={onNextBranch}
            />
          )}
          {isUser && onEdit && (
            <TouchableOpacity style={styles.actionButton} onPress={() => onEdit(message)}>
              <Ionicons name="pencil-outline" size={14} color={Colors.textSecondary} />
            </TouchableOpacity>
          )}
          {/* Copy button — shown on all messages with content */}
          {message.content.length > 0 && (
            <TouchableOpacity style={styles.actionButton} onPress={() => Clipboard.setStringAsync(message.content)}>
              <Ionicons name="copy-outline" size={14} color={Colors.textSecondary} />
            </TouchableOpacity>
          )}
          {!isUser && isLastAssistant && onRetry && (
            <TouchableOpacity style={styles.actionButton} onPress={onRetry}>
              <Ionicons name="refresh-outline" size={14} color={Colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  rowUser: {
    alignItems: 'flex-end',
  },
  rowAssistant: {
    alignItems: 'flex-start',
  },
  bubble: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
  },
  bubbleUser: {
    backgroundColor: Colors.userBubble,
    borderBottomRightRadius: BorderRadius.sm,
  },
  bubbleAssistant: {
    backgroundColor: 'transparent',
    paddingHorizontal: Spacing.md,
  },
  userText: {
    color: Colors.text,
    fontSize: FontSize.md,
    lineHeight: 22,
  },
  markdownContainer: {
    flexShrink: 1,
  },
  imageRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  thumbnail: {
    width: 80,
    height: 80,
    borderRadius: BorderRadius.sm,
  },
  typingIndicator: {
    color: Colors.textSecondary,
    fontSize: FontSize.lg,
    letterSpacing: 2,
  },
  streamingCursor: {
    color: Colors.text,
    fontSize: FontSize.md,
    opacity: 0.7,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: 2,
  },
  actionsUser: {
    justifyContent: 'flex-end',
  },
  actionsAssistant: {
    justifyContent: 'flex-start',
    paddingLeft: Spacing.md,
  },
  actionButton: {
    padding: 4,
  },
  thinkingContainer: {
    marginBottom: Spacing.xs,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  thinkingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.card,
  },
  thinkingLabel: {
    color: Colors.textTertiary,
    fontSize: FontSize.xs,
    fontWeight: '500',
    fontStyle: 'italic',
  },
  thinkingBody: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  thinkingText: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    lineHeight: 18,
    fontStyle: 'italic',
  },
});

/** Markdown styles — white text on dark background, styled code blocks. */
const markdownStyles = StyleSheet.create({
  body: {
    color: Colors.text,
    fontSize: FontSize.md,
    lineHeight: 22,
  },
  heading1: {
    color: Colors.text,
    fontSize: FontSize.xl,
    fontWeight: '700' as const,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  heading2: {
    color: Colors.text,
    fontSize: FontSize.lg,
    fontWeight: '600' as const,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  heading3: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '600' as const,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  code_inline: {
    backgroundColor: Colors.card,
    color: '#E8E8E8',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    fontFamily: 'monospace',
    fontSize: FontSize.sm,
  },
  code_block: {
    backgroundColor: Colors.card,
    color: '#E8E8E8',
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    fontFamily: 'monospace',
    fontSize: FontSize.sm,
    marginVertical: Spacing.xs,
  },
  fence: {
    backgroundColor: Colors.card,
    color: '#E8E8E8',
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    fontFamily: 'monospace',
    fontSize: FontSize.sm,
    marginVertical: Spacing.xs,
  },
  blockquote: {
    backgroundColor: Colors.surface,
    borderLeftWidth: 3,
    borderLeftColor: Colors.textSecondary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    marginVertical: Spacing.xs,
  },
  link: {
    color: '#6B9BF7',
    textDecorationLine: 'underline' as const,
  },
  strong: {
    color: Colors.text,
    fontWeight: '700' as const,
  },
  em: {
    color: Colors.text,
    fontStyle: 'italic' as const,
  },
  bullet_list: {
    marginVertical: Spacing.xs,
  },
  ordered_list: {
    marginVertical: Spacing.xs,
  },
  list_item: {
    color: Colors.text,
    fontSize: FontSize.md,
  },
  hr: {
    backgroundColor: Colors.border,
    height: 1,
    marginVertical: Spacing.md,
  },
  table: {
    borderColor: Colors.border,
  },
  tr: {
    borderBottomColor: Colors.border,
  },
  th: {
    color: Colors.text,
    fontWeight: '600' as const,
    padding: Spacing.xs,
  },
  td: {
    color: Colors.text,
    padding: Spacing.xs,
  },
});
