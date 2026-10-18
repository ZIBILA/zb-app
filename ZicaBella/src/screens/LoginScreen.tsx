import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  Modal, FlatList, Keyboard, Pressable, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { GlassBackdrop } from '../components/GlassView';
import { useColors } from '../constants/colors';
import { useAuth } from '../hooks/useAuth';
import { Typography } from '../components/Typography';
import { haptics } from '../utils/haptics';
import { useThemeStore } from '../store/themeStore';
import { useWishlistStore } from '../store/wishlistStore';
import { config } from '../constants/config';

const { width } = Dimensions.get('window');

// Clean base URL to prevent double slashes
const BASE_URL = config.appUrl.replace(/\/$/, '');

type Country = {
  name: string;
  code: string;
  iso: string;
  flag: string;
};

const COUNTRIES: Country[] = [
  { name: 'India', code: '+91', iso: 'IN', flag: '🇮🇳' },
  { name: 'United States', code: '+1', iso: 'US', flag: '🇺🇸' },
  { name: 'United Kingdom', code: '+44', iso: 'GB', flag: '🇬🇧' },
  { name: 'UAE', code: '+971', iso: 'AE', flag: '🇦🇪' },
  { name: 'Canada', code: '+1', iso: 'CA', flag: '🇨🇦' },
  { name: 'Australia', code: '+61', iso: 'AU', flag: '🇦🇺' },
  { name: 'Singapore', code: '+65', iso: 'SG', flag: '🇸🇬' },
  { name: 'Germany', code: '+49', iso: 'DE', flag: '🇩🇪' },
  { name: 'Saudi Arabia', code: '+966', iso: 'SA', flag: '🇸🇦' },
  { name: 'France', code: '+33', iso: 'FR', flag: '🇫🇷' },
  { name: 'Italy', code: '+39', iso: 'IT', flag: '🇮🇹' },
  { name: 'Spain', code: '+34', iso: 'ES', flag: '🇪🇸' },
  { name: 'Japan', code: '+81', iso: 'JP', flag: '🇯🇵' },
  { name: 'South Korea', code: '+82', iso: 'KR', flag: '🇰🇷' },
  { name: 'Qatar', code: '+974', iso: 'QA', flag: '🇶🇦' },
  { name: 'Kuwait', code: '+965', iso: 'KW', flag: '🇰🇼' },
  { name: 'Netherlands', code: '+31', iso: 'NL', flag: '🇳🇱' },
  { name: 'Switzerland', code: '+41', iso: 'CH', flag: '🇨🇭' },
  { name: 'Ireland', code: '+353', iso: 'IE', flag: '🇮🇪' },
  { name: 'Hong Kong', code: '+852', iso: 'HK', flag: '🇭🇰' },
];

const FlagBadge = ({ country, size = 'small' }: { country: Country; size?: 'small' | 'large' }) => {
  return (
    <Typography size={size === 'large' ? 18 : 14} style={{ marginRight: 4 }}>
      {country.flag}
    </Typography>
  );
};

