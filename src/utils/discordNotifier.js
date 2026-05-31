const { Blob } = require('buffer');

async function postWebhook(payload, file) {
  const webhookUrl = String(process.env.DISCORD_WEBHOOK_URL || '').trim();
  if (!webhookUrl) {
    return false;
  }

  let response;

  if (file) {
    if (!globalThis.FormData) {
      throw new Error('FormData is not available in this Node runtime.');
    }

    const form = new FormData();
    form.append('file', new Blob([file.buffer], { type: file.mimeType }), file.filename);
    form.append('payload_json', JSON.stringify(payload));

    response = await fetch(webhookUrl, {
      method: 'POST',
      body: form,
    });
  } else {
    response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  }

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Discord webhook failed (${response.status}): ${bodyText.slice(0, 500)}`);
  }

  return true;
}

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
  const { mimeType, buffer } = extractQrBuffer(qrBase64);
  if (!buffer.length) {
    throw new Error('Decoded QR buffer is empty.');
  }

  const ext = (mimeType.split('/')[1] || 'png').replace(/[^a-zA-Z0-9]/g, '') || 'png';
  const filename = `whatsapp-qr.${ext}`;
  const text = String(message || 'WhatsApp QR code generated').trim();

  return postWebhook(
    {
      content: text,
      embeds: [
        {
          description: text,
          image: { url: `attachment://${filename}` },
        },
      ],
    },
    {
      mimeType,
      buffer,
      filename,
    }
  );
}

async function notifyPairingCode(code) {
  const text = [
    'WhatsApp pairing code generated.',
    `Code: ${String(code || '').trim()}`,
    'Use Linked Devices > Link with phone number in WhatsApp.',
  ].join('\n');

  return postWebhook({
    content: text,
  });
}

async function notifyBotOffline(event, details = {}) {
  const env = String(process.env.APP_ENV || process.env.NODE_ENV || 'production').toUpperCase();
  const phone = String(process.env.WHATSAPP_PHONE_NUMBER || 'Not Configured').trim();

  const embed = {
    title: '🚨 WhatsApp Bot Offline Alert',
    description: `The WhatsApp bot instance has gone offline or encountered a critical issue.`,
    color: 16711680, // Red (0xFF0000)
    fields: [
      { name: 'Environment', value: `\`${env}\``, inline: true },
      { name: 'Bot Number', value: `\`${phone}\``, inline: true },
      { name: 'Event Triggered', value: `\`${event}\``, inline: true },
    ],
    timestamp: new Date().toISOString(),
  };

  if (details.reason) {
    embed.fields.push({
      name: 'Reason / Details',
      value: `\`\`\`${String(details.reason).slice(0, 1000)}\`\`\``,
    });
  }

  try {
    return await postWebhook({
      embeds: [embed],
    });
  } catch (error) {
    console.error('Failed to notify Discord:', error.message);
    return false;
  }
}

module.exports = {
  notifyQRCode,
  notifyPairingCode,
  notifyBotOffline,
};
