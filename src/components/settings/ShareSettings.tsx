import * as Clipboard from 'expo-clipboard';
import { Linking, Share, StyleSheet, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { useApp } from '@/components/AppProvider';
import { Banner, Button, Card, H, Muted, Row, Toggle, confirm } from '@/components/ui';
import { shareBaseUrl } from '@/lib/backend/config';
import { buildPublic, publicStatuses, shareUrl } from '@/lib/publicLayout';
import { qrSvg } from '@/lib/qr';
import type { LayoutData, Plot, Project } from '@/lib/types';
import { C } from '@/theme';

/** Admin: turn the customer link on/off, show it as a QR code, choose whether prices are shown. */
export function ShareSettings({ project, plots, layout }: { project: Project; plots: Plot[]; layout: LayoutData | null }) {
  const { backend, toast } = useApp();
  const share = project.share;
  const on = !!share?.enabled && !!share.token;
  const base = shareBaseUrl();
  const url = on && base ? shareUrl(base, share!.token) : '';

  const publish = async (token: string, showPrices: boolean) => {
    const p = { ...project, share: { enabled: true, token, showPrices } };
    await backend.publishPublic(token, { ...buildPublic(p, plots, showPrices), st: publicStatuses(plots) }, layout);
  };

  const enable = async (v: boolean) => {
    try {
      if (v) {
        const token = share?.token || backend.newId();
        await backend.updateProject(project.id, { share: { enabled: true, token, showPrices: !!share?.showPrices } });
        await publish(token, !!share?.showPrices);
        toast('Customer link is on');
      } else {
        if (share?.token) await backend.unpublishPublic(share.token);
        await backend.updateProject(project.id, { share: { enabled: false, token: share?.token || '', showPrices: !!share?.showPrices } });
        toast('Customer link is off');
      }
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const newLink = async () => {
    if (!share?.token) return;
    if (!(await confirm('Make a new link?', 'The old link and QR code will stop working.', 'New link'))) return;
    try {
      await backend.unpublishPublic(share.token);
      const token = backend.newId();
      await backend.updateProject(project.id, { share: { enabled: true, token, showPrices: share.showPrices } });
      await publish(token, share.showPrices);
      toast('New link created');
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <Card>
      <H>Customer link</H>
      <Muted style={{ marginBottom: 6 }}>
        A web page for customers and brokers (no app needed) showing the layout with available plots. Buyer names and payments are never shown.
      </Muted>
      <Toggle label="Customer link on" value={on} onChange={enable} />
      {on ? (
        <>
          <Toggle
            label="Show prices on the customer page"
            value={!!share?.showPrices}
            onChange={(v) => backend.updateProject(project.id, { share: { ...share!, showPrices: v } }).then(() => toast(v ? 'Prices shown' : 'Prices hidden'))}
          />
          {backend.kind === 'local' ? <Banner tone="warn" text="Links work for other people only after the Firebase setup (SETUP.md)." /> : null}
          {url ? (
            <>
              <View style={styles.qr} accessibilityLabel="QR code of the customer link">
                <SvgXml xml={qrSvg(url)} width={180} height={180} />
              </View>
              <Text style={styles.url} selectable testID="share-url">
                {url}
              </Text>
              <Row style={{ flexWrap: 'wrap', marginTop: 8 }}>
                <Button
                  small
                  variant="secondary"
                  icon="copy-outline"
                  title="Copy"
                  onPress={async () => {
                    await Clipboard.setStringAsync(url);
                    toast('Link copied');
                  }}
                />
                <Button small variant="secondary" icon="share-social-outline" title="Share" onPress={() => Share.share({ message: `${project.name} — see available plots: ${url}` }).catch(() => undefined)} />
                <Button small variant="secondary" icon="open-outline" title="Open" onPress={() => Linking.openURL(url)} testID="open-share" />
                <Button small variant="ghost" icon="refresh" title="New link" onPress={newLink} />
              </Row>
              <Muted style={{ fontSize: 12, marginTop: 8 }}>The page is served by Firebase Hosting — see SETUP.md, step 2b, to publish it once.</Muted>
            </>
          ) : (
            <Banner tone="warn" text="Set EXPO_PUBLIC_SHARE_URL in .env (see SETUP.md) to get the link." />
          )}
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  qr: { alignSelf: 'center', padding: 10, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: C.border, marginTop: 8 },
  url: { textAlign: 'center', color: C.primary, fontSize: 13, marginTop: 8 },
});
