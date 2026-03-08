import React from 'react';
import { View, Text, Switch, ScrollView, StyleSheet } from 'react-native';
import { useApp } from '../state/AppContext';

// If @react-native-community/slider is installed, swap this for a real Slider.
// For now, the volume/threshold values are display-only (toggleable via code).

export default function SettingsScreen() {
  const { state, dispatch } = useApp();
  const ae = state.audioEngine;
  const conn = state.connections;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>SETTINGS</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* ── Audio ── */}
        <Text style={styles.sectionLabel}>AUDIO BASICS</Text>
        <View style={styles.section}>
          <View style={styles.valueRow}>
            <Text style={styles.rowLabel}>MASTER VOLUME</Text>
            <Text style={styles.rowValue}>{Math.round(ae.masterVolume * 100)}%</Text>
          </View>
          <View style={styles.valueRow}>
            <Text style={styles.rowLabel}>CROWD THRESHOLD</Text>
            <Text style={styles.rowValue}>{ae.crowdThreshold} faces</Text>
          </View>
        </View>

        {/* ── Performance ── */}
        <Text style={[styles.sectionLabel, { marginTop: 32 }]}>PERFORMANCE</Text>
        <View style={styles.section}>
          <View style={styles.toggleRow}>
            <View>
              <Text style={styles.toggleLabel}>Spatialization</Text>
              <Text style={styles.toggleDesc}>3D Binaural processing</Text>
            </View>
            <Switch
              value={ae.spatializationEnabled}
              onValueChange={() =>
                dispatch({
                  type: 'SET_AUDIO',
                  payload: { spatializationEnabled: !ae.spatializationEnabled },
                })
              }
              trackColor={{ false: '#1e293b', true: '#3b82f6' }}
              thumbColor="#fff"
            />
          </View>
          <View style={styles.toggleRow}>
            <View>
              <Text style={styles.toggleLabel}>Demo Mode</Text>
              <Text style={styles.toggleDesc}>Simulate entities for testing</Text>
            </View>
            <Switch
              value={state.demoMode}
              onValueChange={() => dispatch({ type: 'TOGGLE_DEMO' })}
              trackColor={{ false: '#1e293b', true: '#3b82f6' }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {/* ── Connections ── */}
        <Text style={[styles.sectionLabel, { marginTop: 32, color: '#f59e0b' }]}>
          CONNECTIONS
        </Text>
        <View style={styles.section}>
          {([
            { name: 'Vision Pipeline', status: conn.vision.status, latency: conn.vision.latency },
            { name: 'Music Engine', status: conn.audio.status, latency: conn.audio.latency },
            { name: 'WebSocket', status: conn.ws.status, latency: null },
          ] as const).map((c) => (
            <View key={c.name} style={styles.connRow}>
              <View style={styles.connLeft}>
                <View
                  style={[
                    styles.connDot,
                    { backgroundColor: c.status === 'connected' ? '#22c55e' : '#ef4444' },
                  ]}
                />
                <Text style={styles.connName}>{c.name}</Text>
              </View>
              <Text style={styles.connVal}>
                {c.status === 'connected' && c.latency ? `${c.latency}ms` : c.status}
              </Text>
            </View>
          ))}
        </View>

        {/* ── API Endpoints ── */}
        <Text style={[styles.sectionLabel, { marginTop: 32, color: '#64748b' }]}>
          API ENDPOINTS
        </Text>
        <View style={styles.section}>
          {[
            { key: 'musicEngine', val: 'http://localhost:3001' },
            { key: 'facePipeline', val: 'Native iOS Module' },
          ].map(({ key, val }) => (
            <View key={key} style={styles.apiRow}>
              <Text style={styles.apiKey}>{key}</Text>
              <Text style={styles.apiVal}>{val}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F' },

  header: {
    paddingHorizontal: 24,
    paddingTop: 56,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(30,41,59,0.5)',
    alignItems: 'center',
  },
  title: { color: '#fff', fontSize: 18, fontWeight: '700', letterSpacing: 3 },

  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 32 },

  sectionLabel: {
    color: '#3b82f6',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 3,
    paddingHorizontal: 24,
    marginTop: 24,
    marginBottom: 16,
    opacity: 0.8,
  },
  section: { paddingHorizontal: 24, gap: 16 },

  // Value display rows (volume, threshold)
  valueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLabel: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 1.5,
  },
  rowValue: { color: '#f59e0b', fontSize: 12, fontFamily: 'Courier' },

  // Toggles
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  toggleLabel: { color: '#f1f5f9', fontSize: 14, fontWeight: '500' },
  toggleDesc: { color: '#64748b', fontSize: 10, marginTop: 2 },

  // Connection status
  connRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  connLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  connDot: { width: 8, height: 8, borderRadius: 4 },
  connName: { color: '#e2e8f0', fontSize: 14 },
  connVal: { color: '#64748b', fontSize: 12, fontFamily: 'Courier' },

  // API endpoints
  apiRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  apiKey: { color: '#94a3b8', fontSize: 10, fontFamily: 'Courier' },
  apiVal: { color: '#64748b', fontSize: 10, fontFamily: 'Courier' },
});
