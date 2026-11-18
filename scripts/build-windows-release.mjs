import { execSync } from 'child_process';
import { build as esbuild } from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const pkgJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf-8'));
const VERSION = pkgJson.version || '1.0.0';

const RELEASE_ROOT = path.join(ROOT_DIR, 'release');
const STAGE_DIR = path.join(RELEASE_ROOT, 'LedgerPulse-Windows');
const ZIP_FILENAME = `LedgerPulse-Windows-v${VERSION}.zip`;
const ZIP_OUTPUT_PATH = path.join(RELEASE_ROOT, ZIP_FILENAME);

/**
 * Generates a valid Windows .ico file wrapping a PNG icon payload (Windows Vista/7/10/11).
 */
function createWindowsIcoFromPng(pngPath, icoOutputPath) {
  const pngBuf = fs.readFileSync(pngPath);
  // Read PNG IHDR width & height (bytes 16..23)
  const width = pngBuf.readUInt32BE(16);
  const height = pngBuf.readUInt32BE(20);

  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); // Reserved = 0
  header.writeUInt16LE(1, 2); // Type = 1 (ICO)
  header.writeUInt16LE(1, 4); // Image count = 1

  header.writeUInt8(width >= 256 ? 0 : width, 6); // Width
  header.writeUInt8(height >= 256 ? 0 : height, 7); // Height
  header.writeUInt8(0, 8); // Color palette = 0
  header.writeUInt8(0, 9); // Reserved = 0
  header.writeUInt16LE(1, 10); // Color planes = 1
  header.writeUInt16LE(32, 12); // Bits per pixel = 32
  header.writeUInt32LE(pngBuf.length, 14); // Image byte size
  header.writeUInt32LE(22, 18); // Offset to image data (6 + 16 = 22)

  fs.writeFileSync(icoOutputPath, Buffer.concat([header, pngBuf]));
}

