const fs = require('fs');
const path = require('path');
const { getAckSnapshot } = require('./ackService');
const { getStatusSnapshot, parseStatusDetails } = require('./statusService');
const { renderHTML } = require('../core/puppeteerEngine');

function toDataUrl(buffer, mimeType = 'image/jpeg') {
  return `data:${mimeType};base64,${Buffer.from(buffer).toString('base64')}`;
}

async function buildMergedTopHalfImage(ackBuffer, statusBuffer, outputPath) {
  const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Tracking Snapshot</title>
    <style>
      body {
        margin: 0;
        background: #eef3fa;
      }
      #root {
        width: 852px;
        margin: 0 auto;
        padding: 16px;
      }
      .stack {
        display: block;
        width: 820px;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(15, 40, 75, 0.12);
        background: #fff;
        overflow: hidden;
      }
      .panel {
        width: 820px;
        overflow: hidden;
        position: relative;
        background: #fff;
      }
      .divider {
        height: 18px;
        background: #fff;
        position: relative;
      }
      .divider::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        top: 50%;
        height: 1px;
        background: #d8e3f0;
        transform: translateY(-50%);
      }
      img {
        display: block;
        width: 820px;
        height: auto;
      }
    </style>
  </head>
  <body>
    <div id="root">
      <div class="stack">
        <div class="panel" id="ack-panel">
          <img id="ack-image" alt="Acknowledgement" src=${JSON.stringify(toDataUrl(ackBuffer))} />
        </div>
        <div class="divider"></div>
        <div class="panel" id="status-panel">
          <img id="status-image" alt="Status" src=${JSON.stringify(toDataUrl(statusBuffer))} />
        </div>
      </div>
    </div>
    <script>
      function waitForImage(image) {
        return new Promise((resolve, reject) => {
          if (image.complete && image.naturalWidth > 0) {
            resolve(image);
            return;
          }

          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error('Image load failed.'));
        });
      }

      window.__snapshotReady = false;

      Promise.all([
        waitForImage(document.getElementById('ack-image')),
        waitForImage(document.getElementById('status-image')),
      ]).then(([ackImage, statusImage]) => {
        const ackPanel = document.getElementById('ack-panel');
        const statusPanel = document.getElementById('status-panel');
        const ackVisibleHeight = Math.max(1, Math.floor(ackImage.getBoundingClientRect().height / 2));
        const statusVisibleHeight = Math.max(1, Math.floor(statusImage.getBoundingClientRect().height / 2));

        ackPanel.style.height = ackVisibleHeight + 'px';
        statusPanel.style.height = statusVisibleHeight + 'px';
        window.__snapshotReady = true;
      }).catch(() => {
        window.__snapshotReady = true;
      });
    </script>
  </body>
</html>`;

  await renderHTML(html, {
    type: 'image',
    path: outputPath,
    waitForFunction: 'window.__snapshotReady === true',
    imageOptions: {
      fullPage: true,
    },
  });
}

async function getTrackingSnapshot(appNo, dob, options = {}) {
  const { keepFile = false, filename = `Track_${appNo}.jpg` } = options;
  const statusFilename = dob ? `status_${appNo}_${Date.now()}.jpg` : filename;
  const statusSnapshot = await getStatusSnapshot(appNo, {
    keepFile,
    filename: statusFilename,
  });
  const details = parseStatusDetails(statusSnapshot.html);

  if (!dob) {
    return {
      ...statusSnapshot,
      details,
      ackDetails: null,
      mode: 'status-only',
    };
  }

  const ackSnapshot = await getAckSnapshot(appNo, dob, {
    keepFile: false,
    filename: `ack_${appNo}_${Date.now()}.jpg`,
  });
  const filePath = path.join(process.cwd(), filename);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  await buildMergedTopHalfImage(ackSnapshot.buffer, statusSnapshot.buffer, filePath);
  const buffer = fs.readFileSync(filePath);

  if (!keepFile) {
    fs.unlinkSync(filePath);
  }

  return {
    html: statusSnapshot.html,
    filePath,
    buffer,
    details,
    ackDetails: ackSnapshot.ackDetails || null,
    mode: 'ack-status-merged',
  };
}

module.exports = {
  getTrackingSnapshot,
};