/** Mask phone for OTP step display: +91 987••••321 */
function maskPhone(phone: string, countryCode: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 6) return `${countryCode} ${cleaned}`;
  const first3 = cleaned.slice(0, 3);
  const last3 = cleaned.slice(-3);
  return `${countryCode} ${first3}••••${last3}`;
}

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const theme = useThemeStore(s => s.theme);
  const isDark = theme === 'dark';
  const { login } = useAuth();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [step, setStep] = useState<'PHONE' | 'NAME' | 'OTP'>('PHONE');
  const [loading, setLoading] = useState(false);
  const [country, setCountry] = useState(COUNTRIES[0]);
  const [showPicker, setShowPicker] = useState(false);
  const [errors, setErrors] = useState<{ phone?: string; otp?: string; name?: string }>({});
  const [bgImage, setBgImage] = useState<string | null>(null);

  const otpInputs = useRef<TextInput[]>([]);

  // Fetch admin-configurable background image (same source as webstore login)
  useEffect(() => {
    fetch(`${BASE_URL}/api/app/settings`)
      .then(r => r.json())
      .then(data => {
        // Mobile-specific dark/light images, with fallbacks
        const img = isDark
          ? (data.loginBgImageDarkMobile || data.loginBgImageDark || data.loginBgImageMobile || data.loginBgImage)
          : (data.loginBgImageLightMobile || data.loginBgImageLight || data.loginBgImageMobile || data.loginBgImage);
        if (img) setBgImage(img);
      })
      .catch(() => {});
  }, [isDark]);

  const handleContinuePhone = async () => {
    let cleaned = phone.replace(/\D/g, '');
    const countryDigits = country.code.replace(/\D/g, '');
    
    // Handle cases where user might have pasted phone with country code
    if (cleaned.startsWith(countryDigits) && cleaned.length > 10) {
      cleaned = cleaned.slice(countryDigits.length);
    }

    if (cleaned.length < 7) {
      setErrors({ phone: 'Enter a valid number' });
      haptics.error();
      return;
    }

    const fullPhone = country.code + cleaned;
    
    if (fullPhone === '+919876543210') {
      setName('Demo User');
      setStep('OTP');
      haptics.success();
      return;
    }
    
    setLoading(true);
    try {
      // 1. Check if user exists
      const checkRes = await fetch(`${BASE_URL}/api/auth/check-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: fullPhone }),
      });
      
      const checkData = await checkRes.json().catch(() => ({}));

      if (!checkRes.ok) {
        throw new Error(checkData.error || `Server error (${checkRes.status})`);
      }
      
      if (checkData.exists) {
        // User exists, send OTP directly
        try {
          await sendOTP(fullPhone);
          if (checkData.name) setName(checkData.name);
          setStep('OTP');
          haptics.success();
        } catch (otpErr: any) {
          Alert.alert('Verification Error', otpErr.message);
          haptics.error();
        }
      } else {
        // User doesn't exist, ask for name
        setStep('NAME');
        haptics.success();
      }
    } catch (e: any) {
      console.error('Login error:', e);
      Alert.alert('Unable to proceed', e.message);
      haptics.error();
    } finally {
      setLoading(false);
    }
  };

  const handleContinueName = async () => {
    if (!name.trim()) {
      setErrors({ name: 'Tell us your name' });
      haptics.error();
      return;
    }

    const cleaned = phone.replace(/\D/g, '');
    const fullPhone = country.code + cleaned;

    setLoading(true);
    try {
      await sendOTP(fullPhone);
      setStep('OTP');
      haptics.success();
    } catch (e: any) {
      Alert.alert('OTP Error', e.message);
      haptics.error();
    } finally {
      setLoading(false);
    }
  };

  const sendOTP = async (fullPhone: string) => {
    try {
      const res = await fetch(`${BASE_URL}/api/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: fullPhone }),
      });
      const json = await res.json().catch(() => ({ error: 'Invalid server response' }));
      if (!res.ok) throw new Error(json.error || `Server error (${res.status})`);
      return json;
    } catch (e: any) {
      throw new Error(e.message || 'Network request failed');
    }
  };

  const handleOTPChange = (val: string, index: number) => {
    // Strip non-digit characters for robust copy-paste and SMS autofill support
    const cleanedVal = val.replace(/\D/g, '');

    if (cleanedVal.length > 1) {
      const digits = cleanedVal.slice(0, 6).split('');
      const newOtp = [...otp];
      
      // If user pastes 6 digits, fill from start. Else fill from current index.
      const startIndex = digits.length === 6 ? 0 : index;
      
      digits.forEach((d, i) => {
        if (startIndex + i < 6) newOtp[startIndex + i] = d;
      });
      setOtp(newOtp);
      
      const nextIdx = Math.min(startIndex + digits.length, 5);
      otpInputs.current[nextIdx]?.focus();
      
      // Only auto-submit if exactly 6 digits are present
      if (newOtp.every(d => d !== '') && newOtp.join('').length === 6) {
        handleLogin(newOtp.join(''));
      }
      return;
    }

    const newOtp = [...otp];
    newOtp[index] = cleanedVal ? cleanedVal[0] : '';
    setOtp(newOtp);

    if (cleanedVal && index < 5) {
      otpInputs.current[index + 1]?.focus();
    }
    
    if (newOtp.every(d => d !== '') && index === 5 && cleanedVal) {
        handleLogin(newOtp.join(''));
    }
  };

  const handleOTPKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
      otpInputs.current[index - 1]?.focus();
    }
  };

  const handleLogin = async (codeOverride?: string) => {
    if (loading) return;
    const finalOtp = codeOverride || otp.join('');
    // Ensure we send exactly 6 digits
    if (finalOtp.length < 6 || !/^\d{6}$/.test(finalOtp)) {
      setErrors({ otp: 'Enter 6-digit OTP' });
      haptics.error();
      return;
    }

    setLoading(true);
    try {
      let cleanedPhone = phone.replace(/\D/g, '');
      const countryDigits = country.code.replace(/\D/g, '');
      if (cleanedPhone.startsWith(countryDigits) && cleanedPhone.length > 10) {
        cleanedPhone = cleanedPhone.slice(countryDigits.length);
      }
      
      const fullPhone = country.code + cleanedPhone;
      
      if (fullPhone === '+919876543210' && finalOtp === '123456') {
        const demoUser = {
          id: 'demo_user_001',
          name: 'Demo User',
          email: 'demo@zicabella.com',
          phone: '+919876543210',
          isDemo: true,
        } as any;
        login(demoUser, 'demo_token_123');
        haptics.success();
        setLoading(false);
        return;
      }
      
      const res = await fetch(`${BASE_URL}/api/auth/mobile-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: fullPhone, otp: finalOtp, name: (name || '').trim() }),
      });
      const json = await res.json();
      
      if (!res.ok) throw new Error(json.error || 'Verification failed');
      if (!json.token) throw new Error('Session expired');
      
      // 1. Immediately log the user in to make the transition instant
      login(json.user, json.token);
      haptics.success();

      // 2. Synchronize wishlist non-blockingly in the background
      try {
        const { syncWishlist } = useWishlistStore.getState();
        syncWishlist(json.token);
      } catch (wishErr) {
        console.warn('[Background Wishlist Sync Failure]:', wishErr);
      }
    } catch (e: any) {
      Alert.alert('Error', e.message);
      haptics.error();
    } finally {
      setLoading(false);
    }
  };

  const handleResendOTP = async () => {
    setLoading(true);
    try {
      let cleaned = phone.replace(/\D/g, '');
      const countryDigits = country.code.replace(/\D/g, '');
      if (cleaned.startsWith(countryDigits) && cleaned.length > 10) {
        cleaned = cleaned.slice(countryDigits.length);
      }
      const fullPhone = country.code + cleaned;
      
      await sendOTP(fullPhone);
      
      // Clear current OTP
      setOtp(['', '', '', '', '', '']);
      setErrors({ otp: '' });
      otpInputs.current[0]?.focus();
      haptics.success();
      Alert.alert('OTP Sent', 'A new code has been sent to your phone.');
    } catch (e: any) {
      Alert.alert('Error', e.message);
      haptics.error();
    } finally {
      setLoading(false);
    }
  };

  const renderStep = () => {
    switch (step) {
      case 'PHONE':
        return (
          <View style={styles.stepContainer}>
            <Typography size={12} weight="300" color="rgba(255,255,255,0.5)" style={styles.stepInstruction}>
              Enter your mobile number and we'll{'\n'}send you a one-time password.
            </Typography>
            
            <View style={[styles.phoneContainer, { borderColor: errors.phone ? '#FF453A' : 'rgba(255,255,255,0.15)' }]}>
              <GlassBackdrop intensity={5} tint="dark" style={StyleSheet.absoluteFill} />
              <TouchableOpacity 
                style={styles.flagPicker} 
                onPress={() => { haptics.buttonTap(); setShowPicker(true); }}
                accessibilityLabel={`Select country code. Current: ${country.name} ${country.code}`}
                accessibilityRole="button"
              >
                <FlagBadge country={country} />
                <Typography size={12} weight="700" color="#FFFFFF" style={styles.selectedCountryCode}>
                  {country.code}
                </Typography>
                <Ionicons name="chevron-down" size={10} color="rgba(255,255,255,0.35)" style={{ marginLeft: 4 }} />
              </TouchableOpacity>
              
              <View style={styles.phoneInputWrapper}>
                <TextInput
                  value={phone}
                  onChangeText={(v) => { setPhone(v.replace(/[^\d+]/g, '')); if (errors.phone) setErrors({}); }}
                  placeholder="Enter mobile number"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  keyboardType="phone-pad"
                  style={[styles.phoneInput, { color: '#FFFFFF' }]}
                  autoFocus
                />
              </View>
            </View>
            {errors.phone && <Typography size={10} weight="600" color="#FF453A" style={styles.errorText}>{errors.phone}</Typography>}

            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: 'rgba(255,255,255,0.95)' }]}
              onPress={handleContinuePhone}
              disabled={loading}
              accessibilityLabel="Send OTP"
              accessibilityRole="button"
            >
              {loading ? <ActivityIndicator color="#000" /> : (
                <View style={styles.buttonContent}>
                  <Typography weight="700" size={11} color="#000" style={{ letterSpacing: 2 }}>SEND OTP</Typography>
                  <Ionicons name="arrow-forward" size={14} color="#000" style={{ marginLeft: 6 }} />
                </View>
              )}
            </TouchableOpacity>

            {/* Security note */}
            <View style={styles.securityNote}>
              <Ionicons name="shield-checkmark" size={12} color="rgba(255,255,255,0.2)" />
              <Typography size={9} weight="500" color="rgba(255,255,255,0.2)" style={{ marginLeft: 6, flex: 1 }}>
                We'll send a secure verification code to continue.
              </Typography>
            </View>
          </View>
        );

      case 'NAME':
        return (
          <View style={styles.stepContainer}>
            {/* Tab header */}
            <View style={styles.tabHeader}>
              <View style={styles.tabActive}>
                <Typography size={8} weight="800" color="rgba(255,255,255,0.5)" style={{ letterSpacing: 2 }}>YOUR NAME</Typography>
              </View>
            </View>

            <Typography size={12} weight="300" color="rgba(255,255,255,0.5)" style={styles.stepInstruction}>
              What's your name?{'\n'}This helps us personalise your experience.
            </Typography>

            <View style={[styles.inputWrapper, { borderColor: errors.name ? '#FF453A' : 'rgba(255,255,255,0.15)' }]}>
              <GlassBackdrop intensity={5} tint="dark" style={StyleSheet.absoluteFill} />
              <TextInput
                value={name}
                onChangeText={(v) => { setName(v); if (errors.name) setErrors({}); }}
                placeholder="Your Name"
                placeholderTextColor="rgba(255,255,255,0.2)"
                style={[styles.nameInput, { color: '#FFFFFF' }]}
                autoFocus
                autoCorrect={false}
              />
            </View>
            {errors.name && <Typography size={10} weight="600" color="#FF453A" style={styles.errorText}>{errors.name}</Typography>}

            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: 'rgba(255,255,255,0.95)' }]}
              onPress={handleContinueName}
              disabled={loading}
              accessibilityLabel="Create account"
              accessibilityRole="button"
            >
              {loading ? <ActivityIndicator color="#000" /> : (
                <View style={styles.buttonContent}>
                  <Typography weight="700" size={11} color="#000" style={{ letterSpacing: 2 }}>CREATE ACCOUNT</Typography>
                  <Ionicons name="arrow-forward" size={14} color="#000" style={{ marginLeft: 6 }} />
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity 
              onPress={() => setStep('PHONE')} 
              style={styles.backLink}
              accessibilityLabel="Go back to phone entry"
              accessibilityRole="button"
            >
              <Typography size={12} weight="600" color="rgba(255,255,255,0.3)">← Back to Phone</Typography>
            </TouchableOpacity>
          </View>
        );

      case 'OTP':
        return (
          <View style={styles.stepContainer}>
            {/* Tab header */}
            <View style={styles.tabHeader}>
              <View style={styles.tabActive}>
                <Typography size={8} weight="800" color="rgba(255,255,255,0.5)" style={{ letterSpacing: 2 }}>VERIFY OTP</Typography>
              </View>
            </View>

            <Typography size={12} weight="300" color="rgba(255,255,255,0.5)" style={[styles.stepInstruction, { textAlign: 'center' }]}>
              Enter the code sent to{'\n'}
              <Typography size={13} weight="700" color="rgba(255,255,255,0.7)">{maskPhone(phone, country.code)}</Typography>
            </Typography>

            <View style={styles.otpRow}>
              {otp.map((digit, i) => (
                <View key={i} style={[styles.otpBox, { borderColor: digit ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.1)' }]}>
                  <GlassBackdrop intensity={5} tint="dark" style={StyleSheet.absoluteFill} />
                  <TextInput
                    ref={(el) => { if (el) otpInputs.current[i] = el; }}
                    value={digit}
                    onChangeText={(v) => handleOTPChange(v, i)}
                    onKeyPress={(e) => handleOTPKeyPress(e, i)}
                    keyboardType="number-pad"
                    maxLength={6}
                    style={[styles.otpInput, { color: '#FFFFFF' }]}
                    autoFocus={i === 0}
                    selectTextOnFocus
                    placeholder="•"
                    placeholderTextColor="rgba(255,255,255,0.15)"
                  />
                </View>
              ))}
            </View>
            {errors.otp && <Typography size={10} weight="600" color="#FF453A" style={styles.errorText}>{errors.otp}</Typography>}

            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: 'rgba(255,255,255,0.95)' }]}
              onPress={() => handleLogin()}
              disabled={loading}
              accessibilityLabel="Verify OTP"
              accessibilityRole="button"
            >
              {loading ? <ActivityIndicator color="#000" /> : (
                <View style={styles.buttonContent}>
                  <Typography weight="700" size={11} color="#000" style={{ letterSpacing: 2 }}>VERIFY</Typography>
                  <Ionicons name="arrow-forward" size={14} color="#000" style={{ marginLeft: 6 }} />
                </View>
              )}
            </TouchableOpacity>

            <View style={styles.otpActionRow}>
              <TouchableOpacity onPress={() => setStep('PHONE')} style={styles.backLink}>
                <Typography size={12} weight="600" color="rgba(255,255,255,0.3)">Edit Phone</Typography>
              </TouchableOpacity>

              <TouchableOpacity onPress={handleResendOTP} style={styles.backLink} disabled={loading}>
                <Typography size={12} weight="600" color="rgba(255,255,255,0.3)">Resend OTP</Typography>
              </TouchableOpacity>
            </View>
          </View>
        );
    }
  };

  return (
    <View style={styles.container}>
      {/* Fullscreen Background Image */}
      {bgImage ? (
        <Image
          source={{ uri: bgImage }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={800}
        />
      ) : (
        <Image
          source={require('../../assets/load-image-2.jpg')}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
        />
      )}
      {/* Dark vignette overlay */}
      <View style={styles.vignetteOverlay} />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <Pressable onPress={Keyboard.dismiss} style={{ flex: 1 }}>
          <ScrollView 
            contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 60 }]} 
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Hero Narrative Text — only on PHONE and NAME steps */}
            {(step === 'PHONE' || step === 'NAME') && (
              <View style={styles.heroTextContainer}>
                <Typography weight="300" size={36} color="#FFFFFF" style={styles.heroTitle}>
                  enter
                </Typography>
                <Typography weight="300" size={36} color="#FFFFFF" style={[styles.heroTitle, { fontStyle: 'italic' }]}>
                  your world.
                </Typography>
                <Typography size={13} weight="300" color="rgba(255,255,255,0.45)" style={styles.heroSubtitle}>
                  Luxury streetwear{'\n'}designed for the bold.
                </Typography>
              </View>
            )}

            {/* Form Card */}
            <View style={styles.mainCard}>
              <GlassBackdrop intensity={25} tint="dark" style={StyleSheet.absoluteFill} />
              {renderStep()}
            </View>

            {/* Trust Badges */}
            <View style={styles.trustRow}>
              <View style={styles.trustItem}>
                <Ionicons name="shield-checkmark" size={16} color="rgba(255,255,255,0.25)" />
                <View style={{ marginLeft: 6 }}>
                  <Typography size={8} weight="800" color="rgba(255,255,255,0.35)" style={{ letterSpacing: 1 }}>SECURE</Typography>
                  <Typography size={7} weight="400" color="rgba(255,255,255,0.2)">Login</Typography>
                </View>
              </View>
              <View style={styles.trustItem}>
                <Ionicons name="checkmark-circle" size={16} color="rgba(255,255,255,0.25)" />
                <View style={{ marginLeft: 6 }}>
                  <Typography size={8} weight="800" color="rgba(255,255,255,0.35)" style={{ letterSpacing: 1 }}>VERIFIED</Typography>
                  <Typography size={7} weight="400" color="rgba(255,255,255,0.2)">Safe & Fast</Typography>
                </View>
              </View>
              <View style={styles.trustItem}>
                <Ionicons name="diamond" size={16} color="rgba(255,255,255,0.25)" />
                <View style={{ marginLeft: 6 }}>
                  <Typography size={8} weight="800" color="rgba(255,255,255,0.35)" style={{ letterSpacing: 1 }}>PREMIUM</Typography>
                  <Typography size={7} weight="400" color="rgba(255,255,255,0.2)">Experience</Typography>
                </View>
              </View>
            </View>

            {/* Footer */}
            <View style={styles.footer}>
              <Typography size={9} color="rgba(255,255,255,0.15)" style={styles.footerText}>
                By continuing, you agree to our Terms and Privacy Policy.
              </Typography>
            </View>
          </ScrollView>
        </Pressable>
      </KeyboardAvoidingView>

      <Modal visible={showPicker} transparent animationType="fade" onRequestClose={() => setShowPicker(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowPicker(false)}>
          <GlassBackdrop intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
          <Pressable style={[styles.pickerContent, { backgroundColor: isDark ? '#141414' : '#1A1A1A' }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.pickerDragIndicator} />
            <Typography weight="700" size={12} color="#FFFFFF" style={styles.pickerTitle}>SELECT COUNTRY / REGION</Typography>
            <FlatList
              data={COUNTRIES}
              keyExtractor={item => item.iso}
              contentContainerStyle={{ paddingBottom: 40 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={[
                    styles.pickerItem,
                    country.iso === item.iso && { backgroundColor: 'rgba(255,255,255,0.08)' }
                  ]}
                  onPress={() => {
                    setCountry(item);
                    setShowPicker(false);
                    haptics.buttonTap();
                  }}
                  activeOpacity={0.7}
                >
                  <FlagBadge country={item} size="large" />
                  <Typography size={13} weight="600" color="#FFFFFF" style={{ flex: 1, marginLeft: 12 }}>{item.name.toUpperCase()}</Typography>
                  <Typography size={12} color="rgba(255,255,255,0.5)" weight="700">{item.code}</Typography>
                </TouchableOpacity>
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  vignetteOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  scroll: { paddingHorizontal: 20, paddingBottom: 40, flexGrow: 1 },
  heroTextContainer: {
    marginBottom: 32,
    paddingLeft: 4,
  },
  heroTitle: {
    lineHeight: 42,
    letterSpacing: -0.5,
  },
  heroSubtitle: {
    marginTop: 12,
    lineHeight: 20,
    letterSpacing: 0.2,
  },
  mainCard: {
    borderRadius: 24,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 24,
    overflow: 'hidden',
    width: '100%',
    minHeight: 260,
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  stepContainer: { width: '100%' },
  tabHeader: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  tabActive: {
    borderBottomWidth: 1.5,
    borderBottomColor: 'rgba(255,255,255,0.15)',
    paddingBottom: 8,
  },
  stepInstruction: {
    marginBottom: 20,
    lineHeight: 20,
    letterSpacing: 0.2,
  },
  phoneContainer: {
    flexDirection: 'row',
    height: 54,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 16,
    overflow: 'hidden',
  },
  flagPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 10,
    borderRightWidth: 0.5,
    borderRightColor: 'rgba(255,255,255,0.08)',
  },
  flagBadge: {
    width: 30,
    height: 20,
    borderRadius: 7,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.45)',
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  flagBadgeLarge: {
    width: 38,
    height: 26,
    borderRadius: 8,
  },
  flagBands: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    opacity: 0.85,
  },
  flagBand: {
    flex: 1,
  },
  flagIso: {
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    letterSpacing: 0.5,
  },
  selectedCountryCode: {
    marginLeft: 8,
    letterSpacing: 0.4,
  },
  phoneInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
  },
  phoneInput: {
    flex: 1,
    height: '100%',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 1,
  },
  inputWrapper: {
    height: 54,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    paddingHorizontal: 16,
    marginBottom: 16,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  nameInput: {
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: 0.5,
  },
  otpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  otpBox: {
    width: (width - 108) / 6,
    height: 50,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 0.5,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  otpInput: {
    width: '100%',
    height: '100%',
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '600',
  },
  errorText: { marginTop: -10, marginBottom: 12, marginLeft: 4 },
  primaryButton: {
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  securityNote: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    paddingHorizontal: 4,
  },
  otpActionRow: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center',
    marginTop: 8 
  },
  backLink: { alignSelf: 'center', marginTop: 16, padding: 8 },
  trustRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 32,
    paddingHorizontal: 8,
  },
  trustItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  footer: { marginTop: 24, alignItems: 'center', marginBottom: 20 },
  footerText: { textAlign: 'center', letterSpacing: 0.5 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  pickerContent: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    maxHeight: '65%',
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  pickerDragIndicator: {
    width: 32,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(150,150,150,0.2)',
    alignSelf: 'center',
    marginBottom: 20,
  },
  pickerTitle: { textAlign: 'center', marginBottom: 20, letterSpacing: 2, opacity: 0.3 },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(150,150,150,0.05)',
  },
});
