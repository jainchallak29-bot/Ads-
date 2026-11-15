// Browser versions of file picking/sharing (used when the app runs on the web).
import * as DocumentPicker from 'expo-document-picker';

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
  const res = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: false });
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  checkCadName(a.name);
  const text = a.file ? await a.file.text() : await (await fetch(a.uri)).text();
  if (!text.includes('SECTION')) throw new Error('This does not look like a text DXF file. Save it as "ASCII DXF" from your CAD program.');
  return { name: a.name, text };
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function shareTextFile(name: string, content: string, mimeType: string) {
  download(name, new Blob([content], { type: mimeType }));
}

export async function sharePdf(name: string, html: string) {
  // Browsers print HTML to PDF themselves ("Save as PDF" in the print dialog)
  const w = window.open('', '_blank');
  if (!w) {
    download(name.replace(/\.pdf$/, '.html'), new Blob([html], { type: 'text/html' }));
    return;
  }
  w.document.write(html);
  w.document.title = name;
  w.document.close();
  setTimeout(() => w.print(), 400);
}
