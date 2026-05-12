/**
 * Sarathi/Vahan mixed ONNX captcha solver.
 *
 * Model:   sarathi-vahan-217k_mixed_model_v1.onnx  (project root)
 * Input:   name="input_image"  shape=[1, 3, 54, 250]  float32  RGB NCHW  range [0,1]
 * Output:  name="log_softmax"  shape=[63, 1, 63]       float32  CTC time-first
 *
 * Preprocessing (must match training):
 *   1. Alpha-composite onto a white background (handles PNG transparency)
 *   2. Resize height → 54, maintain aspect ratio (BILINEAR)
 *   3. Left-align on a 250×54 white canvas (right-pad with white / crop if too wide)
 *   4. Normalise to [0,1], transpose HWC → CHW, add batch dim
 *
 * CTC decoding:
 *   VOCAB = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"  (62 chars)
 *   blank = index 0,  char k → VOCAB[k-1]
 *   Collapse consecutive duplicates, strip blank tokens.
 *
 * Usage (any service):
 *   const { solveSarathiCaptcha } = require('./sarathiCaptchaSolver');
 *   const text = await solveSarathiCaptcha(imageBuffer);  // Buffer → string
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const ort  = require('onnxruntime-node');
const { Jimp } = require('jimp');

// ──────────────────────────────────────────────────────────────────────────────
// Constants (must match model training config)
// ──────────────────────────────────────────────────────────────────────────────
const MODEL_PATH = path.join(process.cwd(), 'sarathi-vahan-217k_mixed_model_v1.onnx');
const TARGET_H   = 54;
const TARGET_W   = 250;
const VOCAB      = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'; // 62 chars, blank=0

// ──────────────────────────────────────────────────────────────────────────────
// Lazily-initialised ONNX session (created once, shared forever)
// ──────────────────────────────────────────────────────────────────────────────
let _sessionPromise = null;

function getSession() {
  if (!_sessionPromise) {
    if (!fs.existsSync(MODEL_PATH)) {
      throw new Error(`[SarathiCaptcha] Model not found at: ${MODEL_PATH}`);
    }
    console.log(`[SarathiCaptcha] Loading model from ${MODEL_PATH}`);
    _sessionPromise = ort.InferenceSession.create(MODEL_PATH);
  }
  return _sessionPromise;
}

// ──────────────────────────────────────────────────────────────────────────────
// Preprocessing  →  Float32Array  [1, 3, 54, 250]  NCHW
// ──────────────────────────────────────────────────────────────────────────────
async function preprocessCaptcha(imageBytes) {
  // Step 1: Read image
  const img = await Jimp.read(imageBytes);

  // Step 2: Alpha-composite onto a white background (eliminates transparency)
  const bg = new Jimp({ width: img.width, height: img.height, color: 0xffffffff });
  bg.composite(img, 0, 0);

  // Step 3: Resize height → TARGET_H, maintain aspect ratio (BILINEAR via Jimp)
  const ratio = TARGET_H / bg.height;
  const newW  = Math.max(1, Math.round(bg.width * ratio));
  bg.resize({ w: newW, h: TARGET_H });

  // Step 4: Paste onto a TARGET_W × TARGET_H white canvas (left-aligned, right-padded)
  const canvas = new Jimp({ width: TARGET_W, height: TARGET_H, color: 0xffffffff });
  const pasteW = Math.min(newW, TARGET_W);
  canvas.composite(bg.crop({ x: 0, y: 0, w: pasteW, h: TARGET_H }), 0, 0);

  // Step 5: Build [1, 3, TARGET_H, TARGET_W] float32 tensor (RGB, NCHW)
  const { data } = canvas.bitmap; // RGBA uint8
  const channelSize = TARGET_H * TARGET_W;
  const tensor = new Float32Array(3 * channelSize);

  for (let y = 0; y < TARGET_H; y++) {
    for (let x = 0; x < TARGET_W; x++) {
      const srcIdx = (y * TARGET_W + x) * 4;   // RGBA index
      const dstIdx = y * TARGET_W + x;          // pixel index within channel
      tensor[dstIdx]                  = data[srcIdx]     / 255.0; // R
      tensor[channelSize + dstIdx]    = data[srcIdx + 1] / 255.0; // G
      tensor[2 * channelSize + dstIdx]= data[srcIdx + 2] / 255.0; // B
    }
  }

  return new ort.Tensor('float32', tensor, [1, 3, TARGET_H, TARGET_W]);
}

// ──────────────────────────────────────────────────────────────────────────────
// CTC Decoding
// Output shape: [T=63, B=1, C=63]  — time-first, stored flat in row-major order
// blank = index 0,  char k → VOCAB[k-1]
// ──────────────────────────────────────────────────────────────────────────────
function decodeCTC(flatData) {
  const T = 63;   // time steps
  const C = 63;   // num classes (62 chars + 1 blank)

  let prev = null;
  const chars = [];

  for (let t = 0; t < T; t++) {
    // Argmax over classes for this time step (batch index 0)
    let maxIdx = 0;
    let maxVal = -Infinity;
    const base = t * C; // batch size B=1, so stride is just C per time step
    for (let c = 0; c < C; c++) {
      const val = flatData[base + c];
      if (val > maxVal) { maxVal = val; maxIdx = c; }
    }

    // Skip blank (0) and consecutive duplicates
    if (maxIdx !== 0 && maxIdx !== prev) {
      const charIdx = maxIdx - 1;
      if (charIdx >= 0 && charIdx < VOCAB.length) {
        chars.push(VOCAB[charIdx]);
      }
    }
    prev = maxIdx;
  }

  return chars.join('');
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Solve a Sarathi/Vahan captcha image using the local ONNX model.
 *
 * @param {Buffer} imageBytes  Raw image bytes (PNG, JPEG, etc.)
 * @returns {Promise<string>}  Decoded captcha text, or '' on failure.
 */
async function solveSarathiCaptcha(imageBytes) {
  try {
    const session    = await getSession();
    const inputName  = session.inputNames[0];
    const outputName = session.outputNames[0];

    const tensor = await preprocessCaptcha(imageBytes);
    const result = await session.run({ [inputName]: tensor });

    const logits = result[outputName] && result[outputName].data;
    if (!logits || !logits.length) {
      console.error('[SarathiCaptcha] Model returned empty output.');
      return '';
    }

    const prediction = decodeCTC(logits);
    console.log(`[SarathiCaptcha] Solved: "${prediction}"`);
    return prediction;
  } catch (err) {
    console.error(`[SarathiCaptcha] Inference error: ${err.message}`);
    return '';
  }
}

module.exports = { solveSarathiCaptcha };
