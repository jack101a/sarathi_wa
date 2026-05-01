const { execSync } = require('child_process');
const path = require('path');

function getStorePath() {
  return path.resolve(__dirname, '../../data/authorized_entities.db');
}

function normalizeWaUser(id) {
  if (!id) return '';
  return String(id).trim().replace(/\D/g, '');
}

function normalizeWaGroup(id) {
  if (!id) return '';
  id = String(id).trim();
  if (id.endsWith('@g.us')) {
    return id;
  }
  return id + '@g.us';
}

function normalizeTgId(id) {
  if (!id) return '';
  return String(id).trim().match(/^-?\d+/) ? String(id).trim().match(/^-?\d+/)[0] : '';
}

function dedupe(arr) {
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.filter(Boolean))];
}

function normalizeStore(data) {
  const base = {
    version: 1,
    whatsapp: {
      users: [],
      groups: [],
      admins: []
    },
    telegram: {
      users: [],
      groups: [],
      admins: []
    },
    updatedAt: new Date().toISOString()
  };

  if (!data || typeof data !== 'object') {
    return base;
  }

  if (data.whatsapp && typeof data.whatsapp === 'object') {
    if (Array.isArray(data.whatsapp.users)) {
      base.whatsapp.users = dedupe(data.whatsapp.users.map(normalizeWaUser));
    }
    if (Array.isArray(data.whatsapp.groups)) {
      base.whatsapp.groups = dedupe(data.whatsapp.groups.map(normalizeWaGroup));
    }
    if (Array.isArray(data.whatsapp.admins)) {
      base.whatsapp.admins = dedupe(data.whatsapp.admins.map(normalizeWaUser));
    }
  }

  if (data.telegram && typeof data.telegram === 'object') {
    if (Array.isArray(data.telegram.users)) {
      base.telegram.users = dedupe(data.telegram.users.map(normalizeTgId));
    }
    if (Array.isArray(data.telegram.groups)) {
      base.telegram.groups = dedupe(data.telegram.groups.map(normalizeTgId));
    }
    if (Array.isArray(data.telegram.admins)) {
      base.telegram.admins = dedupe(data.telegram.admins.map(normalizeTgId));
    }
  }

  return base;
}

function readStore() {
  try {
    const helperPath = path.resolve(__dirname, 'sqliteHelper.js');
    const result = execSync(`node "${helperPath}" read`, { encoding: 'utf8' });
    const rows = JSON.parse(result.trim() || '[]');
    
    const base = normalizeStore(null);
    rows.forEach(r => {
      if (r.channel === 'wa') {
        if (r.type === 'user') base.whatsapp.users.push(r.value);
        if (r.type === 'group') base.whatsapp.groups.push(r.value);
        if (r.type === 'admin') base.whatsapp.admins.push(r.value);
      } else if (r.channel === 'tg') {
        if (r.type === 'user') base.telegram.users.push(r.value);
        if (r.type === 'group') base.telegram.groups.push(r.value);
        if (r.type === 'admin') base.telegram.admins.push(r.value);
      }
    });

    return normalizeStore(base);
  } catch (error) {
    return normalizeStore(null);
  }
}

function writeStore(data) {
  try {
    const safeData = normalizeStore(data);
    const helperPath = path.resolve(__dirname, 'sqliteHelper.js');
    execSync(`node "${helperPath}" write`, {
      input: JSON.stringify(safeData),
      encoding: 'utf8'
    });
    return safeData;
  } catch (error) {
    return normalizeStore(data);
  }
}

module.exports = {
  getStorePath,
  normalizeStore,
  readStore,
  writeStore
};
