import React, { useReducer, useEffect } from 'react';
import { View, Text, Pressable, StatusBar, StyleSheet } from 'react-native';
import { AppContext, appReducer, initialState, getDemoState } from './state/AppContext';
import MonitorScreen from './screens/MonitorScreen';
import ContactsScreen from './screens/ContactsScreen';
import VisualizerScreen from './screens/VisualizerScreen';
import SettingsScreen from './screens/SettingsScreen';

const TABS = [
  { id: 'monitor', label: 'Monitor' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'visualizer', label: 'Visualizer' },
  { id: 'settings', label: 'Settings' },
] as const;

const SCREENS: Record<string, React.ComponentType> = {
  monitor: MonitorScreen,
  contacts: ContactsScreen,
  visualizer: VisualizerScreen,
  settings: SettingsScreen,
};

export default function App() {
  const [state, dispatch] = useReducer(appReducer, initialState);

  // Demo mode tick — simulates entity changes every 500ms
  useEffect(() => {
    if (!state.demoMode || !state.session.recording) return;
    let t = 0;
    const iv = setInterval(() => {
      t = (t + 0.5) % 30;
      dispatch({ type: 'SET_DEMO_TIME', payload: t });
      const { entities, departed } = getDemoState(t);
      dispatch({ type: 'UPDATE_ENTITIES', payload: { entities, departed } });
    }, 500);
    return () => clearInterval(iv);
  }, [state.demoMode, state.session.recording]);

  const Screen = SCREENS[state.currentScreen] ?? MonitorScreen;

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0F" />
      <View style={styles.root}>
        <View style={styles.content}>
          <Screen />
        </View>

        {/* Bottom nav */}
        <View style={styles.nav}>
          {TABS.map((tab) => {
            const active = state.currentScreen === tab.id;
            return (
              <Pressable
                key={tab.id}
                onPress={() => dispatch({ type: 'SET_SCREEN', payload: tab.id })}
                style={styles.navItem}
              >
                <Text style={[styles.navLabel, active && styles.navLabelActive]}>
                  {tab.label.toUpperCase()}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </AppContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0A0A0F',
  },
  content: {
    flex: 1,
  },
  nav: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(30, 41, 59, 0.5)',
    backgroundColor: 'rgba(10, 10, 15, 0.95)',
  },
  navItem: {
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  navLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: '#64748b',
  },
  navLabelActive: {
    color: '#ec5b13',
  },
});
