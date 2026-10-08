import React, { useState, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Alert } from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import GlassHeader from '../components/GlassHeader';
import { Typography } from '../components/Typography';
import { useColors } from '../constants/colors';
import { useThemeStore } from '../store/themeStore';
import { formatPrice } from '../utils/formatPrice';
import { useAuthStore } from '../store/authStore';
import { config } from '../constants/config';
import { haptics } from '../utils/haptics';
import { useUIStore } from '../store/uiStore';
import { useEffect } from 'react';

const RETURN_REASONS = [
  "Defective or damaged",
  "Wrong size or fit",
  "Wrong color or pattern",
  "Not as described",
  "Changed mind",
  "Other"
];

export default function ReturnRequestScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { order } = route.params || {};
  const colors = useColors();

  const setTabBarVisible = useUIStore(s => s.setTabBarVisible);
  useFocusEffect(
    useCallback(() => {
      setTabBarVisible(false);
      return () => {
        setTabBarVisible(true);
      };
    }, [setTabBarVisible])
  );

  if (!order) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }]}>
        <Typography color={colors.text}>Order details are missing.</Typography>
        <TouchableOpacity onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main')} style={{ marginTop: 20 }}>
          <Typography color={colors.iosBlue}>Go Back</Typography>
        </TouchableOpacity>
      </View>
    );
  }
  const theme = useThemeStore(s => s.theme);
  const isDark = theme === 'dark';

  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggleSelection = (itemId: string) => {
    haptics.buttonTap();
    const newSet = new Set(selectedItems);
    if (newSet.has(itemId)) {
      newSet.delete(itemId);
    } else {
      newSet.add(itemId);
    }
    setSelectedItems(newSet);
  };

  const setReason = (itemId: string, reason: string) => {
    setReasons(prev => ({ ...prev, [itemId]: reason }));
  };

  const setComment = (itemId: string, text: string) => {
    setComments(prev => ({ ...prev, [itemId]: text }));
  };

  const estimatedRefund = Array.from(selectedItems).reduce((sum, itemId) => {
    const item = order.items.find((i: any) => i.id === itemId);
    if (item) return sum + (item.price * item.quantity);
    return sum;
  }, 0);

  const handleSubmit = async () => {
    // Validate
    if (selectedItems.size === 0) {
      Alert.alert('Error', 'Please select at least one item to return');
      return;
    }
    
    for (const itemId of selectedItems) {
      if (!reasons[itemId]) {
        Alert.alert('Error', 'Please select a reason for all selected items');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const token = useAuthStore.getState().token;
      const user = useAuthStore.getState().user;

      const returnItemsPayload = Array.from(selectedItems).map(itemId => {
        const item = order.items.find((i: any) => i.id === itemId);
        return {
          orderItemId: itemId,
          quantity: item.quantity,
          reason: reasons[itemId],
          comments: comments[itemId] || ''
        };
      });

      const res = await fetch(`${config.appUrl}/api/returns/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          orderId: order.id,
          userId: user?.id,
          returnItems: returnItemsPayload
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit return request');

      haptics.success();
      Alert.alert('Success', 'Your return request has been submitted successfully.', [
        { text: 'OK', onPress: () => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main') }
      ]);
    } catch (err: any) {
      console.error(err);
      haptics.error();
      Alert.alert('Error', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getItemImage = (item: any): string | null => {
    if (item.image) return item.image;
    if (item.imageUrl) return item.imageUrl;
    if (item.product?.image) return item.product.image;
    if (item.product?.images?.[0]) return item.product.images[0];
    return null;
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <GlassHeader title="Request Return" showBack />
      
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 70, paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: 16, marginBottom: 20 }}>
          <Typography size={14} weight="700" color={colors.text}>Select items to return</Typography>
          <Typography size={12} color={colors.textMuted} style={{ marginTop: 4 }}>
            Please select the items you want to return and specify the reason.
          </Typography>
        </View>

        {order.isCod ? (
          <View style={{ marginHorizontal: 16, marginBottom: 16, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,159,10,0.35)', backgroundColor: 'rgba(255,159,10,0.08)' }}>
            <Typography size={11} weight="800" color={colors.text} style={{ marginBottom: 4 }}>STORE CREDIT REFUND</Typography>
            <Typography size={12} color={colors.text} style={{ lineHeight: 17 }}>
              {order.codStoreCreditMessage || 'This was a COD order. As per our return policy, the refund for COD orders will be issued as Store Credit.'}
            </Typography>
            <TouchableOpacity onPress={() => { haptics.buttonTap(); navigation.navigate('Policy', { handle: 'refund-policy', title: 'Refund Policy' }); }}>
              <Typography size={12} weight="800" color={colors.iosBlue} style={{ marginTop: 6 }}>Learn More</Typography>
            </TouchableOpacity>
          </View>
        ) : null}

        {order.items?.map((item: any) => {
          const isSelected = selectedItems.has(item.id);
          const imgUrl = getItemImage(item);
          return (
            <View key={item.id} style={[styles.itemCard, { borderColor: isSelected ? colors.foreground : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)') }]}>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => toggleSelection(item.id)}
                style={styles.itemHeader}
              >
                <View style={[styles.checkbox, { borderColor: isSelected ? colors.foreground : colors.borderLight, backgroundColor: isSelected ? colors.foreground : 'transparent' }]}>
                  {isSelected && <Ionicons name="checkmark" size={12} color={colors.background} />}
                </View>
                <View style={[styles.itemThumb, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)' }]}>
                  {imgUrl ? (
                    <Image source={{ uri: imgUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  ) : (
                    <Ionicons name="shirt-outline" size={20} color={colors.textExtraLight} />
                  )}
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Typography size={14} weight="600" color={colors.text} numberOfLines={2}>{item.title}</Typography>
                  <Typography size={12} color={colors.textMuted} style={{ marginTop: 4 }}>Qty: {item.quantity} • {formatPrice(item.price)}</Typography>
                </View>
              </TouchableOpacity>

              {isSelected && (
                <View style={styles.reasonSection}>
                  <Typography size={12} weight="600" color={colors.text} style={{ marginBottom: 10 }}>Reason for return</Typography>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                    {RETURN_REASONS.map(reason => (
                      <TouchableOpacity
                        key={reason}
                        onPress={() => setReason(item.id, reason)}
                        style={[
                          styles.reasonChip,
                          {
                            backgroundColor: reasons[item.id] === reason ? colors.foreground : 'transparent',
                            borderColor: reasons[item.id] === reason ? colors.foreground : colors.borderLight,
                          }
                        ]}
                      >
                        <Typography size={11} weight={reasons[item.id] === reason ? '700' : '500'} color={reasons[item.id] === reason ? colors.background : colors.text}>
                          {reason}
                        </Typography>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  
                  {reasons[item.id] === 'Other' && (
                    <TextInput
                      style={[styles.input, { color: colors.text, borderColor: colors.borderLight, backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)' }]}
                      placeholder="Please specify..."
                      placeholderTextColor={colors.textExtraLight}
                      value={comments[item.id] || ''}
                      onChangeText={(txt) => setComment(item.id, txt)}
                      multiline
                    />
                  )}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 20), backgroundColor: isDark ? 'rgba(0,0,0,0.95)' : 'rgba(255,255,255,0.95)', borderTopColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 }}>
          <Typography size={13} color={colors.textMuted}>Estimated Refund</Typography>
          <Typography size={18} weight="800" color={colors.text}>{formatPrice(estimatedRefund)}</Typography>
        </View>
        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: selectedItems.size > 0 ? colors.foreground : colors.borderLight }]}
          disabled={selectedItems.size === 0 || isSubmitting}
          onPress={handleSubmit}
        >
          {isSubmitting ? <ActivityIndicator color={colors.background} /> : (
            <Typography size={14} weight="700" color={selectedItems.size > 0 ? colors.background : colors.textMuted}>
              Submit Return Request
            </Typography>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  itemCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    overflow: 'hidden'
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemThumb: {
    width: 50,
    height: 50,
    borderRadius: 10,
    marginLeft: 12,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center'
  },
  reasonSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(150,150,150,0.2)'
  },
  reasonChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
  },
  input: {
    minHeight: 60,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    paddingTop: 12,
    textAlignVertical: 'top'
  },
  footer: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    paddingHorizontal: 20,
    paddingTop: 16,
    borderTopWidth: 1,
  },
  submitBtn: {
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
  }
});
