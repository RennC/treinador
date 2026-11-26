import image from './image.js';
import pose from './pose.js';
import audio from './audio.js';

export const ENGINES = { image, pose, audio };

// Descobre o tipo de um modelo publicado pelo metadata.json.
export function engineFor(metadata) {
  if (metadata.wordLabels) return audio;
  return metadata.packageName === '@teachablemachine/pose' ? pose : image;
}
