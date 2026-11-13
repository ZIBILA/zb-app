import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import OptimizedImage from './OptimizedImage';
import { useColors } from '../constants/colors';
import { formatPrice } from '../utils/formatPrice';
import QuantityControl from './QuantityControl';
import { haptics } from '../utils/haptics';

import { Typography } from './Typography';

interface Props {
  item: {
    id: string;
    handle: string;
    title: string;
    price: string;
    image: string;
    size: string | null;
    quantity: number;
    /** Set when the row is one unit of a stored line (utils/cartUnits). */
    lineId?: string;
    lineQuantity?: number;
  };
  onUpdateQuantity: (id: string, quantity: number) => void;
  onRemove: (id: string) => void;
  onPress: () => void;
}

import { resolveImageUrl } from '../utils/imageUtils';

const CartItem = React.memo(({ item, onUpdateQuantity, onRemove, onPress }: Props) => {
  const colors = useColors();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          borderColor: colors.borderLight,
        },
      ]}
    >
      <TouchableOpacity 
        onPress={onPress} 
        activeOpacity={0.9} 
        style={styles.contentRow}
        accessibilityLabel={`View ${item.title}`}
        accessibilityRole="button"
      >
        {/* Product Image */}
        <View style={[styles.imageContainer, { backgroundColor: colors.background }]}>
          <Image source={resolveImageUrl(item.image) ? { uri: resolveImageUrl(item.image) as string } : undefined} style={styles.image} contentFit="cover" />
        </View>

        {/* Details */}
        <View style={styles.details}>
          <Typography size={8} weight="600" color={colors.text} numberOfLines={1}>
            {item.title.toUpperCase()}
          </Typography>
          {item.size && (
            <Typography size={7} weight="400" color={colors.textExtraLight}>
              SIZE: {item.size}
            </Typography>
          )}
          <Typography size={10} weight="600" color={colors.textSecondary} style={{ marginTop: 2 }}>
            {formatPrice(parseFloat(item.price))}
          </Typography>
        </View>
      </TouchableOpacity>

      {/* Quantity Stepper */}
      <View style={styles.actions}>
        <QuantityControl 
          quantity={item.quantity} 
          // A unit row shows 1; − removes this unit, + adds another unit (a new row) to the stored line.
          onUpdate={(qty) => onUpdateQuantity(item.lineId ?? item.id, (item.lineQuantity ?? item.quantity) + (qty - item.quantity))} 
          min={0}
        />
      </View>
    </View>
  );
});


const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    padding: 12,
    borderRadius: 20,
    borderWidth: 1,
  },
  contentRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  imageContainer: {
    width: 64,
    height: 64,
    borderRadius: 12,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  details: {
    flex: 1,
    justifyContent: 'center',
    gap: 2,
  },
  actions: {
    justifyContent: 'center',
  },
  deleteButton: {
    width: 64,
    marginBottom: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
    marginLeft: 12,
  },
});

export default CartItem;
