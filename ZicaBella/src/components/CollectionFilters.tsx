import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { GlassView } from './GlassView';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../constants/colors';
import { useThemeStore } from '../store/themeStore';

interface Props {
  allSizes: string[];
  selectedSize: string | null;
  onSelectSize: (size: string | null) => void;
  allColors: string[];
  selectedColor: string | null;
  onSelectColor: (color: string | null) => void;
  sortBy: string;
  onSelectSort: (sort: string) => void;
  viewMode: 'grid' | 'grid4' | 'large';
  onToggleView: () => void;
  isTabBarVisible?: boolean;
  isSizeOpen: boolean;
  setIsSizeOpen: (open: boolean) => void;
  isColorOpen: boolean;
  setIsColorOpen: (open: boolean) => void;
  compact?: boolean;
}

const getColorHex = (colorName: string): string => {
  const name = colorName.toLowerCase().trim();
  const map: { [key: string]: string } = {
    black: '#000000',
    white: '#FFFFFF',
    gold: '#E5A93B',
    silver: '#C0C0C0',
    bronze: '#CD7F32',
    red: '#DF2C2C',
    blue: '#2C73DF',
    green: '#2CDF86',
    pink: '#FFB6C1',
    yellow: '#FFD700',
    orange: '#FFA500',
    purple: '#8A2BE2',
    grey: '#808080',
    gray: '#808080',
    beige: '#F5F5DC',
    brown: '#8B4513',
    ivory: '#FFFFF0',
    navy: '#000080',
    cream: '#FFFDD0',
    olive: '#808000',
    maroon: '#800000',
    emerald: '#50C878',
    burgundy: '#800020',
    tan: '#D2B48C',
    khaki: '#F0E68C',
    coral: '#FF7F50',
    mustard: '#FFDB58',
    charcoal: '#36454F',
    nude: '#E3C1B4',
    champagne: '#F7E7CE',
  };
  return map[name] || '#888888';
};

