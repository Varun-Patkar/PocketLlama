/**
 * PocketLlama — Chat input bar component.
 * Multi-line text input with send button, image attachment for vision models,
 * and a stop button during active generation.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Image,
  StyleSheet,
  Alert,
  ScrollView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  useAudioRecorder,
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorderState,
} from 'expo-audio';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, BorderRadius, FontSize } from '../constants/theme';

interface ChatInputProps {
  /** Called when the user sends a message. */
  onSend: (text: string, images: string[]) => void;
  /** Called when the user presses the stop button during streaming. */
  onStop: () => void;
  /** Whether the assistant is currently generating a response. */
  isGenerating: boolean;
  /** Whether the current model supports image input. */
  isVisionCapable: boolean;
  /** Whether the server supports speech-to-text. */
  sttAvailable?: boolean;
  /** Called to transcribe a recorded audio file URI → returns text. */
  onTranscribe?: (audioUri: string) => Promise<string>;
}

export default function ChatInput({
  onSend, onStop, isGenerating, isVisionCapable,
  sttAvailable = false, onTranscribe,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  // Request mic permissions and set audio mode on mount (if STT available)
  useEffect(() => {
    if (!sttAvailable) return;
    (async () => {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (status.granted) {
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      }
    })();
  }, [sttAvailable]);

  /** Send the current message (text + optional images). */
  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed && images.length === 0) return;
    onSend(trimmed, images);
    setText('');
    setImages([]);
  };

  /** Open the image picker (gallery). */
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

  /** Open the camera to capture a photo. */
  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Camera permission is required to take photos.');
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

  /** Show action sheet to choose between camera and gallery. */
  const handleAttachImage = () => {
    Alert.alert('Add Image', 'Choose an option', [
      { text: 'Take Photo', onPress: takePhoto },
      { text: 'Choose from Gallery', onPress: pickImage },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  /** Remove an attached image by index. */
  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  /** Start or stop audio recording for STT. */
  const handleMicPress = async () => {
    if (isRecording) {
      // Stop recording and transcribe
      try {
        setIsRecording(false);
        setIsTranscribing(true);

        await audioRecorder.stop();
        const uri = audioRecorder.uri;

        if (uri && onTranscribe) {
          const transcribed = await onTranscribe(uri);
          if (transcribed) {
            setText((prev) => (prev ? prev + ' ' + transcribed : transcribed));
          }
        }
      } catch (err) {
        console.warn('STT stop error:', err);
        Alert.alert('Recording Error', 'Failed to process audio recording.');
      } finally {
        setIsTranscribing(false);
      }
    } else {
      // Start recording
      try {
        await audioRecorder.prepareToRecordAsync();
        audioRecorder.record();
        setIsRecording(true);
      } catch (err) {
        console.warn('Recording start error:', err);
        Alert.alert('Recording Error', 'Could not start recording.');
      }
    }
  };

  const canSend = text.trim().length > 0 || images.length > 0;

  return (
    <View style={styles.container}>
      {/* Image preview strip */}
      {images.length > 0 && (
        <ScrollView horizontal style={styles.imageStrip} showsHorizontalScrollIndicator={false}>
          {images.map((img, i) => (
            <View key={i} style={styles.imagePreviewWrapper}>
              <Image
                source={{ uri: `data:image/jpeg;base64,${img}` }}
                style={styles.imagePreview}
              />
              <TouchableOpacity style={styles.removeImage} onPress={() => removeImage(i)}>
                <Ionicons name="close-circle" size={20} color={Colors.text} />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Input row */}
      <View style={styles.inputRow}>
        {/* Image attachment button (only for vision models) */}
        {isVisionCapable && !isGenerating && (
          <TouchableOpacity style={styles.attachButton} onPress={handleAttachImage}>
            <Ionicons name="image-outline" size={24} color={Colors.textSecondary} />
          </TouchableOpacity>
        )}

        {/* Text input */}
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Message"
          placeholderTextColor={Colors.textTertiary}
          multiline
          maxLength={10000}
          editable={!isGenerating && !isTranscribing}
          onSubmitEditing={Platform.OS === 'web' ? handleSend : undefined}
          blurOnSubmit={false}
        />

        {/* Mic button (only when STT is available and not generating) */}
        {sttAvailable && !isGenerating && (
          isTranscribing ? (
            <View style={styles.micButton}>
              <ActivityIndicator size="small" color={Colors.textSecondary} />
            </View>
          ) : (
            <TouchableOpacity style={styles.micButton} onPress={handleMicPress}>
              <Ionicons
                name={isRecording ? 'mic' : 'mic-outline'}
                size={24}
                color={isRecording ? '#FF4444' : Colors.textSecondary}
              />
            </TouchableOpacity>
          )
        )}

        {/* Send or Stop button */}
        {isGenerating ? (
          <TouchableOpacity style={styles.stopButton} onPress={onStop}>
            <Ionicons name="stop-circle" size={32} color={Colors.text} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!canSend}
          >
            <Ionicons
              name="arrow-up-circle"
              size={32}
              color={canSend ? Colors.text : Colors.textTertiary}
            />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
    paddingBottom: Platform.OS === 'ios' ? Spacing.xl : Spacing.sm,
  },
  imageStrip: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    maxHeight: 90,
  },
  imagePreviewWrapper: {
    marginRight: Spacing.sm,
    position: 'relative',
  },
  imagePreview: {
    width: 70,
    height: 70,
    borderRadius: BorderRadius.sm,
  },
  removeImage: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: Colors.background,
    borderRadius: 10,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    gap: Spacing.xs,
  },
  attachButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.inputBackground,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    color: Colors.text,
    fontSize: FontSize.md,
    maxHeight: 140,
    minHeight: 44,
  },
  sendButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  stopButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
  micButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
});
