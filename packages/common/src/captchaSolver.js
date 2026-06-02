/**
 * Merged Sarathi & Vahan ONNX Captcha Solver.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const ort = require('onnxruntime-node');
const { Jimp } = require('jimp');
const CONFIG = require('./config'); // Reference configuration from the same package

// ──────────────────────────────────────────────────────────────────────────────
// Sarathi Captcha Solver Configuration & State
// ──────────────────────────────────────────────────────────────────────────────
// Model: sarathi-vahan-217k_mixed_model_v1.onnx
const SARATHI_MODEL_PATH = path.join(__dirname, '..', '..', '..', 'models', 'sarathi-vahan-217k_mixed_model_v1.onnx');
const SARATHI_TARGET_H = 54;
const SARATHI_TARGET_W = 250;
const SARATHI_VOCAB = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'; // 62 chars, blank=0

let _sarathiSessionPromise = null;

function getSarathiSession() {
  if (!_sarathiSessionPromise) {
    if (!fs.existsSync(SARATHI_MODEL_PATH)) {
      throw new Error(`[SarathiCaptcha] Model not found at: ${SARATHI_MODEL_PATH}`);
    }
    console.log(`[SarathiCaptcha] Loading model from ${SARATHI_MODEL_PATH}`);
    _sarathiSessionPromise = ort.InferenceSession.create(SARATHI_MODEL_PATH);
  }
  return _sarathiSessionPromise;
}

async function preprocessSarathiCaptcha(imageBytes) {
  const img = await Jimp.read(imageBytes);
  const bg = new Jimp({ width: img.bitmap.width, height: img.bitmap.height, color: 0xffffffff });
  bg.composite(img, 0, 0);

  const ratio = SARATHI_TARGET_H / bg.bitmap.height;
  const newW = Math.max(1, Math.round(bg.bitmap.width * ratio));
  bg.resize({ w: newW, h: SARATHI_TARGET_H });

  const canvas = new Jimp({ width: SARATHI_TARGET_W, height: SARATHI_TARGET_H, color: 0xffffffff });
  const pasteW = Math.min(newW, SARATHI_TARGET_W);
  canvas.composite(bg.crop({ x: 0, y: 0, w: pasteW, h: SARATHI_TARGET_H }), 0, 0);

  const { data } = canvas.bitmap; // RGBA uint8
  const channelSize = SARATHI_TARGET_H * SARATHI_TARGET_W;
  const tensor = new Float32Array(3 * channelSize);

  for (let y = 0; y < SARATHI_TARGET_H; y++) {
    for (let x = 0; x < SARATHI_TARGET_W; x++) {
      const srcIdx = (y * SARATHI_TARGET_W + x) * 4;
      const dstIdx = y * SARATHI_TARGET_W + x;
      tensor[dstIdx] = data[srcIdx] / 255.0; // R
      tensor[channelSize + dstIdx] = data[srcIdx + 1] / 255.0; // G
      tensor[2 * channelSize + dstIdx] = data[srcIdx + 2] / 255.0; // B
    }
  }

  return new ort.Tensor('float32', tensor, [1, 3, SARATHI_TARGET_H, SARATHI_TARGET_W]);
}

function decodeCTC(flatData) {
  const T = 63;
  const C = 63;
  let prev = null;
  const chars = [];

  for (let t = 0; t < T; t++) {
    let maxIdx = 0;
    let maxVal = -Infinity;
    const base = t * C;
    for (let c = 0; c < C; c++) {
      const val = flatData[base + c];
      if (val > maxVal) {
        maxVal = val;
        maxIdx = c;
      }
    }

    if (maxIdx !== 0 && maxIdx !== prev) {
      const charIdx = maxIdx - 1;
      if (charIdx >= 0 && charIdx < SARATHI_VOCAB.length) {
        chars.push(SARATHI_VOCAB[charIdx]);
      }
    }
    prev = maxIdx;
  }

  return chars.join('');
}

async function solveSarathiCaptcha(imageBytes) {
  try {
    const session = await getSarathiSession();
    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];

    const tensor = await preprocessSarathiCaptcha(imageBytes);
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

// ──────────────────────────────────────────────────────────────────────────────
// Vahan Captcha Solver Configuration & State
// ──────────────────────────────────────────────────────────────────────────────
// Model: godmode_solver.onnx
const VAHAN_MODEL_INPUT_WIDTH = 140;
const VAHAN_MODEL_INPUT_HEIGHT = 50;
const VAHAN_CAPTCHA_LABELS = 'abcdefghijklmnopqrstuvwxyz0123456789';

let _vahanSessionPromise = null;

function getVahanModelPath() {
  // If CONFIG.VAHAN_TRACK has CAPTCHA_MODEL_PATH, use it
  if (CONFIG && CONFIG.VAHAN_TRACK && CONFIG.VAHAN_TRACK.CAPTCHA_MODEL_PATH) {
    // If it is absolute, use as is, else resolve relative to project root
    const mp = CONFIG.VAHAN_TRACK.CAPTCHA_MODEL_PATH;
    if (path.isAbsolute(mp)) return mp;
    return path.join(__dirname, '..', '..', '..', mp);
  }
  return path.join(__dirname, '..', '..', '..', 'models', 'godmode_solver.onnx');
}

async function getVahanSession() {
  if (!_vahanSessionPromise) {
    const modelPath = getVahanModelPath();
    if (!fs.existsSync(modelPath)) {
      throw new Error(`Vahan captcha model not found at ${modelPath}`);
    }
    console.log(`[VahanCaptcha] Loading model from ${modelPath}`);
    _vahanSessionPromise = ort.InferenceSession.create(modelPath);
  }
  return _vahanSessionPromise;
}

function findMaxIndex(values) {
  let maxIndex = 0;
  let maxValue = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] > maxValue) {
      maxValue = values[index];
      maxIndex = index;
    }
  }
  return maxIndex;
}

async function preprocessVahanCaptcha(buffer) {
  const image = await Jimp.read(buffer);
  image
    .greyscale()
    .contrast(0.35)
    .normalize()
    .resize({ w: VAHAN_MODEL_INPUT_WIDTH, h: VAHAN_MODEL_INPUT_HEIGHT });

  const { data, width, height } = image.bitmap;
  const tensorData = new Float32Array(width * height);

  for (let sourceIndex = 0, targetIndex = 0; sourceIndex < data.length; sourceIndex += 4, targetIndex += 1) {
    tensorData[targetIndex] = data[sourceIndex] / 255;
  }

  return new ort.Tensor('float32', tensorData, [1, 1, VAHAN_MODEL_INPUT_HEIGHT, VAHAN_MODEL_INPUT_WIDTH]);
}

async function solveVahanCaptcha(buffer) {
  try {
    const session = await getVahanSession();
    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    
    const tensor = await preprocessVahanCaptcha(buffer);
    const output = await session.run({
      [inputName]: tensor,
    });

    const logits = output[outputName] && output[outputName].data;
    if (!logits || !logits.length) {
      throw new Error('Captcha solver returned an empty response.');
    }

    const winnerIndex = findMaxIndex(logits);
    const prediction = VAHAN_CAPTCHA_LABELS[winnerIndex] || '';
    if (!prediction) {
      throw new Error(`Captcha solver produced an unsupported class index: ${winnerIndex}`);
    }

    return prediction;
  } catch (err) {
    console.error(`[VahanCaptcha] Inference error: ${err.message}`);
    return '';
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Initialization
// ──────────────────────────────────────────────────────────────────────────────
async function init() {
  await Promise.all([
    getSarathiSession().catch(() => {}),
    getVahanSession().catch(() => {})
  ]);
}

module.exports = {
  solveSarathiCaptcha,
  solveVahanCaptcha,
  init
};
