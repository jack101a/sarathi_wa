const fs = require('fs');
const ort = require('onnxruntime-node');
const { Jimp } = require('jimp');
const CONFIG = require('../config/config');

const MODEL_INPUT_WIDTH = 140;
const MODEL_INPUT_HEIGHT = 50;
const CAPTCHA_LABELS = 'abcdefghijklmnopqrstuvwxyz0123456789';

let solverSessionPromise = null;

function getModelPath() {
  return CONFIG.VAHAN_TRACK.CAPTCHA_MODEL_PATH;
}

async function getSession() {
  if (!solverSessionPromise) {
    const modelPath = getModelPath();
    if (!fs.existsSync(modelPath)) {
      throw new Error(`Vahan captcha model not found at ${modelPath}`);
    }

    solverSessionPromise = ort.InferenceSession.create(modelPath);
  }

  return solverSessionPromise;
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

async function preprocessCaptcha(buffer) {
  const image = await Jimp.read(buffer);
  image
    .greyscale()
    .contrast(0.35)
    .normalize()
    .resize({ w: MODEL_INPUT_WIDTH, h: MODEL_INPUT_HEIGHT });

  const { data, width, height } = image.bitmap;
  const tensorData = new Float32Array(width * height);

  for (let sourceIndex = 0, targetIndex = 0; sourceIndex < data.length; sourceIndex += 4, targetIndex += 1) {
    // Model expects a single grayscale channel in NCHW order.
    tensorData[targetIndex] = data[sourceIndex] / 255;
  }

  return new ort.Tensor('float32', tensorData, [1, 1, MODEL_INPUT_HEIGHT, MODEL_INPUT_WIDTH]);
}

async function solveCaptcha(buffer) {
  const session = await getSession();
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const tensor = await preprocessCaptcha(buffer);
  const output = await session.run({
    [inputName]: tensor,
  });

  const logits = output[outputName] && output[outputName].data;
  if (!logits || !logits.length) {
    throw new Error('Captcha solver returned an empty response.');
  }

  const winnerIndex = findMaxIndex(logits);
  const prediction = CAPTCHA_LABELS[winnerIndex] || '';
  if (!prediction) {
    throw new Error(`Captcha solver produced an unsupported class index: ${winnerIndex}`);
  }

  return prediction;
}

module.exports = {
  solveCaptcha,
};
