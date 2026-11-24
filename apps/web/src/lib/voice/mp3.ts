/**
 * Kokoro on Featherless returns a long line as one MP3 per sentence, joined
 * end to end. Each part starts with its own Xing header giving that part's
 * length, and some players (Safari, Apple's decoders) trust the first one and
 * stop after the first sentence. The stream is variable-bitrate, so players
 * need a header to know its length. This keeps one header at the start,
 * rewritten with the whole stream's frame count, size and seek table, and
 * drops the others (and any ID3 tags).
 */

const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG-1
  2: [22050, 24000, 16000], // MPEG-2
  0: [11025, 12000, 8000] // MPEG-2.5
};

/** Length in bytes of the Layer III frame starting at `i`, or 0 if no valid frame starts there. */
function frameLength(b: Uint8Array, i: number): number {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return 0;
  const version = (b[i + 1] >> 3) & 3;
  const layer = (b[i + 1] >> 1) & 3;
  const bitrateIndex = b[i + 2] >> 4;
  const rateIndex = (b[i + 2] >> 2) & 3;
  if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return 0;
  const bitrate = (version === 3 ? BITRATES_V1 : BITRATES_V2)[bitrateIndex];
  const sampleRate = SAMPLE_RATES[version][rateIndex];
  const padding = (b[i + 2] >> 1) & 1;
  return Math.floor(((version === 3 ? 144000 : 72000) * bitrate) / sampleRate) + padding;
}

/** Where the Xing/Info/VBRI tag starts in the frame at `start`, or -1 for an ordinary audio frame. */
function headerTagOffset(b: Uint8Array, start: number, length: number): number {
  const end = Math.min(start + length, start + 48);
  for (let i = start + 4; i + 4 <= end; i++) {
    const tag = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
    if (tag === 'Xing' || tag === 'Info' || tag === 'VBRI') return i - start;
  }
  return -1;
}

function writeUint32(b: Uint8Array, at: number, value: number): void {
  b[at] = (value >>> 24) & 0xff;
  b[at + 1] = (value >>> 16) & 0xff;
  b[at + 2] = (value >>> 8) & 0xff;
  b[at + 3] = value & 0xff;
}

/**
 * A Xing header for the whole stream, made from the first part's header: the
 * frame count, the byte count and a 100-entry seek table. Anything after them
 * (such as the LAME encoder details, whose checksum would no longer match) is cleared.
 */
function wholeStreamHeader(first: Uint8Array, tagAt: number, audio: Uint8Array[]): Uint8Array | null {
  const fieldsEnd = tagAt + 4 + 4 + 4 + 4 + 100;
  // A VBRI header sits elsewhere in the frame; without a usable Xing slot, send no header.
  if (fieldsEnd > first.length || String.fromCharCode(first[tagAt]) === 'V') return null;
  const header = new Uint8Array(first);
  header.set([0x58, 0x69, 0x6e, 0x67], tagAt); // "Xing": the stream is variable-bitrate
  header.fill(0, tagAt + 4);
  writeUint32(header, tagAt + 4, 0x7); // fields present: frames, bytes, seek table
  const total = header.length + audio.reduce((n, frame) => n + frame.length, 0);
  writeUint32(header, tagAt + 8, audio.length);
  writeUint32(header, tagAt + 12, total);
  const offsets: number[] = [];
  let at = header.length;
  for (const frame of audio) {
    offsets.push(at);
    at += frame.length;
  }
  for (let percent = 0; percent < 100; percent++) {
    const offset = offsets[Math.floor((percent * audio.length) / 100)] ?? total;
    header[tagAt + 16 + percent] = Math.min(255, Math.floor((256 * offset) / total));
  }
  return header;
}

/** Joins MP3 parts into one stream. Returns the input unchanged if it isn't MP3. */
export function joinMp3Segments(input: Uint8Array): Uint8Array {
  const audio: Uint8Array[] = [];
  let firstHeader: { frame: Uint8Array; tagAt: number } | null = null;
  let i = 0;
  while (i < input.length) {
    // ID3v2 tag: "ID3", version, flags, then a 4-byte size of 7 bits each.
    if (input[i] === 0x49 && input[i + 1] === 0x44 && input[i + 2] === 0x33 && i + 10 <= input.length) {
      const size = ((input[i + 6] & 0x7f) << 21) | ((input[i + 7] & 0x7f) << 14) | ((input[i + 8] & 0x7f) << 7) | (input[i + 9] & 0x7f);
      i += 10 + size;
      continue;
    }
    const length = frameLength(input, i);
    if (length === 0 || i + length > input.length) {
      i += 1; // not a frame here: look for the next one
      continue;
    }
    const tagAt = headerTagOffset(input, i, length);
    if (tagAt < 0) {
      audio.push(input.subarray(i, i + length));
    } else if (!firstHeader) {
      firstHeader = { frame: input.subarray(i, i + length), tagAt };
    }
    i += length;
  }
  if (audio.length === 0) return input;
  const header = firstHeader ? wholeStreamHeader(firstHeader.frame, firstHeader.tagAt, audio) : null;
  const parts = header ? [header, ...audio] : audio;
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
