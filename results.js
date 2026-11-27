// Exibição dos resultados, usada no app e na página do link.
export function showPredictions(container, predictions) {
  showWinner(predictions);
  // Atualiza as barras existentes para não recriar a lista várias vezes por segundo.
  while (container.children.length > predictions.length) container.lastChild.remove();
  predictions.forEach(({ className, probability }, index) => {
    let row = container.children[index];
    if (!row) {
      row = document.createElement('div');
      row.className = 'prediction';
      row.innerHTML = '<span></span><div class="bar"><i></i></div><span></span>';
      container.append(row);
    }
    const [name, bar, percent] = row.children;
    name.textContent = className;
    percent.textContent = bar.firstChild.style.width = `${Math.round(probability * 100)}%`;
  });
}

// Frase grande com a resposta; só muda quando a resposta muda, para o leitor de tela não repetir.
function showWinner(predictions) {
  const winner = document.getElementById('winner');
  if (!winner || !predictions.length) return;
  const best = predictions.reduce((a, b) => (b.probability > a.probability ? b : a));
  const text = best.probability < 0.6 ? 'Não tenho certeza…' : `Acho que é: ${best.className}`;
  if (winner.textContent !== text) winner.textContent = text;
}

export function drawOverlay(canvas, engine, pose, size) {
  canvas.width = canvas.height = size;
  if (pose) engine.drawPose(canvas.getContext('2d'), pose);
}
