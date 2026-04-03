/**
 * PocketLlama — Global app context.
 * Provides connection state and database-ready flag to all screens.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Connection } from '../types';
import { initDatabase, getConnections } from '../services/database';

interface AppContextValue {
  /** Whether the SQLite database has been initialized. */
  dbReady: boolean;
  /** The currently active connection (null = not connected). */
  connection: Connection | null;
  /** Set the active connection. */
  setConnection: (conn: Connection | null) => void;
  /** All saved connections. */
  savedConnections: Connection[];
  /** Refresh the saved connections list from DB. */
  refreshConnections: () => Promise<void>;
}

const AppContext = createContext<AppContextValue>({
  dbReady: false,
  connection: null,
  setConnection: () => {},
  savedConnections: [],
  refreshConnections: async () => {},
});

/** Hook to access the global app context. */
export function useAppContext(): AppContextValue {
  return useContext(AppContext);
}

/** Provider component — wraps the entire app. */
export function AppProvider({ children }: { children: React.ReactNode }) {
  const [dbReady, setDbReady] = useState(false);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [savedConnections, setSavedConnections] = useState<Connection[]>([]);

  // Initialize database on mount
  useEffect(() => {
    (async () => {
      await initDatabase();
      setDbReady(true);
    })();
  }, []);

  // Load saved connections once DB is ready
  const refreshConnections = useCallback(async () => {
    if (!dbReady) return;
    const conns = await getConnections();
    setSavedConnections(conns);
  }, [dbReady]);

  useEffect(() => {
    refreshConnections();
  }, [refreshConnections]);

  return (
    <AppContext.Provider
      value={{ dbReady, connection, setConnection, savedConnections, refreshConnections }}
    >
      {children}
    </AppContext.Provider>
  );
}
