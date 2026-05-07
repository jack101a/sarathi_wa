const {
  checkTrackedApplications: refreshAllSarathiTrackedApplications,
  readTrackedApplications,
} = require('./autoTrackService');
const {
  readTrackedApplications: readSarathiStore,
  removeTrackedApplication,
} = require('./autoTrackStore');
const {
  readEntries: readVahanStore,
  writeEntries: writeVahanEntries,
} = require('./vahanTrackStore');
const {
  refreshTrackedApplications: refreshVahanTrackedApplications,
} = require('./vahanService');

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeBy(items, getKey) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const key = getKey(item);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(item);
  }

  return result;
}

function getAllTrackedItems() {
  const sarathiTracked = dedupeBy(
    readTrackedApplications(),
    (item) => normalizeText(item.appNo)
  );
  const vahanTracked = dedupeBy(
    readVahanStore(),
    (item) => normalizeText(item.applicationNumber)
  );

  return {
    sarathiTracked,
    vahanTracked,
  };
}

function hasTrackedItems() {
  const { sarathiTracked, vahanTracked } = getAllTrackedItems();
  return sarathiTracked.length > 0 || vahanTracked.length > 0;
}

function buildTrackedItemsMessage() {
  const { sarathiTracked, vahanTracked } = getAllTrackedItems();
  if (!sarathiTracked.length && !vahanTracked.length) {
    return 'No applications are being tracked.';
  }

  return [
    'Sarathi:',
    sarathiTracked.length
      ? sarathiTracked
          .map((item, index) => `${index + 1}. ${item.appNo}${item.tag ? ` - ${item.tag}` : ''}`)
          .join('\n')
      : 'None',
    '-----',
    'Vahan:',
    vahanTracked.length
      ? vahanTracked
          .map((item, index) => `${index + 1}. ${item.applicationNumber}${item.tag ? ` - ${item.tag}` : ''}`)
          .join('\n')
      : 'None',
  ].join('\n');
}

function isSarathiTrackedAnywhere(appNo) {
  const normalizedAppNo = normalizeText(appNo);
  return readTrackedApplications().some((item) => normalizeText(item.appNo) === normalizedAppNo);
}

function isVahanTrackedAnywhere(applicationNumber) {
  const normalizedApplicationNumber = normalizeText(applicationNumber);
  return readVahanStore().some(
    (item) => normalizeText(item.applicationNumber) === normalizedApplicationNumber
  );
}

function removeSarathiTrackEverywhere(appNo) {
  const normalizedAppNo = normalizeText(appNo);
  const existing = readSarathiStore();
  const toRemove = existing.filter((item) => normalizeText(item.appNo) === normalizedAppNo);

  for (const entry of toRemove) {
    removeTrackedApplication(entry);
  }

  return { removed: toRemove.length > 0 };
}

function removeVahanTrackEverywhere(applicationNumber) {
  const normalizedApplicationNumber = normalizeText(applicationNumber);
  const existing = readVahanStore();
  const next = existing.filter(
    (item) => normalizeText(item.applicationNumber) !== normalizedApplicationNumber
  );

  if (next.length === existing.length) {
    return { removed: false };
  }

  writeVahanEntries(next);
  return { removed: true };
}

async function refreshAllTrackedApplications() {
  await refreshAllSarathiTrackedApplications();

  const contexts = dedupeBy(
    readVahanStore().map((item) => ({
      chatId: normalizeText(item.chatId),
      transport: normalizeText(item.transport).toLowerCase() || 'whatsapp',
    })),
    (item) => `${item.transport}:${item.chatId}`
  );

  for (const context of contexts) {
    await refreshVahanTrackedApplications(context.chatId, context.transport);
  }
}

async function enforceTrackingLimit(chatId) {
  const { sarathiTracked, vahanTracked } = getAllTrackedItems();
  const userSarathi = sarathiTracked.filter((i) => normalizeText(i.chatId) === normalizeText(chatId));
  const userVahan = vahanTracked.filter((i) => normalizeText(i.chatId) === normalizeText(chatId));

  if (userSarathi.length + userVahan.length < 10) {
    return true;
  }

  const { deriveSarathiStatus, deriveVahanStatus } = require('./imageGeneratorService');
  const candidates = [];

  userSarathi.forEach((item) => {
    const stat = deriveSarathiStatus(item.lastSnapshot);
    candidates.push({
      type: 'sarathi',
      item,
      createdAtMs: Date.parse(item.createdAt || '') || 0,
      dispatched: stat.dispatched.includes('?'),
      approval: stat.approval.includes('?'),
    });
  });

  userVahan.forEach((item) => {
    const stat = deriveVahanStatus(item.lastSnapshot);
    candidates.push({
      type: 'vahan',
      item,
      createdAtMs: Date.parse(item.createdAt || '') || 0,
      dispatched: stat.dispatched.includes('?'),
      approval: stat.approval.includes('?'),
    });
  });

  const dispatchedCandidates = candidates.filter((c) => c.dispatched);
  const approvedCandidates = candidates.filter((c) => !c.dispatched && c.approval);

  let toEvict = null;
  if (dispatchedCandidates.length > 0) {
    toEvict = dispatchedCandidates.sort((a, b) => a.createdAtMs - b.createdAtMs)[0];
  } else if (approvedCandidates.length > 0) {
    toEvict = approvedCandidates.sort((a, b) => a.createdAtMs - b.createdAtMs)[0];
  }

  if (toEvict) {
    if (toEvict.type === 'sarathi') {
      removeSarathiTrackEverywhere(toEvict.item.appNo);
    } else {
      removeVahanTrackEverywhere(toEvict.item.applicationNumber);
    }
    return true;
  }

  return false;
}

module.exports = {
  buildTrackedItemsMessage,
  getAllTrackedItems,
  hasTrackedItems,
  isSarathiTrackedAnywhere,
  isVahanTrackedAnywhere,
  refreshAllTrackedApplications,
  removeSarathiTrackEverywhere,
  removeVahanTrackEverywhere,
  enforceTrackingLimit,
};
