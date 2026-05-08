const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const LOCK_PATTERNS = [
  /^Singleton/i,
  /^LOCK$/i,
  /\.lock$/i,
];

const SAFE_CACHE_DIR_NAMES = new Set([
  'cache',
  'code cache',
  'gpucache',
  'grshadercache',
  'dawncache',
  'dawngraphitecache',
  'shadercache',
  'service worker',
  'blob_storage',
  'crashpad',
  'component_crx_cache',
  'extensions_crx_cache',
]);

function shouldDeleteLockFile(fileName) {
  return LOCK_PATTERNS.some((pattern) => pattern.test(String(fileName || '').trim()));
}

function walkFiles(rootDir, collected = []) {
  if (!rootDir || !fs.existsSync(rootDir)) {
    return collected;
  }

  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, collected);
      continue;
    }

    collected.push(fullPath);
  }

  return collected;
}

function cleanupWhatsAppAuthLocks(authDir = path.join(process.cwd(), '.wwebjs_auth')) {
  const files = walkFiles(authDir);
  const deleted = [];
  let busyCount = 0;

  for (const filePath of files) {
    if (!shouldDeleteLockFile(path.basename(filePath))) {
      continue;
    }

    try {
      fs.rmSync(filePath, { force: true });
      deleted.push(filePath);
    } catch (error) {
      if (error && (error.code === 'EBUSY' || error.code === 'EPERM')) {
        busyCount += 1;
        continue;
      }
      console.warn(`[startup] Failed to delete lock file ${filePath}: ${error.message}`);
    }
  }

  return { deleted, busyCount };
}

function walkDirectories(rootDir, collected = []) {
  if (!rootDir || !fs.existsSync(rootDir)) {
    return collected;
  }

  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const fullPath = path.join(rootDir, entry.name);
    collected.push(fullPath);
    walkDirectories(fullPath, collected);
  }

  return collected;
}

function shouldDeleteCacheDirectory(dirPath) {
  const name = String(path.basename(dirPath) || '').trim().toLowerCase();
  if (!SAFE_CACHE_DIR_NAMES.has(name)) {
    return false;
  }

  // Never remove session identity roots; only ephemeral cache folders.
  const normalized = dirPath.replace(/\\/g, '/').toLowerCase();
  if (normalized.endsWith('/default') || normalized.includes('/local storage')) {
    return false;
  }

  return true;
}

function cleanupWhatsAppRuntimeCache(authDir = path.join(process.cwd(), '.wwebjs_auth'), cacheDir = path.join(process.cwd(), '.wwebjs_cache')) {
  const deleted = [];
  let busyCount = 0;

  const authDirs = walkDirectories(authDir);
  for (const dirPath of authDirs.sort((a, b) => b.length - a.length)) {
    if (!shouldDeleteCacheDirectory(dirPath)) {
      continue;
    }
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      deleted.push(dirPath);
    } catch (error) {
      if (error && (error.code === 'EBUSY' || error.code === 'EPERM')) {
        busyCount += 1;
        continue;
      }
      console.warn(`[startup] Failed to delete cache directory ${dirPath}: ${error.message}`);
    }
  }

  if (cacheDir && fs.existsSync(cacheDir)) {
    try {
      fs.rmSync(cacheDir, { recursive: true, force: true });
      deleted.push(cacheDir);
    } catch (error) {
      if (error && (error.code === 'EBUSY' || error.code === 'EPERM')) {
        busyCount += 1;
      } else {
        console.warn(`[startup] Failed to delete cache directory ${cacheDir}: ${error.message}`);
      }
    }
  }

  return { deleted, busyCount };
}

function releaseStaleWhatsAppProfileLocks(authDir = path.join(process.cwd(), '.wwebjs_auth')) {
  const result = { attempted: false, killed: 0 };
  try {
    if (process.platform !== 'win32') {
      return result;
    }

    const escapedAuthDir = String(authDir).replace(/'/g, "''");
    const script = [
      `$auth='${escapedAuthDir}'`,
      `$candidates = Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' OR Name='msedge.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains($auth.ToLower()) }`,
      `$killed=0`,
      `foreach($p in $candidates){`,
      `  try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; $killed++ } catch {}`,
      `}`,
      `Write-Output $killed`,
    ].join(';');

    const output = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    result.attempted = true;
    result.killed = Number(output || 0) || 0;
    return result;
  } catch (_) {
    return result;
  }
}

module.exports = {
  cleanupWhatsAppAuthLocks,
  cleanupWhatsAppRuntimeCache,
  releaseStaleWhatsAppProfileLocks,
};
