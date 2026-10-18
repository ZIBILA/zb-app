import React, { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, Pressable, RefreshControl, Keyboard,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import * as ImagePicker from 'expo-image-picker';
import { useColors } from '../constants/colors';
import { useAuth } from '../hooks/useAuth';
import { useAuthStore } from '../store/authStore';
import { signOut } from '../auth/firebase';
import { haptics } from '../utils/haptics';
import { config } from '../constants/config';
import { navigationRef } from '../navigation/navigationUtils';
import { useUIStore } from '../store/uiStore';
import { Typography } from '../components/Typography';
import { GlassView } from '../components/GlassView';
import { Image } from 'expo-image';
import { useThemeStore } from '../store/themeStore';
import { useWishlistStore } from '../store/wishlistStore';
import { formatPrice } from '../utils/formatPrice';
import { useNotificationStore } from '../store/notificationStore';
import LoginScreen from './LoginScreen';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const colors = useColors();
  const { user, isAuthenticated, biometricEnabled, login, logout, setBiometric, updateUser } = useAuth();
  const theme = useThemeStore(s => s.theme);
  const isDark = theme === 'dark';
  const setTabBarVisible = useUIStore(s => s.setTabBarVisible);
  const { wishlist } = useWishlistStore();
  const unreadCount = useNotificationStore(s => s.unreadCount());

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [orderCount, setOrderCount] = useState(0);
  const [serviceCount, setServiceCount] = useState(0);
  const [storeCredits, setStoreCredits] = useState(0);
  const [storeCreditPreference, setStoreCreditPreference] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState<any[]>([]);
  const [profileImage, setProfileImage] = useState<string | undefined>(user?.image || undefined);

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');

  const lastScrollY = useRef(0);
  const scrollRef = useRef<ScrollView>(null);

  const fetchProfile = useCallback(async () => {
    if (!isAuthenticated || !user) return;
    try {
      const params = new URLSearchParams();
      if (user.id) params.set('customerId', user.id);
      if (user.phone) params.set('phone', user.phone);
      if (user.email) params.set('email', user.email);

      const authOptions = { headers: { 'Authorization': `Bearer ${useAuthStore.getState().token || ''}` } };
      
      const [profileRes, ordersRes, addrRes, returnsRes, exchangesRes, creditsRes] = await Promise.all([
        fetch(`${config.appUrl}/api/app/profile?${params.toString()}`, authOptions),
        fetch(`${config.appUrl}/api/app/orders?${params.toString()}&limit=1`, authOptions),
        fetch(`${config.appUrl}/api/app/customers/addresses?${params.toString()}`, authOptions),
        fetch(`${config.appUrl}/api/app/returns?${params.toString()}`, authOptions),
        fetch(`${config.appUrl}/api/app/exchanges?${params.toString()}`, authOptions),
        fetch(`${config.appUrl}/api/app/store-credits?${params.toString()}`, authOptions),
      ]);

      const profileJson = await profileRes.json().catch(() => ({}));
      if (profileRes.ok && profileJson?.customer) {
        updateUser({
          name: profileJson.customer.name || user.name,
          email: profileJson.customer.email || user.email,
          phone: profileJson.customer.phone || user.phone,
          image: profileJson.customer.image || undefined,
          isCommunityMember: !!profileJson.customer.isCommunityMember,
        });
        setProfileImage(profileJson.customer.image || undefined);
        setStoreCredits(profileJson.customer.storeCredits ?? 0);
        setStoreCreditPreference(profileJson.customer.storeCreditPreference ?? false);
      }

      const ordersJson = await ordersRes.json().catch(() => ({}));
      if (ordersRes.ok && ordersJson.orders) {
        setOrderCount((ordersJson.page?.total as number) ?? ordersJson.orders.length);
      }

      const addrJson = await addrRes.json().catch(() => ({}));
      if (addrRes.ok && Array.isArray(addrJson.addresses)) {
        setSavedAddresses(addrJson.addresses);
      }

      const returnsJson = await returnsRes.json().catch(() => ({ returns: [] }));
      const exchangesJson = await exchangesRes.json().catch(() => ({ exchanges: [] }));
      setServiceCount((returnsJson.returns?.length || 0) + (exchangesJson.exchanges?.length || 0));

      const creditsJson = await creditsRes.json().catch(() => ({}));
      if (creditsRes.ok && creditsJson.balance !== undefined) {
        setStoreCredits(creditsJson.balance);
        setStoreCreditPreference(creditsJson.preferStoreCredits ?? false);
      }
    } catch (_e) {
      // Profile fetch failed — non-fatal
    }
  }, [isAuthenticated, user?.id]);

  useEffect(() => {
    if (isAuthenticated && user) {
      setEditName(user.name || '');
      setEditEmail(user.email || '');
      setProfileImage(user.image);
      fetchProfile();
    }
  }, [isAuthenticated, user?.id]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchProfile();
    setRefreshing(false);
    haptics.success();
  }, [fetchProfile]);

  const handleToggleStoreCreditPreference = async (val: boolean) => {
    if (!user) return;
    haptics.buttonTap();
    setStoreCreditPreference(val);
    try {
      await fetch(`${config.appUrl}/api/app/store-credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: user.id,
          action: 'set_preference',
          preferStoreCredits: val,
        }),
      });
    } catch (_e) {
      setStoreCreditPreference(!val); // Revert on error
    }
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    if (!editName.trim()) {
      Alert.alert('Error', 'Name cannot be empty');
      return;
    }

    setLoading(true);
    try {
      const token = useAuthStore.getState().token;
      const res = await fetch(`${config.appUrl}/api/app/profile`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || ''}`
        },
        body: JSON.stringify({ 
          customerId: user.id,
          name: editName.trim(),
          email: editEmail.trim(),
          phone: user.phone,
          image: profileImage,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        updateUser({ 
          name: editName.trim(), 
          email: editEmail.trim(),
          image: profileImage
        });
        setIsEditing(false);
        haptics.success();
        Alert.alert('Success', 'Profile updated successfully');
      } else {
        throw new Error(data.error || 'Failed to update profile');
      }
    } catch (e: any) {
      console.error('[Profile] Save Profile Error:', e);
      haptics.error();
      Alert.alert('Error', e.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const handlePickAvatar = async () => {
    if (!user) return;
    haptics.buttonTap();
    
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission', 'Photo access is required to update your profile photo.');
        return;
      }
      
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.4, // Lower quality for smaller base64 payload
        allowsEditing: true,
        aspect: [1, 1],
        base64: true, // Get base64 string directly
      });
      
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      
      if (!asset.base64) {
        throw new Error('Could not get image data. Please try again.');
      }

      setLoading(true);
      const token = useAuthStore.getState().token;
      const base64Image = `data:image/jpeg;base64,${asset.base64}`;

      // Directly update the profile with the base64 image
      const profileUpdate = await fetch(`${config.appUrl}/api/app/profile`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || ''}`
        },
        body: JSON.stringify({ 
          customerId: user.id, 
          image: base64Image 
        }),
      });

      if (!profileUpdate.ok) {
        const text = await profileUpdate.text();
        console.error('[Profile] Update failed status:', profileUpdate.status);
        console.error('[Profile] Update failed body:', text);
        throw new Error(`Update failed (${profileUpdate.status})`);
      }

      const updateData = await profileUpdate.json().catch(() => ({}));
      
      setProfileImage(base64Image);
      updateUser({ image: base64Image });
      haptics.success();
      Alert.alert('Success', 'Profile photo updated');
    } catch (e: any) {
      console.error('[Profile] Avatar Update Error:', e);
      haptics.error();
      Alert.alert('Error', e.message || 'Failed to update photo');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveAvatar = async () => {
    if (!user) return;
    haptics.buttonTap();

    Alert.alert(
      'Remove Photo',
      'Are you sure you want to remove your profile photo?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              const token = useAuthStore.getState().token;
              const res = await fetch(`${config.appUrl}/api/app/profile`, {
                method: 'PATCH',
                headers: { 
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token || ''}`
                },
                body: JSON.stringify({ customerId: user.id, image: null }),
              });

              if (res.ok) {
                setProfileImage(undefined);
                updateUser({ image: undefined });
                haptics.success();
                Alert.alert('Success', 'Profile photo removed');
              } else {
                throw new Error('Failed to remove photo');
              }
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Network error');
            } finally {
              setLoading(false);
            }
          }
        }
      ]
    );
  };

  const onScroll = (event: any) => {
    const currentY = event.nativeEvent.contentOffset.y;
    const diff = currentY - lastScrollY.current;
    
    if (Math.abs(diff) > 15) {
      const isCurrentlyVisible = useUIStore.getState().isTabBarVisible;
      if (diff > 0 && currentY > 100) {
        if (isCurrentlyVisible) setTabBarVisible(false);
      } else {
        if (!isCurrentlyVisible) setTabBarVisible(true);
      }
      lastScrollY.current = currentY;
    }
  };

  const handleBiometricToggle = async (value: boolean) => {
    if (value) {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Verify your identity',
        fallbackLabel: 'Use passcode',
      });
      if (result.success) {
        setBiometric(true);
        haptics.success();
      }
    } else {
      setBiometric(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: () => {
          signOut();
        },
      },
    ]);
  };

  const navigatePolicy = (handle: string, title: string) => {
    haptics.buttonTap();
    if (navigationRef.isReady()) {
      navigationRef.navigate('Policy', { handle, title });
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Account Deletion Request',
      'To delete your account, please submit a high-priority support ticket or email us at support@zicabella.com with your reason for leaving.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Go to Support', onPress: () => navigation.navigate('Support') }
      ]
    );
  };

  const submitDeletionRequest = async (reason: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${config.appUrl}/api/support/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: user?.id,
          guestName: user?.name,
          guestEmail: user?.email,
          subject: 'ACCOUNT DELETION REQUEST',
          content: `User requested account deletion. \n\nReason: ${reason}`,
          priority: 'HIGH'
        })
      });

      if (res.ok) {
        haptics.success();
        Alert.alert(
          'Request Submitted',
          'Your deletion request has been sent. An admin will review and process it manually. We will contact you via email once completed.'
        );
      } else {
        throw new Error('Failed to submit request');
      }
    } catch (e) {
      Alert.alert('Error', 'Could not submit request. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const MenuItem = ({ icon, title, subtitle, onPress, destructive, badge, type, value, onToggle }: any) => {
    const colors = useColors();
    return (
      <TouchableOpacity 
        style={[styles.menuItem, { borderBottomColor: colors.borderExtraLight }]} 
        onPress={type === 'toggle' ? () => onToggle?.(!value) : onPress}
        activeOpacity={0.7}
      >
        <View style={styles.menuItemLeft}>
          <View style={[styles.iconBox, { backgroundColor: colors.surface }]}>
            <Ionicons name={icon} size={16} color={destructive ? colors.error : colors.text} />
          </View>
          <Typography weight="500" size={12} color={destructive ? colors.error : colors.text} style={styles.menuLabel}>
            {title}
          </Typography>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {badge !== undefined && (
            <View style={{ backgroundColor: colors.error, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 }}>
              <Typography size={10} color="#FFF" weight="bold">{badge}</Typography>
            </View>
          )}
          {type === 'toggle' ? (
            <Pressable onPress={() => onToggle?.(!value)}>
              <View style={[styles.toggleTrack, { backgroundColor: value ? colors.foreground : (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)') }]}>
                <View style={[styles.toggleThumb, { transform: [{ translateX: value ? 20 : 2 }], backgroundColor: '#FFF' }]} />
              </View>
            </Pressable>
          ) : (
            <Ionicons name="chevron-forward" size={14} color={colors.textExtraLight} />
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // ─── NOT AUTHENTICATED ───
  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  // ─── AUTHENTICATED VIEW ───
  const goRoot = (name: 'OrderHistory' | 'Wishlist' | 'Community') => {
    haptics.buttonTap();
    if (navigationRef.isReady()) {
      navigationRef.navigate(name as never);
    }
  };

  const quickActions = [
    { icon: 'receipt-outline' as const, label: 'Orders', onPress: () => goRoot('OrderHistory') },
    { icon: 'heart-outline' as const, label: 'Wishlist', onPress: () => navigation.navigate('Wishlist') },
    { icon: 'swap-horizontal-outline' as const, label: 'Returns', onPress: () => navigation.navigate('Returns') },
    { icon: 'help-circle-outline' as const, label: 'FAQ', onPress: () => navigation.navigate('FAQ') },
    { icon: 'people-outline' as const, label: 'Collabs', onPress: () => navigation.navigate('Collaborations') },
    { icon: 'newspaper-outline' as const, label: 'Blogs', onPress: () => navigation.navigate('Blogs') },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
        style={{ flex: 1 }}
      >
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: insets.top + 40, paddingHorizontal: 20, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.textExtraLight}
              />
            }
          >
            <View style={styles.profileHeader}>
              <TouchableOpacity 
                activeOpacity={0.8} 
                onPress={() => {
                  Alert.alert(
                    'Profile Photo',
                    'Choose an option',
                    [
                      { text: 'Upload New Photo', onPress: handlePickAvatar },
                      profileImage ? { text: 'Remove Photo', onPress: handleRemoveAvatar, style: 'destructive' } : null,
                      { text: 'Cancel', style: 'cancel' }
                    ].filter(Boolean) as any
                  );
                }}
                accessibilityLabel="Edit profile photo"
                accessibilityRole="button"
              >
                <GlassView intensity={isDark ? 20 : 60} tint={theme} style={[styles.avatarGlass, { borderColor: colors.borderLight }]}>
                  {profileImage ? (
                    <Image
                      source={{ uri: profileImage }}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                      transition={250}
                    />
                  ) : (
                    <Typography heading weight="700" size={24} color={colors.text}>
                      {(user?.name || 'U')[0].toUpperCase()}
                    </Typography>
                  )}
                  <View style={styles.avatarEditDot}>
                    <Ionicons name="pencil" size={12} color={colors.background} />
                  </View>
                </GlassView>
              </TouchableOpacity>
              <View style={styles.headerInfo}>
                <Typography heading weight="600" size={18} color={colors.text}>{user?.name || 'ZICA USER'}</Typography>
                <Typography weight="300" size={9} color={colors.textLight} style={{ letterSpacing: 1 }}>{user?.id ? `ID: ${user.id.slice(0, 8).toUpperCase()}` : 'MEMBER SINCE 2024'}</Typography>
              </View>
            </View>

            <View style={[styles.statsRow, { backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)', borderColor: colors.borderExtraLight }]}>
              <TouchableOpacity 
                style={styles.statItem} 
                onPress={() => goRoot('OrderHistory')}
                accessibilityLabel={`${orderCount} orders`}
                accessibilityRole="button"
              >
                <Typography heading size={16} color={colors.text} style={{ letterSpacing: 2 }}>
                  {String(orderCount).padStart(2, '0')}
                </Typography>
                <Typography size={6.5} color={colors.textExtraLight} weight="600">ORDERS</Typography>
              </TouchableOpacity>
              <View style={[styles.statDivider, { backgroundColor: colors.borderLight }]} />
              <TouchableOpacity 
                style={styles.statItem} 
                onPress={() => navigation.navigate('Wishlist')}
                accessibilityLabel={`${wishlist.length} items in wishlist`}
                accessibilityRole="button"
              >
                <Typography heading size={16} color={colors.text} style={{ letterSpacing: 2 }}>
                   {String(wishlist.length).padStart(2, '0')}
                </Typography>
                <Typography size={6.5} color={colors.textExtraLight} weight="600">WISHLIST</Typography>
              </TouchableOpacity>
              <View style={[styles.statDivider, { backgroundColor: colors.borderLight }]} />
              <TouchableOpacity 
                style={styles.statItem} 
                onPress={() => goRoot('OrderHistory')}
                accessibilityLabel={`${serviceCount} service requests`}
                accessibilityRole="button"
              >
                 <Typography heading size={16} color={colors.text} style={{ letterSpacing: 2 }}>
                   {String(serviceCount).padStart(2, '0')}
                 </Typography>
                 <Typography size={6.5} color={colors.textExtraLight} weight="600">SERVICES</Typography>
              </TouchableOpacity>
              <View style={[styles.statDivider, { backgroundColor: colors.borderLight }]} />
              <TouchableOpacity 
                style={styles.statItem} 
                onPress={() => { haptics.buttonTap(); navigation.navigate('StoreCreditHistory'); }}
                accessibilityLabel={`${storeCredits} store credits`}
                accessibilityRole="button"
              >
                <Typography heading size={16} color={storeCredits > 0 ? colors.success : colors.text} style={{ letterSpacing: 1 }}>
                  {storeCredits > 0 ? `₹${storeCredits}` : '—'}
                </Typography>
                <Typography size={6.5} color={colors.textExtraLight} weight="600">CREDITS</Typography>
              </TouchableOpacity>
            </View>

            <View style={styles.quickActionsGrid}>
              {quickActions.map((action) => (
                <TouchableOpacity
                  key={action.label}
                  style={[styles.quickActionItem, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', borderColor: colors.borderExtraLight }]}
                  onPress={() => { haptics.buttonTap(); action.onPress(); }}
                  activeOpacity={0.7}
                >
                  <View style={[styles.quickActionIcon, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
                    <Ionicons name={action.icon} size={18} color={colors.text} />
                  </View>
                  <Typography size={7} weight="600" color={colors.textMuted} style={{ marginTop: 8, letterSpacing: 0.5 }}>{action.label.toUpperCase()}</Typography>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.sectionContainer}>
              <Typography heading size={7} color={colors.textLight} style={styles.sectionTitle}>NOTIFICATIONS</Typography>
              <GlassView intensity={isDark ? 10 : 40} tint={theme} style={[styles.menuGlass, { borderColor: colors.borderLight }]}>
                <MenuItem 
                  icon="notifications-outline" 
                  title="Notifications" 
                  onPress={() => navigation.navigate('Notifications')} 
                  badge={unreadCount > 0 ? unreadCount : undefined}
                />
              </GlassView>
            </View>

            <View style={styles.sectionContainer}>
              <Typography heading size={7} color={colors.textLight} style={styles.sectionTitle}>STORE CREDITS</Typography>
              <GlassView 
                intensity={isDark ? 10 : 40} 
                tint={theme} 
                style={[styles.menuGlass, { borderColor: storeCredits > 0 ? 'rgba(52, 199, 89, 0.2)' : colors.borderLight }]}
              >
                <View style={styles.creditCard}>
                  <View style={styles.creditBalanceRow}>
                    <View>
                      <Typography size={7} weight="800" color={colors.textExtraLight} style={{ letterSpacing: 2 }}>AVAILABLE BALANCE</Typography>
                      <Typography heading size={28} weight="700" color={storeCredits > 0 ? colors.success : colors.text} style={{ marginTop: 4 }}>
                        {formatPrice(storeCredits)}
                      </Typography>
                    </View>
                    <View style={[styles.creditIcon, { backgroundColor: storeCredits > 0 ? 'rgba(52,199,89,0.12)' : colors.surface }]}>
                      <Ionicons name="wallet-outline" size={24} color={storeCredits > 0 ? colors.success : colors.textExtraLight} />
                    </View>
                  </View>
                  
                  <View style={[styles.creditDivider, { backgroundColor: colors.borderExtraLight }]} />
                  
                  <TouchableOpacity
                    style={styles.creditPreferenceRow}
                    onPress={() => handleToggleStoreCreditPreference(!storeCreditPreference)}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1 }}>
                      <Typography size={10} weight="600" color={colors.text}>Prefer Store Credits on Refund</Typography>
                      <Typography size={8} weight="400" color={colors.textMuted} style={{ marginTop: 2 }}>Get instant credit instead of waiting for bank refund</Typography>
                    </View>
                    <View style={[styles.toggleTrack, { backgroundColor: storeCreditPreference ? colors.success : (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)') }]}>
                      <View style={[styles.toggleThumb, { transform: [{ translateX: storeCreditPreference ? 20 : 2 }], backgroundColor: '#FFF' }]} />
                    </View>
                  </TouchableOpacity>

                  <Typography size={7} weight="400" color={colors.textExtraLight} style={{ paddingHorizontal: 20, paddingBottom: 16, lineHeight: 12 }}>
                    Store credits can be used on any future purchase and never expire.
                  </Typography>
                </View>
              </GlassView>
            </View>

            <View style={styles.sectionContainer}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Typography heading size={7} color={colors.textLight} style={styles.sectionTitle}>PERSONAL DETAILS</Typography>
                <TouchableOpacity onPress={() => setIsEditing(!isEditing)}>
                  <Typography size={7} color={colors.foreground} weight="600">{isEditing ? 'CANCEL' : 'EDIT'}</Typography>
                </TouchableOpacity>
              </View>

              <GlassView 
                intensity={isDark ? 10 : 40} 
                tint={theme} 
                style={[styles.menuGlass, { borderColor: colors.borderLight }]}
              >
                <View style={styles.editForm}>
                  <View style={styles.editField}>
                    <Typography size={7} color={colors.textExtraLight} style={styles.fieldLabel}>FULL NAME</Typography>
                    {isEditing ? (
                      <TextInput 
                        value={editName}
                        onChangeText={setEditName}
                        style={[styles.editInput, { color: colors.text, borderBottomColor: colors.borderLight }]}
                      />
                    ) : (
                      <Typography size={12} color={colors.text}>{user?.name || 'Set Name'}</Typography>
                    )}
                  </View>
                  <View style={[styles.fieldDivider, { backgroundColor: colors.borderLight }]} />
                  <View style={styles.editField}>
                    <Typography size={7} color={colors.textExtraLight} style={styles.fieldLabel}>EMAIL ADDRESS</Typography>
                    {isEditing ? (
                      <TextInput 
                        value={editEmail}
                        onChangeText={setEditEmail}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        style={[styles.editInput, { color: colors.text, borderBottomColor: colors.borderLight }]}
                      />
                    ) : (
                      <Typography size={12} color={colors.text}>{user?.email || 'Set Email'}</Typography>
                    )}
                  </View>
                  <View style={[styles.fieldDivider, { backgroundColor: colors.borderLight }]} />
                  <View style={styles.editField}>
                    <Typography size={7} color={colors.textExtraLight} style={styles.fieldLabel}>PHONE NUMBER</Typography>
                    <Typography size={12} color={colors.textMuted}>{user?.phone || 'Not provided'}</Typography>
                  </View>
                </View>
              </GlassView>
              
              {isEditing && (
                <TouchableOpacity 
                  style={[styles.saveBtn, { backgroundColor: colors.foreground }]}
                  onPress={handleSaveProfile}
                  disabled={loading}
                >
                  <Typography heading size={8} weight="700" color={colors.background}>
                    {loading ? 'SAVING...' : 'SAVE CHANGES'}
                  </Typography>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.sectionContainer}>
              <Typography heading size={7} color={colors.textLight} style={styles.sectionTitle}>SUPPORT & LEGAL</Typography>
              <GlassView intensity={isDark ? 10 : 40} tint={theme} style={[styles.menuGlass, { borderColor: colors.borderLight }]}>
                <MenuItem icon="information-circle-outline" title="About Zica Bella" onPress={() => navigation.navigate('About')} />
                <MenuItem icon="call-outline" title="Contact Information" onPress={() => navigatePolicy('contact-information', 'Contact Information')} />
                <MenuItem icon="shield-checkmark-outline" title="Privacy Policy" onPress={() => navigatePolicy('privacy-policy', 'Privacy Policy')} />
                <MenuItem icon="document-text-outline" title="Terms of Service" onPress={() => navigatePolicy('terms-of-service', 'Terms of Service')} />
                <MenuItem icon="headset-outline" title="Customer Support" onPress={() => navigation.navigate('Support')} />
                <MenuItem icon="refresh-outline" title="Refund Policy" onPress={() => navigatePolicy('refund-policy', 'Refund Policy')} />
                <MenuItem icon="bus-outline" title="Shipping Policy" onPress={() => navigatePolicy('shipping-policy', 'Shipping Policy')} />
                <MenuItem icon="trash-outline" title="Request Account Deletion" destructive onPress={handleDeleteAccount} />
              </GlassView>
            </View>

            <TouchableOpacity 
              style={[styles.logoutBtn, { borderColor: colors.error + '40' }]} 
              onPress={handleLogout}
              activeOpacity={0.7}
              accessibilityLabel="Sign out"
              accessibilityRole="button"
            >
              <Ionicons name="log-out-outline" size={16} color={colors.error} />
              <Typography weight="500" size={11} color={colors.error}>SIGN OUT</Typography>
            </TouchableOpacity>

            <Typography weight="300" size={8} color={colors.textExtraLight} style={styles.versionText}>ZICA ARCHIVE v1.0.5</Typography>
          </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 28,
  },
  avatarGlass: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    marginRight: 20,
    overflow: 'hidden',
  },
  avatarEditDot: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#FFF',
  },
  headerInfo: {
    flex: 1,
    gap: 6,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 20,
    paddingHorizontal: 16,
    marginBottom: 24,
    borderRadius: 24,
    borderWidth: 1,
  },
  statItem: {
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  statDivider: {
    width: 1,
    height: 28,
    opacity: 0.15,
  },
  quickActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 32,
  },
  quickActionItem: {
    width: '31%',
    alignItems: 'center',
    paddingVertical: 18,
    borderRadius: 20,
    borderWidth: 1,
  },
  quickActionIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionContainer: {
    marginBottom: 32,
  },
  sectionTitle: {
    letterSpacing: 4,
    marginBottom: 12,
    opacity: 0.7,
  },
  menuGlass: {
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  menuItemLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuLabel: {
    flex: 1,
    letterSpacing: 0.5,
  },
  creditCard: {
    overflow: 'hidden',
  },
  creditBalanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
  },
  creditIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  creditDivider: {
    height: 1,
    marginHorizontal: 20,
    opacity: 0.3,
  },
  creditPreferenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    gap: 16,
  },
  editForm: {
    padding: 20,
    gap: 20,
  },
  editField: {
    gap: 8,
  },
  fieldLabel: {
    letterSpacing: 2,
    opacity: 0.6,
  },
  editInput: {
    fontSize: 14,
    borderBottomWidth: 1,
    paddingVertical: 4,
  },
  fieldDivider: {
    height: 1,
    opacity: 0.05,
  },
  saveBtn: {
    marginTop: 16,
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 16,
  },
  versionText: {
    textAlign: 'center',
    marginTop: 32,
    letterSpacing: 3,
    opacity: 0.3,
  },
  toggleTrack: {
    width: 44,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
});
