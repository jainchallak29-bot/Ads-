import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Share } from 'react-native';

import { useApp } from '@/components/AppProvider';
import { SheetModal } from '@/components/SheetModal';
import { Button, Muted, Toggle } from '@/components/ui';
import { shareBaseUrl } from '@/lib/backend/config';
import { layoutPdfHtml, plotPdfHtml, plotShareText, reportHtml } from '@/lib/export/exporters';
import { sharePdf } from '@/lib/files';
import { makeGeo, mapsUrl } from '@/lib/geo';
import { boundsOf } from '@/lib/geometry';
import { shareUrl } from '@/lib/publicLayout';
import { qrSvg } from '@/lib/qr';
import { features } from '@/lib/status';
import type { LayoutData, Plot, Project } from '@/lib/types';

const fileBase = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'layout';

/** Share the whole layout (PDF / link) or one plot (text / PDF). */
export function ShareSheet({
  visible,
  onClose,
  project,
  plots,
  layout,
  plot,
}: {
  visible: boolean;
  onClose: () => void;
  project: Project;
  plots: Plot[];
  layout: LayoutData | null;
  plot?: Plot | null;
}) {
  const { toast } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [withPrice, setWithPrice] = useState(true);
  const linkOn = features(project).share && !!project.share?.enabled && !!project.share.token && !!shareBaseUrl();
  const link = linkOn ? shareUrl(shareBaseUrl(), project.share!.token, plot?.number) : '';
  const date = new Date().toISOString().slice(0, 10);
  const geo = project.geo && features(project).gps ? makeGeo(project.geo, project.drawingUnit) : null;
  const plotMaps = (() => {
    if (!geo || !plot) return undefined;
    const b = boundsOf(plot.polygon);
    const ll = geo.toLatLng({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
    return mapsUrl(ll.lat, ll.lng);
  })();

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (plot) {
    return (
      <SheetModal visible={visible} title={`Share plot ${plot.number}`} onClose={onClose}>
        <Toggle label="Include price" value={withPrice} onChange={setWithPrice} />
        <Button
          title="Send details (WhatsApp, SMS…)"
          icon="chatbubble-ellipses-outline"
          style={{ marginTop: 8 }}
          onPress={() => run('text', () => Share.share({ message: plotShareText(project, plot, { price: withPrice, url: link || undefined, mapsUrl: plotMaps }) }))}
          testID="share-plot-text"
        />
        <Button
          title="Send PDF with map"
          icon="document-outline"
          variant="secondary"
          style={{ marginTop: 8 }}
          loading={busy === 'pdf'}
          onPress={() => run('pdf', () => sharePdf(`${fileBase(project.name)}_Plot_${plot.number}.pdf`, plotPdfHtml(project, plot, plots, layout, { price: withPrice })))}
          testID="share-plot-pdf"
        />
        <Muted style={{ marginTop: 10, fontSize: 12.5 }}>Buyer names and payments are never included.</Muted>
      </SheetModal>
    );
  }

  const qr = link ? { svg: qrSvg(link), url: link } : undefined;
  return (
    <SheetModal visible={visible} title="Share layout" onClose={onClose}>
      <Button
        title="Layout PDF — all stages marked"
        icon="map-outline"
        loading={busy === 'team'}
        onPress={() => run('team', () => sharePdf(`${fileBase(project.name)}_layout_${date}.pdf`, layoutPdfHtml(project, plots, layout, 'team', qr)))}
        testID="share-layout-team"
      />
      <Button
        title="Layout PDF for customers (available only)"
        icon="people-outline"
        variant="secondary"
        style={{ marginTop: 8 }}
        loading={busy === 'customer'}
        onPress={() => run('customer', () => sharePdf(`${fileBase(project.name)}_available_${date}.pdf`, layoutPdfHtml(project, plots, layout, 'customer', qr)))}
        testID="share-layout-customer"
      />
      <Button
        title="Full report (map + list)"
        icon="document-text-outline"
        variant="secondary"
        style={{ marginTop: 8 }}
        loading={busy === 'report'}
        onPress={() => run('report', () => sharePdf(`${fileBase(project.name)}_report_${date}.pdf`, reportHtml(project, plots, layout)))}
      />
      {link ? (
        <Button
          title="Send customer link"
          icon="link-outline"
          variant="secondary"
          style={{ marginTop: 8 }}
          onPress={() =>
            run('link', async () => {
              await Clipboard.setStringAsync(link);
              await Share.share({ message: `${project.name} — see available plots: ${link}` });
            })
          }
        />
      ) : null}
    </SheetModal>
  );
}
