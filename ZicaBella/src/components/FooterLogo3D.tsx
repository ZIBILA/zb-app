import React, { Suspense, useRef, useState, useCallback, useMemo } from 'react';
import { View, StyleSheet, PanResponder } from 'react-native';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, Bounds } from '@react-three/drei';
import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import { config } from '../constants/config';
import { useThemeStore } from '../store/themeStore';

const CANONICAL_SILVER_GLB = 'https://cdn.shopify.com/3d/models/e024b09e83a75c03/Zicabella-silver-logo.glb';

function FallbackLogo({ size = 56, isDark }: { size?: number; isDark: boolean }) {
  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
      <Image 
        source={require('../../assets/zb-logo-220px.png')} 
        style={{ 
          width: size * 0.75, 
          height: size * 0.75, 
          opacity: 0.9,
          tintColor: isDark ? '#FFFFFF' : '#000000',
        }} 
        contentFit="contain"
      />
    </View>
  );
}

function Model({
  glbUrl,
  touchRotation,
  isDark,
}: {
  glbUrl: string;
  touchRotation: React.MutableRefObject<{ x: number; y: number }>;
  isDark: boolean;
}) {
  const { scene } = useGLTF(glbUrl);
  const group = useRef<any>(null);
  const velocity = useRef({ x: 0, y: 0 });

  useMemo(() => {
    if (scene) {
      scene.traverse((child: any) => {
        if (child.isMesh && child.material) {
          // Exact silver metalness & specular sheen matching the webstore footer
          child.material.metalness = 0.92;
          child.material.roughness = 0.14;
          if (child.material.color) {
            child.material.color.set(isDark ? '#F1F5F9' : '#0F172A');
          }
          child.material.needsUpdate = true;
        }
      });
    }
  }, [scene, isDark]);

  useFrame((_state, delta) => {
    if (group.current) {
      group.current.rotation.y += delta * 0.35;
      velocity.current.x += (touchRotation.current.x - velocity.current.x) * 0.2;
      velocity.current.y += (touchRotation.current.y - velocity.current.y) * 0.2;
      group.current.rotation.y += velocity.current.x;
      group.current.rotation.x += velocity.current.y;
      touchRotation.current.x *= 0.98;
      touchRotation.current.y *= 0.98;
    }
  });

  return (
    <group ref={group}>
      <primitive 
        object={scene} 
        scale={2.6} 
        position={[0, 0, 0]} 
      />
    </group>
  );
}

type Props = {
  glbUrl?: string;
  size?: number;
};

export default function FooterLogo({ glbUrl, size = 56 }: Props) {
  const theme = useThemeStore(s => s.theme);
  const isDark = theme === 'dark';

  const rawUrl = (glbUrl || config.footerLogo3dGlb).trim();
  // Ensure we use the canonical silver 3D logo if raw URL is empty or generic
  const url = (rawUrl.length > 10 && rawUrl.startsWith('http')) ? rawUrl : CANONICAL_SILVER_GLB;

  const touchRotation = useRef({ x: 0, y: 0 });
  const lastGesture = useRef({ dx: 0, dy: 0 });
  const [renderKey, setRenderKey] = useState(0);

  // Re-initialize 3D Canvas on navigation focus to prevent GL context loss
  useFocusEffect(
    useCallback(() => {
      setRenderKey(prev => prev + 1);
      return () => {};
    }, [])
  );

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        lastGesture.current = { dx: 0, dy: 0 };
      },
      onPanResponderMove: (_evt, gestureState) => {
        const sensitivity = 0.025;
        const dx = (gestureState.dx - lastGesture.current.dx) * sensitivity;
        const dy = (gestureState.dy - lastGesture.current.dy) * sensitivity;
        touchRotation.current.x = dx;
        touchRotation.current.y = dy;
        lastGesture.current = { dx: gestureState.dx, dy: gestureState.dy };
      },
      onPanResponderRelease: (_evt, gestureState) => {
        const flickBoost = 0.3;
        touchRotation.current.x = gestureState.vx * flickBoost;
        touchRotation.current.y = gestureState.vy * flickBoost;
      }
    })
  ).current;

  return (
    <View style={[styles.container, { width: size, height: size }]} {...panResponder.panHandlers}>
      <Canvas
        key={`${url}-${renderKey}`}
        camera={{ position: [0, 0, 5.8], fov: 40 }}
        gl={{ 
          alpha: true, 
          antialias: true,
          powerPreference: "high-performance" 
        }}
      >
        <ambientLight intensity={isDark ? 2.5 : 3.0} />
        <directionalLight position={[5, 10, 7]} intensity={4.5} color="#FFFFFF" />
        <directionalLight position={[-5, -10, -5]} intensity={2.5} color="#E2E8F0" />
        <spotLight position={[10, 15, 10]} angle={0.35} penumbra={1} intensity={5} color="#FFFFFF" />
        <pointLight position={[0, 0, 8]} intensity={3.5} color="#FFFFFF" />
        <Suspense fallback={null}>
          <Bounds fit clip observe margin={1}>
            <Model glbUrl={url} touchRotation={touchRotation} isDark={isDark} />
          </Bounds>
        </Suspense>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'center',
    backgroundColor: 'transparent',
    marginBottom: 4,
  },
});
