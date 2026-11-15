import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useApp } from '@/components/AppProvider';
import { Badge, Banner, Button, Card, Field, H, Loading, Muted, Screen } from '@/components/ui';
import { C } from '@/theme';

function NameCard({ initial, onSave }: { initial: string; onSave: (n: string) => void }) {
  const [name, setName] = useState(initial);
  return (
    <Card>
      <H>Welcome 👋</H>
      <Muted style={{ marginBottom: 12 }}>Enter your name. Your team will see it next to plots you mark as booked or sold.</Muted>
      <Field label="Your name" value={name} onChangeText={setName} placeholder="e.g. Rakesh" autoCapitalize="words" testID="name-input" />
      <Button title="Continue" disabled={!name.trim()} onPress={() => onSave(name)} testID="name-save" />
    </Card>
  );
}

export default function Home() {
  const { loaded, userName, setUserName, joined, backend, authError, retryAuth, uid } = useApp();
  const [editingName, setEditingName] = useState(false);

  if (!loaded) return <Loading />;

  if (!userName || editingName) {
    return (
      <Screen>
        <NameCard
          initial={userName}
          onSave={async (n) => {
            await setUserName(n);
            setEditingName(false);
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      {authError ? (
        <Card style={{ borderColor: C.danger }}>
          <Banner tone="danger" text={`Could not connect: ${authError}`} />
          <Button title="Try again" variant="secondary" onPress={retryAuth} />
        </Card>
      ) : null}
      {backend.kind === 'local' ? (
        <Banner
          tone="warn"
          text="This-phone-only mode: projects are saved on this phone but not shared. Add your Firebase keys (see SETUP.md) to sync between phones with project codes."
        />
      ) : null}

      <View style={styles.actions}>
        <Button title="New project" icon="add-circle-outline" style={{ flex: 1 }} onPress={() => router.push('/import')} disabled={!uid} testID="new-project" />
        <Button title="Join with code" icon="key-outline" variant="secondary" style={{ flex: 1 }} onPress={() => router.push('/join')} disabled={!uid} testID="join-project" />
      </View>

      {joined.length === 0 ? (
        <Card style={{ alignItems: 'center', paddingVertical: 32 }}>
          <Ionicons name="map-outline" size={44} color={C.muted} />
          <H style={{ marginTop: 12 }}>No projects yet</H>
          <Muted style={{ textAlign: 'center' }}>
            Create a project from your layout&apos;s DXF file, or join your team&apos;s project with the code your admin shared.
          </Muted>
        </Card>
      ) : (
        joined.map((p) => (
          <Pressable key={p.id} onPress={() => router.push({ pathname: '/project/[id]', params: { id: p.id } })} testID={`project-${p.name}`}>
            {({ pressed }) => (
              <Card style={[styles.projectCard, pressed && { opacity: 0.85 }]}>
                <View style={styles.projectIcon}>
                  <Ionicons name="grid-outline" size={22} color={C.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.projectName}>{p.name}</Text>
                  <Badge text={p.role === 'admin' ? 'Admin' : 'Sales'} color={p.role === 'admin' ? C.primary : '#7A5AF8'} soft />
                </View>
                <Ionicons name="chevron-forward" size={20} color={C.muted} />
              </Card>
            )}
          </Pressable>
        ))
      )}

      <Pressable onPress={() => setEditingName(true)} style={{ alignSelf: 'center', marginTop: 8, padding: 8 }}>
        <Muted>
          Signed in as <Text style={{ fontWeight: '700', color: C.text }}>{userName}</Text> · change
        </Muted>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  projectCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  projectIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  projectName: { fontSize: 17, fontWeight: '700', color: C.text, marginBottom: 4 },
});
