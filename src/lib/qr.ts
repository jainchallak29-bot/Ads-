// QR codes as SVG strings (pure JS; used on screen via SvgXml and inside PDFs).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const QRCode = require('qrcode/lib/core/qrcode') as { create: (text: string, opts: object) => unknown };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const SvgTag = require('qrcode/lib/renderer/svg-tag') as { render: (qr: unknown, opts: object) => string };

export function qrSvg(text: string, margin = 1): string {
  return SvgTag.render(QRCode.create(text, { errorCorrectionLevel: 'M' }), { margin, color: { dark: '#000000ff', light: '#ffffffff' } });
}
