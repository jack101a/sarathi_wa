# Codex Fix Prompt — Complete Pipeline Wiring + Bug Fixes

## Context
The scaling infrastructure is fully built. The following files are DONE and must NOT be changed:
- `src/core/db.js` — SQLite wrapper ✅
- `src/core/jobQueue.js` — dual queue (apiQueue / browserQueue) ✅
- `src/core/rateLimiter.js` — rate limit checks ✅
- `src/core/requestPipeline.js` — full 6-step pipeline ✅
- `src/workers/apiWorker.js` — handles API jobs (needs bug fix below)
- `src/workers/browserWorker.js` — handles browser jobs ✅
- `src/workers/index.js` ✅
- `src/services/jobRepository.js` ✅
- `src/services/billingCron.js` ✅
- `src/services/authorizationRepository.js` ✅
- `src/services/authorizationService.js` ✅
- `src/commands/authAdmin.js` ✅
- `server.js` ✅

## What Is Still Broken

### Problem 1 — `src/bot.js` is NOT using the pipeline
`handleMessage()` in bot.js still calls services directly (old code). The requestPipeline is never invoked.
Rate limiting, subscription checks, job queuing are completely bypassed.

### Problem 2 — `src/telegramBot.js` is NOT using the pipeline
Same issue. All commands run inline without rate limiting or queuing.

### Problem 3 — Bug in `src/workers/apiWorker.js` line 24
```js
// WRONG — null client passed, vahan can't send results back
if (job.command === 'track_rc') { await vahanService.startLookup(null, chatId, ...) }
```
Fix: use `vahanWhatsAppClient` from chatNotifier, or pass `null` and let vahanService
use its stored `activeClients` map. The correct fix is to call `startLookup` with a
proper transport-aware client built from chatNotifier.

### Problem 4 — Bug in `src/workers/apiWorker.js` line 25
```js
// WRONG — addAutoTrack signature is wrong
await addAutoTrack({ appNo: payload.appNo, transport, chatId, dob: payload.dob, tag: payload.tag });
```
`addAutoTrack` from `autoTrackService` takes an entry object with these fields:
`{ appNo, dob, tag, chatId, transport }` — that's actually correct.
BUT the import at line 10 says:
```js
const { addAutoTrack, removeAutoTrack } = require('../services/autoTrackService');
```
Verify this import is correct and the function exists. It does — `autoTrackService` exports `addAutoTrack`. ✅

### Problem 5 — Bug in `src/workers/apiWorker.js` line 24 (track_rc)
`vahanService.startLookup()` requires a `client` object with `sendText` and `sendImage` methods.
Passing `null` will throw. Build a proper client from chatNotifier:

```js
// Build a transport-aware client for vahanService
function makeVahanClient(transport, chatId) {
  return {
    sendText: async (cid, text) => {
      if (transport === 'telegram') return chatNotifier.sendTelegramMessage(cid, text);
      return chatNotifier.sendWhatsAppText(cid, text);
    },
    sendImage: async (cid, imagePath, caption) => {
      const fs = require('fs');
      const buf = fs.readFileSync(imagePath);
      const name = imagePath.split(/[\\/]/).pop();
      if (transport === 'telegram') return chatNotifier.sendTelegramPhoto(cid, buf, name, caption);
      return chatNotifier.sendWhatsAppImage(cid, buf, name, caption);
    },
  };
}
```

---

## Fix 1 — Rewrite `src/bot.js` handleMessage to use pipeline

Keep the ENTIRE file structure. Only change the `handleMessage()` function body.

Keep these blocks EXACTLY AS-IS (inline, no queuing):
1. `isChatIdCommand` early return
2. Verification message handler (`auth \d+ [a-z0-9]{6}`)
3. `isAuthorized` check (the existing gate)
4. `auth` admin command block
5. OTP submission for activeLLPrintFlows (`activeLLPrintFlows.has(message.from)`)
6. Media receipt extraction block (`message.hasMedia` → setReceiptTrackingCandidate)
7. `pendingDob` DOB reply flow
8. Interactive add track flow (`handleInteractiveAddTrackFlow`)
9. `alive` / `suno` commands
10. `help` command
11. `stop` (Vahan session stop)
12. `handleVahanIncomingText` (default case when active Vahan session)
13. The AUTO_TRACK.UPDATE_CHAT_ID guard

