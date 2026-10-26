import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import GlassHeader from '../components/GlassHeader';
import { Typography } from '../components/Typography';
import { useColors } from '../constants/colors';
import { useThemeStore } from '../store/themeStore';
import { useAuth } from '../hooks/useAuth';
import { useAuthStore } from '../store/authStore';
import { useCartStore } from '../store/cartStore';
import { haptics } from '../utils/haptics';
import { config } from '../constants/config';

interface AddressItem {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zip: string;
  country?: string;
  isDefault?: boolean;
}

export default function AddressesScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const isDark = useThemeStore((s) => s.theme) === 'dark';
  const { user } = useAuth();
  const { setShippingAddress } = useCartStore();

  const [addresses, setAddresses] = useState<AddressItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Add Address Modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(user?.name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [email, setEmail] = useState(user?.email || '');
  const [address1, setAddress1] = useState('');
  const [address2, setAddress2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');

  const fetchAddresses = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (user?.email) params.set('email', user.email);
      if (user?.phone) params.set('phone', user.phone);

      const token = useAuthStore.getState().token;
      const res = await fetch(`${config.appUrl}/api/app/customers/addresses?${params.toString()}`, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.addresses)) {
        setAddresses(data.addresses);
        // Pre-fill cart shipping address if there's a default
        const def = data.addresses.find((a: AddressItem) => a.isDefault) || data.addresses[0];
        if (def) {
          setShippingAddress({
            name: def.name,
            phone: def.phone || user?.phone || '',
            email: def.email || user?.email || '',
            street: def.address1,
            line1: def.address1,
            line2: def.address2 || '',
            city: def.city,
            state: def.state,
            zip: def.zip,
            pincode: def.zip,
            country: def.country || 'India',
          });
        }
      }
    } catch (e) {
      console.warn('[AddressesScreen] Error loading addresses:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.email, user?.phone, setShippingAddress]);

  useEffect(() => {
    fetchAddresses();
  }, [fetchAddresses]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchAddresses(true);
  };

  const handleSaveAddress = async () => {
    if (!name.trim()) {
      Alert.alert('Required', 'Please enter recipient name.');
      return;
    }
    if (!phone.trim()) {
      Alert.alert('Required', 'Please enter contact phone number.');
      return;
    }
    if (!address1.trim() || !city.trim() || !state.trim() || !zip.trim()) {
      Alert.alert('Required', 'Please fill in Street Address, City, State, and Pincode.');
      return;
    }

    setSaving(true);
    try {
      const token = useAuthStore.getState().token;
      const res = await fetch(`${config.appUrl}/api/app/customers/addresses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          email: user?.email || email.trim(),
          phone: user?.phone || phone.trim(),
          address: {
            name: name.trim(),
            phone: phone.trim(),
            email: (email.trim() || user?.email || ''),
            address1: address1.trim(),
            address2: address2.trim(),
            city: city.trim(),
            state: state.trim(),
            zip: zip.trim(),
            country: 'India',
            isDefault: true,
          },
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        haptics.success();
        Alert.alert('Address Saved', 'Your address has been saved and set as default.');
        setModalVisible(false);
        // Reset form
        setAddress1('');
        setAddress2('');
        setCity('');
        setState('');
        setZip('');
        fetchAddresses(true);
      } else {
        Alert.alert('Error', data.error || 'Failed to save address.');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Network error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <GlassHeader title="SAVED ADDRESSES" showBack />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: insets.top + 60, paddingBottom: 100, paddingHorizontal: 20 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textExtraLight} />}
      >
        <View style={styles.topBar}>
          <Typography size={8} weight="800" color={colors.textExtraLight} style={{ letterSpacing: 2 }}>
            DELIVERY LOCATIONS ({addresses.length})
          </Typography>
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: colors.foreground }]}
            onPress={() => {
              haptics.buttonTap();
              setModalVisible(true);
            }}
            activeOpacity={0.8}
          >
            <Ionicons name="add" size={16} color={colors.background} />
            <Typography size={7.5} weight="800" color={colors.background} style={{ letterSpacing: 1.5, marginLeft: 4 }}>
              NEW ADDRESS
            </Typography>
          </TouchableOpacity>
        </View>

        {loading && !refreshing ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="small" color={colors.textExtraLight} />
          </View>
        ) : addresses.length === 0 ? (
          <View style={[styles.emptyCard, { borderColor: colors.borderExtraLight, backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)' }]}>
            <View style={[styles.emptyIconBox, { backgroundColor: colors.surface }]}>
              <Ionicons name="location-outline" size={28} color={colors.textExtraLight} />
            </View>
            <Typography heading size={16} weight="700" color={colors.text} style={{ marginTop: 14 }}>
              NO SAVED ADDRESSES
            </Typography>
            <Typography size={9} color={colors.textMuted} style={{ marginTop: 6, textAlign: 'center', lineHeight: 15, maxWidth: 260 }}>
              Add a delivery address for fast 1-tap checkout on all your orders.
            </Typography>
            <TouchableOpacity
              style={[styles.emptyAddBtn, { backgroundColor: colors.foreground }]}
              onPress={() => setModalVisible(true)}
              activeOpacity={0.8}
            >
              <Typography size={8} weight="800" color={colors.background} style={{ letterSpacing: 2 }}>
                ADD ADDRESS
              </Typography>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.addressList}>
            {addresses.map((addr) => (
              <View
                key={addr.id}
                style={[
                  styles.addressCard,
                  {
                    backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                    borderColor: addr.isDefault ? colors.foreground : colors.borderLight,
                  },
                ]}
              >
                <View style={styles.cardHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Ionicons name="home-outline" size={16} color={colors.text} />
                    <Typography size={12} weight="800" color={colors.text}>
                      {addr.name}
                    </Typography>
                  </View>
                  {addr.isDefault ? (
                    <View style={[styles.defaultBadge, { backgroundColor: colors.foreground }]}>
                      <Typography size={6.5} weight="800" color={colors.background} style={{ letterSpacing: 1 }}>
                        DEFAULT
                      </Typography>
                    </View>
                  ) : null}
                </View>

                <Typography size={10} color={colors.textSecondary} style={{ marginTop: 10, lineHeight: 16 }}>
                  {addr.address1}
                  {addr.address2 ? `, ${addr.address2}` : ''}
                  {'\n'}
                  {addr.city}, {addr.state} - {addr.zip}
                  {'\n'}
                  {addr.country || 'India'}
                </Typography>

                {addr.phone ? (
                  <View style={styles.phoneRow}>
                    <Ionicons name="call-outline" size={12} color={colors.textMuted} />
                    <Typography size={8.5} weight="600" color={colors.textMuted} style={{ marginLeft: 6 }}>
                      {addr.phone}
                    </Typography>
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* ═══ ADD ADDRESS MODAL ═══ */}
      <Modal visible={modalVisible} transparent animationType="fade">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.borderLight }]}>
            <View style={styles.modalHeader}>
              <Typography heading size={16} weight="700" color={colors.text}>ADD NEW ADDRESS</Typography>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Ionicons name="close" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420, marginTop: 12 }}>
              <View style={styles.formGap}>
                <View style={styles.field}>
                  <Typography size={7.5} weight="700" color={colors.textSecondary} style={{ marginBottom: 4 }}>
                    FULL NAME
                  </Typography>
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    placeholder="Recipient's Name"
                    placeholderTextColor={colors.textExtraLight}
                    style={[styles.input, { color: colors.text, borderColor: colors.borderLight, backgroundColor: colors.surface }]}
                  />
                </View>

                <View style={styles.field}>
                  <Typography size={7.5} weight="700" color={colors.textSecondary} style={{ marginBottom: 4 }}>
                    PHONE NUMBER
                  </Typography>
                  <TextInput
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="10-digit mobile number"
                    placeholderTextColor={colors.textExtraLight}
                    keyboardType="phone-pad"
                    style={[styles.input, { color: colors.text, borderColor: colors.borderLight, backgroundColor: colors.surface }]}
                  />
                </View>

                <View style={styles.field}>
                  <Typography size={7.5} weight="700" color={colors.textSecondary} style={{ marginBottom: 4 }}>
                    STREET ADDRESS / HOUSE NO.
                  </Typography>
                  <TextInput
                    value={address1}
                    onChangeText={setAddress1}
                    placeholder="Flat / House / Building / Street"
                    placeholderTextColor={colors.textExtraLight}
                    style={[styles.input, { color: colors.text, borderColor: colors.borderLight, backgroundColor: colors.surface }]}
                  />
                </View>

                <View style={styles.field}>
                  <Typography size={7.5} weight="700" color={colors.textSecondary} style={{ marginBottom: 4 }}>
                    APARTMENT / SUITE / LANDMARK (OPTIONAL)
                  </Typography>
                  <TextInput
                    value={address2}
                    onChangeText={setAddress2}
                    placeholder="Nearby landmark, suite or floor"
                    placeholderTextColor={colors.textExtraLight}
                    style={[styles.input, { color: colors.text, borderColor: colors.borderLight, backgroundColor: colors.surface }]}
                  />
                </View>

                <View style={styles.rowFields}>
                  <View style={{ flex: 1 }}>
                    <Typography size={7.5} weight="700" color={colors.textSecondary} style={{ marginBottom: 4 }}>
                      CITY
                    </Typography>
                    <TextInput
                      value={city}
                      onChangeText={setCity}
                      placeholder="e.g. Mumbai"
                      placeholderTextColor={colors.textExtraLight}
                      style={[styles.input, { color: colors.text, borderColor: colors.borderLight, backgroundColor: colors.surface }]}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Typography size={7.5} weight="700" color={colors.textSecondary} style={{ marginBottom: 4 }}>
                      STATE
                    </Typography>
                    <TextInput
                      value={state}
                      onChangeText={setState}
                      placeholder="e.g. Maharashtra"
                      placeholderTextColor={colors.textExtraLight}
                      style={[styles.input, { color: colors.text, borderColor: colors.borderLight, backgroundColor: colors.surface }]}
                    />
                  </View>
                </View>

                <View style={styles.field}>
                  <Typography size={7.5} weight="700" color={colors.textSecondary} style={{ marginBottom: 4 }}>
                    PINCODE
                  </Typography>
                  <TextInput
                    value={zip}
                    onChangeText={setZip}
                    placeholder="6-digit pincode"
                    placeholderTextColor={colors.textExtraLight}
                    keyboardType="numeric"
                    maxLength={6}
                    style={[styles.input, { color: colors.text, borderColor: colors.borderLight, backgroundColor: colors.surface }]}
                  />
                </View>
              </View>
            </ScrollView>

            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={[styles.cancelBtn, { borderColor: colors.borderLight }]} onPress={() => setModalVisible(false)}>
                <Typography size={8} weight="700" color={colors.text}>CANCEL</Typography>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.saveBtn, { backgroundColor: colors.foreground }]} onPress={handleSaveAddress} disabled={saving}>
                {saving ? (
                  <ActivityIndicator size="small" color={colors.background} />
                ) : (
                  <Typography size={8} weight="800" color={colors.background} style={{ letterSpacing: 1.5 }}>
                    SAVE ADDRESS
                  </Typography>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  addBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  centerBox: { paddingVertical: 100, alignItems: 'center', justifyContent: 'center' },
  emptyCard: { padding: 36, borderRadius: 24, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center' },
  emptyIconBox: { width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center' },
  emptyAddBtn: { marginTop: 20, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
  addressList: { gap: 14 },
  addressCard: { padding: 18, borderRadius: 20, borderWidth: 1.5 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  defaultBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  phoneRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.05)' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  modalContent: { padding: 22, borderRadius: 24, borderWidth: 1.5 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  formGap: { gap: 12 },
  field: {},
  rowFields: { flexDirection: 'row', gap: 10 },
  input: { height: 44, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, fontSize: 12, fontWeight: '600' },
  modalBtnRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  cancelBtn: { flex: 1, height: 44, borderRadius: 14, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  saveBtn: { flex: 1.5, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
});
