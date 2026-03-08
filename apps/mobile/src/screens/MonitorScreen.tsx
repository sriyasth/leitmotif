import React, { useEffect, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useApp, getEntityColor, formatTime } from '../state/AppContext';
import { useLeitmotif } from '../useLeitmotif';

// Music engine URL — change to the IP of the machine running music-engine/index.ts
const MUSIC_ENGINE_URL = 'http://localhost:3001';

/**
 * Invisible component that mounts the face pipeline + music engine bridge.
 * Mounting starts the pipeline; unmounting stops it.
 */
function PipelineBridge() {
  const status = useLeitmotif({ musicEngineUrl: MUSIC_ENGINE_URL });

  // Optionally log pipeline status changes
  useEffect(() => {
    if (status.error) console.warn('[MonitorScreen] pipeline error:', status.error);
  }, [status.error]);

  return null;
}

export default function MonitorScreen() {
  const { state, dispatch } = useApp();
  const entityList = Object.values(state.entities);
  const entityCount = entityList.length;

  const toggleRecording = useCallback(() => {
    if (!state.session.recording) {
      if (state.demoMode) dispatch({ type: 'TOGGLE_DEMO' });
      dispatch({ type: 'SET_RECORDING', payload: true });
      dispatch({ type: 'SET_SESSION', payload: { status: 'live' } });
    } else {
      dispatch({ type: 'SET_RECORDING', payload: false });
      dispatch({ type: 'SET_SESSION', payload: { status: 'idle' } });
      dispatch({ type: 'SET_RECORD_TIME', payload: 0 });
    }
  }, [state.session.recording, state.demoMode, dispatch]);

  // Record timer
  useEffect(() => {
    if (!state.session.recording) return;
    const iv = setInterval(() => {
      dispatch({ type: 'SET_RECORD_TIME', payload: state.session.recordTime + 1 });
    }, 1000);
    return () => clearInterval(iv);
  }, [state.session.recording, state.session.recordTime, dispatch]);

  return (
    <View style={styles.container}>
      {/* Pipeline bridge — active only while recording (non-demo) */}
      {state.session.recording && !state.demoMode && <PipelineBridge />}

      {/* Background */}
      <View style={styles.background} />

      {/* Entity bounding boxes */}
      {entityList.map((e) => {
        const bb = e.boundingBox;
        const color = getEntityColor(e);
        const opacity = e.state === 'entering' ? 0.6 : e.state === 'exiting' ? 0.3 : 0.8;
        return (
          <View
            key={e.id}
            style={[
              styles.boundingBox,
              {
                left: `${bb.x}%`,
                top: `${bb.y}%`,
                width: `${bb.w}%`,
                height: `${bb.h}%`,
                borderColor: color,
                backgroundColor: `${color}15`,
                opacity,
              },
            ]}
          >
            <View style={[styles.entityLabel, { backgroundColor: color }]}>
              <Text style={styles.entityLabelText}>{e.name}</Text>
            </View>
            {e.type !== 'object' && (
              <View style={[styles.entityPulse, { backgroundColor: color }]} />
            )}
          </View>
        );
      })}

      {/* Top HUD */}
      <View style={styles.hud}>
        <View style={styles.hudLeft}>
          <View style={[styles.statusBadge, state.session.recording && styles.statusLive]}>
            {state.session.recording && <View style={styles.recDot} />}
            <Text style={styles.statusText}>
              {state.session.recording ? 'LIVE' : 'STANDBY'}
            </Text>
          </View>
          <Text style={styles.entityCount}>Entities: {entityCount}</Text>
          {entityCount >= state.audioEngine.crowdThreshold && (
            <Text style={styles.crowdBadge}>CROWD</Text>
          )}
        </View>
        {state.demoMode && (
          <View style={styles.demoBadge}>
            <Text style={styles.demoText}>DEMO</Text>
          </View>
        )}
      </View>

      {/* Radar minimap */}
      <View style={styles.radar}>
        <View style={styles.radarCenter} />
        {entityList.map((e) => {
          const angleRad = ((e.position.angle_deg - 90) * Math.PI) / 180;
          const dist = Math.min(e.position.distance_m / 6, 1);
          const x = 50 + Math.cos(angleRad) * dist * 40;
          const y = 50 + Math.sin(angleRad) * dist * 40;
          const color = getEntityColor(e);
          return (
            <View
              key={e.id}
              style={[
                styles.radarDot,
                {
                  left: `${x}%`,
                  top: `${y}%`,
                  backgroundColor: color,
                },
              ]}
            />
          );
        })}
      </View>

      {/* Record controls */}
      <View style={styles.controls}>
        <Pressable onPress={toggleRecording} style={styles.recordBtn}>
          <View style={state.session.recording ? styles.stopSquare : styles.recordCircle} />
        </Pressable>
        <Text style={styles.recordLabel}>
          {state.session.recording
            ? `REC ${formatTime(state.session.recordTime)}`
            : 'TAP TO START'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  background: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0f1419',
  },

  // Bounding boxes
  boundingBox: {
    position: 'absolute',
    borderWidth: 2,
    borderRadius: 8,
  },
  entityLabel: {
    position: 'absolute',
    top: -20,
    left: 0,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 2,
  },
  entityLabelText: {
    color: '#000',
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  entityPulse: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    width: 10,
    height: 10,
    borderRadius: 5,
  },

  // HUD
  hud: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 56,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  hudLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: 'rgba(30, 41, 59, 0.6)',
    borderWidth: 1,
    borderColor: 'rgba(51, 65, 85, 0.5)',
  },
  statusLive: {
    backgroundColor: 'rgba(220, 38, 38, 0.2)',
    borderColor: 'rgba(220, 38, 38, 0.5)',
  },
  recDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#dc2626',
  },
  statusText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
  },
  entityCount: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontFamily: 'Courier',
  },
  crowdBadge: {
    color: '#fbbf24',
    fontSize: 10,
    fontWeight: '700',
  },
  demoBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.5)',
  },
  demoText: {
    color: '#fbbf24',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
  },

  // Radar
  radar: {
    position: 'absolute',
    bottom: 120,
    left: 16,
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(0,212,255,0.3)',
    overflow: 'hidden',
  },
  radarCenter: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00d4ff',
    marginTop: -3,
    marginLeft: -3,
  },
  radarDot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: -4,
    marginLeft: -4,
  },

  // Controls
  controls: {
    position: 'absolute',
    bottom: 130,
    alignSelf: 'center',
    alignItems: 'center',
    gap: 12,
  },
  recordBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#dc2626',
  },
  stopSquare: {
    width: 32,
    height: 32,
    borderRadius: 4,
    backgroundColor: '#dc2626',
  },
  recordLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    fontFamily: 'Courier',
  },
});