Replace ALL other command handling with pipeline calls using this pattern:

```js
// Helper to call pipeline and handle blocked result
async function enqueueOrReply(message, transport, commandInfo) {
  const { processRequest } = require('./core/requestPipeline');
  const result = await processRequest(message, transport, commandInfo);
  if (result.blocked) {
    await message.reply(`❌ ${result.message}`);
    return false;
  }
  await message.reply('⏳ Processing...');
  return true;
}
```

Apply this to each command block:

### `track <appNo> [dob]` (switch case 'track')
```js
case 'track': {
  const inlineInput = extractAppNoAndDob(parts.slice(1).join(' '));
  const resolvedInput = inlineInput.appNo
    ? inlineInput
    : await extractTrackInputFromMessage(message, parts.slice(1).join(' '));

  if (!resolvedInput.appNo) {
    await message.reply('Usage: track <application_number> [dob]');
    break;
  }
  if (!resolvedInput.dob && !inlineInput.appNo && resolvedInput.rawValue) {
    await startPendingDobFlow(client, message, MessageMedia, resolvedInput.appNo);
    break;
  }
  clearPendingDobRequest(message.from);
  if (resolvedInput.fromReceiptCache) clearReceiptTrackingCandidate(message.from);
  await enqueueOrReply(message, 'whatsapp', {
    command: 'track',
    payload: { appNo: resolvedInput.appNo, dob: resolvedInput.dob || '' },
    chatId: message.from,
  });
  break;
}
```

### `appl` (switch case 'appl')
```js
case 'appl': {
  const args = parts.slice(1);
  const appNo = args[0] || '';
  const dob = normalizeDob(args[1] || '');
  if (!appNo || !dob) { await message.reply('Usage: appl <application_number> <dob>'); break; }
  await enqueueOrReply(message, 'whatsapp', {
    command: 'appl_image',
    payload: { appNo, dob },
    chatId: message.from,
  });
  break;
}
```

### `form1`, `form1a`, `form2` (switch cases)
```js
case 'form1':
case 'form1a':
case 'form2': {
  const args = parts.slice(1);
  const appNo = args[0] || '';
  const dob = normalizeDob(args[1] || '');
  if (!appNo || !dob) { await message.reply(`Usage: ${command} <application_number> <dob>`); break; }
  await enqueueOrReply(message, 'whatsapp', {
    command,
    payload: { appNo, dob },
    chatId: message.from,
  });
  break;
}
```

### `formset` (switch case)
```js
case 'formset': {
  const args = parts.slice(1);
  const appNo = args[0] || '';
  const dob = normalizeDob(args[1] || '');
  if (!appNo || !dob) { await message.reply('Usage: formset <application_number> <dob>'); break; }
  await enqueueOrReply(message, 'whatsapp', {
    command: 'formset',
    payload: { appNo, dob },
    chatId: message.from,
  });
  break;
}
```

### `/llprint` command (before switch, after help)
```js
if (/^\/? llprint(?:\s+.*)?$/i.test(normalizedBody)) {
  const llArgs = normalizedBody.split(/\s+/).slice(1);
  const appNo = llArgs[0];
  const dob = normalizeDob(llArgs[1] || '');
  if (!appNo || !dob) { await message.reply('Usage: /llprint <application_number> <dob>'); return; }
  const senderPhone = (message.from || '').split('@')[0];
  const mobile = senderPhone.length > 10 ? senderPhone.slice(-10) : senderPhone;
  await enqueueOrReply(message, 'whatsapp', {
    command: 'llprint_start',
    payload: { appNo, dob, mobile },
    chatId: message.from,
  });
  return;
}
```
NOTE: Remove the old llprint block that called `startLLPrintFlow` directly.
Keep the OTP submission block (`activeLLPrintFlows.has`) unchanged — it stays inline.
The browserWorker saves the session in `llprintSessions` map. Bot.js OTP handler must
read from browserWorker's `getLlprintSessions()` instead of `activeLLPrintFlows`:

