import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance } from 'react-native';
import { File, Paths } from 'expo-file-system';

interface ThemeState {
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  setTheme: (theme: 'light' | 'dark') => void;
}

/** Written for the native splash/window, which paints before JS hydrates. */
function persistLaunchTheme(theme: 'light' | 'dark') {
  try {
    new File(Paths.document, 'app-theme.txt').write(theme);
  } catch {
    // The in-app theme still applies. The next cold start keeps the previous launch color.
  }
  // Keep RN / AppCompat night resources aligned with the in-app theme.
  try {
    Appearance.setColorScheme(theme);
  } catch {
    // Older runtimes may not support setColorScheme.
  }
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'light',
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
        if (state?.theme) persistLaunchTheme(state.theme);
      },
    }
  )
);
