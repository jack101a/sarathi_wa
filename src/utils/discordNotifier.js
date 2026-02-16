const { Blob } = require('buffer');

function extractQrBuffer(qrBase64) {
  const raw = String(qrBase64 || '').trim();
  if (!raw) {
    throw new Error('QR base64 input is empty.');
  }

  const dataUrlMatch = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (dataUrlMatch) {
    return {
      mimeType: dataUrlMatch[1],
      buffer: Buffer.from(dataUrlMatch[2], 'base64'),
    };
  }

  return {
    mimeType: 'image/png',
    buffer: Buffer.from(raw, 'base64'),
  };
}

async function notifyQRCode(qrBase64, message) {
  const webhookUrl = String(process.env.DISCORD_WEBHOOK_URL || '').trim();
  if (!webhookUrl) {
    return false;
  }

  if (!globalThis.FormData) {
    throw new Error('FormData is not available in this Node runtime.');
  }

  const { mimeType, buffer } = extractQrBuffer(qrBase64);
  if (!buffer.length) {
    throw new Error('Decoded QR buffer is empty.');
  }

  const ext = (mimeType.split('/')[1] || 'png').replace(/[^a-zA-Z0-9]/g, '') || 'png';
  const filename = `whatsapp-qr.${ext}`;
  const text = String(message || 'WhatsApp QR code generated').trim();

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType }), filename);
  form.append(
    'payload_json',
    JSON.stringify({
      content: text,
      embeds: [
        {
          description: text,
          image: { url: `attachment://${filename}` },
        },
      ],
    })
  );

  const response = await fetch(webhookUrl, {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Discord webhook failed (${response.status}): ${bodyText.slice(0, 500)}`);
  }

  return true;
}

module.exports = {
  notifyQRCode,
};
