import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { useApp, getEntityColor } from '../state/AppContext';

const SCREEN_W = Dimensions.get('window').width;
const VIS_SIZE = Math.min(SCREEN_W - 32, 360);
const CENTER = VIS_SIZE / 2;

export default function VisualizerScreen() {
  const { state } = useApp();
  const entityList = Object.values(state.entities);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>LIVE SOUNDSCAPE</Text>
        <Text style={styles.subtitle}>{entityList.length} ENTITIES ACTIVE</Text>
      </View>

      {/* Visualizer area */}
      <View style={styles.visWrap}>
        <View style={[styles.visArea, { width: VIS_SIZE, height: VIS_SIZE }]}>
          {/* Concentric rings */}
          {[1, 2, 3, 4, 5].map((i) => {
            const size = i * (VIS_SIZE / 5.5);
            return (
              <View
                key={i}
                style={[
                  styles.ring,
                  {
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    borderColor: `rgba(236, 91, 19, ${0.12 - i * 0.015})`,
                  },
                ]}
              />
            );
          })}

          {/* Center hub */}
          <View style={styles.hubGlow} />
          <View style={styles.hub} />

          {/* Entity orbs */}
          {entityList.map((e) => {
            const angleRad = ((e.position.angle_deg - 90) * Math.PI) / 180;
            const dist = Math.min(e.position.distance_m / 6, 1);
            const radius = dist * (VIS_SIZE / 2 - 20);
            const ex = CENTER + Math.cos(angleRad) * radius;
            const ey = CENTER + Math.sin(angleRad) * radius;
            const color = getEntityColor(e);
            const orbSize = e.type === 'object' ? 10 : 16;

            return (
              <React.Fragment key={e.id}>
                {/* Glow */}
                <View
                  style={[
                    styles.orbGlow,
                    {
                      left: ex - orbSize * 1.5,
                      top: ey - orbSize * 1.5,
                      width: orbSize * 3,
                      height: orbSize * 3,
                      borderRadius: orbSize * 1.5,
                      backgroundColor: color,
                    },
                  ]}
                />
                {/* Orb */}
                <View
                  style={[
                    styles.orb,
                    {
                      left: ex - orbSize / 2,
                      top: ey - orbSize / 2,
                      width: orbSize,
                      height: orbSize,
                      borderRadius: orbSize / 2,
                      backgroundColor: color,
                    },
                  ]}
                />
                {/* Label */}
                <View style={[styles.orbLabelWrap, { left: ex - 30, top: ey + orbSize / 2 + 4 }]}>
                  <Text style={[styles.orbLabel, { color }]}>{e.name}</Text>
                </View>
              </React.Fragment>
            );
          })}
        </View>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <View>
          <Text style={styles.footerLabel}>ENVIRONMENT NOISE</Text>
          <Text style={styles.footerVal}>
            42<Text style={styles.footerUnit}>dB</Text>
          </Text>
        </View>
        <View style={styles.calibrated}>
          <View style={styles.calibDot} />
          <Text style={styles.calibText}>System calibrated</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F' },

  header: { alignItems: 'center', paddingTop: 56, paddingBottom: 8 },
  title: { color: '#fff', fontSize: 14, fontWeight: '700', letterSpacing: 3 },
  subtitle: { color: '#94a3b8', fontSize: 10, fontWeight: '500', marginTop: 4 },

  visWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  visArea: { alignItems: 'center', justifyContent: 'center' },

  ring: { position: 'absolute', borderWidth: 1 },
  hubGlow: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(236, 91, 19, 0.2)',
  },
  hub: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#ec5b13',
  },

  orbGlow: { position: 'absolute', opacity: 0.15 },
  orb: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.8)',
  },
  orbLabelWrap: { position: 'absolute', width: 60, alignItems: 'center' },
  orbLabel: { fontSize: 10, fontWeight: '700' },

  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  footerLabel: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
  },
  footerVal: { color: '#fff', fontSize: 28, fontWeight: '700', marginTop: 4 },
  footerUnit: { color: '#94a3b8', fontSize: 12, fontWeight: '400' },

  calibrated: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(15,23,42,0.8)',
    borderWidth: 1,
    borderColor: 'rgba(51,65,85,0.5)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  calibDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e' },
  calibText: { color: '#e2e8f0', fontSize: 12, fontWeight: '600' },
});
