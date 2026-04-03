/**
 * PocketLlama — Custom drawer content for the chat sidebar.
 * Shows: "New Chat" button, chronological chat list grouped by date,
 * long-press to delete, connection info, and disconnect/change model buttons.
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Chat } from '../types';
import { Colors, FontSize, Spacing, BorderRadius } from '../constants/theme';
import PromptModal from './PromptModal';

interface DrawerContentProps {
  /** All chats for the current connection. */
  chats: Chat[];
  /** ID of the currently active chat. */
  activeChatId?: string;
  /** Connection URL (displayed truncated at bottom). */
  connectionUrl?: string;
  /** Called when user taps "New Chat". */
  onNewChat: () => void;
  /** Called when user selects a chat from the list. */
  onSelectChat: (chatId: string) => void;
  /** Called when user confirms deletion of a chat. */
  onDeleteChat: (chatId: string) => void;
  /** Called when user renames a chat. */
  onRenameChat: (chatId: string, newTitle: string) => void;
  /** Called when user taps "Disconnect". */
  onDisconnect: () => void;
  /** Called when user taps "Change Model". */
  onChangeModel: () => void;
}

/** Group chats by relative date labels. */
function groupChatsByDate(chats: Chat[]): { label: string; data: Chat[] }[] {
  const now = Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const yesterdayMs = todayMs - 86400000;
  const weekMs = todayMs - 7 * 86400000;

  const groups: Record<string, Chat[]> = {};
  const order: string[] = [];

  for (const chat of chats) {
    let label: string;
    if (chat.updatedAt >= todayMs) {
      label = 'Today';
    } else if (chat.updatedAt >= yesterdayMs) {
      label = 'Yesterday';
    } else if (chat.updatedAt >= weekMs) {
      label = 'Previous 7 Days';
    } else {
      label = 'Older';
    }
    if (!groups[label]) {
      groups[label] = [];
      order.push(label);
    }
    groups[label].push(chat);
  }

  return order.map((label) => ({ label, data: groups[label] }));
}

export default function DrawerContent({
  chats,
  activeChatId,
  connectionUrl,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onRenameChat,
  onDisconnect,
  onChangeModel,
}: DrawerContentProps) {
  const grouped = groupChatsByDate(chats);
  const [renameChat, setRenameChat] = useState<Chat | null>(null);

  /** Handle long press — show action sheet with Rename and Delete options. */
  const handleLongPress = useCallback(
    (chat: Chat) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      Alert.alert(chat.title || 'Chat', 'Choose an action', [
        {
          text: 'Rename',
          onPress: () => setRenameChat(chat),
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => onDeleteChat(chat.id),
        },
        { text: 'Cancel', style: 'cancel' },
      ]);
    },
    [onDeleteChat]
  );

  /** Truncate a URL for display. */
  const displayUrl = connectionUrl
    ? connectionUrl.replace(/^https?:\/\//, '').slice(0, 30) + (connectionUrl.length > 40 ? '...' : '')
    : 'Not connected';

  return (
    <View style={styles.container}>
      {/* Header — New Chat button */}
      <TouchableOpacity style={styles.newChatButton} onPress={onNewChat}>
        <Ionicons name="add" size={22} color={Colors.text} />
        <Text style={styles.newChatText}>New Chat</Text>
      </TouchableOpacity>

      {/* Chat list */}
      <FlatList
        data={grouped}
        keyExtractor={(item) => item.label}
        style={styles.list}
        showsVerticalScrollIndicator={false}
        renderItem={({ item: group }) => (
          <View>
            <Text style={styles.groupLabel}>{group.label}</Text>
            {group.data.map((chat) => (
              <TouchableOpacity
                key={chat.id}
                style={[
                  styles.chatItem,
                  chat.id === activeChatId && styles.chatItemActive,
                ]}
                onPress={() => onSelectChat(chat.id)}
                onLongPress={() => handleLongPress(chat)}
                delayLongPress={400}
              >
                <Text style={styles.chatTitle} numberOfLines={1}>
                  {chat.title || 'New Chat'}
                </Text>
                <Text style={styles.chatModel} numberOfLines={1}>
                  {chat.model}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No chats yet</Text>
          </View>
        }
      />

      {/* Footer — Connection info + actions */}
      <View style={styles.footer}>
        <View style={styles.connectionInfo}>
          <View style={styles.connectionDot} />
          <Text style={styles.connectionUrl} numberOfLines={1}>
            {displayUrl}
          </Text>
        </View>
        <View style={styles.footerButtons}>
          <TouchableOpacity style={styles.footerButton} onPress={onChangeModel}>
            <Ionicons name="swap-horizontal" size={18} color={Colors.textSecondary} />
            <Text style={styles.footerButtonText}>Model</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.footerButton} onPress={onDisconnect}>
            <Ionicons name="log-out-outline" size={18} color={Colors.danger} />
            <Text style={[styles.footerButtonText, { color: Colors.danger }]}>Disconnect</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Rename modal */}
      <PromptModal
        visible={!!renameChat}
        title="Rename Chat"
        placeholder="Enter a new name"
        defaultValue={renameChat?.title || ''}
        confirmLabel="Save"
        onConfirm={(newTitle) => {
          if (renameChat) {
            onRenameChat(renameChat.id, newTitle);
          }
          setRenameChat(null);
        }}
        onCancel={() => setRenameChat(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface,
    paddingTop: 60,
  },
  newChatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
  },
  newChatText: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '500',
  },
  list: {
    flex: 1,
    paddingHorizontal: Spacing.sm,
  },
  groupLabel: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: Spacing.sm,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xs,
  },
  chatItem: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    marginVertical: 1,
  },
  chatItemActive: {
    backgroundColor: Colors.card,
  },
  chatTitle: {
    color: Colors.text,
    fontSize: FontSize.sm,
    fontWeight: '400',
  },
  chatModel: {
    color: Colors.textTertiary,
    fontSize: FontSize.xs,
    marginTop: 2,
  },
  emptyContainer: {
    paddingVertical: Spacing.xxl,
    alignItems: 'center',
  },
  emptyText: {
    color: Colors.textTertiary,
    fontSize: FontSize.sm,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    padding: Spacing.md,
  },
  connectionInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.success,
  },
  connectionUrl: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    flex: 1,
  },
  footerButtons: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  footerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
  },
  footerButtonText: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
  },
});
