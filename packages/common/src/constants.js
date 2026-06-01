/**
 * Shared Application Constants
 */

'use strict';

const SERVICES = {
  TRACK: 'track',
  TRACK_MULTIPLE: 'track_multiple',
  TRACK_RC: 'track_rc',
  TRACK_STATUS: 'track_status',
  ADD_TRACK: 'add_track',
  REMOVE_TRACK: 'remove_track',
  LIST_TRACK: 'list_track',
  REFRESH_TRACK: 'refresh_track',
  FORM1: 'form1',
  FORM1A: 'form1a',
  FORM2: 'form2',
  FORMSET: 'formset',
  APPL_PDF: 'appl_pdf',
  SLOT_PDF: 'slot_pdf',
  ALIVE: 'alive',
  VAHAN_TRACK: 'vahan_track',
  VAHAN_ADD: 'vahan_add',
  VAHAN_REMOVE: 'vahan_remove',
  VAHAN_LIST: 'vahan_list',
  VAHAN_REFRESH: 'vahan_refresh',
  RESEND_OTP: 'resend_otp',
  LLPRINT_START: 'llprint_start',
  FEE_PRINT_START: 'fee_print_start',
  PAY_FEE_START: 'pay_fee_start',
  SLOT_BOOKING_START: 'slot_booking_start',
  DL_INFO_START: 'dl_info_start',
  LLEDIT_START: 'lledit_start',
  DL_RENEWAL_START: 'dl_renewal_start',
  APPLY_DL_START: 'apply_dl_start',
  MOBUPDATE_START: 'mobupdate_start'
};

const CATEGORIES = {
  LIGHT: 'light',
  MEDIUM: 'medium',
  HEAVY: 'heavy'
};

const QUEUE_TYPES = {
  API: 'api',
  BROWSER: 'browser'
};

module.exports = {
  SERVICES,
  CATEGORIES,
  QUEUE_TYPES
};
