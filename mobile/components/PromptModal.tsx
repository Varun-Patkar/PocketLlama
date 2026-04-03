/**
 * PocketLlama — Custom text prompt modal.
 * A simple modal with a text input, used as a cross-platform replacement
 * for Alert.prompt (which is iOS-only).
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { Colors, FontSize, Spacing, BorderRadius } from '../constants/theme';

interface PromptModalProps {
  /** Whether the modal is visible. */
  visible: boolean;
  /** Title shown at the top of the modal. */
  title: string;
  /** Optional placeholder for the text input. */
  placeholder?: string;
  /** Initial value pre-filled in the input. */
  defaultValue?: string;
  /** Label for the confirm button. Default: "Save". */
  confirmLabel?: string;
  /** Whether to use multiline input. */
  multiline?: boolean;
  /** Initial images (base64) attached to the message being edited. */
  defaultImages?: string[];
  /** Whether to show image editing controls. */
  showImageEditor?: boolean;
  /** Called with the entered text and images when user confirms. */
  onConfirm: (value: string, images?: string[]) => void;
  /** Called when user cancels or dismisses. */
  onCancel: () => void;
}

export default function PromptModal({
  visible,
  title,
  placeholder,
  defaultValue = '',
  confirmLabel = 'Save',
  multiline = false,
  defaultImages,
  showImageEditor = false,
  onConfirm,
  onCancel,
}: PromptModalProps) {
  const [value, setValue] = useState(defaultValue);
  const [images, setImages] = useState<string[]>(defaultImages || []);
  const inputRef = useRef<TextInput>(null);

  // Reset value and images when modal opens
  useEffect(() => {
    if (visible) {
      setValue(defaultValue);
      setImages(defaultImages || []);
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [visible, defaultValue, defaultImages]);

  const handleConfirm = () => {
    const trimmed = value.trim();
    if (trimmed || images.length > 0) {
      onConfirm(trimmed, showImageEditor ? images : undefined);
    }
  };

  /** Pick an image from gallery. */
  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.7,
      allowsMultipleSelection: false,
    });
    if (!result.canceled && result.assets[0]?.base64) {
      setImages((prev) => [...prev, result.assets[0].base64!]);
    }
  };

  /** Take a photo with camera. */
  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Camera permission is required.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      base64: true,
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]?.base64) {
      setImages((prev) => [...prev, result.assets[0].base64!]);
    }
  };

  /** Show add image options. */
  const handleAddImage = () => {
    Alert.alert('Add Image', 'Choose an option', [
      { text: 'Take Photo', onPress: takePhoto },
      { text: 'Choose from Gallery', onPress: pickImage },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  /** Remove an image by index. */
  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onCancel} />
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>

          {/* Image editor strip */}
          {showImageEditor && (
            <View style={styles.imageSection}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageStrip}>
                {images.map((img, i) => (
                  <View key={i} style={styles.imageWrapper}>
                    <Image
                      source={{ uri: `data:image/jpeg;base64,${img}` }}
                      style={styles.imageThumb}
                    />
                    <TouchableOpacity style={styles.removeImage} onPress={() => removeImage(i)}>
                      <Ionicons name="close-circle" size={20} color={Colors.text} />
                    </TouchableOpacity>
                  </View>
                ))}
                <TouchableOpacity style={styles.addImageButton} onPress={handleAddImage}>
                  <Ionicons name="add" size={24} color={Colors.textSecondary} />
                </TouchableOpacity>
              </ScrollView>
            </View>
          )}

          <TextInput
            ref={inputRef}
            style={[styles.input, multiline && styles.inputMultiline]}
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={Colors.textTertiary}
            autoFocus={false}
            multiline={multiline}
            maxLength={multiline ? 10000 : 100}
            selectionColor={Colors.textSecondary}
            onSubmitEditing={multiline ? undefined : handleConfirm}
            blurOnSubmit={!multiline}
          />
          <View style={styles.buttons}>
            <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmButton, !value.trim() && styles.confirmDisabled]}
              onPress={handleConfirm}
              disabled={!value.trim()}
            >
              <Text style={[styles.confirmText, !value.trim() && styles.confirmTextDisabled]}>
                {confirmLabel}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlay,
  },
  card: {
    width: '85%',
    maxWidth: 400,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  title: {
    color: Colors.text,
    fontSize: FontSize.lg,
    fontWeight: '600',
    marginBottom: Spacing.lg,
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
    minHeight: 44,
  },
  inputMultiline: {
    minHeight: 100,
    maxHeight: 200,
    textAlignVertical: 'top',
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.md,
    marginTop: Spacing.lg,
  },
  cancelButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  cancelText: {
    color: Colors.textSecondary,
    fontSize: FontSize.md,
    fontWeight: '500',
  },
  confirmButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.text,
    borderRadius: BorderRadius.md,
  },
  confirmDisabled: {
    opacity: 0.3,
  },
  confirmText: {
    color: Colors.background,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  confirmTextDisabled: {
    color: Colors.background,
  },
  imageSection: {
    marginBottom: Spacing.md,
  },
  imageStrip: {
    flexDirection: 'row',
  },
  imageWrapper: {
    marginRight: Spacing.sm,
    position: 'relative',
  },
  imageThumb: {
    width: 60,
    height: 60,
    borderRadius: BorderRadius.sm,
  },
  removeImage: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: Colors.background,
    borderRadius: 10,
  },
  addImageButton: {
    width: 60,
    height: 60,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
