import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../../constants/colors';
import { Typography } from '../../components/Typography';
import CheckoutSummaryBar from '../../components/CheckoutSummaryBar';
import { useCartStore } from '../../store/cartStore';
import { useAuth } from '../../hooks/useAuth';
import { useAuthStore } from '../../store/authStore';
import { haptics } from '../../utils/haptics';
import { config } from '../../constants/config';
import { getFreshDeviceCoordinates, requestDeviceLocationPermission } from '../../utils/deviceLocation';

export default function DeliveryAddressScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const colors = useColors();
  const { user, updateUser } = useAuth();
  const { total, items, shippingAddress, setShippingAddress, buyNowItem } = useCartStore();

  const checkoutItems = buyNowItem ? [buyNowItem] : items;
  const checkoutTotal = buyNowItem ? parseFloat(buyNowItem.price) * buyNowItem.quantity : total();

  const [loadingPincode, setLoadingPincode] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [isEditing, setIsEditing] = useState(!shippingAddress);
  const [savedAddresses, setSavedAddresses] = useState<any[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [detectingLocation, setDetectingLocation] = useState(false);
  const [address, setAddress] = useState({
    name: shippingAddress?.name || user?.name || '',
    email: shippingAddress?.email || user?.email || '',
    phone: shippingAddress?.phone || user?.phone || '',
    line1: shippingAddress?.line1 || shippingAddress?.street || '',
    line2: shippingAddress?.line2 || '',
    city: shippingAddress?.city || '',
    state: shippingAddress?.state || '',
    pincode: shippingAddress?.pincode || shippingAddress?.zip || '',
    country: 'India',
  });

  const STATE_CODE_TO_NAME: { [key: string]: string } = {
    AP: 'Andhra Pradesh',
    AR: 'Arunachal Pradesh',
    AS: 'Assam',
    BR: 'Bihar',
    CG: 'Chhattisgarh',
    GA: 'Goa',
    GJ: 'Gujarat',
    HR: 'Haryana',
    HP: 'Himachal Pradesh',
    JH: 'Jharkhand',
    KA: 'Karnataka',
    KL: 'Kerala',
    MP: 'Madhya Pradesh',
    MH: 'Maharashtra',
    MN: 'Manipur',
    ML: 'Meghalaya',
    MZ: 'Mizoram',
    NL: 'Nagaland',
    OD: 'Odisha',
    PB: 'Punjab',
    RJ: 'Rajasthan',
    SK: 'Sikkim',
    TN: 'Tamil Nadu',
    TG: 'Telangana',
    TR: 'Tripura',
    UP: 'Uttar Pradesh',
    UK: 'Uttarakhand',
    WB: 'West Bengal',
    AN: 'Andaman and Nicobar Islands',
    CH: 'Chandigarh',
    DN: 'Dadra and Nagar Haveli and Daman and Diu',
    DL: 'Delhi',
    JK: 'Jammu and Kashmir',
    LA: 'Ladakh',
    LD: 'Lakshadweep',
    PY: 'Puducherry',
  };

  const fetchPincodeDetails = async (pin: string) => {
    if (pin.length !== 6) return;
    setLoadingPincode(true);

    // 1. Try the secure app backend serviceability API first
    try {
      const backendRes = await fetch(`${config.appUrl}/api/logistics/serviceability?pincode=${pin}`);
      if (backendRes.ok) {
        const backendJson = await backendRes.json();
        if (backendJson.district && backendJson.state) {
          const stateCode = backendJson.state.toUpperCase();
          const stateName = STATE_CODE_TO_NAME[stateCode] || backendJson.state;
          setAddress(prev => ({
            ...prev,
            city: backendJson.district,
            state: stateName,
          }));
          haptics.success();
          setLoadingPincode(false);
          return;
        }
      }
    } catch (e) {
      console.warn('Backend pincode fetch failed, trying fallback API:', e);
    }

    // 2. Fallback to the public API
    try {
      const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
      const json = await res.json();
      if (json[0]?.Status === 'Success' && Array.isArray(json[0].PostOffice) && json[0].PostOffice.length > 0) {
        const postOffice = json[0].PostOffice[0];
        // Use District first (most reliable for city), then Division, Block, and finally Name
        const city = (postOffice.District && postOffice.District !== 'NA' ? postOffice.District : null)
          || (postOffice.Division && postOffice.Division !== 'NA' ? postOffice.Division : null)
          || (postOffice.Block && postOffice.Block !== 'NA' ? postOffice.Block : null)
          || postOffice.Name
          || '';
        const state = postOffice.State || postOffice.Circle || '';
        setAddress(prev => ({
          ...prev,
          city,
          state,
        }));
        haptics.success();
      } else {
        haptics.error();
      }
    } catch (e) {
      console.error('Pincode fetch error:', e);
      haptics.error();
    } finally {
      setLoadingPincode(false);
    }
  };

  const handleUseCurrentLocation = async () => {
    setDetectingLocation(true);
    try {
      const permission = await requestDeviceLocationPermission();
      if (permission !== 'granted') {
        Alert.alert(
          'Location permission needed',
          'Allow location access so we can fill your delivery address from your current position.'
        );
        haptics.error();
        return;
      }

      const coords = await getFreshDeviceCoordinates();
      const res = await fetch(
        `${config.appUrl}/api/geo/reverse?lat=${coords.latitude}&lng=${coords.longitude}`
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        Alert.alert('Could not detect address', 'Please enter your delivery address manually.');
        haptics.error();
        return;
      }

      const stateKey = String(data.state || '').trim().toUpperCase();
      const stateName = STATE_CODE_TO_NAME[stateKey] || data.state || '';
      const zipDigits = String(data.zip || '').replace(/\D/g, '').slice(0, 6);
      const line1 =
        data.street ||
        data.landmark ||
        (typeof data.formattedAddress === 'string' ? data.formattedAddress.split(',')[0].trim() : '');

      setAddress(prev => ({
        ...prev,
        line1: line1 || prev.line1,
        city: data.city || prev.city,
        state: stateName || prev.state,
        pincode: zipDigits || prev.pincode,
      }));
      setIsEditing(true);
      haptics.success();
    } catch (e) {
      console.warn('Current location detection failed:', e);
      Alert.alert(
        'Location unavailable',
        'We could not get a fresh GPS fix. Please enter your address manually or try again outdoors.'
      );
      haptics.error();
    } finally {
      setDetectingLocation(false);
    }
  };

  const handlePincodeChange = (v: string) => {
    const cleaned = v.replace(/[^0-9]/g, '').slice(0, 6);
    setAddress({ ...address, pincode: cleaned });
    if (cleaned.length === 6) {
      fetchPincodeDetails(cleaned);
    }
  };

  const isValid = useMemo(
    () =>
      !!(address.name && address.email && address.phone && address.line1 && address.city && address.pincode && address.state) && 
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.email),
    [address]
  );

  const fetchSavedAddresses = useCallback(async () => {
    if (!user?.phone && !user?.email) return;
    setLoadingSaved(true);
    try {
      const params = new URLSearchParams();
      if (user?.phone) params.set('phone', user.phone);
      if (user?.email) params.set('email', user.email);
      const res = await fetch(`${config.appUrl}/api/app/customers/addresses?${params.toString()}`);
      const json = await res.json().catch(() => ({ addresses: [] }));
      if (res.ok && Array.isArray(json.addresses)) {
        setSavedAddresses(json.addresses);
        // Auto-fill if store is empty
        if (!shippingAddress && json.addresses.length > 0) {
          const a = json.addresses[0];
          const normalized = {
            name: a.name || user?.name || '',
            email: a.email || user?.email || '',
            phone: a.phone || user?.phone || '',
            line1: a.address1 || '',
            line2: a.address2 || '',
            city: a.city || '',
            state: a.state || '',
            pincode: a.zip || '',
            country: 'India',
            street: a.address1 || '',
            zip: a.zip || '',
          };
          setShippingAddress(normalized);
          setIsEditing(false);
          // Also update the local form state
          setAddress(normalized);
        }
      } else {
        setSavedAddresses([]);
      }
    } catch {
      setSavedAddresses([]);
    } finally {
      setLoadingSaved(false);
    }
  }, [user?.phone, user?.email]);

  useEffect(() => {
    fetchSavedAddresses();
  }, [fetchSavedAddresses]);

  const fieldError = (field: keyof typeof address) => {
    if (!submitted) return null;
    if (!String(address[field] || '').trim()) return 'Required';
    if (field === 'pincode' && String(address.pincode).trim().length !== 6) return 'Invalid pincode';
    if (field === 'phone' && String(address.phone).replace(/\D/g, '').length < 10) return 'Invalid phone';
    if (field === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(address.email))) return 'Invalid email';
    return null;
  };

  return (
    <KeyboardAvoidingView 
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main')} style={[styles.back, { backgroundColor: colors.surface }]}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerTitle}>
          <Typography size={7} color={colors.textExtraLight} weight="600" style={styles.stepTag}>STEP 1 OF 2</Typography>
          <Typography size={14} color={colors.text} weight="700">DELIVERY ADDRESS</Typography>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView 
        contentContainerStyle={[styles.scroll, { paddingBottom: 120 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Typography size={22} weight="700" color={colors.text} style={styles.title}>Where should we send your pieces?</Typography>

        <TouchableOpacity
          onPress={() => { haptics.buttonTap(); handleUseCurrentLocation(); }}
          disabled={detectingLocation}
          activeOpacity={0.85}
          style={{
            marginBottom: 24,
            paddingVertical: 14,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: colors.borderLight,
            backgroundColor: colors.surface,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          {detectingLocation ? (
            <ActivityIndicator size="small" color={colors.foreground} />
          ) : (
            <Ionicons name="navigate-outline" size={18} color={colors.text} />
          )}
          <Typography size={9} weight="800" color={colors.text} style={{ letterSpacing: 2 }}>
            {detectingLocation ? 'DETECTING LOCATION…' : 'USE CURRENT LOCATION'}
          </Typography>
        </TouchableOpacity>

        {!isEditing && shippingAddress && (
          <View>
            <View style={[styles.savedCard, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
              <Ionicons name="location-outline" size={20} color={colors.text} />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Typography size={10} weight="700" color={colors.text}>{shippingAddress.name}</Typography>
                <Typography size={9} color={colors.textMuted} style={{ marginTop: 2 }}>
                  {shippingAddress.line1}
                  {shippingAddress.line2 ? `, ${shippingAddress.line2}` : ''}
                  {`\n${shippingAddress.city}, ${shippingAddress.state} ${shippingAddress.pincode}`}
                </Typography>
                <Typography size={9} color={colors.textExtraLight} style={{ marginTop: 6 }}>{shippingAddress.email} · {shippingAddress.phone}</Typography>
              </View>
              <TouchableOpacity onPress={() => { haptics.buttonTap(); setIsEditing(true); }} activeOpacity={0.7}>
                <Typography size={8} weight="700" color={colors.foreground} style={{ letterSpacing: 2 }}>CHANGE</Typography>
              </TouchableOpacity>
            </View>

          </View>
        )}

        {/* Saved addresses list (from backend) */}
        {!isEditing && (
          <View style={{ marginTop: 24 }}>
            {savedAddresses.some(a => !(shippingAddress && shippingAddress.line1 === a.address1 && shippingAddress.pincode === a.zip)) && (
              <Typography size={7} weight="700" color={colors.textExtraLight} style={{ marginBottom: 12, letterSpacing: 2 }}>
                {shippingAddress ? 'OR CHOOSE ANOTHER SAVED ADDRESS' : 'SAVED ADDRESSES'}
              </Typography>
            )}
            
            {loadingSaved ? (
              <View style={{ paddingVertical: 18, alignItems: 'center' }}>
                <ActivityIndicator color={colors.foreground} />
              </View>
            ) : (
              savedAddresses.map((a, idx) => {
                // Don't show the currently selected address in the list
                const isSelected = shippingAddress && 
                  (shippingAddress.line1 === a.address1 && shippingAddress.pincode === a.zip);
                
                if (isSelected) return null;

                return (
                  <TouchableOpacity
                    key={`${a.id || idx}`}
                    onPress={() => {
                      haptics.buttonTap();
                      const normalized = {
                        name: a.name || user?.name || '',
                        email: a.email || user?.email || '',
                        phone: a.phone || user?.phone || '',
                        line1: a.address1 || '',
                        line2: a.address2 || '',
                        city: a.city || '',
                        state: a.state || '',
                        pincode: a.zip || '',
                        country: 'India',
                        street: a.address1 || '',
                        zip: a.zip || '',
                      };
                      setShippingAddress(normalized);
                      setAddress(normalized); // Update form too
                      setIsEditing(false);
                    }}
                    activeOpacity={0.7}
                    style={[styles.savedCard, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}
                  >
                    <Ionicons name="location-outline" size={20} color={colors.text} />
                    <View style={{ marginLeft: 12, flex: 1 }}>
                      <Typography size={10} weight="700" color={colors.text} numberOfLines={1}>
                        {a.name || user?.name || 'Saved Address'}
                      </Typography>
                      <Typography size={9} color={colors.textMuted} numberOfLines={2} style={{ marginTop: 2 }}>
                        {a.address1}{a.address2 ? `, ${a.address2}` : ''}{` · ${a.city || ''}, ${a.state || ''} ${a.zip || ''}`}
                      </Typography>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textExtraLight} />
                  </TouchableOpacity>
                );
              })
            )}

            <TouchableOpacity
              onPress={() => { 
                haptics.buttonTap(); 
                setAddress({
                  name: user?.name || '',
                  email: user?.email || '',
                  phone: user?.phone || '',
                  line1: '',
                  line2: '',
                  city: '',
                  state: '',
                  pincode: '',
                  country: 'India',
                });
                setIsEditing(true); 
              }}
              activeOpacity={0.8}
              style={{ marginTop: shippingAddress ? 0 : 12, paddingVertical: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.borderLight, alignItems: 'center' }}
            >
              <Typography size={9} weight="800" color={colors.text} style={{ letterSpacing: 2 }}>+ ADD NEW ADDRESS</Typography>
            </TouchableOpacity>
          </View>
        )}
        
        {isEditing && (
          <View style={styles.form}>
          <View style={styles.field}>
            <Typography size={7} weight="600" color={colors.textExtraLight} style={styles.label}>FULL NAME</Typography>
            <TextInput
              value={address.name}
              onChangeText={(v) => setAddress({...address, name: v})}
              placeholder="Charlotte Moss"
              placeholderTextColor={colors.textExtraLight}
              textContentType="name"
              autoComplete="name"
              style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.borderLight }]}
            />
            {fieldError('name') && <Typography size={8} color={colors.error} style={{ marginLeft: 6 }}>{fieldError('name')}</Typography>}
          </View>

          <View style={styles.field}>
            <Typography size={7} weight="600" color={colors.textExtraLight} style={styles.label}>EMAIL ADDRESS</Typography>
            <TextInput
              value={address.email}
              onChangeText={(v) => setAddress({...address, email: v.toLowerCase().trim()})}
              placeholder="charlotte@example.com"
              placeholderTextColor={colors.textExtraLight}
              keyboardType="email-address"
              textContentType="emailAddress"
              autoComplete="email"
              autoCapitalize="none"
              style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.borderLight }]}
            />
            {fieldError('email') && <Typography size={8} color={colors.error} style={{ marginLeft: 6 }}>{fieldError('email')}</Typography>}
          </View>

          <View style={styles.field}>
            <Typography size={7} weight="600" color={colors.textExtraLight} style={styles.label}>PHONE NUMBER</Typography>
            <TextInput
              value={address.phone}
              onChangeText={(v) => setAddress({...address, phone: v})}
              placeholder="+91 00000 00000"
              placeholderTextColor={colors.textExtraLight}
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
              style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.borderLight }]}
            />
            {fieldError('phone') && <Typography size={8} color={colors.error} style={{ marginLeft: 6 }}>{fieldError('phone')}</Typography>}
          </View>

          <View style={styles.field}>
            <Typography size={7} weight="600" color={colors.textExtraLight} style={styles.label}>ADDRESS LINE 1</Typography>
            <TextInput
              value={address.line1}
              onChangeText={(v) => setAddress({...address, line1: v})}
              placeholder="House No, Building, Street..."
              placeholderTextColor={colors.textExtraLight}
              textContentType="streetAddressLine1"
              autoComplete="address-line1"
              style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.borderLight }]}
            />
            {fieldError('line1') && <Typography size={8} color={colors.error} style={{ marginLeft: 6 }}>{fieldError('line1')}</Typography>}
          </View>

          <View style={styles.field}>
            <Typography size={7} weight="600" color={colors.textExtraLight} style={styles.label}>ADDRESS LINE 2 (OPTIONAL)</Typography>
            <TextInput
              value={address.line2}
              onChangeText={(v) => setAddress({...address, line2: v})}
              placeholder="Apartment, landmark..."
              placeholderTextColor={colors.textExtraLight}
              textContentType="streetAddressLine2"
              autoComplete="address-line2"
              style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.borderLight }]}
            />
          </View>

          <View style={styles.row}>
            <View style={[styles.field, { width: 140 }]}>
              <Typography size={7} weight="600" color={colors.textExtraLight} style={styles.label}>PINCODE</Typography>
              <View style={{ position: 'relative' }}>
                <TextInput
                  value={address.pincode}
                  onChangeText={handlePincodeChange}
                  placeholder="110001"
                  placeholderTextColor={colors.textExtraLight}
                  keyboardType="number-pad"
                  textContentType="postalCode"
                  autoComplete="postal-code"
                  style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.borderLight }]}
                />
                {loadingPincode && (
                  <View style={{ position: 'absolute', right: 15, top: 20 }}>
                    <ActivityIndicator size="small" color={colors.text} />
                  </View>
                )}
              </View>
              {fieldError('pincode') && <Typography size={8} color={colors.error} style={{ marginLeft: 6 }}>{fieldError('pincode')}</Typography>}
            </View>
            <View style={[styles.field, { flex: 1 }]}>
              <Typography size={7} weight="600" color={colors.textExtraLight} style={styles.label}>CITY / AREA</Typography>
              <TextInput
                value={address.city}
                onChangeText={(v) => setAddress({...address, city: v})}
                placeholder="New Delhi"
                placeholderTextColor={colors.textExtraLight}
                textContentType="addressCity"
                autoComplete="postal-address-locality"
                style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.borderLight }]}
              />
              {fieldError('city') && <Typography size={8} color={colors.error} style={{ marginLeft: 6 }}>{fieldError('city')}</Typography>}
            </View>
          </View>
 
          <View style={styles.field}>
            <Typography size={7} weight="600" color={colors.textExtraLight} style={styles.label}>STATE</Typography>
            <TextInput
              value={address.state}
              onChangeText={(v) => setAddress({...address, state: v})}
              placeholder="Delhi"
              placeholderTextColor={colors.textExtraLight}
              textContentType="addressState"
              autoComplete="postal-address-region"
              style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.borderLight }]}
            />
            {fieldError('state') && <Typography size={8} color={colors.error} style={{ marginLeft: 6 }}>{fieldError('state')}</Typography>}
          </View>
          </View>
        )}
      </ScrollView>

      {/* Summary Bar */}
      <CheckoutSummaryBar 
        itemCount={checkoutItems.length}
        total={checkoutTotal}
        primaryLabel="REVIEW & PAY"
        onPrimaryPress={async () => {
          setSubmitted(true);
          
          if (!isEditing && shippingAddress) {
            haptics.buttonTap();
            // Sync selected saved address email with user profile
            if (shippingAddress.email && shippingAddress.email !== user?.email) {
              updateUser({ email: shippingAddress.email });
              if (user?.id) {
                const token = useAuthStore.getState().token;
                if (token) {
                  try {
                    await fetch(`${config.appUrl}/api/app/profile`, {
                      method: 'PATCH',
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                      },
                      body: JSON.stringify({
                        customerId: user.id,
                        email: shippingAddress.email,
                      }),
                    });
                  } catch (err) {
                    console.error('Failed to sync updated email to backend profile:', err);
                  }
                }
              }
            }
            navigation.navigate('OrderReview');
            return;
          }

          if (!isValid) {
            haptics.error();
            return;
          }

          haptics.buttonTap();
          
          const normalized = {
            name: address.name,
            email: address.email,
            phone: address.phone,
            line1: address.line1,
            line2: address.line2,
            city: address.city,
            state: address.state,
            pincode: address.pincode,
            country: 'India',
            // Back-compat for older screens/services still reading these keys
            street: address.line1,
            zip: address.pincode,
          };

          // Save to backend if we have a user identity
          if (user?.phone || user?.email) {
            try {
              await fetch(`${config.appUrl}/api/app/customers/addresses`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  phone: user?.phone,
                  email: user?.email,
                  address: {
                    name: normalized.name,
                    phone: normalized.phone,
                    address1: normalized.line1,
                    address2: normalized.line2,
                    city: normalized.city,
                    state: normalized.state,
                    zip: normalized.pincode,
                    country: normalized.country,
                  }
                }),
              });
              // Refresh saved addresses in background
              fetchSavedAddresses();
            } catch (e) {
              console.error('Failed to save address to DB:', e);
            }
          }

          // Update profile email locally and in backend database to keep in sync
          if (normalized.email && normalized.email !== user?.email) {
            updateUser({ email: normalized.email });
            if (user?.id) {
              const token = useAuthStore.getState().token;
              if (token) {
                try {
                  await fetch(`${config.appUrl}/api/app/profile`, {
                    method: 'PATCH',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                      customerId: user.id,
                      email: normalized.email,
                    }),
                  });
                } catch (err) {
                  console.error('Failed to sync updated email to backend profile:', err);
                }
              }
            }
          }

          setShippingAddress(normalized);
          setIsEditing(false);
          navigation.navigate('OrderReview');
        }}
        disabled={false}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 16 },
  back: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { alignItems: 'center' },
  stepTag: { letterSpacing: 2, marginBottom: 2 },
  scroll: { paddingHorizontal: 24, paddingTop: 20 },
  title: { letterSpacing: -0.5, marginBottom: 32 },
  form: { gap: 20 },
  field: { gap: 8 },
  label: { letterSpacing: 2, marginLeft: 4 },
  input: { height: 60, borderRadius: 20, borderWidth: 1, paddingHorizontal: 20, fontSize: 13, fontWeight: '500' },
  row: { flexDirection: 'row', gap: 16 },
  savedSection: { marginTop: 40 },
  savedCard: { flexDirection: 'row', alignItems: 'center', padding: 20, borderRadius: 24, borderWidth: 1, marginBottom: 12 },
});
