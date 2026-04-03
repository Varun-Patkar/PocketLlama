/**
 * PocketLlama — Connection screen (home).
 * Offers two connection methods: QR code scanning or manual URL+key entry.
 * Also shows a list of saved connections for quick reconnect.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  BackHandler,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppContext } from '../contexts/AppContext';
import { saveAndTestConnection, parseQRData } from '../services/connection';
import { touchConnection, deleteConnection } from '../services/database';
import QRScanner from '../components/QRScanner';
import { Colors, FontSize, Spacing, BorderRadius } from '../constants/theme';
import { Connection, QRPayload } from '../types';

export default function ConnectionScreen() {
  const router = useRouter();
  const { setConnection, savedConnections, refreshConnections } = useAppContext();
  const [mode, setMode] = useState<'home' | 'qr' | 'manual'>('home');
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // Handle Android hardware back button: go back to home mode if in QR/manual,
  // otherwise let the system handle it (exit app).
  useEffect(() => {
    const onBackPress = () => {
      if (mode !== 'home') {
        setMode('home');
        return true; // Consumed — don't exit
      }
      return false; // Let system handle (exit app)
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [mode]);

  /** Connect using a URL and key (from QR or manual entry). */
  const connect = async (connUrl: string, connKey: string) => {
    setConnecting(true);
    try {
      const conn = await saveAndTestConnection(connUrl, connKey);
      setConnection(conn);
      await refreshConnections();
      router.push('/models');
    } catch (err: any) {
      Alert.alert('Connection Failed', err.message || 'Could not connect to the server.');
    } finally {
      setConnecting(false);
    }
  };

  /** Handle a successful QR scan. */
  const handleQRScan = (payload: QRPayload) => {
    setMode('home');
    // Pre-fill manual fields so user can see/edit what was scanned
    setUrl(payload.url);
    setKey(payload.key);
    connect(payload.url, payload.key);
  };

  /** Handle manual connect button press. */
  const handleManualConnect = () => {
    if (!url.trim()) {
      Alert.alert('Missing URL', 'Please enter the server URL.');
      return;
    }
    if (!key.trim()) {
      Alert.alert('Missing Key', 'Please enter the auth key.');
      return;
    }
    connect(url.trim(), key.trim());
  };

  /** Reconnect to a saved connection. */
  const handleReconnect = async (conn: Connection) => {
    setConnecting(true);
    try {
      const { testConnection } = await import('../services/ollama');
      const ok = await testConnection(conn.url, conn.key);
      if (!ok) {
        Alert.alert('Connection Failed', 'Server is no longer reachable. The key may have changed.', [
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              await deleteConnection(conn.id);
              await refreshConnections();
            },
          },
          { text: 'Keep', style: 'cancel' },
        ]);
        setConnecting(false);
        return;
      }
      await touchConnection(conn.id);
      setConnection(conn);
      await refreshConnections();
      router.push('/models');
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setConnecting(false);
    }
  };

  /** Delete a saved connection. */
  const handleDeleteSaved = (conn: Connection) => {
    Alert.alert('Delete Connection', `Remove "${conn.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteConnection(conn.id);
          await refreshConnections();
        },
      },
    ]);
  };

  // ── QR Scanner mode ─────────────────────────────────────────────────────
  if (mode === 'qr') {
    return <QRScanner onScan={handleQRScan} onClose={() => setMode('home')} />;
  }

  // ── Manual entry mode ───────────────────────────────────────────────────
  if (mode === 'manual') {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.content}>
          <TouchableOpacity style={styles.backButton} onPress={() => setMode('home')}>
            <Ionicons name="arrow-back" size={24} color={Colors.text} />
          </TouchableOpacity>

          <Text style={styles.title}>Manual Connection</Text>
          <Text style={styles.subtitle}>
            Enter the URL and key from the PocketLlama server terminal.
          </Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Server URL</Text>
            <TextInput
              style={styles.input}
              value={url}
              onChangeText={setUrl}
              placeholder="https://xxxxx.devtunnels.ms"
              placeholderTextColor={Colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Auth Key</Text>
            <View style={styles.keyInputRow}>
              <TextInput
                style={[styles.input, styles.keyInput]}
                value={key}
                onChangeText={setKey}
                placeholder="32-character hex key"
                placeholderTextColor={Colors.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={!showKey}
              />
              <TouchableOpacity style={styles.showKeyButton} onPress={() => setShowKey(!showKey)}>
                <Ionicons
                  name={showKey ? 'eye-off-outline' : 'eye-outline'}
                  size={22}
                  color={Colors.textSecondary}
                />
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.connectButton, connecting && styles.buttonDisabled]}
            onPress={handleManualConnect}
            disabled={connecting}
          >
            {connecting ? (
              <ActivityIndicator color={Colors.background} />
            ) : (
              <Text style={styles.connectButtonText}>Connect</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ── Home mode (default) ─────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {/* Logo / header */}
        <View style={styles.header}>
          <Image
            source={require('../assets/pocketllama-logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.title}>PocketLlama</Text>
          <Text style={styles.subtitle}>Connect to your Ollama server</Text>
        </View>

        {/* Connection buttons */}
        <View style={styles.buttonGroup}>
          <TouchableOpacity
            style={[styles.primaryButton, connecting && styles.buttonDisabled]}
            onPress={() => setMode('qr')}
            disabled={connecting}
          >
            <Ionicons name="qr-code-outline" size={24} color={Colors.background} />
            <Text style={styles.primaryButtonText}>Scan QR Code</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondaryButton, connecting && styles.buttonDisabled]}
            onPress={() => setMode('manual')}
            disabled={connecting}
          >
            <Ionicons name="create-outline" size={24} color={Colors.text} />
            <Text style={styles.secondaryButtonText}>Enter Manually</Text>
          </TouchableOpacity>
        </View>

        {/* Loading indicator */}
        {connecting && (
          <View style={styles.connectingRow}>
            <ActivityIndicator color={Colors.text} />
            <Text style={styles.connectingText}>Connecting...</Text>
          </View>
        )}

        {/* Saved connections */}
        {savedConnections.length > 0 && (
          <View style={styles.savedSection}>
            <Text style={styles.savedTitle}>Saved Connections</Text>
            <FlatList
              data={savedConnections}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.savedItem}
                  onPress={() => handleReconnect(item)}
                  onLongPress={() => handleDeleteSaved(item)}
                  delayLongPress={400}
                  disabled={connecting}
                >
                  <View style={styles.savedItemLeft}>
                    <Ionicons name="server-outline" size={18} color={Colors.textSecondary} />
                    <View>
                      <Text style={styles.savedName}>{item.name}</Text>
                      <Text style={styles.savedUrl} numberOfLines={1}>
                        {item.url.replace(/^https?:\/\//, '')}
                      </Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
                </TouchableOpacity>
              )}
            />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: 80,
  },
  header: {
    alignItems: 'center',
    marginBottom: Spacing.xxl,
  },
  logo: {
    width: 150,
    height: 150,
  },
  title: {
    color: Colors.text,
    fontSize: FontSize.xxl,
    fontWeight: '700',
    marginTop: Spacing.md,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: FontSize.md,
    marginTop: Spacing.xs,
    textAlign: 'center',
  },
  buttonGroup: {
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.text,
    paddingVertical: Spacing.lg,
    borderRadius: BorderRadius.md,
  },
  primaryButtonText: {
    color: Colors.background,
    fontSize: FontSize.lg,
    fontWeight: '600',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    backgroundColor: 'transparent',
    paddingVertical: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  secondaryButtonText: {
    color: Colors.text,
    fontSize: FontSize.lg,
    fontWeight: '500',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  connectingRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  connectingText: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
  },
  savedSection: {
    marginTop: Spacing.lg,
  },
  savedTitle: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: Spacing.sm,
  },
  savedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.sm,
  },
  savedItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    flex: 1,
  },
  savedName: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '500',
  },
  savedUrl: {
    color: Colors.textTertiary,
    fontSize: FontSize.xs,
    marginTop: 1,
  },
  backButton: {
    marginBottom: Spacing.lg,
  },
  inputGroup: {
    marginBottom: Spacing.lg,
  },
  label: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    marginBottom: Spacing.xs,
  },
  input: {
    backgroundColor: Colors.inputBackground,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    color: Colors.text,
    fontSize: FontSize.md,
  },
  keyInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  keyInput: {
    flex: 1,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    borderRightWidth: 0,
  },
  showKeyButton: {
    backgroundColor: Colors.inputBackground,
    borderWidth: 1,
    borderColor: Colors.border,
    borderTopRightRadius: BorderRadius.md,
    borderBottomRightRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  connectButton: {
    backgroundColor: Colors.text,
    paddingVertical: Spacing.lg,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  connectButtonText: {
    color: Colors.background,
    fontSize: FontSize.lg,
    fontWeight: '600',
  },
});
