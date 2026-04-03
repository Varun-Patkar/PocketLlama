/**
 * PocketLlama — Model selection screen.
 * Displays available models from the connected Ollama instance.
 * Tapping a model creates a new chat and navigates to the chat screen.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { useAppContext } from '../contexts/AppContext';
import { getModels, checkVisionCapability, isVisionModel, formatModelSize } from '../services/ollama';
import { createChat } from '../services/database';
import { OllamaModel, Chat } from '../types';
import { Colors, FontSize, Spacing, BorderRadius } from '../constants/theme';

export default function ModelSelectionScreen() {
  const router = useRouter();
  const { connection } = useAppContext();
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch models on mount
  useEffect(() => {
    fetchModels();
  }, []);

  const fetchModels = async () => {
    if (!connection) {
      setError('No active connection.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const modelList = await getModels(connection.url, connection.key);
      setModels(modelList);
      if (modelList.length === 0) {
        setError('No models found. Pull a model with: ollama pull llama3.1');
      }
      // Pre-check vision capability for all models (populates cache)
      for (const m of modelList) {
        checkVisionCapability(connection.url, connection.key, m.name).catch(() => {});
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch models.');
    } finally {
      setLoading(false);
    }
  };

  /** Create a new chat with the selected model and navigate to it. */
  const handleSelectModel = async (model: OllamaModel) => {
    if (!connection) return;

    const chatId = Crypto.randomUUID();
    const now = Date.now();
    const chat: Chat = {
      id: chatId,
      connectionId: connection.id,
      model: model.name,
      title: 'New Chat',
      createdAt: now,
      updatedAt: now,
    };

    await createChat(chat);
    router.replace(`/(chat)/${chatId}`);
  };

  /** Render a single model card. */
  const renderModel = ({ item }: { item: OllamaModel }) => {
    const vision = isVisionModel(item.name);
    return (
      <TouchableOpacity style={styles.modelCard} onPress={() => handleSelectModel(item)}>
        <View style={styles.modelInfo}>
          <View style={styles.modelNameRow}>
            <Text style={styles.modelName}>{item.name}</Text>
            {vision && (
              <View style={styles.visionBadge}>
                <Ionicons name="eye-outline" size={12} color={Colors.text} />
                <Text style={styles.visionBadgeText}>Vision</Text>
              </View>
            )}
          </View>
          <View style={styles.modelMeta}>
            <Text style={styles.modelSize}>{formatModelSize(item.size)}</Text>
            {item.details?.parameterSize && (
              <>
                <Text style={styles.metaSeparator}>•</Text>
                <Text style={styles.modelSize}>{item.details.parameterSize}</Text>
              </>
            )}
            {item.details?.quantizationLevel && (
              <>
                <Text style={styles.metaSeparator}>•</Text>
                <Text style={styles.modelSize}>{item.details.quantizationLevel}</Text>
              </>
            )}
          </View>
        </View>
        <Ionicons name="chevron-forward" size={20} color={Colors.textTertiary} />
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Select Model</Text>
        <TouchableOpacity onPress={fetchModels}>
          <Ionicons name="refresh" size={24} color={Colors.text} />
        </TouchableOpacity>
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.text} />
          <Text style={styles.loadingText}>Loading models...</Text>
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={Colors.textSecondary} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchModels}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={models}
          keyExtractor={(item) => item.name}
          renderItem={renderModel}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
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
    paddingHorizontal: Spacing.xl,
    paddingTop: 60,
    paddingBottom: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: {
    color: Colors.text,
    fontSize: FontSize.lg,
    fontWeight: '600',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  loadingText: {
    color: Colors.textSecondary,
    fontSize: FontSize.md,
    marginTop: Spacing.md,
  },
  errorText: {
    color: Colors.textSecondary,
    fontSize: FontSize.md,
    textAlign: 'center',
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
  },
  retryButton: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  retryButtonText: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '500',
  },
  listContent: {
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  modelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modelInfo: {
    flex: 1,
    marginRight: Spacing.md,
  },
  modelNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  modelName: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '500',
  },
  visionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.card,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  visionBadgeText: {
    color: Colors.text,
    fontSize: FontSize.xs,
    fontWeight: '500',
  },
  modelMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.xs,
    gap: Spacing.xs,
  },
  modelSize: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
  },
  metaSeparator: {
    color: Colors.textTertiary,
    fontSize: FontSize.sm,
  },
});
