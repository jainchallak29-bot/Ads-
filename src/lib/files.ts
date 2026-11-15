// Picking the CAD file and sharing exports (phones). See files.web.ts for the browser.
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

export interface PickedFile {
  name: string;
  text: string;
}

export function checkCadName(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.dwg')) {
    throw new Error('DWG files cannot be opened directly. In AutoCAD use File → Save As → "AutoCAD DXF (*.dxf)", then pick the .dxf file.');
  }
  if (!lower.endsWith('.dxf')) throw new Error('Please choose a .dxf file (export it from your CAD program with Save As → DXF).');
}

export async function pickDxf(): Promise<PickedFile | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  checkCadName(a.name);
  const text = await new File(a.uri).text();
  if (!text.includes('SECTION')) throw new Error('This does not look like a text DXF file. Save it as "ASCII DXF" from your CAD program.');
  return { name: a.name, text };
}

function cacheFile(name: string): File {
  const f = new File(Paths.cache, name);
  if (f.exists) f.delete();
  f.create();
  return f;
}

export async function shareTextFile(name: string, content: string, mimeType: string) {
  const f = cacheFile(name);
  await f.write(content);
  await Sharing.shareAsync(f.uri, { mimeType, dialogTitle: name });
}

export async function sharePdf(name: string, html: string) {
  const { uri } = await Print.printToFileAsync({ html, width: 842, height: 595 });
  const dest = new File(Paths.cache, name);
  if (dest.exists) dest.delete();
  await new File(uri).copy(dest);
  await Sharing.shareAsync(dest.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: name });
}
