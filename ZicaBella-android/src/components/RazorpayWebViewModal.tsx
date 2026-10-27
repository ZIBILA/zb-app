import React, { useRef, useCallback, useEffect } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Platform,
  BackHandler,
  ActivityIndicator,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Typography } from './Typography';
import { haptics } from '../utils/haptics';

export interface RazorpayWebViewSuccessPayload {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature?: string;
}

interface Props {
  visible: boolean;
  orderId: string;
  razorpayKeyId: string;
  amount: number; // in Rupees
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
  onSuccess: (payload: RazorpayWebViewSuccessPayload) => void;
  onDismiss: () => void;
  onError: (errorDescription: string) => void;
}

export default function RazorpayWebViewModal({
  visible,
  orderId,
  razorpayKeyId,
  amount,
  prefill,
  onSuccess,
  onDismiss,
  onError,
}: Props) {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);

  // Handle hardware back button on Android
  useEffect(() => {
    if (!visible) return;
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      onDismiss();
      return true;
    });
    return () => backHandler.remove();
  }, [visible, onDismiss]);

  const amountPaise = Math.round(Number(amount || 0) * 100);

  const cleanName = (prefill?.name || '').replace(/["'\\]/g, ' ').trim();
  const cleanEmail = (prefill?.email || '').replace(/["'\\]/g, ' ').trim();
  const cleanContact = (prefill?.contact || '').replace(/\D/g, '').slice(-10);

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Zica Bella Checkout</title>
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%;
      height: 100%;
      background-color: #0A0A0A;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      overflow: hidden;
      color: #FFFFFF;
    }
    .loader {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    }
    .spinner {
      width: 44px;
      height: 44px;
      border: 3px solid rgba(255, 255, 255, 0.12);
      border-top-color: #FFFFFF;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    .label {
      font-size: 11px;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: rgba(255, 255, 255, 0.6);
      font-weight: 700;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="loader">
    <div class="spinner"></div>
    <div class="label">SECURE PAYMENT GATEWAY...</div>
  </div>
  <script>
    var options = {
      key: "${razorpayKeyId}",
      amount: ${amountPaise},
      currency: "INR",
      name: "Zica Bella",
      description: "Order #${orderId.startsWith('order_') ? orderId.slice(-8).toUpperCase() : orderId}",
      image: "https://cdn.shopify.com/s/files/1/0955/5394/5881/files/Zica-bella-luxury-streetwear-brand_f9d3cad3-ed6a-48d0-b90e-3a1bdd26df5e.jpg",
      order_id: "${orderId}",
      prefill: {
        name: "${cleanName}",
        email: "${cleanEmail}",
        contact: "${cleanContact}"
      },
      theme: {
        color: "#000000",
        backdrop_color: "rgba(0,0,0,0.85)"
      },
      modal: {
        confirm_close: true,
        animation: true,
        ondismiss: function() {
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ event: 'CANCELLED' }));
          }
        }
      },
      handler: function(response) {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            event: 'SUCCESS',
            data: response
          }));
        }
      }
    };

    try {
      var rzp = new Razorpay(options);
      rzp.on('payment.failed', function(resp) {
        if (window.ReactNativeWebView) {
          var desc = (resp && resp.error && resp.error.description) || 'Payment failed';
          window.ReactNativeWebView.postMessage(JSON.stringify({
            event: 'FAILED',
            description: desc
          }));
        }
      });
      window.onload = function() {
        rzp.open();
      };
    } catch(err) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          event: 'FAILED',
          description: err.message || 'Payment gateway failed to initialize'
        }));
      }
    }
  </script>
</body>
</html>
`;

  const handleMessage = useCallback((event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.event === 'SUCCESS' && msg.data) {
        haptics.success();
        onSuccess({
          razorpay_payment_id: msg.data.razorpay_payment_id,
          razorpay_order_id: msg.data.razorpay_order_id,
          razorpay_signature: msg.data.razorpay_signature,
        });
      } else if (msg.event === 'CANCELLED') {
        haptics.buttonTap();
        onDismiss();
      } else if (msg.event === 'FAILED') {
        haptics.error();
        onError(msg.description || 'Transaction could not be completed.');
      }
    } catch (e) {
      console.warn('[RazorpayWebView] Could not parse message:', event.nativeEvent.data);
    }
  }, [onSuccess, onDismiss, onError]);

  const handleShouldStartLoadWithRequest = useCallback((request: any) => {
    const url = request.url || '';
    // Allow data URLs and standard Razorpay checkout URLs
    if (url.startsWith('data:') || url.startsWith('about:blank')) {
      return true;
    }
    if (url.includes('razorpay.com') || url.includes('api.razorpay.com')) {
      return true;
    }

    // Intercept native UPI deep links and third-party apps
    const isDeepLink =
      url.startsWith('upi://') ||
      url.startsWith('tez://') ||
      url.startsWith('phonepe://') ||
      url.startsWith('gpay://') ||
      url.startsWith('paytmmp://') ||
      url.startsWith('bhim://') ||
      url.startsWith('credpay://') ||
      url.startsWith('intent://');

    if (isDeepLink) {
      if (url.startsWith('intent://')) {
        try {
          const schemeMatch = url.match(/scheme=([^;]+)/);
          if (schemeMatch && schemeMatch[1] === 'upi') {
            const upiUrl = url.replace(/^intent:\/\//, 'upi://').replace(/#Intent;.*$/, '');
            Linking.openURL(upiUrl).catch(() => Linking.openURL(url).catch(() => {}));
            return false;
          }
        } catch {}
      }
      Linking.openURL(url).catch(err => {
        console.warn('[RazorpayWebView] App link open failed:', err);
      });
      return false;
    }

    // Allow banking OTP pages, 3D secure redirects
    return true;
  }, []);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onDismiss}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Navigation Bar */}
        <View style={styles.navBar}>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={onDismiss}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel="Close payment window"
            accessibilityRole="button"
          >
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.titleContainer}>
            <Typography size={8} weight="800" color="rgba(255,255,255,0.4)" style={{ letterSpacing: 2 }}>
              RAZORPAY SECURE
            </Typography>
            <Typography size={13} weight="700" color="#FFFFFF">
              ₹{amount.toLocaleString('en-IN')}
            </Typography>
          </View>
          <View style={{ width: 36 }} />
        </View>

        {/* WebView */}
        <WebView
          ref={webViewRef}
          originWhitelist={['*']}
          source={{ html, baseUrl: 'https://checkout.razorpay.com' }}
          onMessage={handleMessage}
          onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
          javaScriptEnabled
          domStorageEnabled
          mixedContentMode="always"
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#FFFFFF" />
              <Typography size={11} weight="600" color="rgba(255,255,255,0.5)" style={{ marginTop: 16, letterSpacing: 1 }}>
                LOADING GATEWAY...
              </Typography>
            </View>
          )}
          style={styles.webView}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  navBar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    backgroundColor: '#0A0A0A',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleContainer: {
    alignItems: 'center',
  },
  webView: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0A0A0A',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
