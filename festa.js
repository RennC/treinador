// Elementos lúdicos: confete ao terminar o treino e o botão para parar as animações.
const KEY = 'zoom-calm'; // a cópia do playground, no mesmo endereço, lê a mesma escolha
const COLORS = ['#0082c6', '#b2d235', '#fed500', '#f26522'];

const calm = () => document.documentElement.classList.contains('calm')
  || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function setupCalmButton(button) {
  const apply = value => {
    document.documentElement.classList.toggle('calm', value);
    button.setAttribute('aria-pressed', String(value));
    button.textContent = value ? 'Ligar animações' : 'Parar animações';
  };
  apply(localStorage.getItem(KEY) === '1');
  button.onclick = () => {
    const value = !document.documentElement.classList.contains('calm');
    localStorage.setItem(KEY, value ? '1' : '0');
    apply(value);
  };
}

// Uma chuva curta de confete, só decorativa.
export function celebrate() {
  if (calm()) return;
  const layer = document.createElement('div');
  layer.className = 'confetti';
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement('i');
    piece.style.cssText = `left:${Math.random() * 100}%;background:${COLORS[i % COLORS.length]};`
      + `animation-delay:${Math.random() * 0.5}s;animation-duration:${1.6 + Math.random()}s`;
    layer.append(piece);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 3200);
}
