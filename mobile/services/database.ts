/**
 * PocketLlama — SQLite database service.
 * Manages local storage of connections, chats, and messages using expo-sqlite.
 *
 * Tables:
 *   - connections: saved proxy connection credentials
 *   - chats:       conversation sessions
 *   - messages:    individual messages within chats
 */

import * as SQLite from 'expo-sqlite';
import { Connection, Chat, Message } from '../types';

let db: SQLite.SQLiteDatabase | null = null;

/**
 * Open (or create) the database and ensure all tables exist.
 * Must be called once at app startup before any other DB operations.
 */
export async function initDatabase(): Promise<void> {
  db = await SQLite.openDatabaseAsync('pocketllama.db');

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_used INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      model TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      thinking TEXT,
      images TEXT,
      parent_id TEXT,
      branch_index INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
    CREATE INDEX IF NOT EXISTS idx_chats_connection_id ON chats(connection_id);
    CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at DESC);
  `);

  // Migrations for existing databases
  const migrations = [
    'ALTER TABLE messages ADD COLUMN thinking TEXT',
    'ALTER TABLE messages ADD COLUMN parent_id TEXT',
    'ALTER TABLE messages ADD COLUMN branch_index INTEGER DEFAULT 0',
  ];
  for (const sql of migrations) {
    try { await db.runAsync(sql); } catch { /* column already exists */ }
  }

  // Create indexes that depend on migrated columns (must run after migrations)
  try {
    await db.execAsync('CREATE INDEX IF NOT EXISTS idx_messages_parent_id ON messages(parent_id)');
  } catch { /* index already exists or column missing */ }
}

/** Get the initialized database instance. Throws if initDatabase() hasn't been called. */
function getDb(): SQLite.SQLiteDatabase {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

// ── Connections ─────────────────────────────────────────────────────────────

/** Save a new connection to the database. */
export async function saveConnection(conn: Connection): Promise<void> {
  const d = getDb();
  await d.runAsync(
    'INSERT OR REPLACE INTO connections (id, url, key, name, created_at, last_used) VALUES (?, ?, ?, ?, ?, ?)',
    [conn.id, conn.url, conn.key, conn.name, conn.createdAt, conn.lastUsed]
  );
}

/** Get all saved connections, most recently used first. */
export async function getConnections(): Promise<Connection[]> {
  const d = getDb();
  const rows = await d.getAllAsync('SELECT * FROM connections ORDER BY last_used DESC');
  return (rows as any[]).map(mapConnection);
}

/** Update the last_used timestamp for a connection. */
export async function touchConnection(id: string): Promise<void> {
  const d = getDb();
  await d.runAsync('UPDATE connections SET last_used = ? WHERE id = ?', [Date.now(), id]);
}

/** Delete a saved connection and all its associated chats and messages. */
export async function deleteConnection(id: string): Promise<void> {
  const d = getDb();
  // Get all chat IDs for this connection, then delete their messages
  const chats = await d.getAllAsync('SELECT id FROM chats WHERE connection_id = ?', [id]);
  for (const chat of chats as any[]) {
    await d.runAsync('DELETE FROM messages WHERE chat_id = ?', [chat.id]);
  }
  await d.runAsync('DELETE FROM chats WHERE connection_id = ?', [id]);
  await d.runAsync('DELETE FROM connections WHERE id = ?', [id]);
}

// ── Chats ───────────────────────────────────────────────────────────────────

/** Create a new chat entry. */
export async function createChat(chat: Chat): Promise<void> {
  const d = getDb();
  await d.runAsync(
    'INSERT INTO chats (id, connection_id, model, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [chat.id, chat.connectionId, chat.model, chat.title, chat.createdAt, chat.updatedAt]
  );
}

/** Get all chats for a given connection, newest first. */
export async function getChats(connectionId?: string): Promise<Chat[]> {
  const d = getDb();
  let rows: any[];
  if (connectionId) {
    rows = await d.getAllAsync(
      'SELECT * FROM chats WHERE connection_id = ? ORDER BY updated_at DESC',
      [connectionId]
    );
  } else {
    rows = await d.getAllAsync('SELECT * FROM chats ORDER BY updated_at DESC');
  }
  return rows.map(mapChat);
}

/** Update a chat's title. */
export async function updateChatTitle(id: string, title: string): Promise<void> {
  const d = getDb();
  await d.runAsync('UPDATE chats SET title = ?, updated_at = ? WHERE id = ?', [title, Date.now(), id]);
}

/** Touch the updated_at timestamp on a chat (called when new messages are added). */
export async function touchChat(id: string): Promise<void> {
  const d = getDb();
  await d.runAsync('UPDATE chats SET updated_at = ? WHERE id = ?', [Date.now(), id]);
}

/** Delete a chat and all its messages. */
export async function deleteChat(id: string): Promise<void> {
  const d = getDb();
  await d.runAsync('DELETE FROM messages WHERE chat_id = ?', [id]);
  await d.runAsync('DELETE FROM chats WHERE id = ?', [id]);
}

/** Get a single chat by ID. */
export async function getChatById(id: string): Promise<Chat | null> {
  const d = getDb();
  const row = await d.getFirstAsync('SELECT * FROM chats WHERE id = ?', [id]);
  return row ? mapChat(row as any) : null;
}

// ── Messages ────────────────────────────────────────────────────────────────

/** Add a message to a chat. Also touches the chat's updated_at. */
export async function addMessage(msg: Message): Promise<void> {
  const d = getDb();
  const imagesJson = msg.images ? JSON.stringify(msg.images) : null;
  await d.runAsync(
    'INSERT INTO messages (id, chat_id, role, content, thinking, images, parent_id, branch_index, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [msg.id, msg.chatId, msg.role, msg.content, msg.thinking || null, imagesJson, msg.parentId, msg.branchIndex, msg.createdAt]
  );
  await touchChat(msg.chatId);
}

/** Get all messages for a chat, ordered oldest first. */
export async function getMessages(chatId: string): Promise<Message[]> {
  const d = getDb();
  const rows = await d.getAllAsync(
    'SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC',
    [chatId]
  );
  return (rows as any[]).map(mapMessage);
}

/** Update a message's content (used when streaming completes to save final text). */
export async function updateMessageContent(id: string, content: string): Promise<void> {
  const d = getDb();
  await d.runAsync('UPDATE messages SET content = ? WHERE id = ?', [content, id]);
}

/** Delete a specific message by ID. */
export async function deleteMessage(id: string): Promise<void> {
  const d = getDb();
  await d.runAsync('DELETE FROM messages WHERE id = ?', [id]);
}

/**
 * Delete all messages in a chat that were created at or after the given timestamp.
 * Used when editing a message — removes everything from that point onward.
 */
export async function deleteMessagesFromIndex(chatId: string, fromCreatedAt: number): Promise<void> {
  const d = getDb();
  await d.runAsync(
    'DELETE FROM messages WHERE chat_id = ? AND created_at >= ?',
    [chatId, fromCreatedAt]
  );
}

// ── Row mappers ─────────────────────────────────────────────────────────────

function mapConnection(row: any): Connection {
  return {
    id: row.id,
    url: row.url,
    key: row.key,
    name: row.name,
    createdAt: row.created_at,
    lastUsed: row.last_used,
  };
}

function mapChat(row: any): Chat {
  return {
    id: row.id,
    connectionId: row.connection_id,
    model: row.model,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row: any): Message {
  return {
    id: row.id,
    chatId: row.chat_id,
    role: row.role,
    content: row.content,
    thinking: row.thinking || undefined,
    images: row.images ? JSON.parse(row.images) : undefined,
    parentId: row.parent_id ?? null,
    branchIndex: row.branch_index ?? 0,
    createdAt: row.created_at,
  };
}

// ── Branch helpers ──────────────────────────────────────────────────────────

/** Get all sibling messages that share the same parentId within a chat. */
export async function getSiblings(chatId: string, parentId: string | null): Promise<Message[]> {
  const d = getDb();
  let rows: any[];
  if (parentId === null) {
    rows = await d.getAllAsync(
      'SELECT * FROM messages WHERE chat_id = ? AND parent_id IS NULL ORDER BY branch_index ASC',
      [chatId]
    );
  } else {
    rows = await d.getAllAsync(
      'SELECT * FROM messages WHERE chat_id = ? AND parent_id = ? ORDER BY branch_index ASC',
      [chatId, parentId]
    );
  }
  return rows.map(mapMessage);
}

/** Get the next branch index for a given parentId (for creating new branches). */
export async function getNextBranchIndex(chatId: string, parentId: string | null): Promise<number> {
  const d = getDb();
  let row: any;
  if (parentId === null) {
    row = await d.getFirstAsync(
      'SELECT MAX(branch_index) as max_idx FROM messages WHERE chat_id = ? AND parent_id IS NULL',
      [chatId]
    );
  } else {
    row = await d.getFirstAsync(
      'SELECT MAX(branch_index) as max_idx FROM messages WHERE chat_id = ? AND parent_id = ?',
      [chatId, parentId]
    );
  }
  return (row?.max_idx ?? -1) + 1;
}

/**
 * Get all messages for a chat as a flat list (all branches).
 * Use buildConversationThread() to resolve the active branch path.
 */
export async function getAllMessages(chatId: string): Promise<Message[]> {
  const d = getDb();
  const rows = await d.getAllAsync(
    'SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC',
    [chatId]
  );
  return (rows as any[]).map(mapMessage);
}

/**
 * Build a linear conversation thread from the message tree,
 * following the specified active branches.
 *
 * @param allMessages - All messages in the chat (flat list from DB)
 * @param activeBranches - Map of parentId → active branchIndex to follow.
 *                         If a parentId is missing, defaults to the latest branch (highest index).
 */
export function buildConversationThread(
  allMessages: Message[],
  activeBranches: Record<string, number>
): Message[] {
  const thread: Message[] = [];
  let currentParentId: string | null = null;

  while (true) {
    // Find all children of currentParentId
    const children = allMessages.filter((m) =>
      m.parentId === currentParentId
    );
    if (children.length === 0) break;

    // Determine which branch to follow
    const key = currentParentId ?? '__root__';
    const activeBranch = activeBranches[key];
    let selected: Message;

    if (activeBranch !== undefined) {
      selected = children.find((m) => m.branchIndex === activeBranch) || children[children.length - 1];
    } else {
      // Default: follow the latest branch (highest index)
      selected = children[children.length - 1];
    }

    thread.push(selected);
    currentParentId = selected.id;
  }

  return thread;
}
