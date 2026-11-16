import Ionicons from '@expo/vector-icons/Ionicons';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useApp } from '@/components/AppProvider';
import { Button, Card, H, IconButton, Muted, Row, Toggle, confirm } from '@/components/ui';
import { pickAttachment } from '@/lib/files';
import type { Plot, PlotFile } from '@/lib/types';
import { C } from '@/theme';

function fmtSize(n: number) {
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

/** Shrink photos before upload (1600 px JPEG) to save data and storage. */
async function compress(uri: string, width?: number): Promise<string> {
  const ctx = ImageManipulator.manipulate(uri);
  if (!width || width > 1600) ctx.resize({ width: 1600 });
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 });
  return out.uri;
}

/** Photos and documents of one plot. Private files are for admins only. */
export function PlotFiles({ projectId, plot, isAdmin, canUpload }: { projectId: string; plot: Plot; isAdmin: boolean; canUpload: boolean }) {
  const { backend, uid, userName, toast } = useApp();
  const [files, setFiles] = useState<PlotFile[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [priv, setPriv] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);

  useEffect(() => backend.watchFiles(projectId, plot.id, isAdmin, setFiles, () => undefined), [backend, projectId, plot.id, isAdmin]);

  // download links for thumbnails
  useEffect(() => {
    let alive = true;
    for (const f of files) {
      if (urls[f.id]) continue;
      backend
        .fileUrl(projectId, f)
        .then((u) => alive && u && setUrls((m) => ({ ...m, [f.id]: u })))
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [backend, files, projectId, urls]);

  const upload = async (input: { uri: string; name: string; contentType: string; kind: PlotFile['kind'] } | null) => {
    if (!input) return;
    setBusy(true);
    try {
      await backend.uploadFile(projectId, plot.id, { ...input, private: isAdmin && priv }, { name: userName });
      toast(input.kind === 'photo' ? 'Photo added' : 'Document added');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const photo = async (camera: boolean) => {
    try {
      if (camera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return toast('Camera permission was not given');
      }
      const res = camera ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      if (res.canceled || !res.assets?.length) return;
      const a = res.assets[0];
      const uri = await compress(a.uri, a.width);
      await upload({ uri, name: `plot-${plot.number}-${Date.now()}.jpg`, contentType: 'image/jpeg', kind: 'photo' });
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const photos = files.filter((f) => f.kind === 'photo');
  const docs = files.filter((f) => f.kind === 'doc');

  return (
    <Card>
      <H>Photos & documents</H>
      {photos.length ? (
        <View style={styles.grid}>
          {photos.map((f) => (
            <Pressable key={f.id} onPress={() => urls[f.id] && setViewer(urls[f.id])} style={styles.thumb} accessibilityLabel={`Photo ${f.name}`}>
              {urls[f.id] ? <Image source={{ uri: urls[f.id] }} style={StyleSheet.absoluteFill} /> : <ActivityIndicator />}
              {f.private ? (
                <View style={styles.lock}>
                  <Ionicons name="lock-closed" size={12} color="#fff" />
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
      {docs.map((f) => (
        <View key={f.id} style={styles.doc}>
          <Ionicons name={f.contentType.includes('pdf') ? 'document-text-outline' : 'document-outline'} size={22} color={C.primary} />
          <Pressable style={{ flex: 1 }} onPress={() => urls[f.id] && Linking.openURL(urls[f.id])}>
            <Text style={styles.docName} numberOfLines={1}>
              {f.private ? '🔒 ' : ''}
              {f.name}
            </Text>
            <Muted style={{ fontSize: 12 }}>
              {fmtSize(f.size)} · {f.uploadedByName} · {new Date(f.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </Muted>
          </Pressable>
          {isAdmin || f.uploadedBy === uid ? (
            <IconButton
              icon="trash-outline"
              label={`Delete ${f.name}`}
              color={C.danger}
              onPress={async () => {
                if (await confirm('Delete file?', f.name, 'Delete', true)) backend.deleteFile(projectId, f).catch((e: Error) => toast(e.message));
              }}
            />
          ) : null}
        </View>
      ))}
      {!files.length ? <Muted style={{ marginBottom: 8 }}>No photos or documents yet.</Muted> : null}
      {canUpload ? (
        <>
          {isAdmin ? <Toggle label="Private (admins only)" hint="For buyer ID, agreements and other personal papers." value={priv} onChange={setPriv} /> : null}
          <Row style={{ flexWrap: 'wrap', marginTop: 6 }}>
            <Button small icon="camera-outline" title="Take photo" onPress={() => photo(true)} disabled={busy} />
            <Button small variant="secondary" icon="images-outline" title="Photo" onPress={() => photo(false)} disabled={busy} testID="add-photo" />
            <Button
              small
              variant="secondary"
              icon="attach-outline"
              title="Document"
              disabled={busy}
              onPress={async () => {
                try {
                  const a = await pickAttachment();
                  if (a) await upload({ ...a, kind: a.contentType.startsWith('image/') ? 'photo' : 'doc' });
                } catch (e) {
                  toast((e as Error).message);
                }
              }}
              testID="add-document"
            />
            {busy ? <ActivityIndicator color={C.primary} /> : null}
          </Row>
        </>
      ) : null}

      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <Pressable style={styles.viewer} onPress={() => setViewer(null)} accessibilityLabel="Close photo">
          {viewer ? <Image source={{ uri: viewer }} style={styles.full} resizeMode="contain" /> : null}
        </Pressable>
      </Modal>
    </Card>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  thumb: { width: 96, height: 96, borderRadius: 10, overflow: 'hidden', backgroundColor: '#EEF1F4', alignItems: 'center', justifyContent: 'center' },
  lock: { position: 'absolute', right: 4, top: 4, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8, padding: 3 },
  doc: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  docName: { fontSize: 15, fontWeight: '600', color: C.text },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  full: { width: '100%', height: '85%' },
});
