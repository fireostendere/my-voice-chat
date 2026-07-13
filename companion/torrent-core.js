'use strict';

const VIDEO_FILE_RE = /\.(mp4|m4v|webm|ogv|ogg|mov|mkv)$/i;
const MAX_TORRENT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_MAGNET_LENGTH = 32 * 1024;

function isMagnetUri(value) {
  return typeof value === 'string' && /^magnet:\?[^\s]*xt=urn:bt(?:ih|mh):/i.test(value.trim());
}

function selectLargestVideoFile(files) {
  return (
    files
      .map((file, index) => ({ file, index }))
      .filter(({ file }) => VIDEO_FILE_RE.test(file.name))
      .sort((left, right) => right.file.length - left.file.length)[0] ?? null
  );
}

function parseTorrentInput(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('No magnet link or .torrent file was provided.');
  }
  if (input.kind === 'magnet') {
    if (!isMagnetUri(input.magnet) || input.magnet.length > MAX_MAGNET_LENGTH) {
      throw new Error('Invalid magnet link.');
    }
    return input.magnet.trim();
  }
  if (input.kind === 'torrent-file') {
    if (typeof input.base64 !== 'string' || input.base64.length === 0) {
      throw new Error('The .torrent file is empty.');
    }
    const bytes = Buffer.from(input.base64, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_TORRENT_FILE_BYTES) {
      throw new Error('The .torrent file exceeds the 2 MB limit.');
    }
    return bytes;
  }
  throw new Error('Unknown torrent source format.');
}

module.exports = {
  MAX_TORRENT_FILE_BYTES,
  isMagnetUri,
  parseTorrentInput,
  selectLargestVideoFile,
};
