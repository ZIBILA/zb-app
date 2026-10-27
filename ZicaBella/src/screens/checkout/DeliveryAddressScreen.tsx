import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
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
import { getFreshDeviceCoordinates, getNativeReverseGeocode, requestDeviceLocationPermission } from '../../utils/deviceLocation';
import { requireValidAuth } from '../../utils/tokenUtils';
import {
  buildDeliveryStreet,
  isAdministrativeNoise,
  stripLeadingHouseFromStreet,
} from '../../utils/parseDetectedAddress';

function parseSavedAddress(a: any, currentUser?: any) {
  if (!a) {
    return {
      name: currentUser?.name || '',
      email: currentUser?.email || '',
      phone: currentUser?.phone || '',
      flat: '',
      street: '',
      streetAddress: '',
      line1: '',
      line2: '',
      address1: '',
      address2: '',
      city: '',
      state: '',
      pincode: '',
      country: 'India',
    };
  }

  let flat = a.flat || '';
  let street = a.street || a.streetAddress || a.address2 || a.line2 || '';

  // If flat is not explicitly stored, parse from address1 / line1
  if (!flat && (a.address1 || a.line1)) {
    const rawLine1 = (a.address1 || a.line1 || '').trim();
    if (street && rawLine1 !== street && rawLine1.endsWith(street)) {
      flat = rawLine1.replace(new RegExp(`,?\\s*${street.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '').trim();
    } else if (street && rawLine1 !== street) {
      flat = rawLine1;
    } else {
      const parts = rawLine1.split(',');
      if (parts.length >= 2) {
        flat = parts[0].trim();
        street = parts.slice(1).join(',').trim();
      } else {
        flat = '';
        street = rawLine1;
      }
    }
  }

  const fullLine1 = [flat, street].filter(Boolean).join(', ') || a.address1 || a.line1 || '';

  return {
    name: a.name || currentUser?.name || '',
    email: a.email || currentUser?.email || '',
    phone: a.phone || currentUser?.phone || '',
    flat,
    street,
    streetAddress: street,
    line1: fullLine1,
    line2: street || a.address2 || a.line2 || '',
    address1: fullLine1,
    address2: street || a.address2 || a.line2 || '',
    city: a.city || '',
    state: a.state || a.province || '',
    pincode: a.zip || a.pincode || '',
    country: a.country || 'India',
    zip: a.zip || a.pincode || '',
  };
}

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
  const [addressFieldHighlighted, setAddressFieldHighlighted] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const flatFieldRef = useRef<TextInput>(null);
  const streetFieldRef = useRef<TextInput>(null);

  const initialParsed = useMemo(() => parseSavedAddress(shippingAddress, user), [shippingAddress, user]);

  const [address, setAddress] = useState({
    name: initialParsed.name,
    email: initialParsed.email,
    phone: initialParsed.phone,
    flat: initialParsed.flat,
    street: initialParsed.street,
    line1: initialParsed.line1,
    line2: initialParsed.line2,
    city: initialParsed.city,
    state: initialParsed.state,
    pincode: initialParsed.pincode,
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

    // 2. Fallback to public Indian postal directory
    try {
      const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
      const json = await res.json();
      if (json[0]?.Status === 'Success' && Array.isArray(json[0].PostOffice) && json[0].PostOffice.length > 0) {
        const postOffice = json[0].PostOffice[0];
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
        haptics.error();
        return;
      }

      const coords = await getFreshDeviceCoordinates();

      // 1 & 2. Run Native geocoding and Server enrichment concurrently for speed
      let detectedArea = '';
      let detectedCity = '';
      let detectedState = '';
      let detectedZip = '';

      const [nativeResult, serverResult] = await Promise.allSettled([
        getNativeReverseGeocode(coords),
        fetch(`${config.appUrl}/api/geo/reverse?lat=${coords.latitude}&lng=${coords.longitude}`)
          .then(res => res.json())
          .catch(() => null),
      ]);

      const nativeAddr = nativeResult.status === 'fulfilled' ? nativeResult.value : null;
      if (nativeAddr) {
        // Never use name/streetNumber — native often puts plot/house ("E 1701") there.
        // Never use district/subregion when it's admin noise ("Meerut Division").
        const locality =
          nativeAddr.subregion &&
          nativeAddr.subregion !== nativeAddr.city &&
          !isAdministrativeNoise(nativeAddr.subregion)
            ? nativeAddr.subregion
            : null;
        const district =
          nativeAddr.district &&
          nativeAddr.district !== nativeAddr.city &&
          !isAdministrativeNoise(nativeAddr.district)
            ? nativeAddr.district
            : null;

        detectedArea = buildDeliveryStreet([nativeAddr.street, locality, district]);

        const cityCandidate =
          nativeAddr.city ||
          (!isAdministrativeNoise(nativeAddr.district || '') ? nativeAddr.district : '') ||
          (!isAdministrativeNoise(nativeAddr.subregion || '') ? nativeAddr.subregion : '') ||
          '';
        detectedCity = isAdministrativeNoise(cityCandidate) ? '' : cityCandidate;
        detectedState = nativeAddr.region || '';
        detectedZip = (nativeAddr.postalCode || '').replace(/\D/g, '').slice(0, 6);
      }

      const serverData = serverResult.status === 'fulfilled' ? serverResult.value : null;
      if (serverData && serverData.ok) {
        const serverStateKey = String(serverData.state || '').trim().toUpperCase();
        const serverStateName = STATE_CODE_TO_NAME[serverStateKey] || serverData.state || '';
        const serverZip = String(serverData.zip || '').replace(/\D/g, '').slice(0, 6);
        // houseNo stays out of street — Flat field is left empty for manual entry
        const serverArea =
          buildDeliveryStreet([serverData.street, serverData.landmark]) ||
          stripLeadingHouseFromStreet(
            typeof serverData.formattedAddress === 'string'
              ? serverData.formattedAddress.split(',').slice(0, 3).join(',').trim()
              : ''
          );

        if (!detectedArea || (serverArea && serverArea.length > detectedArea.length)) {
          detectedArea = serverArea;
        }
        if (!detectedCity && serverData.city && !isAdministrativeNoise(serverData.city)) {
          detectedCity = serverData.city;
        }
        if (!detectedState && serverStateName) detectedState = serverStateName;
        if (!detectedZip && serverZip) detectedZip = serverZip;
      }

      const finalStateKey = String(detectedState || '').trim().toUpperCase();
      const finalStateName = STATE_CODE_TO_NAME[finalStateKey] || detectedState || '';
      const finalStreet = stripLeadingHouseFromStreet(detectedArea);

      setAddress(prev => ({
        ...prev,
        // Always clear flat after location detect — customers must enter house/building manually
        flat: '',
        street: finalStreet || prev.street,
        city: detectedCity || prev.city,
        state: finalStateName || prev.state,
        pincode: detectedZip || prev.pincode,
      }));

      if (detectedZip && detectedZip.length === 6) {
        fetchPincodeDetails(detectedZip);
      }

      setIsEditing(true);
      haptics.success();
      // Flat stays empty for manual entry — no error UI until user tries to continue
      setAddressFieldHighlighted(false);
    } catch (e) {
      console.warn('Current location detection failed:', e);
      haptics.error();
      setIsEditing(true);
      setAddressFieldHighlighted(false);
    } finally {
      setDetectingLocation(false);
    }
  };

  const handlePincodeChange = (v: string) => {
    const cleaned = v.replace(/[^0-9]/g, '').slice(0, 6);
    setAddress(prev => ({ ...prev, pincode: cleaned }));
    if (cleaned.length === 6) {
      fetchPincodeDetails(cleaned);
    }
  };

  const isValid = useMemo(
    () =>
      !!(
        address.name?.trim() && 
        address.email?.trim() && 
        address.phone?.trim() && 
        address.flat?.trim() && 
        address.street?.trim() && 
        address.city?.trim() && 
        address.pincode?.trim() && 
        address.pincode.trim().length === 6 &&
        address.state?.trim()
      ) && 
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.email) &&
      address.phone.replace(/\D/g, '').length >= 10,
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
        if (!shippingAddress && json.addresses.length > 0) {
          const parsed = parseSavedAddress(json.addresses[0], user);
          setShippingAddress(parsed);
          setIsEditing(false);
          setAddress(parsed);
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
    if (!requireValidAuth(navigation)) return;
    fetchSavedAddresses();
  }, [fetchSavedAddresses, navigation]);

  useEffect(() => {
    if (!user) return;
    setAddress((prev) => ({
      ...prev,
      name: prev.name || user.name || '',
      email: prev.email || user.email || '',
      phone: prev.phone || user.phone || '',
    }));
  }, [user?.name, user?.email, user?.phone]);

  const fieldError = (field: keyof typeof address) => {
    if (!submitted) return null;
    if (field === 'flat') {
      if (!String(address.flat || '').trim()) return 'Please enter flat/house no. and building name';
      return null;
    }
    if (field === 'street') {
      if (!String(address.street || '').trim()) return 'Please enter street, area, or locality';
      return null;
    }
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
        ref={scrollViewRef}
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
                      const parsed = parseSavedAddress(a, user);
                      setShippingAddress(parsed);
                      setAddress(parsed); // Update form too
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
                  flat: '',
                  street: '',
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

          {/* FLAT / HOUSE NO. & BUILDING NAME — MANDATORY */}
          <View style={styles.field}>
            <Typography size={7} weight="600" color={colors.textExtraLight} style={styles.label}>
              FLAT / HOUSE NO. & BUILDING NAME
            </Typography>
            <TextInput
              ref={flatFieldRef}
              value={address.flat}
              onChangeText={(v) => {
                setAddress(prev => ({ ...prev, flat: v }));
                if (v.trim()) setAddressFieldHighlighted(false);
              }}
              placeholder="Enter flat/house no. and building name"
              placeholderTextColor={addressFieldHighlighted && !address.flat.trim() ? 'rgba(255,59,48,0.6)' : colors.textExtraLight}
              style={[
                styles.input,
                {
                  color: colors.text,
                  backgroundColor: (addressFieldHighlighted && !address.flat.trim())
                    ? (colors.background === '#000000' ? 'rgba(255,59,48,0.06)' : 'rgba(255,59,48,0.04)')
                    : colors.surface,
                  borderColor: (fieldError('flat') || (addressFieldHighlighted && !address.flat.trim()))
                    ? colors.error
                    : colors.borderLight,
                  borderWidth: (fieldError('flat') || (addressFieldHighlighted && !address.flat.trim())) ? 1.5 : 1,
                }
              ]}
            />
            {fieldError('flat') && (
              <Typography size={8} color={colors.error} style={{ marginLeft: 6 }}>
                {fieldError('flat')}
              </Typography>
            )}
            {addressFieldHighlighted && !address.flat.trim() && !fieldError('flat') && (
              <Typography size={8} color={colors.error} style={{ marginLeft: 6, fontWeight: '600' }}>
                Please enter your flat/house no. and building name to complete your address
              </Typography>
            )}
          </View>

          {/* STREET / AREA / LANDMARK — AUTO-FILLED BY LOCATION OR EDITABLE */}
          <View style={styles.field}>
            <TextInput
              ref={streetFieldRef}
              value={address.street}
              onChangeText={(v) => setAddress(prev => ({ ...prev, street: v }))}
              placeholder="Street, area, locality, or landmark"
              placeholderTextColor={colors.textExtraLight}
              textContentType="fullStreetAddress"
              autoComplete="street-address"
              multiline
              style={[
                styles.input,
                styles.completeAddressInput,
                { 
                  color: colors.text, 
                  backgroundColor: colors.surface, 
                  borderColor: fieldError('street') ? colors.error : colors.borderLight,
                }
              ]}
            />
            {fieldError('street') && (
              <Typography size={8} color={colors.error} style={{ marginLeft: 6, marginTop: 2 }}>
                {fieldError('street')}
              </Typography>
            )}
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
                  style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: fieldError('pincode') ? colors.error : colors.borderLight }]}
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
                style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: fieldError('city') ? colors.error : colors.borderLight }]}
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
              style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: fieldError('state') ? colors.error : colors.borderLight }]}
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
          if (!requireValidAuth(navigation)) return;
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
            if (!address.flat.trim()) {
              setAddressFieldHighlighted(true);
              flatFieldRef.current?.focus();
            } else if (!address.street.trim()) {
              streetFieldRef.current?.focus();
            }
            return;
          }

          haptics.buttonTap();
          
          // Normalize phone to E.164 (+91…) so Shiprocket / Shopify get the address number
          const phoneDigits = String(address.phone || '').replace(/\D/g, '');
          let formattedPhone = address.phone;
          if (phoneDigits.length === 10 && /^[6-9]/.test(phoneDigits)) {
            formattedPhone = `+91${phoneDigits}`;
          } else if (phoneDigits.length === 12 && phoneDigits.startsWith('91')) {
            formattedPhone = `+${phoneDigits}`;
          } else if (phoneDigits.length === 11 && phoneDigits.startsWith('0')) {
            formattedPhone = `+91${phoneDigits.slice(1)}`;
          } else if (phoneDigits.length >= 10 && !String(address.phone).startsWith('+')) {
            formattedPhone = `+${phoneDigits}`;
          }

          const flatTrimmed = address.flat.trim();
          const streetTrimmed = address.street.trim();
          const completeAddress1 = [flatTrimmed, streetTrimmed].filter(Boolean).join(', ');

          const normalized = {
            name: address.name?.trim() || user?.name || '',
            email: address.email?.trim() || user?.email || '',
            phone: formattedPhone || user?.phone || '',
            flat: flatTrimmed,
            street: streetTrimmed,
            streetAddress: streetTrimmed,
            line1: completeAddress1,
            line2: streetTrimmed,
            address1: completeAddress1,
            address2: streetTrimmed,
            city: address.city?.trim() || '',
            state: address.state?.trim() || '',
            province: address.state?.trim() || '',
            pincode: address.pincode?.trim() || '',
            country: 'India',
            zip: address.pincode?.trim() || '',
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
                    flat: normalized.flat,
                    street: normalized.street,
                    address1: normalized.address1,
                    address2: normalized.address2,
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
  completeAddressInput: { minHeight: 64, paddingTop: 16, paddingBottom: 16, textAlignVertical: 'top' },
  exampleText: { marginLeft: 6, marginTop: 4, letterSpacing: 0.2, lineHeight: 14 },
  row: { flexDirection: 'row', gap: 16 },
  savedSection: { marginTop: 40 },
  savedCard: { flexDirection: 'row', alignItems: 'center', padding: 20, borderRadius: 24, borderWidth: 1, marginBottom: 12 },
});