```js
// At top of bot.js, add import:
const { getLlprintSessions } = require('./workers/browserWorker');

// In handleMessage, replace activeLLPrintFlows.has / .get / .delete
// with getLlprintSessions().has / .get / .delete
```

### `list track`
```js
if (/^list\s+track$/i.test(normalizedBody)) {
  await enqueueOrReply(message, 'whatsapp', {
    command: 'list_track', payload: {}, chatId: message.from,
  });
  return;
}
```

### `track status`
```js
if (/^track\s+status$/i.test(normalizedBody)) {
  await enqueueOrReply(message, 'whatsapp', {
    command: 'track_status', payload: {}, chatId: message.from,
  });
  return;
}
```

### `refresh track`
```js
if (/^refresh\s+track$/i.test(normalizedBody)) {
  await enqueueOrReply(message, 'whatsapp', {
    command: 'refresh_track', payload: {}, chatId: message.from,
  });
  return;
}
```

### `track rc <appNo>`
```js
if (trackRcMatch) {
  const extractedRc = await extractRcTrackInputFromMessage(message, trackRcMatch[1] || '');
  const rcAppNo = (trackRcMatch[1] || '').toUpperCase() || extractedRc.appNo || '';
  if (!rcAppNo) { await message.reply('Usage: track rc <application_number>'); return; }
  if (!trackRcMatch[1] || extractedRc.fromReceiptCache) clearRcReceiptTrackingCandidate(message.from);
  await enqueueOrReply(message, 'whatsapp', {
    command: 'track_rc',
    payload: { appNo: rcAppNo, vehicleNo: extractedRc.vehicleNo || '' },
    chatId: message.from,
  });
  return;
}
```

### `add track rc <appNo>`
```js
if (addTrackRcMatch) {
  const extractedRc = await extractRcTrackInputFromMessage(message, addTrackRcMatch[1] || '');
  const rcAppNo = (addTrackRcMatch[1] || '').toUpperCase() || extractedRc.appNo || '';
  const tagValue = addTrackRcMatch[2] || '';
  if (!rcAppNo) { await message.reply('Usage: add track rc <application_number> -tag'); return; }
  if (!addTrackRcMatch[1] || extractedRc.fromReceiptCache) clearRcReceiptTrackingCandidate(message.from);
  await enqueueOrReply(message, 'whatsapp', {
    command: 'add_track_rc',
    payload: { appNo: rcAppNo, tag: tagValue },
    chatId: message.from,
  });
  return;
}
```

### `remove track rc <appNo>`
```js
if (removeTrackRcMatch) {
  await enqueueOrReply(message, 'whatsapp', {
    command: 'remove_track_rc',
    payload: { appNo: removeTrackRcMatch[1] },
    chatId: message.from,
  });
  return;
}
```

### `add track` / `add track <appNo> [dob] -tag`
```js
if (/^add\s+track$/i.test(normalizedBody)) {
  const extracted = await extractTrackInputFromMessage(message);
  if (extracted.appNo) {
    if (extracted.fromReceiptCache) clearReceiptTrackingCandidate(message.from);
    await enqueueOrReply(message, 'whatsapp', {
      command: 'add_track',
      payload: { appNo: extracted.appNo, dob: extracted.dob || '', tag: '' },
      chatId: message.from,
    });
    return;
  }
  await startInteractiveAddTrackFlow(message);
  return;
}

if (addTrackMatch) {
  const explicitAppNo = addTrackMatch[1] || '';
  const explicitDob = normalizeDob(addTrackMatch[2] || '');
  const tag = addTrackMatch[3] || '';
  let resolvedAppNo = explicitAppNo;
  let resolvedDob = explicitDob;
  if (!resolvedAppNo) {
    const extracted = await extractTrackInputFromMessage(message, normalizedBody.replace(/^add\s+track/i, '').trim());
    resolvedAppNo = extracted.appNo;
    resolvedDob = resolvedDob || extracted.dob;
    if (extracted.fromReceiptCache) clearReceiptTrackingCandidate(message.from);
  }
  if (!resolvedAppNo) { await message.reply('Could not determine application number.'); return; }
  await enqueueOrReply(message, 'whatsapp', {
    command: 'add_track',
    payload: { appNo: resolvedAppNo, dob: resolvedDob, tag },
    chatId: message.from,
  });
  return;
}
```

