/**
 * PocketLlama — Chat screen.
 * The main conversation interface. Loads a chat by ID from the route params,
 * displays message history, streams assistant responses, and supports image
 * attachments for vision-capable models.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  BackHandler,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useNavigation } from 'expo-router';
import { DrawerActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { useAppContext } from '../../contexts/AppContext';
import { sendMessage, abortCurrentRequest, isVisionModel, checkVisionCapability, generateChatTitle, checkSTTAvailable, transcribeAudio } from '../../services/ollama';
import {
  getChatById,
  getAllMessages,
  addMessage,
  updateMessageContent,
  updateChatTitle,
  deleteMessagesFromIndex,
  getSiblings,
  getNextBranchIndex,
  buildConversationThread,
} from '../../services/database';
import ChatBubble from '../../components/ChatBubble';
import ChatInput from '../../components/ChatInput';
import PromptModal from '../../components/PromptModal';
import ImageViewer from '../../components/ImageViewer';
import { Message, Chat, OllamaChatMessage } from '../../types';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/theme';

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const { connection } = useAppContext();

  const [chat, setChat] = useState<Chat | null>(null);
  /** All messages in the chat (flat, all branches). */
  const [allMessages, setAllMessages] = useState<Message[]>([]);
  /** The linear conversation thread (resolved from the tree via activeBranches). */
  const [messages, setMessages] = useState<Message[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  /** Base64 image currently shown in full-screen viewer. */
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  /**
   * Tracks which branch is active at each fork point.
   * Key = parentId (or '__root__' for root-level messages), Value = branchIndex.
   */
  const [activeBranches, setActiveBranches] = useState<Record<string, number>>({});
  /** Cache of sibling counts for each message, keyed by message ID. */
  const [siblingCounts, setSiblingCounts] = useState<Record<string, number>>({});

  const flatListRef = useRef<FlatList>(null);

  // Android back button opens the drawer instead of exiting the app
  useEffect(() => {
    const onBackPress = () => {
      navigation.dispatch(DrawerActions.openDrawer());
      return true; // Consumed — don't exit
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [navigation]);

  // Load chat and messages on mount / when id changes
  useEffect(() => {
    loadChat();
  }, [id]);

  const loadChat = async () => {
    if (!id) return;
    const chatData = await getChatById(id);
    setChat(chatData);
    const msgs = await getAllMessages(id);
    setAllMessages(msgs);
    // Build the thread using current active branches (defaults to latest branch at each fork)
    const thread = buildConversationThread(msgs, activeBranches);
    setMessages(thread);
    // Compute sibling counts for branch navigation
    await computeSiblingCounts(msgs, thread);
  };

  /** Compute how many siblings each message in the thread has. */
  const computeSiblingCounts = async (all: Message[], thread: Message[]) => {
    const counts: Record<string, number> = {};
    for (const msg of thread) {
      const siblings = all.filter((m) => m.parentId === msg.parentId);
      counts[msg.id] = siblings.length;
    }
    setSiblingCounts(counts);
  };

  /** Rebuild the conversation thread from allMessages using current activeBranches. */
  const rebuildThread = useCallback((all: Message[], branches: Record<string, number>) => {
    const thread = buildConversationThread(all, branches);
    setMessages(thread);
    // Recompute sibling counts
    const counts: Record<string, number> = {};
    for (const msg of thread) {
      const siblings = all.filter((m) => m.parentId === msg.parentId);
      counts[msg.id] = siblings.length;
    }
    setSiblingCounts(counts);
  }, []);

  /** Scroll to the bottom of the message list. */
  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, []);

  /** Open the drawer. */
  const openDrawer = () => {
    navigation.dispatch(DrawerActions.openDrawer());
  };

  /**
   * Parse <think>...</think> tags from streamed text.
   * Handles partial tags during streaming (unclosed <think> with no </think> yet).
   * Returns separated thinking and content strings.
   */
  const parseThinkTags = (raw: string): { thinking: string; content: string } => {
    // Check if there's a <think> tag at all
    const thinkStart = raw.indexOf('<think>');
    if (thinkStart === -1) {
      return { thinking: '', content: raw.trim() };
    }

    const thinkEnd = raw.indexOf('</think>');

    if (thinkEnd === -1) {
      // Still inside <think> block — everything after <think> is thinking, no content yet
      const thinking = raw.slice(thinkStart + 7).trim();
      const beforeThink = raw.slice(0, thinkStart).trim();
      return { thinking, content: beforeThink };
    }

    // Complete <think>...</think> block found
    const thinking = raw.slice(thinkStart + 7, thinkEnd).trim();
    const content = (raw.slice(0, thinkStart) + raw.slice(thinkEnd + 8)).trim();
    return { thinking, content };
  };

  /** Core method: send messages to Ollama and stream the response back. */
  const streamResponse = async (conversationMessages: Message[], parentIdForAssistant: string | null, assistantBranchIdx: number) => {
    if (!connection || !chat || !id) return;

    // Create a placeholder assistant message for streaming
    const assistantMsgId = Crypto.randomUUID();
    const assistantMsg: Message = {
      id: assistantMsgId,
      chatId: id,
      role: 'assistant',
      content: '',
      thinking: '',
      parentId: parentIdForAssistant,
      branchIndex: assistantBranchIdx,
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, assistantMsg]);
    setStreamingMessageId(assistantMsgId);
    setIsGenerating(true);
    scrollToBottom();

    // Track raw accumulated text, then parse <think> tags from it
    let rawAccumulated = '';

    try {
      // Build the messages array for the Ollama /api/chat endpoint
      const ollamaMessages: OllamaChatMessage[] = conversationMessages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.images && m.images.length > 0 ? { images: m.images } : {}),
      }));

      // Stream the response
      const fullResponse = await sendMessage(
        connection.url,
        connection.key,
        chat.model,
        ollamaMessages,
        (token) => {
          rawAccumulated += token;
          // Parse <think>...</think> tags from the raw accumulated text
          const parsed = parseThinkTags(rawAccumulated);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: parsed.content, thinking: parsed.thinking }
                : m
            )
          );
          scrollToBottom();
        }
      );

      // Final parse of the complete response
      const finalParsed = parseThinkTags(fullResponse);

      // Save the completed assistant message to the database
      const finalMsg: Message = {
        ...assistantMsg,
        content: finalParsed.content,
        thinking: finalParsed.thinking || undefined,
        createdAt: Date.now(),
      };
      await addMessage(finalMsg);

      // Update allMessages with the saved assistant message
      setAllMessages((prev) => [...prev, finalMsg]);

      // Auto-generate a title after the first exchange
      const isFirstExchange = chat.title === 'New Chat';
      if (isFirstExchange && conversationMessages.length > 0) {
        const firstUserMsg = conversationMessages.find((m) => m.role === 'user');
        if (firstUserMsg) {
          const title = await generateChatTitle(
            connection.url,
            connection.key,
            chat.model,
            firstUserMsg.content,
            fullResponse
          );
          await updateChatTitle(id, title);
          setChat((prev) => (prev ? { ...prev, title } : prev));
        }
      }

    } catch (err: any) {
      if (err.name === 'AbortError') {
        // User cancelled — save whatever was generated so far
        setMessages((prev) => {
          const partial = prev.find((m) => m.id === assistantMsgId);
          if (partial && (partial.content || partial.thinking)) {
            addMessage({ ...assistantMsg, content: partial.content, thinking: partial.thinking });
          }
          return (partial?.content || partial?.thinking) ? prev : prev.filter((m) => m.id !== assistantMsgId);
        });
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId));
        Alert.alert('Error', err.message || 'Failed to get response from Ollama.', [
          { text: 'OK' },
        ]);
      }
    } finally {
      setIsGenerating(false);
      setStreamingMessageId(null);
    }
  };

  /** Handle sending a new message. */
  const handleSend = async (text: string, images: string[]) => {
    if (!connection || !chat || !id) return;

    // Determine parentId: the last message in the current thread, or null for first message
    const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
    const parentId = lastMsg?.id ?? null;

    // Create and save user message
    const userMsg: Message = {
      id: Crypto.randomUUID(),
      chatId: id,
      role: 'user',
      content: text,
      images: images.length > 0 ? images : undefined,
      parentId,
      branchIndex: 0,
      createdAt: Date.now(),
    };
    await addMessage(userMsg);

    // Update local state
    const updatedAll = [...allMessages, userMsg];
    setAllMessages(updatedAll);
    const updatedThread = [...messages, userMsg];
    setMessages(updatedThread);
    scrollToBottom();

    // Stream the assistant response
    await streamResponse(updatedThread, userMsg.id, 0);
  };

  /** Retry the last assistant response — create a new branch and regenerate. */
  const handleRetry = async () => {
    if (!connection || !chat || !id || isGenerating) return;

    // Find the last assistant message
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant) return;

    // Get the conversation up to the message before the assistant response
    const assistantIdx = messages.findIndex((m) => m.id === lastAssistant.id);
    const threadBeforeAssistant = messages.slice(0, assistantIdx);

    // The parent of the assistant message (the user message it responded to)
    const parentId = lastAssistant.parentId;

    // Get the next branch index for siblings at this position
    const nextIdx = await getNextBranchIndex(id, parentId);

    // Update active branch to point to the new branch
    const branchKey = parentId ?? '__root__';
    const newBranches = { ...activeBranches, [branchKey]: nextIdx };
    setActiveBranches(newBranches);

    // Stream a new response on the new branch
    await streamResponse(threadBeforeAssistant, parentId, nextIdx);
  };

  /** Edit a user message — open the edit modal. */
  const handleEdit = (messageToEdit: Message) => {
    if (isGenerating) return;
    setEditingMessage(messageToEdit);
  };

  /** Called when the edit modal confirms with new text and optional images. */
  const handleEditConfirm = async (newText: string, newImages?: string[]) => {
    if (!editingMessage || !id) return;
    const messageToEdit = editingMessage;
    setEditingMessage(null);

    // The edited message goes under the same parent as the original
    const parentId = messageToEdit.parentId;

    // Get the next branch index for this parent
    const nextIdx = await getNextBranchIndex(id, parentId);

    // Create the edited user message as a new branch
    const editedMsg: Message = {
      id: Crypto.randomUUID(),
      chatId: id,
      role: 'user',
      content: newText,
      images: newImages && newImages.length > 0 ? newImages : undefined,
      parentId,
      branchIndex: nextIdx,
      createdAt: Date.now(),
    };
    await addMessage(editedMsg);

    // Update active branches to follow the new branch at this fork point
    const branchKey = parentId ?? '__root__';
    const newBranches = { ...activeBranches, [branchKey]: nextIdx };
    setActiveBranches(newBranches);

    // Rebuild thread up to the new edited message
    const editIdx = messages.findIndex((m) => m.id === messageToEdit.id);
    const threadBeforeEdit = messages.slice(0, editIdx);
    const updatedThread = [...threadBeforeEdit, editedMsg];

    // Update allMessages and visible thread
    const updatedAll = [...allMessages, editedMsg];
    setAllMessages(updatedAll);
    setMessages(updatedThread);
    scrollToBottom();

    // Stream new response for the edited branch
    await streamResponse(updatedThread, editedMsg.id, 0);
  };

  /** Handle stop button during generation. */
  const handleStop = () => {
    abortCurrentRequest();
  };

  /** Switch a message to the previous branch at its fork point. */
  const handlePrevBranch = (msg: Message) => {
    const branchKey = msg.parentId ?? '__root__';
    const currentIdx = activeBranches[branchKey] ?? msg.branchIndex;
    if (currentIdx <= 0) return;
    const newBranches = { ...activeBranches, [branchKey]: currentIdx - 1 };
    setActiveBranches(newBranches);
    rebuildThread(allMessages, newBranches);
  };

  /** Switch a message to the next branch at its fork point. */
  const handleNextBranch = (msg: Message) => {
    const branchKey = msg.parentId ?? '__root__';
    const currentIdx = activeBranches[branchKey] ?? msg.branchIndex;
    const siblings = allMessages.filter((m) => m.parentId === msg.parentId);
    if (currentIdx >= siblings.length - 1) return;
    const newBranches = { ...activeBranches, [branchKey]: currentIdx + 1 };
    setActiveBranches(newBranches);
    rebuildThread(allMessages, newBranches);
  };

  /** Vision capability — starts with sync cache check, then async /api/show. */
  const [visionCapable, setVisionCapable] = useState(false);

  useEffect(() => {
    if (!chat || !connection) { setVisionCapable(false); return; }
    setVisionCapable(isVisionModel(chat.model));
    checkVisionCapability(connection.url, connection.key, chat.model)
      .then(setVisionCapable)
      .catch(() => {});
  }, [chat?.model, connection]);

  /** STT availability — checked once per connection. */
  const [sttAvailable, setSTTAvailable] = useState(false);

  useEffect(() => {
    if (!connection) { setSTTAvailable(false); return; }
    checkSTTAvailable(connection.url, connection.key)
      .then(setSTTAvailable)
      .catch(() => setSTTAvailable(false));
  }, [connection]);

  /** Transcribe audio for STT mic button. */
  const handleTranscribe = async (audioUri: string): Promise<string> => {
    if (!connection) return '';
    return transcribeAudio(connection.url, connection.key, audioUri);
  };

  /** Find the last assistant message ID in the list. */
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={openDrawer} style={styles.headerButton}>
          <Ionicons name="menu" size={24} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerModel} numberOfLines={1}>
            {chat?.model || 'Chat'}
          </Text>
          {connection && (
            <View style={styles.statusRow}>
              <View style={styles.statusDot} />
              <Text style={styles.statusText}>Connected</Text>
            </View>
          )}
        </View>
        <View style={styles.headerButton} />
      </View>

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ChatBubble
            message={item}
            isStreaming={item.id === streamingMessageId}
            isLastAssistant={item.id === lastAssistantId}
            onEdit={handleEdit}
            onRetry={handleRetry}
            onImagePress={setViewingImage}
            siblingCount={siblingCounts[item.id] || 1}
            currentBranchIndex={item.branchIndex + 1}
            onPrevBranch={() => handlePrevBranch(item)}
            onNextBranch={() => handleNextBranch(item)}
          />
        )}
        style={styles.messagesList}
        contentContainerStyle={styles.messageList}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={scrollToBottom}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="chatbubble-ellipses-outline" size={48} color={Colors.textTertiary} />
            <Text style={styles.emptyTitle}>Start a conversation</Text>
            <Text style={styles.emptySubtitle}>
              Send a message to begin chatting with {chat?.model || 'the model'}
            </Text>
          </View>
        }
      />

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        onStop={handleStop}
        isGenerating={isGenerating}
        isVisionCapable={visionCapable}
        sttAvailable={sttAvailable}
        onTranscribe={handleTranscribe}
      />

      {/* Edit message modal */}
      <PromptModal
        visible={!!editingMessage}
        title="Edit Message"
        placeholder="Edit your message"
        defaultValue={editingMessage?.content || ''}
        confirmLabel="Send"
        multiline
        showImageEditor={visionCapable}
        defaultImages={editingMessage?.images}
        onConfirm={handleEditConfirm}
        onCancel={() => setEditingMessage(null)}
      />

      {/* Full-screen image viewer */}
      <ImageViewer
        imageBase64={viewingImage}
        onClose={() => setViewingImage(null)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingTop: 55,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.background,
  },
  headerButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerModel: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.success,
  },
  statusText: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
  },
  messagesList: {
    flex: 1,
  },
  messageList: {
    paddingVertical: Spacing.md,
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 100,
    paddingHorizontal: Spacing.xl,
  },
  emptyTitle: {
    color: Colors.textSecondary,
    fontSize: FontSize.lg,
    fontWeight: '500',
    marginTop: Spacing.lg,
  },
  emptySubtitle: {
    color: Colors.textTertiary,
    fontSize: FontSize.sm,
    textAlign: 'center',
    marginTop: Spacing.sm,
    lineHeight: 20,
  },
});
