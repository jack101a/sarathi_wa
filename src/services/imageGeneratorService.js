const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { readTrackedApplications } = require('./autoTrackStore');
const { readEntries: readVahanStore } = require('./vahanTrackStore');

function extractDate(text) {
  const match = String(text || '').match(/(\d{2})[-/A-Za-z]+(\d{4}|\d{2})/);
  if (match) {
    // Attempting a simple extraction, fallback to generic
    return match[0].substring(0, 11);
  }
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

function deriveSarathiStatus(snapshotStr) {
  let details = {};
  try {
    details = JSON.parse(snapshotStr || '{}');
  } catch (e) {}

  const statusText = [
    details.kind,
    details.stage,
    details.message,
    details.approvedAction,
    details.transaction,
  ].map((value) => String(value || '').toUpperCase()).join(' ');

  const dispatchedDone = details.kind === 'dispatched' || statusText.includes('DISPATCH');
  const approvalDone = dispatchedDone || details.kind === 'approved' || statusText.includes('PRINTING') || statusText.includes('CARD') || statusText.includes('APPROVAL');
  const scrutinyDone = approvalDone || (Boolean(details.stage) && !String(details.stage).toUpperCase().includes('SCRUTINY'));

  const dateStr = extractDate(statusText);

  return {
    scrutiny: scrutinyDone ? `${dateStr} ✅` : '— ⚠️',
    approval: approvalDone ? `${dateStr} ✅` : '— ⚠️',
    dispatched: dispatchedDone ? `${dateStr} ✅` : '— ⚠️',
  };
}

function deriveVahanStatus(snapshotStr) {
  let details = {};
  try {
    details = JSON.parse(snapshotStr || '{}');
  } catch (e) {}

  const rowsText = (details.rows || []).join(' ').toUpperCase();
  const rcPrint = String(details.rcPrintOrSmartCardStatus || '').toUpperCase();
  const dispatch = String(details.dispatchRcStatus || '').toUpperCase();

  const dispatchedDone = dispatch.includes('DISPATCHED') || dispatch.includes('DELIVERED');
  const approvalDone = dispatchedDone || rcPrint.includes('PRINTED') || rowsText.includes('APPROVED');
  const scrutinyDone = approvalDone || rowsText.includes('VERIFIED') || rowsText.includes('SUCCESS');

  const dateStr = extractDate(rowsText + ' ' + rcPrint + ' ' + dispatch);

  return {
    scrutiny: scrutinyDone ? `${dateStr} ✅` : '— ⚠️',
    approval: approvalDone ? `${dateStr} ✅` : '— ⚠️',
    dispatched: dispatchedDone ? `${dateStr} ✅` : '— ⚠️',
  };
}

const htmlTemplate = (data) => `
<!DOCTYPE html>
<html>
<head>
<style>
  body {
    font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    padding: 30px;
    background-color: #f8fafc;
    margin: 0;
  }
  .table-container {
    background: white;
    border-radius: 12px;
    box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
    padding: 20px;
    max-width: 1200px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 10px;
  }
  th, td {
    padding: 14px 16px;
    text-align: left;
    border-bottom: 1px solid #e2e8f0;
  }
  th {
    background-color: #f1f5f9;
    font-weight: 600;
    color: #334155;
    text-transform: uppercase;
    font-size: 13px;
    letter-spacing: 0.05em;
  }
  .section-header {
    background-color: #3b82f6 !important;
    color: white !important;
    font-size: 16px !important;
    font-weight: bold !important;
    text-transform: none !important;
    letter-spacing: normal !important;
  }
  .vahan-header {
    background-color: #10b981 !important;
  }
  tr:last-child td {
    border-bottom: none;
  }
  .status-completed {
    color: #166534;
    background-color: #dcfce7;
    padding: 4px 8px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    display: inline-block;
  }
  .status-pending {
    color: #991b1b;
    background-color: #fee2e2;
    padding: 4px 8px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    display: inline-block;
  }
</style>
</head>
<body>
  <div class="table-container">
    <h2 style="margin-top: 0; color: #1e293b; text-align: center; margin-bottom: 20px;">Live Application Status Tracker</h2>
    <table>
      <thead>
        <tr>
          <th style="width: 5%">Sr. No.</th>
          <th style="width: 15%">Name / Tag</th>
          <th style="width: 15%">Service / Transport</th>
          <th style="width: 15%">Application No.</th>
          <th style="width: 12%">DOB / Vehicle No.</th>
          <th style="width: 12%">Scrutiny</th>
          <th style="width: 12%">Approval</th>
          <th style="width: 14%">Dispatched</th>
        </tr>
      </thead>
      <tbody>
        ${data.filter(d => d.category === 'sarathi').length > 0 ? `
        <tr>
          <td colspan="8" class="section-header">🚘 Sarathi Applications (DOB)</td>
        </tr>
        ${data.filter(d => d.category === 'sarathi').map(d => `
          <tr>
            <td>${d.srNo}</td>
            <td><strong>${d.applicantName}</strong></td>
            <td>${d.serviceName}</td>
            <td>${d.appNo}</td>
            <td>${d.dobOrVehicle}</td>
            <td><span class="${d.scrutiny.includes('✅') ? 'status-completed' : 'status-pending'}">${d.scrutiny}</span></td>
            <td><span class="${d.approval.includes('✅') ? 'status-completed' : 'status-pending'}">${d.approval}</span></td>
            <td><span class="${d.dispatched.includes('✅') ? 'status-completed' : 'status-pending'}">${d.dispatched}</span></td>
          </tr>
        `).join('')}
        ` : ''}
        
        ${data.filter(d => d.category === 'vahan').length > 0 ? `
        <tr>
          <td colspan="8" class="section-header vahan-header">🛵 Vahan Applications (Vehicle No.)</td>
        </tr>
        ${data.filter(d => d.category === 'vahan').map(d => `
          <tr>
            <td>${d.srNo}</td>
            <td><strong>${d.applicantName}</strong></td>
            <td>${d.serviceName}</td>
            <td>${d.appNo}</td>
            <td><strong>${d.dobOrVehicle}</strong></td>
            <td><span class="${d.scrutiny.includes('✅') ? 'status-completed' : 'status-pending'}">${d.scrutiny}</span></td>
            <td><span class="${d.approval.includes('✅') ? 'status-completed' : 'status-pending'}">${d.approval}</span></td>
            <td><span class="${d.dispatched.includes('✅') ? 'status-completed' : 'status-pending'}">${d.dispatched}</span></td>
          </tr>
        `).join('')}
        ` : ''}
        
        ${data.length === 0 ? '<tr><td colspan="8" style="text-align: center;">No tracked applications found.</td></tr>' : ''}
      </tbody>
    </table>
  </div>
</body>
</html>
`;

async function generateStatusImage(chatId) {
  const sarathiItems = readTrackedApplications().filter(i => i.chatId === chatId);
  const vahanItems = readVahanStore().filter(i => i.chatId === chatId);

  let srNo = 1;
  const data = [];

  for (const item of sarathiItems) {
    let sInfo = deriveSarathiStatus(item.lastSnapshot);
    data.push({
      category: 'sarathi',
      srNo: srNo++,
      applicantName: item.tag || 'Unknown',
      serviceName: 'Sarathi ' + (item.transport || ''),
      appNo: item.appNo,
      dobOrVehicle: item.dob || 'Not Provided',
      scrutiny: sInfo.scrutiny,
      approval: sInfo.approval,
      dispatched: sInfo.dispatched
    });
  }

  for (const item of vahanItems) {
    let vInfo = deriveVahanStatus(item.lastSnapshot);
    data.push({
      category: 'vahan',
      srNo: srNo++,
      applicantName: item.tag || 'Unknown',
      serviceName: 'Vahan ' + (item.transport || ''),
      appNo: item.applicationNumber,
      dobOrVehicle: 'Vehicle Details Check',
      scrutiny: vInfo.scrutiny,
      approval: vInfo.approval,
      dispatched: vInfo.dispatched
    });
  }

  const html = htmlTemplate(data);
  const tempHtmlPath = path.join(__dirname, '..', '..', `temp_table_${Date.now()}.html`);
  const outImagePath = path.join(__dirname, '..', '..', `status_${chatId}_${Date.now()}.png`);
  
  fs.writeFileSync(tempHtmlPath, html);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  await page.setViewport({ width: 1300, height: 900, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  
  const element = await page.$('.table-container');
  if (element) {
    await element.screenshot({ path: outImagePath });
  } else {
    await page.screenshot({ path: outImagePath });
  }
  
  await browser.close();
  fs.unlinkSync(tempHtmlPath);
  
  return outImagePath;
}

module.exports = {
  generateStatusImage,
  deriveSarathiStatus,
  deriveVahanStatus
};