/**
 * Standard CRC-32 lookup table for PKZIP archive generation (zero external dependencies).
 */
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function collectFilesRecursive(baseDir, currentRel = '') {
  const entries = fs.readdirSync(path.join(baseDir, currentRel), { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const relPath = currentRel ? `${currentRel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...collectFilesRecursive(baseDir, relPath));
    } else if (entry.isFile()) {
      results.push(relPath);
    }
  }
  return results;
}

/**
 * Builds a standard DEFLATE PKZIP file natively readable by Windows Explorer "Extract All".
 */
function createZipFromDirectory(sourceDir, rootFolderInZip, outZipPath) {
  const relFiles = collectFilesRecursive(sourceDir);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((now.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((now.getFullYear() - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f);

  for (const rel of relFiles) {
    const fullPath = path.join(sourceDir, rel);
    const rawData = fs.readFileSync(fullPath);
    const zipEntryName = `${rootFolderInZip}/${rel.replace(/\\/g, '/')}`;
    const nameBuf = Buffer.from(zipEntryName, 'utf-8');
    const uncompressedCrc = crc32(rawData);
    const deflated = zlib.deflateRawSync(rawData, { level: 9 });

    const useDeflate = deflated.length < rawData.length;
    const payload = useDeflate ? deflated : rawData;
    const method = useDeflate ? 8 : 0;

    // Local file header (30 bytes + filename)
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // Version needed: 2.0
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(uncompressedCrc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(rawData.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);

    // Central directory header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // Version made by
    centralHeader.writeUInt16LE(20, 6); // Version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(uncompressedCrc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(rawData.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // Extra len
    centralHeader.writeUInt16LE(0, 32); // Comment len
    centralHeader.writeUInt16LE(0, 34); // Disk start
    centralHeader.writeUInt16LE(0, 36); // Internal attrs
    centralHeader.writeUInt32LE(0, 38); // External attrs
    centralHeader.writeUInt32LE(offset, 42); // Local header offset
    nameBuf.copy(centralHeader, 46);

    localParts.push(localHeader, payload);
    centralParts.push(centralHeader);
    offset += localHeader.length + payload.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(relFiles.length, 8);
  eocd.writeUInt16LE(relFiles.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.writeFileSync(outZipPath, Buffer.concat([...localParts, centralDirBuf, eocd]));
}

function writeWindowsTextFile(destPath, content) {
  const crlf = content.replace(/\r?\n/g, '\r\n');
  fs.writeFileSync(destPath, crlf, 'utf-8');
}

async function main() {
  console.log(`[1/5] Generating Windows application icon (public/ledgerpulse.ico)...`);
  const pngIconPath = path.join(ROOT_DIR, 'public', 'pwa-192x192.png');
  const icoPath = path.join(ROOT_DIR, 'public', 'ledgerpulse.ico');
  createWindowsIcoFromPng(pngIconPath, icoPath);

  console.log(`[2/5] Building production client & PWA assets (vite build)...`);
  execSync('npm run build', { cwd: ROOT_DIR, stdio: 'inherit' });

  console.log(`[3/5] Preparing clean Windows release directory...`);
  fs.rmSync(RELEASE_ROOT, { recursive: true, force: true });
  fs.mkdirSync(path.join(STAGE_DIR, 'data', 'inbox'), { recursive: true });

  console.log(`[4/5] Bundling standalone zero-dependency Windows server (server.cjs)...`);
  await esbuild({
    entryPoints: [path.join(ROOT_DIR, 'server.ts')],
    outfile: path.join(STAGE_DIR, 'server.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['vite'],
    define: {
      'import.meta.url': 'importMetaUrl',
    },
    banner: {
      js: "const importMetaUrl = require('url').pathToFileURL(__filename).href;",
    },
    logLevel: 'info',
  });

  // Copy compiled frontend dist/
  fs.cpSync(path.join(ROOT_DIR, 'dist'), path.join(STAGE_DIR, 'dist'), {
    recursive: true,
    force: true,
  });

  // Copy icon & Windows launchers with CRLF line endings
  fs.copyFileSync(icoPath, path.join(STAGE_DIR, 'ledgerpulse.ico'));

  const vbsSrc = fs.readFileSync(path.join(ROOT_DIR, 'windows', 'LedgerPulse.vbs'), 'utf-8');
  writeWindowsTextFile(path.join(STAGE_DIR, 'LedgerPulse.vbs'), vbsSrc);

  const installSrc = fs.readFileSync(
    path.join(ROOT_DIR, 'windows', 'Install-Windows-App.bat'),
    'utf-8'
  );
  writeWindowsTextFile(path.join(STAGE_DIR, 'Install-Windows-App.bat'), installSrc);

  const startSrc = fs.readFileSync(path.join(ROOT_DIR, 'start-windows-app.bat'), 'utf-8');
  writeWindowsTextFile(path.join(STAGE_DIR, 'Start-LedgerPulse.bat'), startSrc);

  const stopSrc = fs.readFileSync(
    path.join(ROOT_DIR, 'windows', 'Stop-LedgerPulse-Server.bat'),
    'utf-8'
  );
  writeWindowsTextFile(path.join(STAGE_DIR, 'Stop-LedgerPulse-Server.bat'), stopSrc);

  if (fs.existsSync(path.join(ROOT_DIR, '.env.example'))) {
    const envEx = fs.readFileSync(path.join(ROOT_DIR, '.env.example'), 'utf-8');
    writeWindowsTextFile(path.join(STAGE_DIR, '.env.example'), envEx);
  }

  writeWindowsTextFile(
    path.join(STAGE_DIR, 'WINDOWS-QUICKSTART.txt'),
    [
      `LedgerPulse for Windows v${VERSION}`,
      `Repository: https://github.com/MakawanP/LedgerPulse`,
      `====================================================================`,
      ``,
      `HOW TO INSTALL & LAUNCH ON WINDOWS 10 / 11:`,
      ``,
      `1. Extract this entire ZIP folder anywhere on your PC (e.g. Documents\\LedgerPulse).`,
      `2. Double-click "Install-Windows-App.bat":`,
      `   - Creates Desktop & Start Menu shortcuts with the LedgerPulse icon.`,
      `   - Launches LedgerPulse silently in a dedicated Windows desktop window`,
      `     (zero command-prompt console window).`,
      ``,
      `ALTERNATIVE LAUNCHERS:`,
      `- "LedgerPulse.vbs"          : Silent desktop window launcher`,
      `- "Start-LedgerPulse.bat"    : Console launcher (shows server port logs)`,
      `- "Stop-LedgerPulse-Server.bat" : Stops the background local server on port 3000`,
      ``,
      `NOTES:`,
      `- Standalone GitHub Release builds include runtime\\node.exe (no installs needed).`,
      `- Portable builds use Node.js 20+ (https://nodejs.org/) with zero npm install required.`,
      `- Local ledger vault is saved automatically at data\\local-ledger-vault.json.`,
      `- Sign in with Google inside the app to sync live across Phone & Windows PC.`,
      ``,
    ].join('\n')
  );

  console.log(`[5/5] Packaging ${ZIP_FILENAME} ...`);
  createZipFromDirectory(STAGE_DIR, 'LedgerPulse-Windows', ZIP_OUTPUT_PATH);

  const stats = fs.statSync(ZIP_OUTPUT_PATH);
  console.log(
    `Windows release ready: ${ZIP_OUTPUT_PATH} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`
  );
}

main().catch((err) => {
  console.error('Failed to build Windows release:', err);
  process.exit(1);
});
