const starts = (buffer, bytes, offset = 0) => bytes.every((value, index) => buffer[offset + index] === value);
const ascii = (buffer, start, length) => buffer.subarray(start, start + length).toString('ascii');

export function detectMediaContainer(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer || []);
  if (buffer.length < 4) return null;
  if (starts(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return buffer.includes(Buffer.from('acTL')) ? 'apng' : 'png';
  }
  if (starts(buffer, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (ascii(buffer, 0, 6) === 'GIF87a' || ascii(buffer, 0, 6) === 'GIF89a') return 'gif';
  if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 4) === 'WEBP') return 'webp';
  if (starts(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return 'webm';
  if (ascii(buffer, 0, 4) === 'OggS') return 'ogg';
  if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 4) === 'WAVE') return 'wav';
  if (buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0) return 'aac';
  if (ascii(buffer, 0, 3) === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) return 'mp3';
  if (ascii(buffer, 4, 4) === 'ftyp') {
    const brands = ascii(buffer, 8, Math.min(64, Math.max(0, buffer.length - 8)));
    if (/avif|avis/.test(brands)) return 'avif';
    return 'mp4';
  }
  return null;
}

const EXPECTED = {
  'image/png': ['png', 'apng'],
  'image/apng': ['apng'],
  'image/jpeg': ['jpeg'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
  'image/avif': ['avif'],
  'video/mp4': ['mp4'],
  'audio/mp4': ['mp4'],
  'audio/x-m4a': ['mp4'],
  'video/webm': ['webm'],
  'audio/webm': ['webm'],
  'video/ogg': ['ogg'],
  'audio/ogg': ['ogg'],
  'audio/mpeg': ['mp3'],
  'audio/mp3': ['mp3'],
  'audio/wav': ['wav'],
  'audio/x-wav': ['wav'],
  'audio/aac': ['aac'],
};

export function mediaMimeMatches(buffer, claimedMime) {
  const expected = EXPECTED[String(claimedMime || '').toLowerCase()];
  return !!expected?.includes(detectMediaContainer(buffer));
}

export function audioMimeMatches(buffer, claimedMime) {
  const mime = String(claimedMime || '').toLowerCase();
  return mime.startsWith('audio/') && mediaMimeMatches(buffer, mime);
}
