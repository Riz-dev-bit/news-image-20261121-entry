import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as zlib from 'node:zlib';
import * as crypto from 'node:crypto';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_FILE_SIZE = 1_048_576; // 1 MB (1024 * 1024 bytes)
const REQUIRED_WIDTH = 1024;
const REQUIRED_HEIGHT = 1024;

function main(): void {
  const entryPath = fileURLToPath(new URL('./entry.png', import.meta.url));

  if (!fs.existsSync(entryPath)) {
    throw new Error(`entry.png not found at resolved path: ${entryPath}`);
  }

  const stat = fs.statSync(entryPath);
  if (stat.size > MAX_FILE_SIZE) {
    throw new Error(`entry.png size (${stat.size} bytes) exceeds maximum allowed size of ${MAX_FILE_SIZE} bytes`);
  }

  const buffer = fs.readFileSync(entryPath);
  if (buffer.length < 24) {
    throw new Error(`entry.png buffer length (${buffer.length}) is too short to contain valid PNG header`);
  }

  const signature = buffer.subarray(0, 8);
  if (!signature.equals(PNG_SIGNATURE)) {
    throw new Error('entry.png does not have a valid PNG signature');
  }

  let offset = 8;
  let chunkCount = 0;
  let sawIEND = false;
  let width = 0;
  let height = 0;

  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) {
      throw new Error(`Incomplete chunk header at offset ${offset}`);
    }

    const chunkLength = buffer.readUInt32BE(offset);
    const chunkType = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    const crcOffset = dataEnd;

    if (crcOffset + 4 > buffer.length) {
      throw new Error(`Truncated chunk ${chunkType} at offset ${offset}`);
    }

    // Verify CRC32 checksum (calculated over chunk type and chunk data)
    const chunkTypeAndData = buffer.subarray(offset + 4, dataEnd);
    const expectedCrc = buffer.readUInt32BE(crcOffset);
    const actualCrc = zlib.crc32(chunkTypeAndData);

    if (expectedCrc !== actualCrc) {
      throw new Error(
        `CRC32 mismatch in chunk ${chunkType} at offset ${offset}: expected ${expectedCrc}, got ${actualCrc}`
      );
    }

    if (offset === 8) {
      if (chunkType !== 'IHDR') {
        throw new Error(`Expected first chunk to be IHDR, got: ${chunkType}`);
      }
      if (chunkLength !== 13) {
        throw new Error(`IHDR chunk data length must be 13, got ${chunkLength}`);
      }
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);

      if (width !== REQUIRED_WIDTH || height !== REQUIRED_HEIGHT) {
        throw new Error(`entry.png dimensions (${width}x${height}) must be exactly ${REQUIRED_WIDTH}x${REQUIRED_HEIGHT}`);
      }
    }

    chunkCount++;
    offset = crcOffset + 4;

    if (chunkType === 'IEND') {
      sawIEND = true;
      if (offset !== buffer.length) {
        throw new Error(
          `IEND chunk is not at the exact end of entry.png: ended at offset ${offset}, file length is ${buffer.length}`
        );
      }
      break;
    }
  }

  if (!sawIEND) {
    throw new Error('entry.png is missing the required IEND trailer chunk');
  }

  const outputDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
  fs.mkdirSync(outputDir, { recursive: true });

  const destPath = path.join(outputDir, 'entry.png');
  fs.copyFileSync(entryPath, destPath);

  // Compute SHA-256 digest of the exported file
  const exportedBuffer = fs.readFileSync(destPath);
  const sha256 = crypto.createHash('sha256').update(exportedBuffer).digest('hex');

  console.log(`Verified ${chunkCount} PNG chunks with valid CRC32 checksums.`);
  console.log(`Confirmed IEND trailer chunk at exact end of entry.png.`);
  console.log(`Verified entry.png (${width}x${height}, ${stat.size} bytes). Successfully copied to ${destPath}`);
  console.log(`SHA-256 digest: ${sha256}`);
}

main();