export default function CollectionFilters({
  allSizes,
  selectedSize,
  onSelectSize,
  allColors,
  selectedColor,
  onSelectColor,
  sortBy,
  onSelectSort,
  viewMode,
  onToggleView,
  isTabBarVisible = true,
  isSizeOpen,
  setIsSizeOpen,
  isColorOpen,
  setIsColorOpen,
  compact = false,
}: Props) {
  const colors = useColors();
  const theme = useThemeStore(state => state.theme);
  const isDark = theme === 'dark';

  return (
    <View style={styles.container}>
      <View style={[styles.pillWrapper, { borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)' }]}>
        <GlassView intensity={isDark ? 30 : 45} tint={isDark ? 'dark' : 'light'} style={styles.pill}>
          {/* Sort Button */}
          <TouchableOpacity 
            style={[styles.filterBtn, compact && styles.compactBtn]} 
            onPress={() => {
              const sorts = ['featured', 'newest', 'price-asc', 'price-desc'];
              const next = sorts[(sorts.indexOf(sortBy) + 1) % sorts.length];
              onSelectSort(next);
            }}
            accessibilityLabel={`Sort by: ${sortBy.replace('-', ' ')}`}
            accessibilityRole="button"
          >
            <Ionicons name="swap-vertical" size={13} color={colors.text} />
            {!compact && (
              <Text style={[styles.filterText, { color: colors.text }]}>
                {sortBy === 'featured' ? 'SORT' : sortBy.replace('-', ' ').toUpperCase()}
              </Text>
            )}
          </TouchableOpacity>
          
          <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />

          {/* Color Button */}
          <TouchableOpacity 
            style={[styles.filterBtn, compact && styles.compactBtn]}
            onPress={() => {
              setIsColorOpen(!isColorOpen);
              setIsSizeOpen(false);
            }}
            accessibilityLabel={`Filter by color${selectedColor ? ': ' + selectedColor : ''}`}
            accessibilityRole="button"
            accessibilityState={{ expanded: isColorOpen }}
          >
            <View style={styles.iconWrapper}>
              {selectedColor ? (
                <View style={[styles.colorSwatchInPill, { backgroundColor: getColorHex(selectedColor), borderColor: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.15)' }]} />
              ) : (
                <Ionicons name="color-palette-outline" size={13} color={colors.text} />
              )}
            </View>
            {!compact && (
              <Text style={[styles.filterText, { color: colors.text }]}>
                {selectedColor || 'COLOR'}
              </Text>
            )}
          </TouchableOpacity>

          <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />

          {/* Size Button */}
          <TouchableOpacity 
            style={[styles.filterBtn, compact && styles.compactBtn]}
            onPress={() => {
              setIsSizeOpen(!isSizeOpen);
              setIsColorOpen(false);
            }}
            accessibilityLabel={`Filter by size${selectedSize ? ': ' + selectedSize : ''}`}
            accessibilityRole="button"
            accessibilityState={{ expanded: isSizeOpen }}
          >
            <View style={styles.iconWrapper}>
              <Ionicons name="resize-outline" size={13} color={colors.text} />
              {selectedSize && <View style={[styles.activeDot, { backgroundColor: colors.iosBlue || '#D4AF37' }]} />}
            </View>
            {!compact && (
              <Text style={[styles.filterText, { color: colors.text }]}>
                {selectedSize || 'SIZE'}
              </Text>
            )}
          </TouchableOpacity>

          <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />

          {/* View Toggle */}
          <TouchableOpacity 
            style={styles.viewToggle} 
            onPress={onToggleView}
            accessibilityLabel={`Switch layout view. Current: ${viewMode}`}
            accessibilityRole="button"
          >
            <Ionicons 
              name={
                viewMode === 'grid' ? 'grid-outline' : 
                viewMode === 'grid4' ? 'apps-outline' :
                'square-outline'
              } 
              size={13} 
              color={colors.text} 
            />
          </TouchableOpacity>
        </GlassView>
      </View>

      {/* Dropdown for Sizes */}
      {isSizeOpen && (
        <View style={styles.dropdownOverlay}>
          <TouchableOpacity 
            style={StyleSheet.absoluteFill} 
            activeOpacity={1} 
            onPress={() => setIsSizeOpen(false)} 
          />
          <View style={[styles.dropdownContainer, { borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)' }]}>
            <GlassView intensity={isDark ? 70 : 85} tint={isDark ? 'dark' : 'light'} style={styles.dropdownInner}>
              <ScrollView style={{ maxHeight: 220 }}>
                <TouchableOpacity 
                  style={styles.dropdownOption}
                  onPress={() => { onSelectSize(null); setIsSizeOpen(false); }}
                >
                  <Text style={[styles.dropdownOptionText, { color: colors.text, opacity: !selectedSize ? 1 : 0.5 }]}>
                    ANY SIZE
                  </Text>
                  {!selectedSize && <Ionicons name="checkmark" size={11} color={colors.text} />}
                </TouchableOpacity>
                {allSizes.map(size => (
                  <TouchableOpacity 
                    key={size}
                    style={styles.dropdownOption}
                    onPress={() => { onSelectSize(size); setIsSizeOpen(false); }}
                  >
                    <Text style={[styles.dropdownOptionText, { color: colors.text }]}>
                      {size}
                    </Text>
                    {selectedSize === size && (
                      <Ionicons name="checkmark" size={11} color={colors.text} />
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </GlassView>
          </View>
        </View>
      )}

      {/* Dropdown for Colors */}
      {isColorOpen && (
        <View style={styles.dropdownOverlay}>
          <TouchableOpacity 
            style={StyleSheet.absoluteFill} 
            activeOpacity={1} 
            onPress={() => setIsColorOpen(false)} 
          />
          <View style={[styles.dropdownContainer, { borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)' }]}>
            <GlassView intensity={isDark ? 70 : 85} tint={isDark ? 'dark' : 'light'} style={styles.dropdownInner}>
              <ScrollView style={{ maxHeight: 220 }}>
                <TouchableOpacity 
                  style={styles.dropdownOption}
                  onPress={() => { onSelectColor(null); setIsColorOpen(false); }}
                >
                  <View style={styles.dropdownOptionColorRow}>
                    <View style={[styles.colorSwatchDropdown, { backgroundColor: 'transparent', borderWidth: 1, borderStyle: 'dashed', borderColor: colors.textExtraLight }]} />
                    <Text style={[styles.dropdownOptionText, { color: colors.text, opacity: !selectedColor ? 1 : 0.5 }]}>
                      ANY COLOR
                    </Text>
                  </View>
                  {!selectedColor && <Ionicons name="checkmark" size={11} color={colors.text} />}
                </TouchableOpacity>
                {allColors.map(color => (
                  <TouchableOpacity 
                    key={color}
                    style={styles.dropdownOption}
                    onPress={() => { onSelectColor(color); setIsColorOpen(false); }}
                  >
                    <View style={styles.dropdownOptionColorRow}>
                      <View style={[styles.colorSwatchDropdown, { backgroundColor: getColorHex(color), borderColor: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.12)' }]} />
                      <Text style={[styles.dropdownOptionText, { color: colors.text }]}>
                        {color}
                      </Text>
                    </View>
                    {selectedColor === color && (
                      <Ionicons name="checkmark" size={11} color={colors.text} />
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </GlassView>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    zIndex: 2000,
    elevation: 2000,
    marginBottom: 6,
    marginTop: 2,
  },
  pillWrapper: {
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 0.5,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.12,
        shadowRadius: 12,
      },
      android: {
        elevation: 4,
        borderColor: 'rgba(255, 255, 255, 0.12)',
      },
    }),
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    height: 30,
  },
  compactBtn: {
    paddingHorizontal: 8,
    width: 36,
    justifyContent: 'center',
  },
  iconWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    position: 'absolute',
    top: -1,
    right: -3,
  },
  colorSwatchInPill: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 0.5,
  },
  filterText: {
    fontSize: 8.5,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  divider: {
    width: 0.5,
    height: 12,
    opacity: 0.08,
  },
  viewToggle: {
    width: 36,
    justifyContent: 'center',
    alignItems: 'center',
    height: 30,
  },
  dropdownOverlay: {
    position: 'absolute',
    top: 42,
    width: '100%',
    alignItems: 'center',
    zIndex: 2001,
    elevation: 2001,
  },
  dropdownContainer: {
    width: 200,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 0.5,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.2,
        shadowRadius: 20,
      },
      android: {
        elevation: 10,
      },
    }),
  },
  dropdownInner: {
    paddingVertical: 8,
  },
  dropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  dropdownOptionColorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  colorSwatchDropdown: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 0.5,
  },
  dropdownOptionText: {
    fontSize: 9.5,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
