// Uploaded media: type detection, metadata, and per-platform preparation
// (JPEG + allowed aspect ratio for Instagram, compatible MP4 for Reels).

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { newId } from './store.js';
import { MEDIA_RULES } from '../public/shared/rules.js';

const execFileP = promisify(execFile);

const IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'tiff', 'avif', 'heif']);
const FACEBOOK_PHOTO_FORMATS = new Set(['jpeg', 'png', 'gif']);
const FACEBOOK_PHOTO_MAX_BYTES = Math.floor(9.5 * 1024 * 1024); // Facebook allows 10 MB
const INSTAGRAM_PHOTO_MAX_BYTES = Math.floor(7.5 * 1024 * 1024); // Instagram allows 8 MB
const MIME = {
  jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', tiff: 'image/tiff',
  avif: 'image/avif', heif: 'image/heif', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  mkv: 'video/x-matroska', avi: 'video/x-msvideo',
};
const EXT = { jpeg: 'jpg', tiff: 'tif' };
const ID_RE = /^[a-f0-9]{32}$/;
// Files Instagram must be able to download (served without login at /media/<name>).
export const PUBLIC_FILE_RE = /^[a-f0-9]{32}\.ig(?:-r\d+)?\.jpg$/;

export class MediaError extends Error {}

function cleanName(name) {
  const base = String(name ?? 'file').replace(/[\\/]/g, '_').replace(/[\u0000-\u001f\u007f"<>|?*:]/g, '').trim();
  return (base || 'file').slice(0, 120);
}

function numberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseRate(rate) {
  const [a, b] = String(rate ?? '').split('/').map(Number);
  if (!a) return null;
  const r = b ? a / b : a;
  return Number.isFinite(r) && r > 0 ? Math.round(r * 100) / 100 : null;
}

async function readHead(file, length = 64) {
  const fh = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/** Recognise common video containers from their first bytes. */
export function detectVideoContainer(head) {
  if (head.length < 12) return null;
  const box = head.toString('latin1', 4, 8);
  if (box === 'ftyp') return head.toString('latin1', 8, 12) === 'qt  ' ? 'mov' : 'mp4';
  if (['moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(box)) return 'mov';
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    return head.toString('latin1').includes('webm') ? 'webm' : 'mkv';
  }
  if (head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'AVI ') return 'avi';
  return null;
}

/**
 * Returns true when the MP4/MOV "moov" box comes before the media data ("fast start"),
 * false when it comes after (Instagram rejects those), or null when it can't tell.
 */
export async function isFastStart(file) {
  const fh = await fs.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const buf = Buffer.alloc(16);
    let offset = 0;
    for (let i = 0; i < 1000 && offset + 8 <= size; i++) {
      const { bytesRead } = await fh.read(buf, 0, 16, offset);
      if (bytesRead < 8) break;
      let boxSize = buf.readUInt32BE(0);
      const type = buf.toString('latin1', 4, 8);
      if (boxSize === 1) {
        if (bytesRead < 16) break;
        boxSize = Number(buf.readBigUInt64BE(8));
      } else if (boxSize === 0) {
        boxSize = size - offset;
      }
      if (type === 'moov') return true;
      if (type === 'mdat') return false;
      if (boxSize < 8) break;
      offset += boxSize;
    }
    return null;
  } finally {
    await fh.close();
  }
}

async function toolWorks(cmd) {
  try {
    await execFileP(cmd, ['-version'], { timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

function runFfmpeg(ffmpegPath, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr = (stderr + d).slice(-4000);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new MediaError(`Video conversion failed (ffmpeg exit code ${code}). ${stderr.trim().split('\n').slice(-2).join(' ')}`));
    });
  });
}

/** What needs fixing before a video is safe to send to Instagram / Facebook Reels. */
export function videoAdjustments(rec) {
  const v = rec.video ?? {};
  const reasons = [];
  if (!['mp4', 'mov'].includes(rec.format)) reasons.push(`${rec.format.toUpperCase()} files are not accepted`);
  if (v.videoCodec && !['h264', 'hevc'].includes(v.videoCodec)) reasons.push(`video codec ${v.videoCodec} is not supported`);
  if (v.audioCodec && v.audioCodec !== 'aac') reasons.push(`audio codec ${v.audioCodec} is not supported`);
  if (v.fps && (v.fps < 23 || v.fps > 60)) reasons.push(`frame rate ${v.fps} fps is outside 23–60 fps`);
  if (rec.width > 1920) reasons.push(`width ${rec.width}px is above 1920px`);
  if (v.pixFmt && !['yuv420p', 'yuvj420p'].includes(v.pixFmt)) reasons.push(`pixel format ${v.pixFmt} is not supported`);
  if (v.bitRate && v.bitRate > 25_000_000) reasons.push('bitrate is above 25 Mbps');
  const transcode = reasons.length > 0;
  const remux = !transcode && rec.faststart === false;
  if (remux) reasons.push('the file is not "fast start" (index at the end)');
  return { transcode, remux, reasons };
}

export async function createMediaLibrary(config, { log = () => {} } = {}) {
  const dir = config.uploadsDir;
  await fs.mkdir(dir, { recursive: true });
  const [ffmpeg, ffprobe] = await Promise.all([toolWorks(config.ffmpegPath), toolWorks(config.ffprobePath)]);
  const tools = { ffmpeg, ffprobe };
  const records = new Map();
  const prepared = new Map();

  const recordPath = (id) => path.join(dir, `${id}.json`);
  const filePath = (rec) => path.join(dir, rec.file);

  async function save(rec) {
    records.set(rec.id, rec);
    await fs.writeFile(recordPath(rec.id), JSON.stringify(rec, null, 2));
  }

  async function get(id) {
    if (!ID_RE.test(String(id))) return null;
    if (records.has(id)) return records.get(id);
    try {
      const rec = JSON.parse(await fs.readFile(recordPath(id), 'utf8'));
      await fs.access(filePath(rec));
      records.set(id, rec);
      return rec;
    } catch {
      return null;
    }
  }

  async function probeVideo(file) {
    const { stdout } = await execFileP(
      config.ffprobePath,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
      { timeout: 60000, maxBuffer: 10 * 1024 * 1024 },
    );
    const info = JSON.parse(stdout);
    const streams = info.streams ?? [];
    const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
    const a = streams.find((s) => s.codec_type === 'audio');
    if (!v) throw new MediaError('This file has no video track.');
    let width = v.width;
    let height = v.height;
    const rotation = Number(v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? v.tags?.rotate ?? 0);
    if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
    return {
      width,
      height,
      duration: numberOrNull(info.format?.duration) ?? numberOrNull(v.duration),
      video: {
        videoCodec: v.codec_name ?? null,
        audioCodec: a?.codec_name ?? null,
        fps: parseRate(v.avg_frame_rate) ?? parseRate(v.r_frame_rate),
        pixFmt: v.pix_fmt ?? null,
        bitRate: numberOrNull(info.format?.bit_rate),
      },
    };
  }

  /**
   * Register an uploaded file. `tmpPath` is moved into the library.
   * @param {{width?: number, height?: number, duration?: number}} hints measurements made by the browser
   */
  async function ingest(tmpPath, originalName, hints = {}) {
    const id = newId(16);
    const stat = await fs.stat(tmpPath);
    let rec;
    try {
      let image = null;
      try {
        image = await sharp(tmpPath, { failOn: 'none' }).metadata();
      } catch {
        image = null;
      }
      if (image && IMAGE_FORMATS.has(image.format)) {
        if (image.format === 'heif') {
          // Make sure the photo can actually be decoded (HEIC from iPhones often can't be).
          await sharp(tmpPath).resize(16).toBuffer().catch(() => {
            throw new MediaError('HEIC/HEIF photos are not supported. Please convert the photo to JPEG first (on iPhone: Settings → Camera → Formats → Most Compatible).');
          });
        }
        const swap = (image.orientation ?? 1) >= 5;
        rec = {
          id,
          kind: 'image',
          format: image.format,
          width: swap ? image.height : image.width,
          height: swap ? image.width : image.height,
          animated: (image.pages ?? 1) > 1,
          duration: null,
        };
      } else {
        const container = detectVideoContainer(await readHead(tmpPath));
        if (!container) {
          throw new MediaError('Unsupported file. Upload a photo (JPG, PNG, WebP, GIF) or a video (MP4, MOV).');
        }
        rec = {
          id,
          kind: 'video',
          format: container,
          width: numberOrNull(hints.width),
          height: numberOrNull(hints.height),
          duration: numberOrNull(hints.duration),
          video: {},
        };
        if (tools.ffprobe) {
          try {
            Object.assign(rec, await probeVideo(tmpPath));
          } catch (err) {
            if (err instanceof MediaError) throw err;
            log(`ffprobe failed for ${originalName}: ${err.message}`);
          }
        }
        rec.faststart = ['mp4', 'mov'].includes(container) ? await isFastStart(tmpPath) : null;
      }
    } catch (err) {
      await fs.rm(tmpPath, { force: true });
      throw err;
    }

    rec.name = cleanName(originalName);
    rec.mime = MIME[rec.format] ?? 'application/octet-stream';
    rec.size = stat.size;
    rec.file = `${id}.${EXT[rec.format] ?? rec.format}`;
    rec.createdAt = new Date().toISOString();
    rec.notes = [];
    rec.warnings = [];
    if (rec.kind === 'video') {
      const adj = videoAdjustments(rec);
      if (adj.transcode || adj.remux) {
        if (tools.ffmpeg) {
          rec.notes.push(`Will be converted automatically for Instagram/Reels (${adj.reasons.join('; ')}).`);
        } else {
          rec.warnings.push(`Instagram may reject this video: ${adj.reasons.join('; ')}. Install ffmpeg so this app can fix it automatically, or export the video as MP4 (H.264 + AAC, "web optimized").`);
        }
      }
      if (!tools.ffprobe && !rec.duration) {
        rec.warnings.push('Could not read the video length. Length limits will be checked by Facebook/Instagram.');
      }
    }
    await fs.rename(tmpPath, path.join(dir, rec.file));
    await save(rec);
    return rec;
  }

  async function remove(id) {
    const rec = await get(id);
    if (!rec) return false;
    records.delete(id);
    const names = await fs.readdir(dir);
    await Promise.all(names.filter((n) => n.startsWith(`${id}.`)).map((n) => fs.rm(path.join(dir, n), { force: true })));
    return true;
  }

  function memo(key, fn) {
    if (!prepared.has(key)) {
      const p = fn().catch((err) => {
        prepared.delete(key);
        throw err;
      });
      prepared.set(key, p);
    }
    return prepared.get(key);
  }

  async function exists(p) {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }

  async function encodeJpeg(input, maxBytes) {
    let quality = 90;
    for (;;) {
      const buf = await sharp(input).flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer();
      if (buf.length <= maxBytes || quality <= 45) return buf;
      quality -= 10;
    }
  }

  const fileInfo = (rec, p, mime = rec.mime, name = rec.name) => ({ path: p, mime, name });

  /** Facebook accepts JPEG/PNG/GIF up to 10 MB; anything else is converted to JPEG. */
  function forFacebookPhoto(rec) {
    if (FACEBOOK_PHOTO_FORMATS.has(rec.format) && rec.size <= FACEBOOK_PHOTO_MAX_BYTES) {
      return Promise.resolve(fileInfo(rec, filePath(rec)));
    }
    return memo(`${rec.id}:fb`, async () => {
      const out = path.join(dir, `${rec.id}.fb.jpg`);
      if (!(await exists(out))) {
        let img = sharp(filePath(rec), { failOn: 'none' }).rotate();
        if (Math.max(rec.width, rec.height) > 4096) img = img.resize(4096, 4096, { fit: 'inside' });
        await fs.writeFile(out, await encodeJpeg(await img.toBuffer(), FACEBOOK_PHOTO_MAX_BYTES));
      }
      return fileInfo(rec, out, 'image/jpeg', rec.name.replace(/\.[^.]+$/, '') + '.jpg');
    });
  }

  /**
   * Instagram needs a JPEG (≤ 8 MB) between 4:5 and 1.91:1. Photos outside that range are padded
   * with a blurred copy of themselves instead of being cropped. In a carousel every photo is
   * padded to the first photo's shape, because Instagram crops all items to the first one.
   */
  function forInstagramPhoto(rec, { targetRatio } = {}) {
    const ratioKey = targetRatio ? `-r${Math.round(targetRatio * 1000)}` : '';
    return memo(`${rec.id}:ig${ratioKey}`, async () => {
      const out = path.join(dir, `${rec.id}.ig${ratioKey}.jpg`);
      if (await exists(out)) return { ...fileInfo(rec, out, 'image/jpeg'), fileName: path.basename(out) };
      const { data: oriented, info } = await sharp(filePath(rec), { failOn: 'none' })
        .rotate()
        .flatten({ background: '#ffffff' })
        .toBuffer({ resolveWithObject: true });
      const { minRatio, maxRatio } = MEDIA_RULES.instagramImage;
      const ratio = info.width / info.height;
      const desired = Math.min(maxRatio, Math.max(minRatio, targetRatio ?? ratio));
      let canvasW = info.width;
      let canvasH = info.height;
      if (Math.abs(desired - ratio) > 0.005) {
        if (desired > ratio) canvasW = Math.round(info.height * desired);
        else canvasH = Math.round(info.width / desired);
      }
      // Instagram stores photos 320–1440 px wide.
      const scale = canvasW > 1440 ? 1440 / canvasW : canvasW < 320 ? 320 / canvasW : 1;
      const outW = Math.max(1, Math.round(canvasW * scale));
      const outH = Math.max(1, Math.round(canvasH * scale));
      const fgW = Math.min(outW, Math.max(1, Math.round(info.width * scale)));
      const fgH = Math.min(outH, Math.max(1, Math.round(info.height * scale)));
      const fg = await sharp(oriented).resize(fgW, fgH, { fit: 'fill' }).toBuffer();
      let composed = fg;
      if (fgW !== outW || fgH !== outH) {
        const small = await sharp(oriented)
          .resize(Math.max(1, Math.round(outW / 12)), Math.max(1, Math.round(outH / 12)), { fit: 'cover' })
          .blur(2)
          .toBuffer();
        const background = await sharp(small).resize(outW, outH, { fit: 'fill' }).modulate({ brightness: 0.85 }).toBuffer();
        composed = await sharp(background).composite([{ input: fg, gravity: 'centre' }]).toBuffer();
      }
      await fs.writeFile(out, await encodeJpeg(composed, INSTAGRAM_PHOTO_MAX_BYTES));
      return { ...fileInfo(rec, out, 'image/jpeg'), fileName: path.basename(out) };
    });
  }

  /** Video ready for Reels/Instagram: converted with ffmpeg only when needed (and possible). */
  function forVideo(rec) {
    const adj = videoAdjustments(rec);
    if ((!adj.transcode && !adj.remux) || !tools.ffmpeg) return Promise.resolve(fileInfo(rec, filePath(rec)));
    return memo(`${rec.id}:video`, async () => {
      const out = path.join(dir, `${rec.id}.prepared.mp4`);
      if (!(await exists(out))) {
        const tmp = `${out}.part.mp4`;
        const input = ['-y', '-hide_banner', '-loglevel', 'error', '-i', filePath(rec), '-map', '0:v:0', '-map', '0:a:0?'];
        let args;
        if (adj.transcode) {
          const fps = Math.min(60, Math.max(24, Math.round(rec.video?.fps || 30)));
          args = [
            ...input,
            '-vf', "scale='min(1920,iw)':'min(1920,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1",
            '-r', String(fps),
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
            '-g', String(fps * 2),
            '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
            '-movflags', '+faststart', tmp,
          ];
        } else {
          args = [...input, '-c', 'copy', ...(rec.video?.videoCodec === 'hevc' ? ['-tag:v', 'hvc1'] : []), '-movflags', '+faststart', tmp];
        }
        log(`Converting video ${rec.name} (${adj.reasons.join('; ')})`);
        try {
          await runFfmpeg(config.ffmpegPath, args, 60 * 60 * 1000);
          await fs.rename(tmp, out);
        } catch (err) {
          await fs.rm(tmp, { force: true });
          throw err;
        }
      }
      return fileInfo(rec, out, 'video/mp4', rec.name.replace(/\.[^.]+$/, '') + '.mp4');
    });
  }

  /** Delete uploads older than MEDIA_RETENTION_DAYS (and abandoned partial uploads). */
  async function cleanup() {
    const now = Date.now();
    const maxAge = config.mediaRetentionDays * 24 * 3600 * 1000;
    let removed = 0;
    for (const name of await fs.readdir(dir)) {
      const p = path.join(dir, name);
      try {
        const st = await fs.stat(p);
        const limit = name.startsWith('upload-') || name.endsWith('.part.mp4') ? 24 * 3600 * 1000 : maxAge;
        if (st.isFile() && now - st.mtimeMs > limit) {
          await fs.rm(p, { force: true });
          const id = name.split('.')[0];
          records.delete(id);
          removed += 1;
        }
      } catch {
        // File vanished meanwhile; ignore.
      }
    }
    return removed;
  }

  return { dir, tools, ingest, get, remove, filePath, forFacebookPhoto, forInstagramPhoto, forVideo, cleanup };
}

/** Public, client-safe view of a media record. */
export function publicMedia(rec) {
  return {
    id: rec.id,
    kind: rec.kind,
    name: rec.name,
    format: rec.format,
    mime: rec.mime,
    size: rec.size,
    width: rec.width,
    height: rec.height,
    duration: rec.duration,
    animated: Boolean(rec.animated),
    notes: rec.notes ?? [],
    warnings: rec.warnings ?? [],
    url: `/api/media/${rec.id}/file`,
  };
}
