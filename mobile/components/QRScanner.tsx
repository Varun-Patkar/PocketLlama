/**
 * PocketLlama — QR Scanner component.
 * Full-screen camera view with barcode scanning overlay.
 * Parses scanned JSON data and calls onScan callback.
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { Colors, FontSize, Spacing, BorderRadius } from '../constants/theme';
import { parseQRData } from '../services/connection';
import { QRPayload } from '../types';

interface QRScannerProps {
  /** Called when a valid QR code with url+key is successfully scanned. */
  onScan: (payload: QRPayload) => void;
  /** Called when the user closes the scanner. */
  onClose: () => void;
}

export default function QRScanner({ onScan, onClose }: QRScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  // Camera permission not yet determined
  if (!permission) {
    return (
      <View style={styles.container}>
        <Text style={styles.permissionText}>Requesting camera permission...</Text>
      </View>
    );
  }

  // Camera permission denied
  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.permissionText}>Camera permission is required to scan QR codes.</Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Grant Permission</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.closeButtonBottom} onPress={onClose}>
          <Text style={styles.closeButtonBottomText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  /** Handle barcode scan event from the camera. */
  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanned) return; // Prevent multiple scans
    setScanned(true);

    try {
      const payload = parseQRData(data);
      onScan(payload);
    } catch (err: any) {
      Alert.alert('Invalid QR Code', err.message || 'Could not parse QR code data.', [
        { text: 'Scan Again', onPress: () => setScanned(false) },
        { text: 'Cancel', onPress: onClose },
      ]);
    }
  };

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
      />

      {/* Overlay with scan frame */}
      <View style={styles.overlay}>
        {/* Close button */}
        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
          <Ionicons name="close" size={28} color={Colors.text} />
        </TouchableOpacity>

        {/* Scan frame */}
        <View style={styles.scanFrame}>
          <View style={[styles.corner, styles.topLeft]} />
          <View style={[styles.corner, styles.topRight]} />
          <View style={[styles.corner, styles.bottomLeft]} />
          <View style={[styles.corner, styles.bottomRight]} />
        </View>

        {/* Instruction text */}
        <Text style={styles.instructionText}>
          Point your camera at the QR code{'\n'}shown in the terminal
        </Text>
      </View>
    </View>
  );
}

const FRAME_SIZE = 250;
const CORNER_SIZE = 30;
const CORNER_WEIGHT = 3;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  scanFrame: {
    width: FRAME_SIZE,
    height: FRAME_SIZE,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_WEIGHT,
    borderLeftWidth: CORNER_WEIGHT,
    borderColor: Colors.text,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_WEIGHT,
    borderRightWidth: CORNER_WEIGHT,
    borderColor: Colors.text,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_WEIGHT,
    borderLeftWidth: CORNER_WEIGHT,
    borderColor: Colors.text,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_WEIGHT,
    borderRightWidth: CORNER_WEIGHT,
    borderColor: Colors.text,
  },
  instructionText: {
    color: Colors.text,
    fontSize: FontSize.md,
    textAlign: 'center',
    marginTop: Spacing.xl,
    opacity: 0.8,
  },
  permissionText: {
    color: Colors.textSecondary,
    fontSize: FontSize.md,
    textAlign: 'center',
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.lg,
  },
  permissionButton: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.text,
    borderRadius: BorderRadius.md,
  },
  permissionButtonText: {
    color: Colors.background,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  closeButtonBottom: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  closeButtonBottomText: {
    color: Colors.textSecondary,
    fontSize: FontSize.md,
  },
});
