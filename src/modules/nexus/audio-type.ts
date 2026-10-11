export const AUDIO_MIME_TYPES = ['audio/webm', 'audio/ogg', 'audio/wav', 'audio/mpeg', 'audio/mp4'] as const;
export type AudioMimeType = (typeof AUDIO_MIME_TYPES)[number];

/** Voice commands are short clips; ~5 MB is several minutes of Opus audio. */
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

export const AUDIO_EXTENSIONS: Record<AudioMimeType, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
};

/** Detects the audio container from the file signature, ignoring the client-declared Content-Type. */
export function detectAudioMimeType(data: Buffer): AudioMimeType | null {
  if (data.length < 12) {
    return null;
  }
  if (data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) {
    return 'audio/webm';
  }
  if (data.toString('ascii', 0, 4) === 'OggS') {
    return 'audio/ogg';
  }
  if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WAVE') {
    return 'audio/wav';
  }
  if (data.toString('ascii', 0, 3) === 'ID3' || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0)) {
    return 'audio/mpeg';
  }
  if (data.toString('ascii', 4, 8) === 'ftyp') {
    return 'audio/mp4';
  }
  return null;
}
