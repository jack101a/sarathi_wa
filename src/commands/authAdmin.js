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
      '*Auth Commands:*',
      '`auth add user <phone> [name] [plan] [monthly_limit] [expiry_YYYY-MM-DD]`',
      '`auth edit user <phone> [name=X] [plan=X] [limit=N] [expiry=YYYY-MM-DD] [status=active|inactive] [credits=N]`',
      '`auth credits add <phone> <amount>`  — top-up credits',
      '`auth credits set <phone> <amount>`  — set credits to exact amount',
      '`auth delete user <phone>`',
      '`auth list users`',
      '`auth user <phone>`',
      '`auth reset usage <phone>`',
      '',
      '_Legacy commands:_',
      '`auth add wa user <phone>`',
      '`auth remove wa user <phone>`',
      '`auth add wa group <group_id>`',
      '`auth remove wa group <group_id>`',
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

  // ─── Add user ────────────────────────────────────────────────────────────
  if (sub === 'add' && String(parts[2] || '').toLowerCase() === 'user') {
    const phone = normalizePhone(parts[3] || '');
    if (!phone) return 'Invalid phone number.';
    await authService.addAuthorizedEntry('wa', 'user', phone, {
      name: parts[4] || '',
      plan: parts[5] || 'standard',
      monthly_limit: Number(parts[6] || 0),
      expiry_date: parts[7] || '',
    });
    return `✅ User ${phone} added/updated with plan '${parts[5] || 'standard'}'.`;
  }

  // ─── Edit user ───────────────────────────────────────────────────────────
  if (sub === 'edit' && String(parts[2] || '').toLowerCase() === 'user') {
    const phone = normalizePhone(parts[3] || '');
    if (!phone) return 'Invalid phone number.';
    const updates = {};
    let creditsDelta = null;   // relative add (+N)
    let creditsAbs   = null;   // absolute set (=N)
    for (const token of parts.slice(4)) {
      const [k, ...rest] = token.split('=');
      const v = rest.join('=');
      if (!v) continue;
      if (k === 'name')    updates.name = v;
      if (k === 'plan')    updates.subscription_plan = v;
      if (k === 'limit')   updates.monthly_limit = Number(v) || 0;
      if (k === 'expiry')  updates.expiry_date = v;
      if (k === 'status')  updates.is_active = v.toLowerCase() === 'active';
      if (k === 'credits') creditsAbs = Number(v) || 0;
    }
    const u = await authService.editUser(phone, updates);
    if (!u) return `User ${phone} not found.`;
    // Handle credit adjustment separately
    if (creditsAbs !== null) {
      await repo.setCredits(u.id, creditsAbs);
    }
    const newCredits = await repo.getCredits(u.id);
    return `✅ User ${phone} updated. Current credits: *${newCredits}*.`;
  }

  // ─── Credits: add / set ──────────────────────────────────────────────────
  if (sub === 'credits') {
    const action = String(parts[2] || '').toLowerCase();
    const phone  = normalizePhone(parts[3] || '');
    const amount = Number(parts[4] || 0);
    if (!phone)  return 'Invalid phone number.';
    if (amount <= 0) return 'Amount must be a positive number.';
    const user = await authService.getUserDetails(phone);
    if (!user) return `User ${phone} not found.`;
    let newBalance;
    if (action === 'add') {
      newBalance = await repo.addCredits(user.id, amount);
      return `✅ Added *${amount}* credits to ${phone}.\n💰 New balance: *${newBalance} credits*.`;
    }
    if (action === 'set') {
      newBalance = await repo.setCredits(user.id, amount);
      return `✅ Credits for ${phone} set to *${newBalance}*.`;
    }
    return 'Usage: `auth credits add <phone> <amount>` or `auth credits set <phone> <amount>`';
  }

  // ─── Delete user ─────────────────────────────────────────────────────────
  if (sub === 'delete' && String(parts[2] || '').toLowerCase() === 'user') {
    const phone = normalizePhone(parts[3] || '');
    if (!phone) return 'Invalid phone number.';
    const ok = await authService.deleteUser(phone);
    return ok ? `User ${phone} deactivated.` : `User ${phone} not found.`;
  }

  // ─── Reset usage ─────────────────────────────────────────────────────────
  if (sub === 'reset' && String(parts[2] || '').toLowerCase() === 'usage') {
    const phone = normalizePhone(parts[3] || '');
    if (!phone) return 'Invalid phone number.';
    const u = await authService.getUserDetails(phone);
    if (!u) return `User ${phone} not found.`;
    await repo.resetMonthlyUsage(u.id);
    return `Usage reset for ${phone}.`;
  }

  // ─── Backward-compatible legacy commands ─────────────────────────────────
  if (sub === 'list') {
    const channel = String(parts[2] || '').toLowerCase().trim();
    const type    = String(parts[3] || '').toLowerCase().trim();
    if (channel === 'wa' && type === 'users') {
      const users = await repo.query('SELECT * FROM auth_users WHERE channel = "wa" AND is_active = 1');
      return users.length ? 'Active WA users:\n' + users.map((u) => `- ${u.canonical_phone}`).join('\n') : 'No active WA users.';
    }
    if (channel === 'wa' && type === 'groups') {
      const groups = await repo.getAuthorizedGroups('wa');
      return groups.length ? 'Active WA groups:\n' + groups.map((g) => `- ${g.group_id}`).join('\n') : 'No active WA groups.';
    }
  }

  if (['add', 'resend', 'cancel', 'status', 'remove'].includes(sub)) {
    const channel = String(parts[2] || '').toLowerCase().trim();
    const type    = String(parts[3] || '').toLowerCase().trim();
    const id      = parts.slice(4).join(' ');
    if (channel === 'wa' && type === 'user') {
      const phone = normalizePhone(id);
      if (!phone) return 'Invalid phone number.';
      if (sub === 'add')    { const verif = await startVerification(phone, 'admin', 'wa'); if (!verif) return `Failed to initiate verification for ${phone}.`; const verificationText = `AUTH ${phone} ${verif.code}`; if (client) { try { await client.sendMessage(`${phone}@c.us`, verificationText); } catch (_) {} } return `Verification initiated for ${phone}.\nCopy and send this exact text from target number:\n${verificationText}`; }
      if (sub === 'resend') { const verif = await resendVerification(phone); if (!verif) return `Failed to resend verification for ${phone}.`; const verificationText = `AUTH ${phone} ${verif.code}`; if (client) { try { await client.sendMessage(`${phone}@c.us`, verificationText); } catch (_) {} } return `Verification resent for ${phone}.\nCopy and send this exact text from target number:\n${verificationText}`; }
      if (sub === 'cancel') return (await cancelVerification(phone)) ? `Verification cancelled for ${phone}.` : `No pending verification found for ${phone}.`;
      if (sub === 'status') { const s = await getStatus(phone); return s ? `Verification status for ${phone}: ${s.status} (Expires: ${s.expires_at})` : `No verification found for ${phone}.`; }
      if (sub === 'remove') return (await repo.deactivateUser(phone)) ? `User ${phone} removed completely.` : `User ${phone} not found.`;
    }
    if (channel === 'wa' && type === 'group') {
      if (sub === 'add')    { await repo.addAuthorizedGroup(id, 'wa'); return `Group ${id} added successfully.`; }
      if (sub === 'remove') { await repo.removeAuthorizedGroup(id, 'wa'); return `Group ${id} removed successfully.`; }
    }
  }

  return `Unknown subcommand: '${sub}'. Use \`auth help\` to see all commands.`;
}

module.exports = { handleAuthCommand };
