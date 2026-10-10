import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Typography } from './Typography';
import { useColors } from '../constants/colors';
import { useThemeStore } from '../store/themeStore';
import { formatPrice } from '../utils/formatPrice';
import { haptics } from '../utils/haptics';

/**
 * Customer-facing view of one return / exchange request. Renders the `summary` object the
 * backend builds (same data the website shows): linked id, stage, COD note, pickup,
 * received flag, refund / store-credit state and the replacement order.
 */

type Props = {
  summary: any;
  /** Optional extra info shown under the header (dates, reason…) */
  children?: React.ReactNode;
};

const formatDateTime = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    : '';

export default function RequestSummaryCard({ summary, children }: Props) {
  const colors = useColors();
  const navigation = useNavigation<any>();
  const isDark = useThemeStore(s => s.theme) === 'dark';
  const [showHistory, setShowHistory] = useState(false);

  if (!summary) return null;

  const pickup = summary.pickup || {};
  const refund = summary.refund;
  const replacement = summary.replacement;
  const history: any[] = pickup.timeline || [];
  const border = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const isExchange = summary.kind === 'exchange';

  const openUrl = (url?: string | null) => {
    if (!url) return;
    haptics.buttonTap();
    Linking.openURL(url).catch(() => {});
  };

  const Row = ({ label, value }: { label: string; value?: string | null }) =>
    value ? (
      <View style={styles.row}>
        <Typography size={11} color={colors.textMuted}>{label}</Typography>
        <Typography size={11} weight="700" color={colors.text} style={{ flexShrink: 1, textAlign: 'right', marginLeft: 12 }}>{value}</Typography>
      </View>
    ) : null;

  return (
    <View style={[styles.card, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#FFFFFF', borderColor: border }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Typography size={9} weight="800" color={colors.textExtraLight} style={{ letterSpacing: 0.8 }}>
            {isExchange ? 'EXCHANGE' : 'RETURN'}
          </Typography>
          <Typography size={14} weight="800" color={colors.text} style={{ marginTop: 2 }}>
            {summary.displayId || (isExchange ? 'Exchange request' : 'Return request')}
          </Typography>
        </View>
        <View style={[styles.badge, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' }]}>
          <Typography size={9} weight="800" color={colors.text}>{String(summary.stageLabel || summary.status || '').toUpperCase()}</Typography>
        </View>
      </View>

      {children}

      {summary.isCod && !isExchange && summary.codMessage ? (
        <View style={[styles.notice, { borderColor: 'rgba(255,159,10,0.35)', backgroundColor: 'rgba(255,159,10,0.08)' }]}>
          <Typography size={11} color={colors.text} style={{ lineHeight: 16 }}>{summary.codMessage}</Typography>
          <TouchableOpacity
            onPress={() => { haptics.buttonTap(); navigation.navigate('Policy', { handle: 'refund-policy', title: 'Refund Policy' }); }}
          >
            <Typography size={11} weight="800" color={colors.iosBlue} style={{ marginTop: 4 }}>Learn More</Typography>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={[styles.section, { borderTopColor: border }]}>
        <Typography size={10} weight="800" color={colors.textExtraLight} style={{ letterSpacing: 0.8, marginBottom: 6 }}>PICKUP</Typography>
        <Row label="Status" value={pickup.stageLabel} />
        <Row label="Carrier status" value={pickup.carrierStatusLabel} />
        <Row label="Last location" value={pickup.location} />
        {!summary.received && pickup.expectedDate ? (
          <Row label="Expected" value={formatDateTime(pickup.expectedDate)} />
        ) : null}
        {pickup.trackingUrl ? (
          <TouchableOpacity onPress={() => openUrl(pickup.trackingUrl)} style={{ marginTop: 6 }}>
            <Typography size={11} weight="800" color={colors.iosBlue}>External Track</Typography>
          </TouchableOpacity>
        ) : null}
        {history.length > 0 ? (
          <TouchableOpacity onPress={() => { haptics.buttonTap(); setShowHistory(v => !v); }} style={{ marginTop: 8 }}>
            <Typography size={11} weight="700" color={colors.textMuted}>{showHistory ? 'Hide history' : 'Show history'}</Typography>
          </TouchableOpacity>
        ) : null}
        {showHistory && history.map((e, i) => (
          <View key={`${e.status}-${i}`} style={{ marginTop: 6 }}>
            <Typography size={11} weight="600" color={colors.text}>{e.status}</Typography>
            <Typography size={10} color={colors.textMuted}>{[e.location, formatDateTime(e.dateTime)].filter(Boolean).join(' • ')}</Typography>
          </View>
        ))}
      </View>

      <View style={[styles.section, { borderTopColor: border }]}>
        <Row label="Parcel received" value={summary.received ? `Yes${summary.receivedAt ? ` • ${formatDateTime(summary.receivedAt)}` : ''}` : 'Not yet'} />
        {refund ? (
          <>
            <Row label={refund.method === 'store_credit' ? 'Store credit' : 'Refund'} value={formatPrice(refund.amount || 0)} />
            <Row label="Refund to" value={refund.methodLabel} />
            <Row label="Refund status" value={refund.stateLabel} />
          </>
        ) : null}
      </View>

      {replacement ? (
        <View style={[styles.section, { borderTopColor: border }]}>
          <Typography size={10} weight="800" color={colors.textExtraLight} style={{ letterSpacing: 0.8, marginBottom: 6 }}>REPLACEMENT ORDER</Typography>
          <Row label="Order" value={replacement.displayId} />
          <Row label="Status" value={replacement.status} />
          <Row label="Payment" value={replacement.paymentLabel} />
          {replacement.trackingUrl ? (
            <TouchableOpacity onPress={() => openUrl(replacement.trackingUrl)} style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="navigate-outline" size={12} color={colors.iosBlue} />
              <Typography size={11} weight="800" color={colors.iosBlue}>External Track</Typography>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, borderWidth: 1, padding: 16, marginBottom: 16 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  notice: { borderWidth: 1, borderRadius: 12, padding: 10, marginTop: 8 },
  section: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 12, paddingTop: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 2 },
});
