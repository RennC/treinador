// Tela inicial: escolha do tipo de projeto e lista dos projetos salvos.
import { ENGINES } from './engines/index.js';
import { el } from './cards.js';

const $ = selector => document.querySelector(selector);

const frame = (x, content) => `<g transform="translate(${x} 0)"><rect width="96" height="96" rx="14" fill="#fff"/>${content}</g>`;
const art = frames => `<svg viewBox="0 0 320 96" aria-hidden="true">${frames.map((content, i) => frame(i * 112, content)).join('')}</svg>`;

// Ilustrações próprias de cada tipo (conteúdo fixo, sem dados do usuário).
const photo = (sun, hill) => `<circle cx="${sun}" cy="30" r="11" fill="#ffd301"/><path d="M10 80 36 48l18 22 12-12 20 22z" fill="${hill}"/>`;
const person = (leftArm, rightArm) => `<g fill="none" stroke="#212529" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
<path d="M48 36v26M48 62 36 84M48 62l12 22"/><path d="${leftArm}"/><path d="${rightArm}"/></g>
<circle cx="48" cy="22" r="9" fill="#ea590c"/><circle cx="48" cy="40" r="4" fill="#007ec2"/><circle cx="48" cy="62" r="4" fill="#007ec2"/>`;
const wave = (heights, color) => heights.map((h, i) =>
  `<rect x="${14 + i * 10}" y="${48 - h / 2}" width="6" height="${h}" rx="3" fill="${color}"/>`).join('');

const TITLE = { image: 'Imagens', pose: 'Poses', audio: 'Sons' };

const ART = {
  image: art([photo(66, '#007ec2'), photo(30, '#ea590c'), photo(54, '#00679e')]),
  pose: art([person('M48 42 30 56 24 70', 'M48 42 66 56 72 70'), person('M48 42 28 40 18 26', 'M48 42 68 40 78 26'),
    person('M48 42 28 42 14 42', 'M48 42 66 56 72 70')]),
  audio: art([wave([14, 30, 52, 70, 44, 26, 16], '#007ec2'), wave([40, 62, 28, 48, 72, 34, 20], '#ea590c'),
    wave([10, 16, 12, 18, 12, 16, 10], '#00679e')]),
};

export function renderHome({ projects, onCreate, onOpen }) {
  $('#typeList').replaceChildren(...Object.values(ENGINES).map(engine => {
    const picture = el('span', { className: 'art' });
    picture.innerHTML = ART[engine.id];
    const button = el('button', { className: `type-card ${engine.id}` }, picture,
      el('span', { className: 'type-title', textContent: TITLE[engine.id] }),
      el('span', { className: 'type-text', textContent: engine.description }),
      el('span', { className: 'type-action', textContent: 'Começar' }));
    button.onclick = () => onCreate(engine.id);
    return button;
  }));

  $('#recent').hidden = !projects.length;
  const recent = [...projects].sort((a, b) => b.updatedAt - a.updatedAt);
  $('#recentList').replaceChildren(...recent.map(project => {
    const total = project.classes.reduce((sum, c) => sum + c.samples.length, 0);
    const button = el('button', { className: `recent-card ${project.type}` },
      el('strong', { textContent: project.name }),
      el('span', { className: 'help', textContent: `${TITLE[project.type]} · ${total === 1 ? '1 exemplo' : `${total} exemplos`}` }));
    button.onclick = () => onOpen(project);
    return button;
  }));
}
