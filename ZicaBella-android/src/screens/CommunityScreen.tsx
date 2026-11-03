import React, { useState, useEffect } from 'react';
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { GlassView, GlassBackdrop } from '../components/GlassView';

import { useColors } from '../constants/colors';
import { useAuth } from '../hooks/useAuth';
import { config } from '../constants/config';
import { useAuthStore } from '../store/authStore';
import { Typography } from '../components/Typography';
import CommunitySection from '../components/CommunitySection';
import { useAdminSettings, useFeaturedUsers } from '../hooks/useAdminFeatures';
import { useCommunityStore } from '../store/communityStore';
import { haptics } from '../utils/haptics';
import { useThemeStore } from '../store/themeStore';
import { resolveImageUrl } from '../utils/imageUtils';

export default function CommunityScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const colors = useColors();
  const { user, isAuthenticated } = useAuth();
  const theme = useThemeStore(s => s.theme);
  const isDark = theme === 'dark';

  const { settings } = useAdminSettings();
  const { updates, loading, fetchCommunityData } = useCommunityStore();
  
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    imageUrl: '',
    instagramUrl: '',
    quote: '',
  });
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchCommunityData();
  }, [fetchCommunityData]);

  const pickImage = async () => {
    try {
      const ImagePicker = require('expo-image-picker');
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [4, 5],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0].uri) {
        uploadImage(result.assets[0].uri);
      }
    } catch (e: any) {
      console.error("ImagePicker Error:", e);
      Alert.alert('Error', 'Could not open image library');
    }
  };

  const uploadImage = async (uri: string) => {
    setIsUploading(true);
    const formData = new FormData();
    const uriParts = uri.split('.');
    const fileType = uriParts[uriParts.length - 1];
    
    // @ts-ignore
    formData.append('file', {
      uri: Platform.OS === 'android' ? uri : uri.replace('file://', ''),
      name: `look-${Date.now()}.${fileType}`,
      type: `image/${fileType === 'png' ? 'png' : 'jpeg'}`,
    });

    try {
      const res = await fetch(`${config.appUrl}/api/community/upload`, {
        method: 'POST',
        body: formData,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'multipart/form-data',
          'Authorization': `Bearer ${useAuthStore.getState().token || ''}`,
        },
      });
      
      const data = await res.json();
      if (data.success) {
        setForm((prev: any) => ({ ...prev, imageUrl: data.url }));
        haptics.success();
      } else {
        Alert.alert('Upload Failed', data.error || 'Unknown error');
      }
    } catch (e: any) {
      console.error("Upload error:", e);
      Alert.alert('Upload Error', 'Failed to connect to server');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmission = async () => {
    if (!form.imageUrl || !form.name || !form.quote) {
      Alert.alert('Missing Info', 'Please provide a photo, name, and style narrative.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`${config.appUrl}/api/community/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${useAuthStore.getState().token || ''}`,
        },
        body: JSON.stringify({
          imageUrl: form.imageUrl,
          instagramUrl: form.instagramUrl,
          styleDescription: form.quote,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        haptics.success();
        Alert.alert('Success', 'Your look has been submitted for moderation!');
        setShowForm(false);
        setForm({ ...form, imageUrl: '', quote: '' });
        // Refresh community data to show new updates if any
        fetchCommunityData(true);
      } else {
        Alert.alert('Submission Failed', data.error || 'Please try again later.');
      }
    } catch (e) {
      Alert.alert('Error', 'Network error. Please check your connection.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity 
          onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main')} 
          style={[styles.backBtn, { backgroundColor: colors.surface }]}
        >
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <Typography heading weight="700" size={12} color={colors.text} style={styles.headerTitle}>COMMUNITY</Typography>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <GlassView 
          intensity={isDark ? 80 : 100} 
          tint={isDark ? 'dark' : 'light'} 
          style={[styles.banner, { borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)', borderWidth: 1 }]}
        >
          <Typography heading size={8} weight="700" color={isDark ? colors.textLight : colors.textMuted} style={styles.bannerLabel}>DROP ALERT</Typography>
          <Typography heading size={18} weight="700" color={colors.text} style={styles.bannerTitle}>New season arriving soon</Typography>
          <Typography size={11} color={colors.textSecondary} style={styles.bannerSub}>Be the first to know</Typography>
        </GlassView>

        <TouchableOpacity 
          style={[styles.featuredBtn, { backgroundColor: colors.foreground }]}
          onPress={() => isAuthenticated ? setShowForm(true) : navigation.navigate('ProfileTab')}
          activeOpacity={0.85}
        >
          <Ionicons name="cloud-upload-outline" size={18} color={colors.background} />
          <Typography heading weight="700" size={9} color={colors.background}>PUBLISH YOUR LOOK</Typography>
        </TouchableOpacity>

        <View style={{ marginBottom: 24 }}>
          <CommunitySection community={settings?.community} />
        </View>

        {updates.length > 0 && (
          <View style={styles.section}>
            <Typography heading size={8} color={colors.textLight} style={styles.sectionLabel}>LIVE UPDATES</Typography>
            {updates.map((update: any, idx: number) => (
              <GlassView 
                key={update.id || idx} 
                intensity={isDark ? 80 : 100} 
                tint={isDark ? 'dark' : 'light'} 
                style={[styles.updateCard, { borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)' }]}
              >
                <View style={styles.updateBadge}>
                   <Typography heading size={7} weight="700" color={update.type === 'EVENT' ? colors.primary : '#34C759'}>{update.type}</Typography>
                </View>
                <Typography heading size={14} color={colors.text} style={{ marginBottom: 4 }}>{update.title}</Typography>
                <Typography size={11} color={colors.textSecondary}>{update.description}</Typography>
              </GlassView>
            ))}
          </View>
        )}

        {showForm && (
          <View style={StyleSheet.absoluteFill}>
             <GlassBackdrop intensity={isDark ? 80 : 100} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
             <ScrollView style={[styles.formContainer, { backgroundColor: 'transparent' }]} contentContainerStyle={{ padding: 24, paddingBottom: 100 }}>
                <View style={styles.formHeader}>
                   <Typography heading size={18} color={colors.text}>Publish Look</Typography>
                   <TouchableOpacity onPress={() => setShowForm(false)}>
                      <Ionicons name="close-circle" size={24} color={colors.textMuted} />
                   </TouchableOpacity>
                </View>
                <Typography size={10} color={colors.textSecondary} style={{ marginBottom: 24 }}>Share your fit with the community</Typography>

                <TouchableOpacity 
                   style={[styles.uploadZone, { 
                     borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                     backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.4)',
                   }]} 
                   onPress={pickImage}
                   disabled={isUploading}
                >
                   {form.imageUrl ? (
                     <Image source={{ uri: resolveImageUrl(form.imageUrl) || '' }} style={styles.previewImage} />
                   ) : (
                     <View style={styles.uploadPlaceholder}>
                        <Ionicons name="camera-outline" size={32} color={colors.textExtraLight} />
                        <Typography size={10} color={colors.textMuted}>{isUploading ? 'UPLOADING...' : 'TAP TO UPLOAD PHOTO'}</Typography>
                     </View>
                   )}
                </TouchableOpacity>

                <View style={styles.inputGroup}>
                   <Typography heading size={7} color={colors.textMuted} style={styles.inputLabel}>NAME</Typography>
                   <TextInput 
                      value={form.name}
                      onChangeText={(t) => setForm({...form, name: t})}
                      placeholder="Your Name"
                      placeholderTextColor={colors.textExtraLight}
                      style={[styles.formInput, {
                        backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.6)',
                        borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                        color: colors.text
                      }]}
                   />
                </View>

                <View style={styles.inputGroup}>
                   <Typography heading size={7} color={colors.textMuted} style={styles.inputLabel}>INSTAGRAM URL (OPTIONAL)</Typography>
                   <TextInput 
                      value={form.instagramUrl}
                      onChangeText={(t) => setForm({...form, instagramUrl: t})}
                      placeholder="https://instagram.com/p/..."
                      placeholderTextColor={colors.textExtraLight}
                      style={[styles.formInput, {
                        backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.6)',
                        borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                        color: colors.text
                      }]}
                   />
                </View>

                <View style={styles.inputGroup}>
                   <Typography heading size={7} color={colors.textMuted} style={styles.inputLabel}>STYLE NARRATIVE</Typography>
                   <TextInput 
                      value={form.quote}
                      onChangeText={(t) => setForm({...form, quote: t})}
                      placeholder="What do you love most about Zica Bella?..."
                      placeholderTextColor={colors.textExtraLight}
                      style={[styles.formInput, { 
                        height: 100, 
                        textAlignVertical: 'top',
                        backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.6)',
                        borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                        color: colors.text
                      }]}
                      multiline
                   />
                </View>

                <TouchableOpacity 
                   style={[styles.submitBtn, { backgroundColor: colors.foreground }]} 
                   onPress={handleSubmission}
                   disabled={isSubmitting || !form.imageUrl}
                >
                   <Typography heading weight="700" size={10} color={colors.background}>
                      {isSubmitting ? 'SUBMITTING...' : 'SUBMIT TO EDITOR'}
                   </Typography>
                </TouchableOpacity>
             </ScrollView>
          </View>
        )}

        {updates.length === 0 && !loading && !showForm && (
          <View style={styles.comingSoon}>
            <Ionicons name="people-outline" size={48} color={colors.borderLight} />
            <Typography heading weight="700" size={16} color={colors.text} style={styles.comingSoonTitle}>Inner Circle</Typography>
            <Typography size={12} color={colors.textMuted} style={styles.comingSoonText}>
              Exclusive access for verified Zica Bella customers. Connect, share, and get early access.
            </Typography>
          </View>
        )}

        <View style={{ height: 120 + insets.bottom }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 3, textTransform: 'uppercase' },
  scrollContent: { paddingHorizontal: 16 },
  banner: { borderRadius: 16, padding: 24, marginBottom: 20 },
  bannerLabel: { fontSize: 8, fontWeight: '700', letterSpacing: 3, textTransform: 'uppercase', marginBottom: 8 },
  bannerTitle: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3, marginBottom: 4 },
  bannerSub: { fontSize: 11, fontWeight: '400' },
  comingSoon: { alignItems: 'center', paddingTop: 40, gap: 12 },
  comingSoonTitle: { marginTop: 8 },
  comingSoonText: { textAlign: 'center', maxWidth: 280, lineHeight: 18 },
  featuredBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16, borderRadius: 16, marginBottom: 32 },
  section: { marginBottom: 32 },
  sectionLabel: { letterSpacing: 2, marginBottom: 16, opacity: 0.6 },
  updateCard: { padding: 24, borderRadius: 20, borderWidth: 1, marginBottom: 12 },
  updateBadge: { marginBottom: 8 },
  formContainer: { ...StyleSheet.absoluteFillObject },
  formHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  uploadZone: { height: 300, borderRadius: 24, borderWidth: 2, borderStyle: 'dashed', marginBottom: 24, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  previewImage: { width: '100%', height: '100%' },
  uploadPlaceholder: { alignItems: 'center', gap: 12 },
  inputGroup: { marginBottom: 20 },
  inputLabel: { letterSpacing: 2, marginBottom: 10, marginLeft: 4 },
  formInput: { borderRadius: 16, padding: 16, fontSize: 14, borderWidth: 1 },
  submitBtn: { paddingVertical: 18, borderRadius: 16, alignItems: 'center', marginTop: 10 },
});
