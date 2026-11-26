// Uma única câmera compartilhada entre a coleta de amostras e o teste.
let stream = null;
let owner = null;
let facing = 'environment';
let mirrored = false;
let request = 0;

export function cropSquare(source, width, height, size, mirror = false) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const side = Math.min(width, height);
  if (mirror) {
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, (width - side) / 2, (height - side) / 2, side, side, 0, 0, size, size);
  return canvas;
}

export async function fileToCanvas(file, size) {
  const bitmap = await createImageBitmap(file);
  const canvas = cropSquare(bitmap, bitmap.width, bitmap.height, size);
  bitmap.close();
  return canvas;
}

function stopTracks() {
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
}

export function closeCamera() {
  request++;
  const previous = owner;
  owner = null;
  stopTracks();
  if (previous) {
    previous.video.srcObject = null;
    previous.onClose();
  }
}

async function attach(video) {
  const id = ++request;
  stopTracks();
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('A câmera ao vivo exige HTTPS (ou localhost). Use o botão de imagens.');
  }
  const next = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 640 } },
  });
  // Outra abertura (ou fechamento) aconteceu enquanto o Android pedia permissão.
  if (id !== request) {
    next.getTracks().forEach(track => track.stop());
    return false;
  }
  stream = next;
  // Webcams sem "facingMode" são tratadas como frontais, igual ao Teachable Machine.
  mirrored = stream.getVideoTracks()[0].getSettings().facingMode !== 'environment';
  video.classList.toggle('mirror', mirrored);
  video.srcObject = stream;
  await video.play().catch(() => {});
  return true;
}

export async function openCamera(video, onClose) {
  closeCamera();
  const mine = { video, onClose };
  owner = mine;
  try {
    return await attach(video);
  } catch (error) {
    if (owner === mine) closeCamera();
    throw error;
  }
}

export async function switchCamera() {
  if (!owner) return;
  facing = facing === 'environment' ? 'user' : 'environment';
  try {
    await attach(owner.video);
  } catch (error) {
    closeCamera();
    throw error;
  }
}

export function grabFrame(size) {
  const video = owner?.video;
  if (!stream || !video?.videoWidth) return null;
  return cropSquare(video, video.videoWidth, video.videoHeight, size, mirrored);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) closeCamera();
});
