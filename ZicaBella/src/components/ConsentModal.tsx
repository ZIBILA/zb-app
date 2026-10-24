import React, { useState, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Typography } from './Typography';
import { useColors } from '../constants/colors';
import { useThemeStore } from '../store/themeStore';
import { haptics } from '../utils/haptics';

interface ConsentModalProps {
  onConsentComplete?: () => void;
}

export const ConsentModal = ({ onConsentComplete }: ConsentModalProps) => {
  const [isVisible, setIsVisible] = useState(false);
  const colors = useColors();
  const isDark = useThemeStore((state) => state.theme) === 'dark';

  useEffect(() => {
    checkFirstLaunch();
  }, []);

  const checkFirstLaunch = async () => {
    try {
      const hasConsented = await AsyncStorage.getItem('@zicabella_consent');
      if (!hasConsented) {
        setIsVisible(true);
      } else {
        onConsentComplete?.();
      }
    } catch (e) {
      // safe fallback
      setIsVisible(true);
    }
  };

  const handleAccept = async () => {
    haptics.buttonTap();
    await AsyncStorage.setItem('@zicabella_consent', 'accepted');
    setIsVisible(false);
    onConsentComplete?.();
  };

  if (!isVisible) return null;

  return (
    <Modal transparent animationType="fade" visible={isVisible} statusBarTranslucent>
      <View style={[styles.container, { backgroundColor: isDark ? 'rgba(0,0,0,0.72)' : 'rgba(5,5,6,0.28)' }]}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceElevated,
              borderColor: colors.borderLight,
            },
            !isDark && styles.cardLight,
          ]}
        >
          <Typography heading weight="700" size={16} color={colors.text} style={styles.title}>
            DATA & PRIVACY
          </Typography>

          <Typography size={11} color={colors.textSecondary} style={styles.paragraph}>
            To provide the Zica Bella experience, we collect basic usage analytics and crash reports.
            This helps us fix bugs faster and improve the app.
          </Typography>

          <Typography size={11} color={colors.textSecondary} style={styles.paragraph}>
            By continuing to use the app, you agree to our Terms of Service and Privacy Policy.
            You can review these at any time in your Profile Settings.
          </Typography>

          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.foreground }]}
            onPress={handleAccept}
            activeOpacity={0.8}
            accessibilityLabel="Accept privacy terms and continue"
            accessibilityRole="button"
          >
            <Typography size={11} weight="700" color={colors.background} style={{ letterSpacing: 1 }}>
              I UNDERSTAND
            </Typography>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    padding: 24,
    borderRadius: 24,
    borderWidth: 1,
  },
  cardLight: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 8,
  },
  title: {
    letterSpacing: 2,
    marginBottom: 20,
    textAlign: 'center',
  },
  paragraph: {
    lineHeight: 18,
    marginBottom: 16,
    textAlign: 'center',
  },
  button: {
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
  }
});
