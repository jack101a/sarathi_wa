const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const sarathiCount = 6;
const vahanCount = 4;

const generateData = () => {
  const data = [];
  let srNo = 1;

  // Sarathi
  for (let i = 0; i < sarathiCount; i++) {
    data.push({
      category: 'sarathi',
      srNo: srNo++,
      applicantName: ['Rahul Sharma', 'Sneha Patel', 'Amit Kumar', 'Pooja Singh', 'Vikram Desai', 'Neha Gupta'][i],
      serviceName: ['Learner License', 'DL Renewal', 'Duplicate DL', 'Learner License', 'DL Renewal', 'International DL'][i],
      appNo: '1742636326',
      dobOrVehicle: ['01-05-1990', '15-08-1985', '22-11-1992', '10-02-1998', '05-09-1980', '30-12-1995'][i],
      scrutiny: '10-03-2026 ✅',
      approval: i % 2 === 0 ? '12-03-2026 ✅' : '— ⚠️',
      dispatched: i === 0 ? '15-03-2026 ✅' : '— ⚠️'
    });
  }

  // Vahan
  for (let i = 0; i < vahanCount; i++) {
    data.push({
      category: 'vahan',
      srNo: srNo++,
      applicantName: ['Ravi Verma', 'Anita Roy', 'Suresh Nair', 'Kavita Joshi'][i],
      serviceName: ['RC Transfer', 'Hypothecation Removal', 'Duplicate RC', 'RC Transfer'][i],
      appNo: 'MH260413V9978127',
      dobOrVehicle: ['MH47AD1215', 'MH02XY5678', 'MH12BC9012', 'MH43PQ3456'][i],
      scrutiny: '05-03-2026 ✅',
      approval: i < 2 ? '08-03-2026 ✅' : '— ⚠️',
      dispatched: '— ⚠️'
    });
  }

  return data;
};

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
    <h2 style="margin-top: 0; color: #1e293b; text-align: center; margin-bottom: 20px;">Application Status Report</h2>
    <table>
      <thead>
        <tr>
          <th style="width: 5%">Sr. No.</th>
          <th style="width: 15%">Applicant Name</th>
          <th style="width: 15%">Service Name</th>
          <th style="width: 15%">Application No.</th>
          <th style="width: 12%">DOB / Vehicle No.</th>
          <th style="width: 12%">Scrutiny</th>
          <th style="width: 12%">Approval</th>
          <th style="width: 14%">Dispatched</th>
        </tr>
      </thead>
      <tbody>
        <!-- Sarathi Section -->
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
        
        <!-- Vahan Section -->
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
      </tbody>
    </table>
  </div>
</body>
</html>
`;

(async () => {
  try {
    const data = generateData();
    const html = htmlTemplate(data);
    fs.writeFileSync('temp_table.html', html);

    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    
    // Set a good viewport size for the table
    await page.setViewport({ width: 1300, height: 900, deviceScaleFactor: 2 });
    
    await page.setContent(html, { waitUntil: 'networkidle0' });
    
    // Select the table container element to screenshot just that part
    const element = await page.$('.table-container');
    await element.screenshot({ path: 'application_status.png' });
    
    await browser.close();
    
    // Cleanup HTML
    fs.unlinkSync('temp_table.html');
    console.log('Image generated successfully at application_status.png');
  } catch (error) {
    console.error('Error generating image:', error);
  }
})();
