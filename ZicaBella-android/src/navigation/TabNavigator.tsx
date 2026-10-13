import React, { useEffect } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View, Text, TouchableOpacity, Dimensions, Platform } from 'react-native';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withTiming, 
  Easing 
} from 'react-native-reanimated';

import { useColors } from '../constants/colors';
import { useThemeStore } from '../store/themeStore';
import { useCartStore } from '../store/cartStore';
import { useUIStore } from '../store/uiStore';
import { TabParamList } from './types';

import HomeScreen from '../screens/HomeScreen';
import SearchScreen from '../screens/SearchScreen';
import ChatScreen from '../screens/ChatScreen';
import ProfileScreen from '../screens/ProfileScreen';
import ProductDetailScreen from '../screens/ProductDetailScreen';
import CollectionScreen from '../screens/CollectionScreen';
import CommunityScreen from '../screens/CommunityScreen';
import OrderHistoryScreen from '../screens/OrderHistoryScreen';
import OrderDetailsScreen from '../screens/OrderDetailsScreen';
import ReturnRequestScreen from '../screens/ReturnRequestScreen';
import ExchangeSelectProductScreen from '../screens/ExchangeSelectProductScreen';
import ReturnsScreen from '../screens/ReturnsScreen';
import PolicyScreen from '../screens/PolicyScreen';
import ShopScreen from '../screens/ShopScreen';
import WishlistScreen from '../screens/WishlistScreen';
import StoryScreen from '../screens/StoryScreen';
import FAQScreen from '../screens/FAQScreen';
import BlogsScreen from '../screens/BlogsScreen';
import CollaborationsScreen from '../screens/CollaborationsScreen';
import NotificationsScreen from '../screens/NotificationsScreen';

import { BlurView } from 'expo-blur';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import CartDrawer from '../components/CartDrawer';
import WishlistDrawer from '../components/WishlistDrawer';
import MenuDrawer from '../components/MenuDrawer';
import { useNavigation } from '@react-navigation/native';
import { useAndroidBackHandler } from '../hooks/useAndroidBackHandler';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const { width } = Dimensions.get('window');

// ─── STACKS FOR EACH TAB ─────────────────────────────────────────────
// This ensures the bottom bar stays visible when navigating deep within a tab.

function HomeStack() {
  return (
    <Stack.Navigator id="HomeStack" screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }}>
      <Stack.Screen name="HomeScreen" component={HomeScreen} />
      <Stack.Screen name="Collection" component={CollectionScreen as any} />
      <Stack.Screen name="Community" component={CommunityScreen as any} />
      <Stack.Screen name="Story" component={StoryScreen as any} />
      <Stack.Screen name="Editorials" component={BlogsScreen as any} />
    </Stack.Navigator>
  );
}

function SearchStack() {
  return (
    <Stack.Navigator id="SearchStack" screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }}>
      <Stack.Screen name="SearchScreen" component={SearchScreen} />
      <Stack.Screen name="Collection" component={CollectionScreen as any} />
    </Stack.Navigator>
  );
}

function ShopStack() {
  return (
    <Stack.Navigator id="ShopStack" screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }}>
      <Stack.Screen name="ShopScreen" component={ShopScreen} />
      <Stack.Screen name="Collection" component={CollectionScreen as any} />
    </Stack.Navigator>
  );
}

function ProfileStack() {
  return (
    <Stack.Navigator id="ProfileStack" screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }}>
      <Stack.Screen name="ProfileScreen" component={ProfileScreen} />
      <Stack.Screen name="OrderHistory" component={OrderHistoryScreen as any} />
      <Stack.Screen name="OrderDetails" component={OrderDetailsScreen as any} />
      <Stack.Screen name="ReturnRequest" component={ReturnRequestScreen as any} />
      <Stack.Screen name="ExchangeSelectProduct" component={ExchangeSelectProductScreen as any} />
      <Stack.Screen name="Returns" component={ReturnsScreen as any} />
      <Stack.Screen name="Wishlist" component={WishlistScreen as any} />
      <Stack.Screen name="Blogs" component={BlogsScreen as any} />
      <Stack.Screen name="Collaborations" component={CollaborationsScreen as any} />
      <Stack.Screen name="Notifications" component={NotificationsScreen as any} />
    </Stack.Navigator>
  );
}

function OrdersStack() {
  return (
    <Stack.Navigator id="OrdersStack" screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }}>
      <Stack.Screen name="OrderHistory" component={OrderHistoryScreen as any} />
      <Stack.Screen name="OrderDetails" component={OrderDetailsScreen as any} />
      <Stack.Screen name="ReturnRequest" component={ReturnRequestScreen as any} />
      <Stack.Screen name="ExchangeSelectProduct" component={ExchangeSelectProductScreen as any} />
    </Stack.Navigator>
  );
}

// ───────────────────────────────────────────────────────────────────

function getActiveRouteName(state: any): string | null {
  if (!state || !state.routes) return null;
  const route = state.routes[state.index];
  if (route.state) {
    return getActiveRouteName(route.state);
  }
  return route.name || null;
}

