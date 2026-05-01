const {
  startVerification,
  resendVerification,
  cancelVerification,
  getStatus
} = require('../services/waVerificationService');
const repo = require('../services/authorizationRepository');
const { normalizePhone } = require('../services/authorizationNormalizer');

async function handleAuthCommand(text, fromChatId, client) {
  const parts = String(text || '').trim().split(/\s+/);
  if (parts[0].toLowerCase() !== 'auth' && parts[0].toLowerCase() !== '/auth') {
    return null;
  }

  const sub = String(parts[1] || '').toLowerCase().trim();

  // auth help
  if (sub === 'help' || parts.length === 1) {
    return `Available auth commands:
- auth help
- auth list wa users
- auth add wa user <phone>
- auth resend wa user <phone>
- auth cancel wa user <phone>
- auth status wa user <phone>
- auth remove wa user <phone>
- auth list wa groups
- auth add wa group <group_id>
- auth remove wa group <group_id>`;
  }

  // auth list wa users/groups
  if (sub === 'list') {
    const channel = String(parts[2] || '').toLowerCase().trim();
    const type = String(parts[3] || '').toLowerCase().trim();

    if (channel === 'wa' && type === 'users') {
      const users = repo.querySync('SELECT * FROM auth_users WHERE channel = "wa" AND is_active = 1');
      if (!users.length) return 'No active WA users.';
      return 'Active WA users:\n' + users.map(u => `- ${u.canonical_phone}`).join('\n');
    }
    if (channel === 'wa' && type === 'groups') {
      const groups = repo.getAuthorizedGroups('wa');
      if (!groups.length) return 'No active WA groups.';
      return 'Active WA groups:\n' + groups.map(g => `- ${g.group_id}`).join('\n');
    }
    return `Invalid list format. Use 'auth help' to see usage.`;
  }

  // auth add/resend/cancel/status/remove
  if (sub === 'add' || sub === 'resend' || sub === 'cancel' || sub === 'status' || sub === 'remove') {
    const channel = String(parts[2] || '').toLowerCase().trim();
    const type = String(parts[3] || '').toLowerCase().trim();
    const id = parts.slice(4).join(' ');

    if (channel === 'wa' && type === 'user') {
      const phone = normalizePhone(id);
      if (!phone) return 'Invalid phone number.';

      if (sub === 'add') {
        const verif = startVerification(phone, 'admin', 'wa');
        if (verif) {
          const verificationText = `AUTH ${phone} ${verif.code}`;
          if (client) {
            try {
              await client.sendMessage(phone + '@c.us', verificationText);
            } catch (e) {}
          }
          return `Verification initiated for ${phone}.\nCopy and send this exact text from target number:\n${verificationText}`;
        }
        return `Failed to initiate verification for ${phone}.`;
      }

      if (sub === 'resend') {
        const verif = resendVerification(phone);
        if (verif) {
          const verificationText = `AUTH ${phone} ${verif.code}`;
          if (client) {
            try {
              await client.sendMessage(phone + '@c.us', verificationText);
            } catch (e) {}
          }
          return `Verification resent for ${phone}.\nCopy and send this exact text from target number:\n${verificationText}`;
        }
        return `Failed to resend verification for ${phone}.`;
      }

      if (sub === 'cancel') {
        const ok = cancelVerification(phone);
        return ok ? `Verification cancelled for ${phone}.` : `No pending verification found for ${phone}.`;
      }

      if (sub === 'status') {
        const status = getStatus(phone);
        if (!status) return `No verification found for ${phone}.`;
        return `Verification status for ${phone}: ${status.status} (Expires: ${status.expires_at})`;
      }

      if (sub === 'remove') {
        const ok = repo.deactivateUser(phone);
        return ok ? `User ${phone} removed completely.` : `User ${phone} not found.`;
      }
    }

    if (channel === 'wa' && type === 'group') {
      if (sub === 'add') {
        repo.addAuthorizedGroup(id, 'wa');
        return `Group ${id} added successfully.`;
      }
      if (sub === 'remove') {
        repo.removeAuthorizedGroup(id, 'wa');
        return `Group ${id} removed successfully.`;
      }
    }
  }

  return `Unknown subcommand: '${sub}'. Use 'auth help' to see usage.`;
}

module.exports = { handleAuthCommand };
