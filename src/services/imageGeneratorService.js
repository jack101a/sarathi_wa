const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { renderHTML } = require('../core/puppeteerEngine');
const { readTrackedApplications } = require('./autoTrackStore');
const { readEntries: readVahanStore } = require('./vahanTrackStore');

function todayDDMMYYYY() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

function extractDate(text) {
  const value = String(text || '');
  const m1 = value.match(/(\d{2})[-/](\d{2})[-/](\d{4})/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
  const m2 = value.match(/(\d{1,2})[\s-]([A-Za-z]{3,9})[\s-](\d{2,4})/);
  if (m2) {
    const mmMap = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
    const day = String(Number(m2[1])).padStart(2, '0');
    const month = String(mmMap[String(m2[2]).toLowerCase()] || '').padStart(2, '0');
    let year = String(m2[3]);
    if (year.length === 2) year = `20${year}`;
    if (month !== '00') return `${day}-${month}-${year}`;
  }
  return todayDDMMYYYY();
}

function fmtStatus(done, dateStr) {
  return done ? `${dateStr} \u2705` : `Pending`;
}

function isDispatchRcGenerated(value) {
  return String(value || '').toUpperCase().includes('DISPATCH RC GENERATED');
}

function parseSnapshot(snapshotStr) {
  try {
    return JSON.parse(snapshotStr || '{}');
  } catch (_) {
    return {};
  }
}

function deriveSarathiStatus(snapshotStr) {
  const details = parseSnapshot(snapshotStr);
  const text = [details.kind, details.stage, details.message, details.approvedAction, details.transaction]
    .map((v) => String(v || '').toUpperCase())
    .join(' ');
  const completed = Array.isArray(details.completedActions) ? details.completedActions : [];
  const findCompletedDate = (needle) => {
    const row = completed.find((item) => String(item.actionName || '').toUpperCase().includes(needle));
    return row ? extractDate(row.processedOn || '') : '';
  };

  const dispatchedDone = details.kind === 'dispatched' || text.includes('DISPATCH');
  const approvalDone = dispatchedDone || details.kind === 'approved' || text.includes('APPROVAL') || text.includes('CARD') || text.includes('PRINTING');
  const scrutinyDone = approvalDone || (!!details.stage && !String(details.stage).toUpperCase().includes('SCRUTINY'));
  const scrutinyDate = findCompletedDate('SCRUTINY') || extractDate(text);
  const approvalDate = findCompletedDate('APPROVAL') || extractDate(details.approvedOn || '') || (approvalDone ? scrutinyDate : '');
  const dispatchedDate = findCompletedDate('DISPATCH') || (dispatchedDone ? extractDate(text) : '');

  return {
    scrutiny: fmtStatus(scrutinyDone, scrutinyDate),
    approval: fmtStatus(approvalDone, approvalDate),
    dispatched: fmtStatus(dispatchedDone, dispatchedDate),
    details,
  };
}

function deriveVahanStatus(snapshotStr) {
  const details = parseSnapshot(snapshotStr);
  const rows = Array.isArray(details.rows) ? details.rows : [];
  const rowValues = rows.map((row) => {
    if (typeof row === 'string') return row;
    return `${row.transactionPurpose || ''} ${row.currentStatus || ''}`;
  });
  const rowsText = rowValues.join(' ').toUpperCase();
  const rcPrint = String(details.rcPrintOrSmartCardStatus || '').toUpperCase();
  const dispatch = String(details.dispatchRcStatus || '').toUpperCase();
  const merged = `${rowsText} ${rcPrint} ${dispatch}`;

  const dispatchedDone = isDispatchRcGenerated(dispatch);
  const approvalDone = dispatchedDone || rcPrint.includes('PRINTED') || merged.includes('APPROVED') || merged.includes('COMPLETED');
  const scrutinyDone = approvalDone || merged.includes('VERIFIED') || merged.includes('SUCCESS');
  const approvedRowDate = rows
    .filter((row) => {
      const text = typeof row === 'string' ? row : `${row.transactionPurpose || ''} ${row.currentStatus || ''}`;
      return /COMPLETED|APPROVED/i.test(text);
    })
    .map((row) => extractDate(typeof row === 'string' ? row : row.currentStatus || ''))
    .find(Boolean) || '';
  const scrutinyDate = extractDate(rowsText) || approvedRowDate;
  const approvalDate = approvedRowDate || extractDate(rcPrint) || (approvalDone ? scrutinyDate : '');
  const dispatchedDate = extractDate(dispatch);

  return {
    scrutiny: fmtStatus(scrutinyDone, scrutinyDate),
    approval: fmtStatus(approvalDone, approvalDate),
    dispatched: fmtStatus(dispatchedDone, dispatchedDate),
    details,
  };
}

function inferSarathiService(details) {
  return String((details && details.transaction) || '').trim() || 'Sarathi Service';
}

function inferVahanService(details) {
  const rows = Array.isArray(details && details.rows) ? details.rows : [];
  const transactionNames = rows
    .map((row) => {
      if (typeof row === 'string') {
        const value = String(row).trim();
        return /FEE|TAX/i.test(value) ? '' : value;
      }
      return String(row.transactionPurpose || '').trim();
    })
    .filter((value) => value && !/(^|\s|\/)(POSTAL\s+)?FEE(\s|\/|$)|\b(MV\s*)?TAX\b/i.test(value));
  if (transactionNames.length) return [...new Set(transactionNames)].join(', ');
  const merged = `${rows.map((row) => (typeof row === 'string' ? row : `${row.transactionPurpose || ''} ${row.currentStatus || ''}`)).join(' ')} ${(details && details.rcPrintOrSmartCardStatus) || ''} ${(details && details.dispatchRcStatus) || ''}`.toUpperCase();
  if (merged.includes('HYPOTHECATION')) return 'Hypothecation Removal';
  if (merged.includes('TRANSFER')) return 'RC Transfer';
  if (merged.includes('DUPLICATE')) return 'Duplicate RC';
  return 'Vahan Service';
}

function isPlaceholderService(value) {
  const text = String(value || '').trim().toUpperCase();
  return (
    !text ||
    text === 'VAHAN SERVICE' ||
    text === 'SARATHI SERVICE' ||
    text === 'NOT AVAILABLE'
  );
}

function getCacheMetaPath(chatId) {
  return path.join(__dirname, '..', '..', 'data', 'tmp', `status_cache_${String(chatId).replace(/[^a-z0-9@._-]/gi, '_')}.json`);
}

function buildChatSignature(sarathiItems, vahanItems) {
  const payload = {
    sarathi: sarathiItems.map((item) => ({
      appNo: item.appNo,
      applicantName: item.applicantName || item.tag || '',
      serviceName: item.serviceName || '',
      applicationDate: item.applicationDate || '',
      lastSnapshot: item.lastSnapshot || '',
      scrutinyAt: item.scrutinyAt || '',
      approvalAt: item.approvalAt || '',
      dispatchedAt: item.dispatchedAt || '',
      dob: item.dob || '',
    })),
    vahan: vahanItems.map((item) => ({
      applicationNumber: item.applicationNumber,
      applicantName: item.applicantName || item.tag || '',
      serviceName: item.serviceName || '',
      applicationDate: item.applicationDate || '',
      lastSnapshot: item.lastSnapshot || '',
      scrutinyAt: item.scrutinyAt || '',
      approvalAt: item.approvalAt || '',
      dispatchedAt: item.dispatchedAt || '',
      vehicleNo: item.vehicleNo || '',
    })),
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function readCacheMeta(chatId) {
  try {
    const p = getCacheMetaPath(chatId);
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function writeCacheMeta(chatId, meta) {
  const p = getCacheMetaPath(chatId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(meta, null, 2), 'utf8');
}

function inferVehicleNo(item, details) {
  const rows = Array.isArray(details && details.rows) ? details.rows : [];
  const source = `${item.applicationNumber || ''} ${rows.map((row) => (typeof row === 'string' ? row : `${row.transactionPurpose || ''} ${row.currentStatus || ''}`)).join(' ')}`.toUpperCase();
  const m = source.match(/\b[A-Z]{2}\d{2}[A-Z]{1,3}\d{1,4}\b/);
  return m ? m[0] : 'Not Available';
}

function htmlTemplate({ sarathiRows, vahanRows }) {
  const renderRow = (d) => `
    <tr>
      <td class="sr">${d.srNo}</td>
      <td class="name">${d.applicantName}</td>
      <td class="service">${d.serviceName}</td>
      <td class="date">${d.applicationDate}</td>
      <td class="app">${d.appNo}</td>
      <td class="id">${d.dobOrVehicle}</td>
      <td><span class="${d.scrutiny.includes('\u2705') ? 'status-completed' : 'status-pending'}">${d.scrutiny}</span></td>
      <td><span class="${d.approval.includes('\u2705') ? 'status-completed' : 'status-pending'}">${d.approval}</span></td>
      <td><span class="${d.dispatched.includes('\u2705') ? 'status-completed' : 'status-pending'}">${d.dispatched}</span></td>
    </tr>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
    *{box-sizing:border-box}
    html,body{width:1200px;min-height:960px}
    body{font-family:'Segoe UI',Roboto,Arial,sans-serif;padding:14px;background:#f6f8fb;margin:0;color:#111827}
    .table-container{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px;width:1172px;margin:0 auto}
    h2{margin:0 0 12px 0;text-align:center;font-size:30px;line-height:1.1;color:#172033}
    table{width:100%;border-collapse:collapse;font-size:15px;line-height:1.18;table-layout:fixed}
    th,td{border:1px solid #dbe2ea;padding:9px 9px;vertical-align:middle;overflow-wrap:anywhere}
    th{background:#eef3f9;font-weight:800;font-size:15px;color:#122033}
    th:nth-child(1){width:5%}
    th:nth-child(2){width:13%}
    th:nth-child(3){width:15%}
    th:nth-child(4){width:11%}
    th:nth-child(5){width:14%}
    th:nth-child(6){width:13%}
    th:nth-child(7),th:nth-child(8),th:nth-child(9){width:9.66%}
    td.name{font-weight:800}
    td.id,td.date{font-weight:800}
    .section-header{background:#1f6feb;color:#fff;font-weight:800;font-size:17px;text-align:left;padding:10px 12px}
    .vahan{background:#0f9d58}
    .status-completed{color:#166534;background:#dcfce7;border-radius:7px;padding:3px 4px;display:inline-block;font-weight:800;font-size:12px;white-space:nowrap}
    .status-pending{color:#991b1b;background:#fee2e2;border-radius:7px;padding:3px 6px;display:inline-block;font-weight:800;font-size:13px;white-space:nowrap}
  </style></head><body><div class="table-container"><h2>Application Status Tracker</h2><table><thead><tr>
  <th>Sr. No.</th><th>Applicant Name</th><th>Service Name</th><th>Application Date</th><th>Application No.</th><th>DOB / Vehicle No.</th><th>Scrutiny</th><th>Approval</th><th>Dispatched</th>
  </tr></thead><tbody>
  ${sarathiRows.length ? `<tr><td colspan="9" class="section-header">Sarathi Applications</td></tr>${sarathiRows.map(renderRow).join('')}` : ''}
  ${vahanRows.length ? `<tr><td colspan="9" class="section-header vahan">Vahan Applications</td></tr>${vahanRows.map(renderRow).join('')}` : ''}
  ${(!sarathiRows.length && !vahanRows.length) ? '<tr><td colspan="9" style="text-align:center">No tracked applications found.</td></tr>' : ''}
  </tbody></table></div></body></html>`;
}

async function generateStatusImage(chatId) {
  const sarathiItems = readTrackedApplications().filter((i) => String(i.chatId) === String(chatId));
  const vahanItems = readVahanStore().filter((i) => String(i.chatId) === String(chatId));

  const limitedSarathi = sarathiItems.slice(0, 10);
  const remaining = Math.max(0, 10 - limitedSarathi.length);
  const limitedVahan = vahanItems.slice(0, remaining);
  const signature = buildChatSignature(limitedSarathi, limitedVahan);
  const existingCache = readCacheMeta(chatId);
  if (existingCache && existingCache.signature === signature && existingCache.imagePath && fs.existsSync(existingCache.imagePath)) {
    return existingCache.imagePath;
  }

  let srNo = 1;
  const sarathiRows = limitedSarathi.map((item) => {
    const s = deriveSarathiStatus(item.lastSnapshot);
    const scrutiny = String(item.scrutinyAt || '').trim() ? `${item.scrutinyAt} \u2705` : s.scrutiny;
    const approval = String(item.approvalAt || '').trim() ? `${item.approvalAt} \u2705` : s.approval;
    const dispatched = String(item.dispatchedAt || '').trim() ? `${item.dispatchedAt} \u2705` : s.dispatched;
    return {
      srNo: srNo++,
      applicantName: item.applicantName || item.tag || 'Unknown',
      serviceName: isPlaceholderService(item.serviceName) ? inferSarathiService(s.details) : item.serviceName,
      applicationDate: item.applicationDate || 'Not Available',
      appNo: item.appNo,
      dobOrVehicle: item.dob || 'Not Available',
      scrutiny,
      approval,
      dispatched,
    };
  });

  const vahanRows = limitedVahan.map((item) => {
    const v = deriveVahanStatus(item.lastSnapshot);
    const scrutiny = String(item.scrutinyAt || '').trim() ? `${item.scrutinyAt} \u2705` : v.scrutiny;
    const approval = String(item.approvalAt || '').trim() ? `${item.approvalAt} \u2705` : v.approval;
    const dispatched = String(item.dispatchedAt || '').trim() ? `${item.dispatchedAt} \u2705` : v.dispatched;
    return {
      srNo: srNo++,
      applicantName: item.applicantName || item.tag || 'Unknown',
      serviceName: isPlaceholderService(item.serviceName) ? inferVahanService(v.details) : item.serviceName,
      applicationDate: item.applicationDate || 'Not Available',
      appNo: item.applicationNumber,
      dobOrVehicle: item.vehicleNo || inferVehicleNo(item, v.details),
      scrutiny,
      approval,
      dispatched,
    };
  });

  const html = htmlTemplate({ sarathiRows, vahanRows });
  const outImagePath = path.join(__dirname, '..', '..', 'data', 'tmp', `status_${chatId}_${Date.now()}.png`);
  fs.mkdirSync(path.dirname(outImagePath), { recursive: true });

  // Use the shared renderHTML helper — correctly acquires/releases the page semaphore
  // and uses waitUntil:'domcontentloaded' so local HTML never hangs on networkidle0
  await renderHTML(html, {
    type: 'image',
    path: outImagePath,
    viewport: { width: 1200, height: 960, deviceScaleFactor: 2 },
    imageOptions: { fullPage: true },
    pdfOptions: {},
  });

  writeCacheMeta(chatId, {
    chatId: String(chatId),
    signature,
    imagePath: outImagePath,
    generatedAt: new Date().toISOString(),
  });

  return outImagePath;
}

module.exports = {
  generateStatusImage,
  deriveSarathiStatus,
  deriveVahanStatus,
  inferVahanService,
};

