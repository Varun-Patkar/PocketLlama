/**
 * PocketLlama — Chat drawer layout.
 * Wraps the chat screen in a drawer navigator with custom DrawerContent
 * showing chat history, new chat button, and connection controls.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Drawer } from 'expo-router/drawer';
import { useRouter, usePathname } from 'expo-router';
import { useAppContext } from '../../contexts/AppContext';
import DrawerContent from '../../components/DrawerContent';
import { getChats, deleteChat, updateChatTitle } from '../../services/database';
import { Chat } from '../../types';
import { Colors } from '../../constants/theme';

export default function ChatLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const { connection, setConnection } = useAppContext();
  const [chats, setChats] = useState<Chat[]>([]);

  /** Extract the active chat ID from the current path. */
  const activeChatId = pathname?.split('/').pop() || undefined;

  /** Load chats from the database. */
  const loadChats = useCallback(async () => {
    if (!connection) return;
    const chatList = await getChats(connection.id);
    setChats(chatList);
  }, [connection]);

  // Reload chats whenever the pathname changes (new chat created, etc.)
  useEffect(() => {
    loadChats();
  }, [loadChats, pathname]);

  /** Handle "New Chat" — navigate to model selection. */
  const handleNewChat = () => {
    router.push('/models');
  };

  /** Handle selecting a chat from the drawer. */
  const handleSelectChat = (chatId: string) => {
    router.replace(`/(chat)/${chatId}`);
  };

  /** Handle deleting a chat. */
  const handleDeleteChat = async (chatId: string) => {
    await deleteChat(chatId);
    await loadChats();
    // If the deleted chat was active, navigate to models to pick a new one
    if (chatId === activeChatId) {
      if (chats.length > 1) {
        const remaining = chats.filter((c) => c.id !== chatId);
        if (remaining.length > 0) {
          router.replace(`/(chat)/${remaining[0].id}`);
          return;
        }
      }
      router.replace('/models');
    }
  };

  /** Handle disconnect — clear connection and go back to home. */
  const handleDisconnect = () => {
    setConnection(null);
    router.replace('/');
  };

  /** Handle "Change Model" — go to model selection (starts new chat). */
  const handleChangeModel = () => {
    router.push('/models');
  };

  /** Handle renaming a chat. */
  const handleRenameChat = async (chatId: string, newTitle: string) => {
    await updateChatTitle(chatId, newTitle);
    await loadChats();
  };

  return (
    <Drawer
      screenOptions={{
        headerShown: false,
        drawerStyle: {
          backgroundColor: Colors.surface,
          width: 300,
        },
        sceneStyle: {
          backgroundColor: Colors.background,
        },
      }}
      drawerContent={() => (
        <DrawerContent
          chats={chats}
          activeChatId={activeChatId}
          connectionUrl={connection?.url}
          onNewChat={handleNewChat}
          onSelectChat={handleSelectChat}
          onDeleteChat={handleDeleteChat}
          onRenameChat={handleRenameChat}
          onDisconnect={handleDisconnect}
          onChangeModel={handleChangeModel}
        />
      )}
    >
      <Drawer.Screen
        name="[id]"
        options={{ headerShown: false }}
      />
    </Drawer>
  );
}
