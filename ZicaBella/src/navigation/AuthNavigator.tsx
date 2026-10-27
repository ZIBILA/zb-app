import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import LoginScreen from '../screens/LoginScreen';
import PrivacyAndTermsScreen from '../screens/auth/PrivacyAndTermsScreen';

// Types moved to types.ts to break circular dependencies
import { useColors } from '../constants/colors';
import { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export default function AuthNavigator() {
  const colors = useColors();
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="PrivacyAndTerms" component={PrivacyAndTermsScreen} options={{ presentation: 'formSheet' }} />
    </Stack.Navigator>
  );
}
