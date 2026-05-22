const { startVerification, resendVerification, cancelVerification, getStatus } = require('../services/waVerificationService');
const repo = require('../services/authorizationRepository');
const authService = require('../services/authorizationService');
const { normalizePhone } = require('../services/authorizationNormalizer');

async function handleAuthCommand(text, fromChatId, client) {
  const parts = String(text || '').trim().split(/\s+/);
  if (!/^\/?auth$/i.test(parts[0] || '')) return null;
  const sub = String(parts[1] || '').toLowerCase().trim();

  // ─── Help ────────────────────────────────────────────────────────────────
  if (sub === 'help' || parts.length === 1) {
    return [
      '*Auth Commands (Read-only & Lookup):*',
      '👉 `auth list users`  — View all active users',
      '👉 `auth user <phone>`  — View specific user details',
      '',
      '*User & Credit Management:*',
      '⚠️ *Disabled via chat.* User creation, editing, deactivation, and credit management are now managed exclusively via the *Admin UI Dashboard* to ensure strict auditing.',
      '',
      '*Group Authorization:*',
      '👉 `auth add wa group <group_id>`',
      '👉 `auth remove wa group <group_id>`',
    ].join('\n');
  }

  // ─── List users ──────────────────────────────────────────────────────────
  if (sub === 'list' && String(parts[2] || '').toLowerCase() === 'users') {
    const users = await authService.listUsers();
    if (!users.length) return 'No active users.';
    const lines = users.map((u) => {
      const credits = Number(u.credits || 0);
      return `- ${u.canonical_phone} | ${u.name || '-'} | ${u.subscription_plan || 'standard'} | used:${u.used_count || 0}/${u.monthly_limit || 0} | 💰${credits}cr | exp:${u.expiry_date || '-'} | ${Number(u.is_active) === 1 ? '✅' : '❌'}`;
    });
    return 'Active users:\n' + lines.join('\n');
  }

  // ─── Show user details ───────────────────────────────────────────────────
  if (sub === 'user') {
    const phone = normalizePhone(parts[2] || '');
    if (!phone) return 'Invalid phone number.';
    const u = await authService.getUserDetails(phone);
    if (!u) return `User ${phone} not found.`;
    const credits = Number(u.credits || 0);
    return [
      `📱 Phone: ${u.canonical_phone}`,
      `👤 Name: ${u.name || '-'}`,
      `📋 Plan: ${u.subscription_plan || 'standard'}`,
      `📊 Usage: ${u.used_count || 0}/${u.monthly_limit || 0} (monthly)`,
      `📆 Daily: ${u.daily_count || 0}`,
      `💰 Credits: ${credits} (${credits >= 50 ? '✅ can run heavy jobs' : '⚠️ insufficient for heavy jobs'})`,
      `📅 Expiry: ${u.expiry_date || 'none'}`,
      `🔑 Status: ${Number(u.is_active) === 1 ? 'active ✅' : 'inactive ❌'}`,
    ].join('\n');
  }

  // ─── Block user/credit mutating operations via Chat ──────────────────────
  if (
    (sub === 'add' && String(parts[2] || '').toLowerCase() === 'user') ||
    (sub === 'edit' && String(parts[2] || '').toLowerCase() === 'user') ||
    sub === 'credits' ||
    (sub === 'delete' && String(parts[2] || '').toLowerCase() === 'user') ||
    (sub === 'reset' && String(parts[2] || '').toLowerCase() === 'usage')
  ) {
    return '❌ *User & Credit Management via Chat is Disabled!*\nCreating, editing, deleting, resetting usage, or allocating credits can now *only* be done via the *Admin UI Dashboard*.';
  }

  // ─── Legacy commands check for users ─────────────────────────────────────
  if (['add', 'resend', 'cancel', 'status', 'remove'].includes(sub)) {
    const channel = String(parts[2] || '').toLowerCase().trim();
    const type    = String(parts[3] || '').toLowerCase().trim();
    const id      = parts.slice(4).join(' ');
    
    if (channel === 'wa' && type === 'user') {
      return '❌ *User Management via Chat is Disabled!*\nAll user creation, verification, and deactivation is now handled directly in the *Admin UI Dashboard*.';
    }
    
    if (channel === 'wa' && type === 'group') {
      if (sub === 'add')    { await repo.addAuthorizedGroup(id, 'wa'); return `Group ${id} added successfully.`; }
      if (sub === 'remove') { await repo.removeAuthorizedGroup(id, 'wa'); return `Group ${id} removed successfully.`; }
    }
  }

  return `Unknown subcommand: '${sub}'. Use \`auth help\` to see all commands.`;
}

module.exports = { handleAuthCommand };
