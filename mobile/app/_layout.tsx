/**
 * PocketLlama — Root layout.
 * Initializes the database, wraps the app in the AppProvider context,
 * and sets up the root Stack navigator with a dark theme.
 */

import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppProvider, useAppContext } from '../contexts/AppContext';
import { Colors } from '../constants/theme';

/** Inner layout component that uses app context to show loading state. */
function RootLayoutInner() {
  const { dbReady } = useAppContext();

  // Show loading spinner until database is initialized
  if (!dbReady) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.text} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.background },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="models" />
        <Stack.Screen name="(chat)" />
      </Stack>
    </>
  );
}

/** Root layout exported for expo-router. */
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <AppProvider>
        <RootLayoutInner />
      </AppProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
});
