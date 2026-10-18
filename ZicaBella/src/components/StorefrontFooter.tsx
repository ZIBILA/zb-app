import React from 'react';
import { View, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Ionicons, FontAwesome } from '@expo/vector-icons';
import { useColors } from '../constants/colors';
import { useThemeStore } from '../store/themeStore';
import { Typography } from './Typography';
import FooterLogo from './FooterLogo3D';
import { config } from '../constants/config';
import { useAdminSettings } from '../hooks/useAdminFeatures';
import HeroVideo from './HeroVideo';
import { useNavigation } from '@react-navigation/native';

export default function StorefrontFooter() {
  const colors = useColors();
  const theme = useThemeStore(s => s.theme);
  const isDark = theme === 'dark';
  const { settings } = useAdminSettings();
  const navigation = useNavigation<any>();

  const footerVideo = settings?.media?.footer ?? (settings as any)?.footerVideo;
  const footerLogoGlb =
    settings?.media?.footerLogo3dUrl?.trim() || config.footerLogo3dGlb;

  const instagram = settings?.social?.instagram?.trim();
  const apple = settings?.social?.apple?.trim();
  const spotify = settings?.social?.spotify?.trim();
  const youtube = settings?.social?.youtube?.trim();

  const socials = [
    instagram ? { icon: 'logo-instagram', type: 'Ionicons' as const, url: instagram } : null,
    spotify ? { icon: 'spotify', type: 'FontAwesome' as const, url: spotify } : null,
    apple ? { icon: 'apple', type: 'FontAwesome' as const, url: apple } : null,
    youtube ? { icon: 'logo-youtube', type: 'Ionicons' as const, url: youtube } : null,
  ].filter(Boolean) as { icon: string; type: 'Ionicons' | 'FontAwesome'; url: string }[];

  const openSocial = (url: string) => {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
      void Linking.openURL(url);
    } catch {
      /* invalid URL */
    }
  };

  return (
    <View style={[styles.container, { borderTopColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)' }]}>
      <View style={styles.logoWrapper}>
        <FooterLogo glbUrl={footerLogoGlb} size={64} />
      </View>

      {/* BRANDING: Exact web parity */}
      <Typography rocaston size={18} color={colors.text} style={styles.brandName}>
        ZICA BELLA
      </Typography>

      {/* FOOTER VIDEO (From Next.js parity) */}
      {footerVideo && (
        <View style={styles.videoSection}>
          <HeroVideo key={footerVideo} source={footerVideo} height={200} borderRadius={24} />
          <View style={[styles.videoOverlay, { backgroundColor: isDark ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.05)' }]} />
        </View>
      )}

      {/* SOCIAL LINKS: w-[16px] h-[16px] sizing */}
      <View style={styles.socialRow}>
        {(socials.length > 0 ? socials : [
          { icon: 'logo-instagram', type: 'Ionicons' as const, url: 'https://www.instagram.com/zica.bella' },
          { icon: 'spotify', type: 'FontAwesome' as const, url: 'https://spotify.com/zicabella' },
          { icon: 'apple', type: 'FontAwesome' as const, url: 'https://apple.co/zicabella' },
          { icon: 'logo-youtube', type: 'Ionicons' as const, url: 'https://www.youtube.com/@Zicabella' },
        ]).map((soc, i) => {
          const IconComp = soc.type === 'FontAwesome' ? FontAwesome : Ionicons;
          return (
            <TouchableOpacity
              key={`${soc.url}-${i}`}
              onPress={() => openSocial(soc.url)}
              style={styles.socialIcon}
              activeOpacity={0.6}
            >
              <IconComp name={soc.icon as any} size={15} color={colors.textExtraLight} style={{ opacity: 0.45 }} />
            </TouchableOpacity>
          );
        })}
      </View>

      {/* POLICIES: text-[6px] font-medium uppercase tracking-[0.25em] */}
      <View style={styles.policyRow}>
        {[
          { label: 'SUPPORT', onPress: () => navigation.navigate('FAQ') },
          { label: 'CONTACT', onPress: () => navigation.navigate('Policy', { handle: 'contact-information', title: 'CONTACT' }) },
          { label: 'PRIVACY', onPress: () => navigation.navigate('Policy', { handle: 'privacy-policy', title: 'PRIVACY' }) },
          { label: 'TERMS', onPress: () => navigation.navigate('Policy', { handle: 'terms-of-service', title: 'TERMS' }) },
        ].map((policy, index) => (
          <React.Fragment key={policy.label}>
            <TouchableOpacity onPress={policy.onPress}>
              <Typography size={6.2} weight="500" color={colors.textExtraLight} style={styles.policyText}>
                {policy.label}
              </Typography>
            </TouchableOpacity>
            {index < 3 && <View style={[styles.dot, { backgroundColor: colors.textExtraLight }]} />}
          </React.Fragment>
        ))}
      </View>

      {/* COPYRIGHT: text-[6px] uppercase tracking-[0.3em] */}
      <Typography size={6.2} weight="300" color={colors.textExtraLight} style={styles.copyright}>
        © 2026 ZICA BELLA · LUXURY STREETWEAR
      </Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingTop: 40,
    paddingBottom: 40,
    paddingHorizontal: 40,
    alignItems: 'center',
    borderTopWidth: 0.5,
  },
  logoWrapper: {
    marginBottom: 8,
    marginTop: 0,
    alignItems: 'center',
  },
  brandName: {
    letterSpacing: 1.5,
    marginBottom: 24,
  },
  videoSection: {
    width: '100%',
    height: 180,
    borderRadius: 24,
    overflow: 'hidden',
    marginBottom: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  socialRow: {
    flexDirection: 'row',
    gap: 24,
    marginBottom: 32,
  },
  socialIcon: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  policyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  policyText: {
    letterSpacing: 3,
    opacity: 0.6,
  },
  dot: {
    width: 2,
    height: 2,
    borderRadius: 1,
    opacity: 0.15,
  },
  copyright: {
    letterSpacing: 3,
    opacity: 0.2,
    textAlign: 'center',
  },
});