### `remove track <appNo>`
```js
if (removeTrackMatch) {
  await enqueueOrReply(message, 'whatsapp', {
    command: 'remove_track',
    payload: { appNo: removeTrackMatch[1] },
    chatId: message.from,
  });
  return;
}
```

### pendingDob DOB reply
When `pendingDob` flow gets a DOB reply, route via pipeline:
```js
const pendingDob = pendingDobRequests.get(message.from);
if (pendingDob && !/^track\b/i.test(normalizedBody)) {
  const suppliedDob = normalizeDob(normalizedBody);
  if (suppliedDob) {
    clearPendingDobRequest(message.from);
    await enqueueOrReply(message, 'whatsapp', {
      command: 'track',
      payload: { appNo: pendingDob.appNo, dob: suppliedDob },
      chatId: message.from,
    });
    return;
  }
}
```

---

## Fix 2 — Fix `src/workers/apiWorker.js`

### Fix track_rc handler (line ~24)
Replace:
```js
if (job.command === 'track_rc') { await vahanService.startLookup(null, chatId, payload.appNo, transport, { expectedVehicleNo: payload.vehicleNo || '' }); return { ok: true }; }
```

With:
```js
if (job.command === 'track_rc') {
  const vahanClient = makeVahanClient(transport, chatId);
  await vahanService.startLookup(vahanClient, chatId, payload.appNo, transport, { expectedVehicleNo: payload.vehicleNo || '' });
  return { ok: true };
}
```

Add `makeVahanClient` helper at top of apiWorker.js (after imports):
```js
function makeVahanClient(transport, chatId) {
  const fs = require('fs');
  return {
    sendText: async (cid, text) => {
      if (transport === 'telegram') return chatNotifier.sendTelegramMessage(cid, text);
      return chatNotifier.sendWhatsAppText(cid, text);
    },
    sendImage: async (cid, imagePath, caption) => {
      const buf = fs.readFileSync(imagePath);
      const name = String(imagePath).split(/[\\/]/).pop();
      if (transport === 'telegram') return chatNotifier.sendTelegramPhoto(cid, buf, name, caption);
      return chatNotifier.sendWhatsAppImage(cid, buf, name, caption);
    },
  };
}
```

---

## Fix 3 — Partially wire `src/telegramBot.js`

Apply the same `enqueueOrReply` pattern for the key Telegram commands:
- `track`, `form1`, `form1a`, `form2`, `formset`, `appl`, `llprint`, `track rc`, `add track`, `remove track`, `list track`, `track status`, `refresh track`

For Telegram, the `message` object shape is `{ chat: { id }, text }`.
The `requestPipeline.getUserForRequest` already handles Telegram by reading `message.chat.id`.

Use this helper in telegramBot.js:
```js
async function enqueueOrReplyTg(bot, msg, commandInfo) {
  const { processRequest } = require('./core/requestPipeline');
  const result = await processRequest(msg, 'telegram', commandInfo);
  if (result.blocked) {
    await bot.sendMessage(msg.chat.id, `❌ ${result.message}`);
    return false;
  }
  await bot.sendMessage(msg.chat.id, '⏳ Processing...');
  return true;
}
```

---

## Constraints

1. Do NOT change any file other than `bot.js`, `telegramBot.js`, `apiWorker.js`
2. Do NOT remove the `isAuthorized` check — it stays as the first gate in bot.js
3. The interactive add-track flow (`interactiveAddTrackFlows`) stays INLINE — do not queue it
4. The OTP submission block for llprint stays INLINE — only the trigger (`/llprint` command) goes to queue
5. Keep all the `extract*FromMessage` helpers — they are still used for input parsing before enqueue
6. After all changes, run `node -c src/bot.js` and `node -c src/workers/apiWorker.js` to verify no syntax errors

## Verification After Fix
Run:
```bash
node -c src/bot.js
node -c src/telegramBot.js
node -c src/workers/apiWorker.js
node server.js
```
Bot should start without errors. Send `track <appNo> <dob>` — you should see `⏳ Processing...` reply, then result arrives separately via chatNotifier.
