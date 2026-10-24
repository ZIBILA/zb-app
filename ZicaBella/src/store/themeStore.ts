import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance, NativeModules } from 'react-native';
import { File, Paths } from 'expo-file-system';

interface ThemeState {
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  setTheme: (theme: 'light' | 'dark') => void;
}

type ThemePreferencesNative = {
  setTheme?: (theme: string) => void;
  getTheme?: () => string;
};

const nativeTheme = NativeModules.ZBThemePreferences as ThemePreferencesNative | undefined;

function getInitialTheme(): 'light' | 'dark' {
  try {
    const fromNative = nativeTheme?.getTheme?.();
    if (fromNative === 'dark' || fromNative === 'light') return fromNative;
  } catch {}

  try {
    const file = new File(Paths.document, 'app-theme.txt');
    if (file.exists) {
      const content = file.textSync().trim();
      if (content === 'dark' || content === 'light') return content;
    }
  } catch {}

  return 'light';
}

/** Persists launch/splash theme for the next cold start (native splash reads this). */
function persistLaunchTheme(theme: 'light' | 'dark') {
  // Primary: SharedPreferences via native module (what MainActivity reads).
  try {
    nativeTheme?.setTheme?.(theme);
  } catch {
    // Module may be unavailable in Expo Go / before native rebuild.
  }

  // Fallback / sync cache: file used for instant startup resolution.
  try {
    const file = new File(Paths.document, 'app-theme.txt');
    file.write(theme);
  } catch {
    // Native prefs are enough when the module is linked.
  }

  try {
    Appearance.setColorScheme(theme);
  } catch {
    // Older runtimes may not support setColorScheme.
  }
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: getInitialTheme(),
      toggleTheme: () => set((state) => {
        const theme = state.theme === 'light' ? 'dark' : 'light';
        persistLaunchTheme(theme);
        return { theme };
      }),
      setTheme: (theme) => {
        persistLaunchTheme(theme);
        set({ theme });
      },
    }),
    {
      name: 'theme-storage',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => {
        const currentTheme = state?.theme === 'dark' ? 'dark' : 'light';
        persistLaunchTheme(currentTheme);
      },
    }
  )
);
