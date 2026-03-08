import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useApp } from '../state/AppContext';

const STATUS_COLORS: Record<string, string> = {
  connected: '#00d4ff',
  standby: '#f59e0b',
  disconnected: '#64748b',
};

export default function ContactsScreen() {
  const { state, dispatch } = useApp();
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const contacts = Object.values(state.contacts).filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()),
  );

  const handleAdd = useCallback(() => {
    if (!newName.trim()) return;
    const id = `contact_${newName.toLowerCase().replace(/\s/g, '_')}_${Date.now()}`;
    const freq = 300 + Math.random() * 400;
    dispatch({
      type: 'ADD_CONTACT',
      payload: {
        id,
        name: newName,
        status: 'standby',
        motifFreq: freq,
        motifDescription: newDesc || 'Auto-generated motif',
      },
    });
    setNewName('');
    setNewDesc('');
    setShowAdd(false);
  }, [newName, newDesc, dispatch]);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Contacts</Text>
        <Pressable onPress={() => setShowAdd(!showAdd)} style={styles.addBtn}>
          <Text style={styles.addBtnText}>{showAdd ? '\u00D7' : '+'}</Text>
        </Pressable>
      </View>

      {/* Add contact form */}
      {showAdd && (
        <View style={styles.addForm}>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="Name"
            placeholderTextColor="#64748b"
            style={styles.input}
          />
          <TextInput
            value={newDesc}
            onChangeText={setNewDesc}
            placeholder="Personality (e.g., warm, jazzy, calm)"
            placeholderTextColor="#64748b"
            multiline
            numberOfLines={2}
            style={[styles.input, styles.textArea]}
          />
          <Pressable onPress={handleAdd} style={styles.saveBtn}>
            <Text style={styles.saveBtnText}>Generate Motif & Save</Text>
          </Pressable>
        </View>
      )}

      {/* Search */}
      <View style={styles.searchWrap}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search contacts"
          placeholderTextColor="#64748b"
          style={styles.searchInput}
        />
      </View>

      {/* Contact list */}
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {contacts.map((c) => (
          <View key={c.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardInfo}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarLetter}>{c.name.charAt(0)}</Text>
                </View>
                <View>
                  <Text style={styles.cardName}>{c.name}</Text>
                  <Text
                    style={[
                      styles.cardStatus,
                      { color: STATUS_COLORS[c.status] ?? '#64748b' },
                    ]}
                  >
                    {c.status.toUpperCase()}
                  </Text>
                </View>
              </View>
            </View>

            {/* Waveform bars */}
            <View style={styles.waveform}>
              {Array.from({ length: 14 }, (_, i) => {
                const h = (Math.sin(i * 0.7 + c.motifFreq * 0.01) * 0.5 + 0.5) * 80 + 10;
                const finalH = c.status === 'disconnected' ? h * 0.3 : h;
                return (
                  <View
                    key={i}
                    style={[
                      styles.bar,
                      { height: `${finalH}%`, opacity: 0.2 + (finalH / 100) * 0.7 },
                    ]}
                  />
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F' },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 56,
    paddingBottom: 16,
  },
  title: { fontSize: 24, fontWeight: '700', color: '#f1f5f9' },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ec5b13',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: { color: '#fff', fontSize: 24, fontWeight: '600', lineHeight: 28 },

  addForm: {
    marginHorizontal: 24,
    marginBottom: 16,
    padding: 16,
    backgroundColor: 'rgba(15,23,42,0.6)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(51,65,85,0.5)',
    gap: 12,
  },
  input: {
    height: 40,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(30,41,59,0.8)',
    borderRadius: 8,
    color: '#e2e8f0',
    fontSize: 14,
  },
  textArea: { height: 64, paddingVertical: 8, textAlignVertical: 'top' },
  saveBtn: {
    paddingVertical: 10,
    backgroundColor: '#ec5b13',
    borderRadius: 8,
    alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  searchWrap: { paddingHorizontal: 24, marginBottom: 16 },
  searchInput: {
    height: 48,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(15,23,42,0.5)',
    borderRadius: 12,
    color: '#e2e8f0',
    fontSize: 14,
  },

  list: { flex: 1, paddingHorizontal: 24 },
  listContent: { gap: 16, paddingBottom: 24 },

  card: {
    padding: 16,
    backgroundColor: 'rgba(15,23,42,0.4)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(30,41,59,0.5)',
    gap: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardInfo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#334155',
    borderWidth: 2,
    borderColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { color: '#fff', fontSize: 18, fontWeight: '700' },
  cardName: { color: '#f1f5f9', fontSize: 16, fontWeight: '600' },
  cardStatus: { fontSize: 10, fontWeight: '700', fontFamily: 'Courier', letterSpacing: 2 },

  waveform: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,127,255,0.05)',
    borderRadius: 8,
  },
  bar: { flex: 1, backgroundColor: '#007fff', borderRadius: 100 },
});
