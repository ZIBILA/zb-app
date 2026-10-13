import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Share,
  RefreshControl,
  Modal,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import GlassHeader from '../components/GlassHeader';
import { GlassBackdrop, GlassView } from '../components/GlassView';
import { Typography } from '../components/Typography';
import { useColors } from '../constants/colors';
import { useThemeStore } from '../store/themeStore';
import { useAuth } from '../hooks/useAuth';
import { useAuthStore } from '../store/authStore';
import { haptics } from '../utils/haptics';
import { config } from '../constants/config';
import { formatPrice } from '../utils/formatPrice';

const { width: SW } = Dimensions.get('window');

interface AffiliateData {
  id: string;
  code: string;
  displayName: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  commissionRate: number;
  totalClicks: number;
  totalConversions: number;
  totalRevenue: number;
  pendingEarnings: number;
  availableBalance: number;
  lifetimeEarnings: number;
  paidOut: number;
  minWithdrawal: number;
  defaultPayoutAccount?: {
    id: string;
    method: string;
    accountHolderName: string;
    last4?: string;
    bankName?: string;
  } | null;
}

export default function CreatorScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const isDark = useThemeStore((s) => s.theme) === 'dark';
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isAffiliate, setIsAffiliate] = useState(false);
  const [affiliate, setAffiliate] = useState<AffiliateData | null>(null);

  // Application form state
  const [displayName, setDisplayName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState('');

  // Referral data
  const [links, setLinks] = useState<any[]>([]);
  const [referrals, setReferrals] = useState<any[]>([]);

  // Payout Account Modal state
  const [payoutModalVisible, setPayoutModalVisible] = useState(false);
  const [payoutMethod, setPayoutMethod] = useState<'BANK' | 'UPI'>('UPI');
  const [accountHolderName, setAccountHolderName] = useState(user?.name || '');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [bankName, setBankName] = useState('');
  const [upiId, setUpiId] = useState('');
  const [savingPayout, setSavingPayout] = useState(false);

  // Withdrawal Modal state
  const [withdrawModalVisible, setWithdrawModalVisible] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);

  const getAuthHeaders = () => {
    const token = useAuthStore.getState().token;
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  const fetchAffiliateData = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const res = await fetch(`${config.appUrl}/api/affiliate/me`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (res.ok && data.isAffiliate && data.affiliate) {
        setIsAffiliate(true);
        setAffiliate(data.affiliate);

        // Fetch links & referrals if approved
        if (data.affiliate.status === 'APPROVED') {
          const [linksRes, refRes] = await Promise.all([
            fetch(`${config.appUrl}/api/affiliate/links`, { headers: getAuthHeaders() }),
            fetch(`${config.appUrl}/api/affiliate/referrals?limit=20`, { headers: getAuthHeaders() }),
          ]);
          const linksData = await linksRes.json().catch(() => ({ links: [] }));
          const refData = await refRes.json().catch(() => ({ referrals: [] }));
          if (linksData.links) setLinks(linksData.links);
          if (refData.referrals) setReferrals(refData.referrals);
        }
      } else {
        setIsAffiliate(false);
        setAffiliate(null);
      }
    } catch (e) {
      console.warn('[CreatorScreen] Load error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAffiliateData();
  }, [fetchAffiliateData]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchAffiliateData(true);
  };

  // Submit Application
  const handleApply = async () => {
    if (!displayName.trim()) {
      setApplyError('Please enter your creator handle or name.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setApplyError('Please enter a valid email address.');
      return;
    }

    setApplying(true);
    setApplyError('');
    try {
      const res = await fetch(`${config.appUrl}/api/affiliate/apply`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          displayName: displayName.trim(),
          email: email.trim().toLowerCase(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        haptics.success();
        Alert.alert('Application Submitted', 'Your creator application is received and will be reviewed shortly.');
        fetchAffiliateData(true);
      } else {
        setApplyError(data.error || 'Failed to submit application');
      }
    } catch (e: any) {
      setApplyError(e.message || 'Network error');
    } finally {
      setApplying(false);
    }
  };

  // Share referral link
  const handleShare = async () => {
    haptics.buttonTap();
    const primarySlug = links[0]?.slug || affiliate?.code?.toLowerCase() || '';
    const shareUrl = `https://zicabella.com/r/${primarySlug}`;
    try {
      await Share.share({
        message: `Use my code ${affiliate?.code} for exclusive discounts at Zica Bella: ${shareUrl}`,
        url: shareUrl,
      });
    } catch (_e) {}
  };

  // Save Payout Info
  const handleSavePayout = async () => {
    if (payoutMethod === 'UPI' && !upiId.trim()) {
      Alert.alert('Error', 'Please enter a valid UPI ID (e.g. yourname@okhdfcbank)');
      return;
    }
    if (payoutMethod === 'BANK' && (!accountNumber.trim() || !ifsc.trim())) {
      Alert.alert('Error', 'Please fill in Account Number and IFSC Code');
      return;
    }

    setSavingPayout(true);
    try {
      const res = await fetch(`${config.appUrl}/api/affiliate/bank`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          method: payoutMethod,
          accountHolderName: accountHolderName.trim() || user?.name || 'Creator',
          accountNumber: accountNumber.trim(),
          ifsc: ifsc.trim().toUpperCase(),
          bankName: bankName.trim(),
          upiId: upiId.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        haptics.success();
        Alert.alert('Success', 'Payout account updated successfully.');
        setPayoutModalVisible(false);
        fetchAffiliateData(true);
      } else {
        Alert.alert('Error', data.error || 'Failed to save payout account');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Network error');
    } finally {
      setSavingPayout(false);
    }
  };

  // Request Withdrawal
  const handleRequestWithdrawal = async () => {
    const amt = parseFloat(withdrawAmount);
    const minW = affiliate?.minWithdrawal || 1000;
    const avail = affiliate?.availableBalance || 0;

    if (isNaN(amt) || amt <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid withdrawal amount.');
      return;
    }
    if (amt > avail) {
      Alert.alert('Insufficient Balance', `You can withdraw up to ${formatPrice(avail)}.`);
      return;
    }
    if (amt < minW) {
      Alert.alert('Minimum Threshold', `The minimum withdrawal amount is ${formatPrice(minW)}.`);
      return;
    }

    setWithdrawing(true);
    try {
      const res = await fetch(`${config.appUrl}/api/affiliate/withdrawals`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ amount: amt }),
      });
      const data = await res.json();
      if (res.ok) {
        haptics.success();
        Alert.alert('Withdrawal Requested', 'Your payout request has been queued and will be processed to your payout account.');
        setWithdrawModalVisible(false);
        setWithdrawAmount('');
        fetchAffiliateData(true);
      } else {
        Alert.alert('Error', data.error || 'Failed to submit withdrawal');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Network error');
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <GlassHeader title="CREATOR PROGRAM" showBack />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: insets.top + 60, paddingBottom: 100, paddingHorizontal: 20 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textExtraLight} />}
      >
        {loading && !refreshing ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="small" color={colors.textExtraLight} />
          </View>
        ) : !isAffiliate || !affiliate ? (
          /* ═══ STATE A: NOT AN AFFILIATE (APPLY FORM) ═══ */
          <View style={styles.content}>
            <View style={[styles.heroCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', borderColor: colors.borderLight }]}>
              <View style={[styles.badge, { backgroundColor: colors.surface }]}>
                <Ionicons name="sparkles" size={12} color="#C9A96E" />
                <Typography size={7.5} weight="800" color="#C9A96E" style={{ letterSpacing: 1.5, marginLeft: 4 }}>
                  OFFICIAL CREATOR PROGRAM
                </Typography>
              </View>

              <Typography heading size={22} weight="700" color={colors.text} style={{ marginTop: 16 }}>
                EARN WITH ZICA BELLA
              </Typography>
              <Typography size={10} color={colors.textSecondary} style={{ marginTop: 8, lineHeight: 16 }}>
                Join our exclusive network of fashion creators. Share your personalized coupon code & link to earn 10% commission on every order.
              </Typography>
            </View>

            {/* Benefits Row */}
            <View style={styles.benefitsRow}>
              <View style={[styles.benefitCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)', borderColor: colors.borderExtraLight }]}>
                <Ionicons name="trending-up" size={18} color={colors.text} />
                <Typography size={8} weight="800" color={colors.text} style={{ marginTop: 8 }}>10% COMMISSIONS</Typography>
                <Typography size={7} color={colors.textExtraLight} style={{ marginTop: 2, textAlign: 'center' }}>On all verified sales</Typography>
              </View>
              <View style={[styles.benefitCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)', borderColor: colors.borderExtraLight }]}>
                <Ionicons name="flash-outline" size={18} color={colors.text} />
                <Typography size={8} weight="800" color={colors.text} style={{ marginTop: 8 }}>REAL-TIME STATS</Typography>
                <Typography size={7} color={colors.textExtraLight} style={{ marginTop: 2, textAlign: 'center' }}>Live clicks & sales</Typography>
              </View>
              <View style={[styles.benefitCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)', borderColor: colors.borderExtraLight }]}>
                <Ionicons name="wallet-outline" size={18} color={colors.text} />
                <Typography size={8} weight="800" color={colors.text} style={{ marginTop: 8 }}>FAST PAYOUTS</Typography>
                <Typography size={7} color={colors.textExtraLight} style={{ marginTop: 2, textAlign: 'center' }}>Direct UPI & Bank</Typography>
              </View>
            </View>

            {/* Apply Form */}
            <View style={[styles.formCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', borderColor: colors.borderLight }]}>
              <Typography size={8} weight="800" color={colors.textExtraLight} style={{ letterSpacing: 2, marginBottom: 16 }}>
                CREATOR APPLICATION
              </Typography>

              <View style={styles.field}>
                <Typography size={8} weight="600" color={colors.textSecondary} style={{ marginBottom: 6 }}>
                  CREATOR HANDLE / FULL NAME
                </Typography>
                <TextInput
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="e.g. Alex Rivera (@alexfits)"
                  placeholderTextColor={colors.textExtraLight}
                  style={[styles.input, { color: colors.text, borderColor: colors.borderLight, backgroundColor: colors.surface }]}
                />
              </View>

              <View style={[styles.field, { marginTop: 14 }]}>
                <Typography size={8} weight="600" color={colors.textSecondary} style={{ marginBottom: 6 }}>
                  REGISTERED EMAIL
                </Typography>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="yourname@gmail.com"
                  placeholderTextColor={colors.textExtraLight}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  style={[styles.input, { color: colors.text, borderColor: colors.borderLight, backgroundColor: colors.surface }]}
                />
              </View>

              {applyError ? (
                <Typography size={8} color={colors.error} style={{ marginTop: 10 }}>
                  {applyError}
                </Typography>
              ) : null}

              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: colors.foreground }]}
                onPress={handleApply}
                disabled={applying}
                activeOpacity={0.8}
              >
                {applying ? (
                  <ActivityIndicator color={colors.background} />
                ) : (
                  <Typography size={9} weight="800" color={colors.background} style={{ letterSpacing: 2 }}>
                    SUBMIT APPLICATION
                  </Typography>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : affiliate.status === 'PENDING' ? (
          /* ═══ STATE B: APPLICATION UNDER REVIEW ═══ */
          <View style={styles.content}>
            <View style={[styles.statusCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', borderColor: colors.borderLight }]}>
              <View style={styles.statusIconBox}>
                <Ionicons name="time-outline" size={36} color="#FF9500" />
              </View>
              <Typography heading size={18} weight="700" color={colors.text} style={{ marginTop: 16 }}>
                APPLICATION UNDER REVIEW
              </Typography>
              <Typography size={10} color={colors.textSecondary} style={{ marginTop: 8, textAlign: 'center', lineHeight: 16 }}>
                Your creator account request is currently being reviewed by our partnerships team. We will notify you once approved.
              </Typography>
              <View style={[styles.codeBadge, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}>
                <Typography size={8} weight="700" color={colors.textMuted}>
                  APPLICATION REF: #{affiliate.code || affiliate.id.slice(0, 8).toUpperCase()}
                </Typography>
              </View>
            </View>
          </View>
        ) : (
          /* ═══ STATE C: APPROVED CREATOR DASHBOARD ═══ */
          <View style={styles.content}>
            {/* KPI Cards Row */}
            <View style={styles.kpiGrid}>
              <View style={[styles.kpiCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', borderColor: colors.borderLight }]}>
                <Typography size={7} weight="800" color={colors.textExtraLight} style={{ letterSpacing: 1 }}>AVAILABLE BALANCE</Typography>
                <Typography heading size={20} weight="800" color={colors.success} style={{ marginTop: 4 }}>
                  {formatPrice(affiliate.availableBalance || 0)}
                </Typography>
                <TouchableOpacity
                  style={[styles.kpiActionBtn, { backgroundColor: colors.foreground }]}
                  onPress={() => setWithdrawModalVisible(true)}
                  activeOpacity={0.8}
                >
                  <Typography size={7.5} weight="800" color={colors.background} style={{ letterSpacing: 1 }}>
                    WITHDRAW
                  </Typography>
                </TouchableOpacity>
              </View>

              <View style={[styles.kpiCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', borderColor: colors.borderLight }]}>
                <Typography size={7} weight="800" color={colors.textExtraLight} style={{ letterSpacing: 1 }}>TOTAL EARNED</Typography>
                <Typography heading size={20} weight="800" color={colors.text} style={{ marginTop: 4 }}>
                  {formatPrice(affiliate.lifetimeEarnings || 0)}
                </Typography>
                <Typography size={7} color={colors.textMuted} style={{ marginTop: 12 }}>
                  Commission Rate: {affiliate.commissionRate || 10}%
                </Typography>
              </View>
            </View>

            <View style={styles.statsMiniRow}>
              <View style={[styles.miniStat, { backgroundColor: colors.surface, borderColor: colors.borderExtraLight }]}>
                <Typography heading size={16} color={colors.text}>{affiliate.totalConversions || 0}</Typography>
                <Typography size={6.5} weight="700" color={colors.textExtraLight}>CONVERSIONS</Typography>
              </View>
              <View style={[styles.miniStat, { backgroundColor: colors.surface, borderColor: colors.borderExtraLight }]}>
                <Typography heading size={16} color={colors.text}>{affiliate.totalClicks || 0}</Typography>
                <Typography size={6.5} weight="700" color={colors.textExtraLight}>TOTAL CLICKS</Typography>
              </View>
            </View>

            {/* Referral Code & Share Card */}
            <View style={[styles.shareCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', borderColor: colors.borderLight }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View>
                  <Typography size={7} weight="800" color={colors.textExtraLight} style={{ letterSpacing: 1.5 }}>
                    YOUR PROMO CODE
                  </Typography>
                  <Typography heading size={20} weight="800" color={colors.text} style={{ marginTop: 2, letterSpacing: 2 }}>
                    {affiliate.code}
                  </Typography>
                </View>
                <TouchableOpacity style={[styles.shareBtn, { backgroundColor: colors.foreground }]} onPress={handleShare}>
                  <Ionicons name="share-outline" size={14} color={colors.background} />
                  <Typography size={8} weight="800" color={colors.background} style={{ marginLeft: 6, letterSpacing: 1 }}>
                    SHARE
                  </Typography>
                </TouchableOpacity>
              </View>
            </View>

            {/* Payout Method Row */}
            <View style={[styles.payoutCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', borderColor: colors.borderLight }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={[styles.payoutIcon, { backgroundColor: colors.surface }]}>
                    <Ionicons name="card-outline" size={18} color={colors.text} />
                  </View>
                  <View>
                    <Typography size={9} weight="800" color={colors.text}>PAYOUT METHOD</Typography>
                    <Typography size={7.5} color={colors.textMuted} style={{ marginTop: 2 }}>
                      {affiliate.defaultPayoutAccount
                        ? `${affiliate.defaultPayoutAccount.method} •••• ${affiliate.defaultPayoutAccount.last4 || ''}`
                        : 'No payout account added yet'}
                    </Typography>
                  </View>
                </View>
                <TouchableOpacity onPress={() => setPayoutModalVisible(true)}>
                  <Typography size={8} weight="800" color={colors.foreground}>
                    {affiliate.defaultPayoutAccount ? 'EDIT' : 'SETUP'}
                  </Typography>
                </TouchableOpacity>
              </View>
            </View>

            {/* Recent Referrals List */}
            <View style={styles.referralsSection}>
              <Typography size={8} weight="800" color={colors.textExtraLight} style={{ letterSpacing: 2, marginBottom: 12 }}>
                RECENT REFERRALS
              </Typography>
              {referrals.length === 0 ? (
                <View style={[styles.emptyReferrals, { borderColor: colors.borderExtraLight }]}>
                  <Typography size={8} color={colors.textExtraLight} weight="600">
                    NO REFERRAL ORDERS YET
                  </Typography>
                  <Typography size={7} color={colors.textMuted} style={{ marginTop: 4 }}>
                    Share your link and coupon to start earning commissions.
                  </Typography>
                </View>
              ) : (
                referrals.map((ref: any, idx: number) => (
                  <View key={ref.id || idx} style={[styles.referralItem, { borderColor: colors.borderExtraLight, backgroundColor: colors.surface }]}>
                    <View>
                      <Typography size={9} weight="700" color={colors.text}>Order #{ref.orderNumber || ref.id?.slice(0, 6)}</Typography>
                      <Typography size={7} color={colors.textExtraLight} style={{ marginTop: 2 }}>
                        {ref.createdAt ? new Date(ref.createdAt).toLocaleDateString() : 'Recent'}
                      </Typography>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Typography size={9} weight="800" color={colors.success}>+{formatPrice(ref.commissionAmount || 0)}</Typography>
                      <Typography size={6.5} weight="700" color={ref.status === 'CONFIRMED' ? colors.success : '#FF9500'}>
                        {(ref.status || 'PENDING').toUpperCase()}
                      </Typography>
                    </View>
                  </View>
                ))
              )}
            </View>
          </View>
        )}
      </ScrollView>

      {/* ═══ WITHDRAWAL MODAL ═══ */}
      <Modal visible={withdrawModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.borderLight }]}>
            <Typography heading size={16} weight="700" color={colors.text}>REQUEST WITHDRAWAL</Typography>
            <Typography size={8} color={colors.textSecondary} style={{ marginTop: 4 }}>
              Available Balance: {formatPrice(affiliate?.availableBalance || 0)}
            </Typography>

            <TextInput
              value={withdrawAmount}
              onChangeText={setWithdrawAmount}
              placeholder="Enter amount (e.g. 1500)"
              placeholderTextColor={colors.textExtraLight}
              keyboardType="numeric"
              style={[styles.input, { color: colors.text, borderColor: colors.borderLight, backgroundColor: colors.surface, marginTop: 16 }]}
            />

            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={[styles.modalCancelBtn, { borderColor: colors.borderLight }]} onPress={() => setWithdrawModalVisible(false)}>
                <Typography size={8} weight="700" color={colors.text}>CANCEL</Typography>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalSubmitBtn, { backgroundColor: colors.foreground }]} onPress={handleRequestWithdrawal} disabled={withdrawing}>
                {withdrawing ? <ActivityIndicator size="small" color={colors.background} /> : (
                  <Typography size={8} weight="800" color={colors.background}>SUBMIT REQUEST</Typography>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ═══ PAYOUT ACCOUNT MODAL ═══ */}
      <Modal visible={payoutModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.borderLight }]}>
            <Typography heading size={16} weight="700" color={colors.text}>PAYOUT DETAILS</Typography>
            <View style={styles.tabToggleRow}>
              <TouchableOpacity
                style={[styles.tabToggleBtn, payoutMethod === 'UPI' && { backgroundColor: colors.foreground }]}
                onPress={() => setPayoutMethod('UPI')}
              >
                <Typography size={8} weight="800" color={payoutMethod === 'UPI' ? colors.background : colors.text}>UPI ID</Typography>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabToggleBtn, payoutMethod === 'BANK' && { backgroundColor: colors.foreground }]}
                onPress={() => setPayoutMethod('BANK')}
              >
                <Typography size={8} weight="800" color={payoutMethod === 'BANK' ? colors.background : colors.text}>BANK ACCOUNT</Typography>
              </TouchableOpacity>
            </View>

            {payoutMethod === 'UPI' ? (
              <TextInput
                value={upiId}
                onChangeText={setUpiId}
                placeholder="yourname@bankupi"
                placeholderTextColor={colors.textExtraLight}
                autoCapitalize="none"
                style={[styles.input, { color: colors.text, borderColor: colors.borderLight, backgroundColor: colors.surface, marginTop: 14 }]}
              />
            ) : (
              <View style={{ gap: 10, marginTop: 14 }}>
                <TextInput
                  value={accountHolderName}
                  onChangeText={setAccountHolderName}
                  placeholder="Account Holder Name"
                  placeholderTextColor={colors.textExtraLight}
                  style={[styles.input, { color: colors.text, borderColor: colors.borderLight, backgroundColor: colors.surface }]}
                />
                <TextInput
                  value={accountNumber}
                  onChangeText={setAccountNumber}
                  placeholder="Bank Account Number"
                  placeholderTextColor={colors.textExtraLight}
                  keyboardType="numeric"
                  style={[styles.input, { color: colors.text, borderColor: colors.borderLight, backgroundColor: colors.surface }]}
                />
                <TextInput
                  value={ifsc}
                  onChangeText={setIfsc}
                  placeholder="IFSC Code (e.g. HDFC0001234)"
                  placeholderTextColor={colors.textExtraLight}
                  autoCapitalize="characters"
                  style={[styles.input, { color: colors.text, borderColor: colors.borderLight, backgroundColor: colors.surface }]}
                />
              </View>
            )}

            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={[styles.modalCancelBtn, { borderColor: colors.borderLight }]} onPress={() => setPayoutModalVisible(false)}>
                <Typography size={8} weight="700" color={colors.text}>CANCEL</Typography>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalSubmitBtn, { backgroundColor: colors.foreground }]} onPress={handleSavePayout} disabled={savingPayout}>
                {savingPayout ? <ActivityIndicator size="small" color={colors.background} /> : (
                  <Typography size={8} weight="800" color={colors.background}>SAVE</Typography>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerBox: { paddingVertical: 100, alignItems: 'center', justifyContent: 'center' },
  content: { gap: 16 },
  heroCard: { padding: 24, borderRadius: 24, borderWidth: 1.5 },
  badge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 },
  benefitsRow: { flexDirection: 'row', gap: 10 },
  benefitCard: { flex: 1, padding: 14, borderRadius: 18, borderWidth: 1, alignItems: 'center' },
  formCard: { padding: 20, borderRadius: 24, borderWidth: 1.5 },
  field: {},
  input: { height: 46, borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, fontSize: 12, fontWeight: '600' },
  primaryBtn: { height: 48, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginTop: 18 },
  statusCard: { padding: 32, borderRadius: 24, borderWidth: 1.5, alignItems: 'center' },
  statusIconBox: { width: 64, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,149,0,0.1)' },
  codeBadge: { marginTop: 20, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, borderWidth: 1 },
  kpiGrid: { flexDirection: 'row', gap: 12 },
  kpiCard: { flex: 1, padding: 18, borderRadius: 20, borderWidth: 1.5 },
  kpiActionBtn: { marginTop: 12, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10, alignSelf: 'flex-start' },
  statsMiniRow: { flexDirection: 'row', gap: 12 },
  miniStat: { flex: 1, padding: 14, borderRadius: 16, borderWidth: 1, alignItems: 'center', gap: 4 },
  shareCard: { padding: 18, borderRadius: 20, borderWidth: 1.5 },
  shareBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  payoutCard: { padding: 16, borderRadius: 20, borderWidth: 1.5 },
  payoutIcon: { width: 36, height: 36, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  referralsSection: { marginTop: 8 },
  emptyReferrals: { padding: 28, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center' },
  referralItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  modalContent: { padding: 24, borderRadius: 24, borderWidth: 1.5 },
  tabToggleRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  tabToggleBtn: { flex: 1, height: 38, borderRadius: 12, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)' },
  modalBtnRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  modalCancelBtn: { flex: 1, height: 44, borderRadius: 14, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  modalSubmitBtn: { flex: 1, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
});
