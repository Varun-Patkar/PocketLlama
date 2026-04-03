/**
 * PocketLlama — Branch navigator component.
 * Shows "< 1/2 >" style navigation arrows on messages that have
 * sibling branches (created by editing a message).
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, FontSize, Spacing } from '../constants/theme';

interface BranchNavigatorProps {
  /** The 1-based index of the currently shown branch. */
  currentIndex: number;
  /** Total number of sibling branches. */
  totalBranches: number;
  /** Called when user taps the left arrow (go to previous branch). */
  onPrevious: () => void;
  /** Called when user taps the right arrow (go to next branch). */
  onNext: () => void;
}

export default function BranchNavigator({
  currentIndex,
  totalBranches,
  onPrevious,
  onNext,
}: BranchNavigatorProps) {
  if (totalBranches <= 1) return null;

  return (
    <View style={styles.container}>
      <TouchableOpacity
        onPress={onPrevious}
        disabled={currentIndex <= 1}
        style={styles.arrow}
      >
        <Ionicons
          name="chevron-back"
          size={14}
          color={currentIndex <= 1 ? Colors.textTertiary : Colors.textSecondary}
        />
      </TouchableOpacity>
      <Text style={styles.label}>
        {currentIndex}/{totalBranches}
      </Text>
      <TouchableOpacity
        onPress={onNext}
        disabled={currentIndex >= totalBranches}
        style={styles.arrow}
      >
        <Ionicons
          name="chevron-forward"
          size={14}
          color={currentIndex >= totalBranches ? Colors.textTertiary : Colors.textSecondary}
        />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  arrow: {
    padding: 2,
  },
  label: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    fontWeight: '500',
    minWidth: 24,
    textAlign: 'center',
  },
});