function CustomTabBar({ state, descriptors, navigation }: any) {
  const isTabBarVisibleGlobal = useUIStore(s => s.isTabBarVisible);
  // Hide tab bar automatically when ChatTab is active to prevent visual overlap
  const currentRouteName = state.routes[state.index]?.name;
  const leafRouteName = getActiveRouteName(state);
  
  const isTabBarVisible = isTabBarVisibleGlobal && 
                          currentRouteName !== 'ChatTab' && 
                          leafRouteName !== 'ReturnRequest' && 
                          leafRouteName !== 'ExchangeSelectProduct' && 
                          leafRouteName !== 'OrderDetails';

  const colors = useColors();
  const theme = useThemeStore(s => s.theme);
  const isDark = theme === 'dark';
  const translateY = useSharedValue(0);

  useEffect(() => {
    translateY.value = withTiming(isTabBarVisible ? 0 : 120, {
      duration: 400,
      easing: Easing.bezier(0.33, 1, 0.68, 1),
    });
  }, [isTabBarVisible]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[
      styles.tabBarContainer, 
      animatedStyle,
    ]}>
      {Platform.OS === 'android' ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? 'rgba(10, 10, 10, 0.96)' : 'rgba(245, 245, 245, 0.96)' }]} />
      ) : (
        <BlurView 
          intensity={isDark ? 50 : 80} 
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill} 
        />
      )}
      <View style={[styles.tabContent, { borderColor: isDark ? (Platform.OS === 'android' ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.08)') : (Platform.OS === 'android' ? 'rgba(0,0,0,0.10)' : 'rgba(0,0,0,0.06)') }]}>
        {state.routes
          .filter((route: any) => route.name !== 'OrdersTab') // Orders accessible via Profile, Shop is now primary
          .map((route: any, index: number) => {
          // Recalculate the real index for the route
          const realIndex = state.routes.findIndex((r: any) => r.key === route.key);
          const { options } = descriptors[route.key];
          const isFocused = state.index === realIndex;
          const isAI = route.name === 'ChatTab';

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });

            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          const Icon = options?.tabBarIcon;

          return (
            <TouchableOpacity
              key={route.key}
              onPress={onPress}
              style={[styles.tabItem, isAI && styles.aiTabItem]}
              activeOpacity={0.7}
            >
              <View style={[
                styles.iconWrapper, 
                isFocused && styles.activeIconWrapper,
              ]}>
                {Icon && typeof Icon === 'function' ? Icon({ 
                  focused: isFocused, 
                  color: isFocused ? colors.text : colors.textExtraLight, 
                  size: 20 
                }) : null}
              </View>
              {isFocused && (
                <View style={[styles.focusDot, { backgroundColor: colors.text }]} />
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </Animated.View>
  );
}

export const TabNavigator = () => {
  useAndroidBackHandler();
  return (
    <Tab.Navigator
      id="MainTabNavigator"
      tabBar={(props) => <CustomTabBar {...props} />}
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        lazy: true,
      }}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeStack}
        options={{
          tabBarLabel: 'Home',
          tabBarIcon: ({ color }) => <Ionicons name="home-outline" size={20} color={color} />,
        }}
      />
      <Tab.Screen
        name="ShopTab"
        component={ShopStack}
        options={{
          tabBarIcon: ({ color }) => <Ionicons name="grid-outline" size={20} color={color} />,
        }}
      />
      <Tab.Screen
        name="ChatTab"
        component={ChatScreen}
        options={{
          tabBarLabel: 'AI',
          tabBarIcon: ({ color }) => (
            <Ionicons name="sparkles-sharp" size={22} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="SearchTab"
        component={SearchStack}
        options={{
          tabBarLabel: 'Search',
          tabBarIcon: ({ color }) => <Ionicons name="search-outline" size={20} color={color} />,
        }}
      />
      <Tab.Screen
        name="OrdersTab"
        component={OrdersStack}
        options={{
          tabBarLabel: 'Orders',
          tabBarIcon: ({ color }) => <Ionicons name="receipt-outline" size={20} color={color} />,
          tabBarButton: () => null,
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileStack}
        options={{
          tabBarLabel: 'Account',
          tabBarIcon: ({ color }) => <Ionicons name="person-outline" size={20} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
};

const styles = StyleSheet.create({
  tabBarContainer: {
    position: 'absolute',
    bottom: Platform.OS === 'android' ? 28 : 34,
    left: 20,
    right: 20,
    height: Platform.OS === 'android' ? 60 : 64,
    borderRadius: 32,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 20 },
        shadowOpacity: 0.2,
        shadowRadius: 30,
      },
      android: {
        elevation: 16,
      },
    }),
  },
  tabContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    borderWidth: 1.5,
    borderRadius: 32,
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    height: '100%',
  },
  aiTabItem: {
    flex: 1.2,
  },
  iconWrapper: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeIconWrapper: {
  },
  focusDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    position: 'absolute',
    bottom: 8,
  },
  tabLabel: {
    display: 'none',
  },
});

export default TabNavigator;
