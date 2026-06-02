'use strict';
/**
 * worker-api handlers index
 *
 * Each handler module wraps one or more related API services
 * from the legacy monolith (src/services/) without rewriting business logic.
 *
 * All logic is currently handled inline in processor.js for simplicity.
 * This file serves as the entry point for future modularisation.
 *
 * Handlers:
 *   track.js      — Sarathi application tracking
 *   forms.js      — Form downloads (form1, form1a, form2, formset, ack)
 *   vahan.js      — Vahan RC tracking
 *   status.js     — Multi-track status, list, refresh
 *   autoTrack.js  — Scheduled auto-track polling jobs
 */

module.exports = {};
