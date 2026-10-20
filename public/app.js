import { FRAG } from './shader.frag.js';

const DEFAULTS = {
  baseColor: [0.35, 0.55, 0.95],
  lightColor: [1, 1, 1],
  lightDir: [-0.5, 0.6, 0.7],
  lightIntensity: 1,
  roughness: 0.5,
  shadowStrength: 0.5,
  ambient: 0.2,
  animateLight: false,
};

const CHIPS = [
  'Make it deep blue and very shiny',
  'Warm sunset light from the left, strong shadows',
  'Matte emerald green, soft ambient light',
  'Gold metal, harsh light from above',
];

const GEMMA_FAILED = 'Gemma could not answer right now. Please try again in a few seconds.';

const VERTEX = `#version 300 es
in vec2 corner;
void main() { gl_Position = vec4(corner, 0.0, 1.0); }`;

const UNIFORMS = [
  'uTime', 'uResolution', 'uBaseColor', 'uLightColor', 'uLightDir',
  'uLightIntensity', 'uRoughness', 'uShadowStrength', 'uAmbient',
];

const $ = (id) => document.getElementById(id);

let params = structuredClone(DEFAULTS);

function setParams(next) {
  params = next;
  const round = (_, value) => (typeof value === 'number' ? Math.round(value * 100) / 100 : value);
  $('readout').textContent = Object.entries(params)
    .map(([key, value]) => `${key}: ${JSON.stringify(value, round)}`)
    .join('\n');
}

let toastTimer;
function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), 4000);
}

function startRenderer(canvas) {
  const gl = canvas.getContext('webgl2');

  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAG]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  gl.useProgram(program);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const corner = gl.getAttribLocation(program, 'corner');
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);

  const loc = Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]));

  const frame = (ms) => {
    const width = Math.round(innerWidth * devicePixelRatio);
    const height = Math.round(innerHeight * devicePixelRatio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);

    const spin = params.animateLight ? ms / 1000 : 0;
    const [x, y, z] = params.lightDir;
    gl.uniform1f(loc.uTime, ms / 1000);
    gl.uniform2f(loc.uResolution, width, height);
    gl.uniform3fv(loc.uBaseColor, params.baseColor);
    gl.uniform3fv(loc.uLightColor, params.lightColor);
    gl.uniform3f(loc.uLightDir, x * Math.cos(spin) + z * Math.sin(spin), y, z * Math.cos(spin) - x * Math.sin(spin));
    gl.uniform1f(loc.uLightIntensity, params.lightIntensity);
    gl.uniform1f(loc.uRoughness, params.roughness);
    gl.uniform1f(loc.uShadowStrength, params.shadowStrength);
    gl.uniform1f(loc.uAmbient, params.ambient);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const { error } = await response.json().catch(() => ({}));
    throw new Error(error ?? 'Request failed');
  }
  return response;
}

async function speak(message) {
  try {
    const response = await postJson('/api/speak', { text: message });
    new Audio(URL.createObjectURL(await response.blob())).play();
  } catch (error) {
    console.error(error);
  }
}

async function runCommand(input) {
  const text = input.trim();
  if (!text) return;
  $('say').textContent = '';
  $('panel').classList.add('busy');
  try {
    const response = await postJson('/api/command', { text, params });
    const { params: next, explanation } = await response.json();
    setParams(next);
    $('say').textContent = explanation;
    speak(explanation);
  } catch (error) {
    console.error(error);
    toast(GEMMA_FAILED);
    speak(GEMMA_FAILED);
  } finally {
    $('panel').classList.remove('busy');
  }
}

const toBase64 = (blob) =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(blob);
  });

let holding = false;
let recorder;

async function transcribe(blob) {
  try {
    const response = await postJson('/api/transcribe', { audioBase64: await toBase64(blob) });
    const { text } = await response.json();
    if (!text) return toast("Didn't catch that");
    $('text').value = text;
    runCommand(text);
  } catch (error) {
    toast(error.message);
  }
}

async function startTalking() {
  holding = true;
  $('mic').classList.add('live');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return toast('Microphone unavailable');
  }
  if (!holding) return stream.getTracks().forEach((track) => track.stop());

  const chunks = [];
  recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (event) => chunks.push(event.data);
  recorder.onstop = () => {
    stream.getTracks().forEach((track) => track.stop());
    transcribe(new Blob(chunks));
  };
  recorder.start();
}

function stopTalking() {
  holding = false;
  $('mic').classList.remove('live');
  if (recorder?.state === 'recording') recorder.stop();
}

for (const text of CHIPS) {
  const chip = document.createElement('button');
  chip.textContent = text;
  chip.onclick = () => {
    $('text').value = text;
    runCommand(text);
  };
  $('chips').append(chip);
}

$('form').onsubmit = (event) => {
  event.preventDefault();
  runCommand($('text').value);
};
$('reset').onclick = () => {
  setParams(structuredClone(DEFAULTS));
  $('say').textContent = '';
};
$('mic').onpointerdown = startTalking;
$('mic').onpointerup = stopTalking;
$('mic').onpointerleave = stopTalking;
$('mic').onpointercancel = stopTalking;

setParams(params);
startRenderer($('canvas'));
