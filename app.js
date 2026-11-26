import { store } from './store.js';
import { closeCamera } from './camera.js';
import { ENGINES } from './engines/index.js';
import { classCard, stopRecording, el } from './cards.js';
import { createTester } from './tester.js';
import { renderHome } from './home.js';
import {
  githubSettings, checkSettings, saveGitHubSettings, forgetGitHub, testGitHub, repoName, siteUrl,
  publishToGitHub, publishToServer, previewPage, waitUntilLive,
} from './publish.js';

const $ = selector => document.querySelector(selector);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

let projects = [];
let project;
let model = null;      // modelo treinado, em memória
let stale = false;     // amostras/classes mudaram depois do treino
let busy = false;      // treinando ou publicando
let saveTimer = null;
let serverAvailable = false; // há um server.js atendendo este endereço
let publication = 0;

const engine = () => ENGINES[project.type];
const labelOf = (cls, index) => cls.name.trim() || `Class ${index + 1}`;

function notify(message) {
  $('#notice').textContent = message || '';
  $('#notice').hidden = !message;
  if (message) $('#notice').scrollIntoView({ block: 'nearest' });
}

const tester = createTester({
  getTarget: () => model && !stale && !busy ? { engine: engine(), model } : null,
  notify,
  beforeStart: stopRecording,
});

// Libera câmera e microfone.
function releaseMedia() {
  stopRecording();
  tester.stop();
  closeCamera();
}

// ---------- Projetos ----------

function blankProject(type, name) {
  return {
    id: newId(),
    type,
    name,
    updatedAt: Date.now(),
    classes: ENGINES[type].defaultClasses().map(className => ({ id: newId(), name: className, samples: [] })),
    params: { ...ENGINES[type].params },
    published: null,
  };
}

async function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!project) return;
  try {
    await store.put(project);
  } catch (error) {
    notify(`Não foi possível salvar o projeto no tablet: ${error?.message || error}`);
  }
}

function save() {
  project.updatedAt = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 400);
}

const optionText = p => `${p.name} · ${ENGINES[p.type].title}`;

function renderProjectList() {
  $('#projectSelect').replaceChildren(...projects.map(p => el('option', { value: p.id, textContent: optionText(p) })));
  $('#projectSelect').value = project.id;
}

function showProject(next) {
  releaseMedia();
  discardModel();
  project = next;
  localStorage.setItem('lastProject', project.id);
  renderProjectList();
  $('#projectName').value = project.name;
  $('#epochs').value = project.params.epochs;
  $('#batchSize').value = project.params.batchSize;
  $('#learningRate').value = project.params.learningRate;
  $('#previewPanel').dataset.media = engine().media;
  $('#overlay').getContext('2d').clearRect(0, 0, $('#overlay').width, $('#overlay').height);
  updateStatus();
  notify('');
  renderClasses();
  refresh();
}

// ---------- Telas ----------

// "#projeto" mostra o projeto aberto; sem isso, a tela inicial. Assim o botão voltar do Android funciona.
function showView() {
  const editing = location.hash === '#projeto' && Boolean(project);
  if (!editing) {
    releaseMedia();
    notify('');
    renderHome({ projects, onCreate: createProject, onOpen: openProject });
  }
  $('#home').hidden = editing;
  $('#editor').hidden = $('#projectBar').hidden = !editing;
}

function openEditor() {
  location.hash = 'projeto';
  showView();
  window.scrollTo(0, 0);
}

function goHome() {
  if (busy) return;
  location.hash = '';
  showView();
  window.scrollTo(0, 0);
}

async function openProject(next) {
  // Voltar ao mesmo projeto mantém o modelo já treinado.
  if (next !== project) {
    await flush();
    showProject(next);
  }
  openEditor();
}

async function createProject(type) {
  await flush();
  let number = projects.length + 1;
  while (projects.some(p => p.name === `Projeto ${number}`)) number++;
  const next = blankProject(type, `Projeto ${number}`);
  projects.unshift(next);
  showProject(next);
  openEditor();
  await flush();
}

// ---------- Classes ----------

function dataChanged() {
  if (model) {
    stale = true;
    tester.stop();
    tester.clear();
  }
  updateStatus();
  save();
  refresh();
}

// Orienta o próximo passo. Mensagens de resultado ou erro ficam até os dados mudarem.
function updateStatus() {
  let training = 'Pronto para treinar.';
  if (model && stale) training = 'As amostras mudaram. Treine novamente.';
  else if (project.classes.length < 2) training = 'Crie pelo menos 2 classes.';
  else if (!canTrain()) training = engine().requirement;
  $('#trainStatus').textContent = training;
  $('#trainWarning').hidden = true;
  $('#publishStatus').textContent = model && stale
    ? 'Treine novamente antes de publicar.'
    : 'Treine o modelo para publicar.';
}

const cardContext = () => ({
  engine: engine(),
  project,
  notify,
  changed: dataChanged,
  beforeCapture: () => { stopRecording(); tester.stop(); },
  renamed(cls) {
    // Renomear não exige treinar de novo: o nome só vai no metadata.json.
    const index = project.classes.indexOf(cls);
    if (model && !stale) model.setLabel(index, labelOf(cls, index));
    save();
  },
  remove(cls) {
    if (cls.samples.length && !confirm(`Remover "${cls.name}" e suas ${cls.samples.length} amostras?`)) return;
    releaseMedia();
    project.classes.splice(project.classes.indexOf(cls), 1);
    renderClasses();
    dataChanged();
  },
});

function renderClasses() {
  const context = cardContext();
  $('#classList').replaceChildren(...project.classes.map(cls => classCard(cls, context)));
}

// ---------- Treinamento ----------

function discardModel() {
  tester.stop();
  tester.clear();
  const previous = model;
  model = null;
  stale = false;
  // Liberar memória não pode impedir o próximo passo.
  Promise.resolve().then(() => previous?.dispose()).catch(() => {});
}

const canTrain = () => project.classes.length >= 2
  && project.classes.every((cls, index) => cls.samples.length >= engine().minimum(index));

function readParams() {
  const defaults = engine().params;
  const clamp = (value, min, max, fallback) => Number.isFinite(value) && value >= min ? Math.min(value, max) : fallback;
  project.params = {
    epochs: Math.round(clamp($('#epochs').valueAsNumber, 1, 1000, defaults.epochs)),
    batchSize: Number($('#batchSize').value),
    learningRate: clamp($('#learningRate').valueAsNumber, 0.00001, 1, defaults.learningRate),
  };
  $('#epochs').value = project.params.epochs;
  $('#learningRate').value = project.params.learningRate;
  save();
}

async function train() {
  if (busy || !canTrain()) return;
  if (!window.tf) {
    notify('As bibliotecas de IA não carregaram. Conecte à internet e recarregue a página.');
    return;
  }
  readParams();
  releaseMedia();
  discardModel();
  notify('');
  setBusy(true);
  document.body.classList.add('training');
  const status = $('#trainStatus');
  const bar = $('#trainProgress');
  bar.hidden = false;
  $('#trainWarning').hidden = true;
  const progress = (fraction, text) => {
    if (fraction === null) bar.removeAttribute('value');
    else bar.value = fraction;
    status.textContent = text;
  };
  try {
    const classes = project.classes.map((cls, index) => ({ name: labelOf(cls, index), samples: cls.samples }));
    model = await engine().train(classes, project.params, progress);
    status.textContent = model.accuracy === undefined
      ? 'Modelo treinado.'
      : `Modelo treinado. Acerto na validação: ${Math.round(model.accuracy * 100)}%.`;
    $('#trainWarning').textContent = model.warning || '';
    $('#trainWarning').hidden = !model.warning;
    $('#publishStatus').textContent = 'Modelo pronto para publicar.';
  } catch (error) {
    console.error(error);
    status.textContent = 'O treinamento falhou.';
    notify(`Erro no treinamento: ${error.message || error}`);
  } finally {
    bar.hidden = true;
    document.body.classList.remove('training');
    setBusy(false);
  }
}

// ---------- Publicação ----------

// O GitHub, quando configurado, tem prioridade sobre o servidor próprio.
const publishMode = () => githubSettings() || !serverAvailable ? 'github' : 'server';

// O link só pode ser atualizado no mesmo lugar em que foi criado.
function updatableLink() {
  const published = project.published;
  if (!published || (published.target || 'server') !== publishMode()) return null;
  if (published.target === 'github' && published.repo !== repoName(githubSettings() ?? { owner: '', repo: '' })) return null;
  return published;
}

async function publish(asNew) {
  if (busy || !model || stale) return;
  const mode = publishMode();
  const settings = githubSettings();
  const status = $('#publishStatus');
  if (mode === 'github' && !settings) {
    status.textContent = 'Preencha "Publicação no GitHub Pages" e toque em Salvar.';
    $('#githubPanel').open = true;
    return;
  }
  const previous = asNew ? null : updatableLink();
  const target = project;
  const current = ++publication;
  tester.stop();
  setBusy(true);
  status.textContent = 'Enviando o modelo…';
  try {
    const files = await model.export();
    if (mode === 'github') {
      const page = await previewPage(new URL('./', location.href).href);
      target.published = await publishToGitHub(files, previous, settings, page);
    } else {
      const key = $('#publishKey').value.trim();
      target.published = await publishToServer(files, previous, key);
      localStorage.setItem('publishKey', key);
    }
    await flush();
    const done = previous ? 'Link atualizado com o modelo novo.' : 'Link gerado.';
    if (mode === 'server') {
      status.textContent = done;
    } else {
      status.textContent = 'Modelo enviado. Aguardando o GitHub publicar (costuma levar alguns minutos)…';
      // A espera não trava a tela; a mensagem só vale se nada mais recente aconteceu.
      waitUntilLive(target.published.url, files.metadata.timeStamp).then(live => {
        if (current !== publication || project !== target || stale) return;
        status.textContent = live
          ? `${done} Já está no ar.`
          : 'O GitHub ainda não publicou. Confira se o Pages está ativado no repositório e abra o link em instantes.';
      });
    }
  } catch (error) {
    status.textContent = `Falha ao publicar: ${error.message}`;
  } finally {
    setBusy(false);
  }
}

// ---------- Configuração do GitHub ----------

const GITHUB_FIELDS = { owner: '#ghOwner', repo: '#ghRepo', branch: '#ghBranch', token: '#ghToken', site: '#ghSite' };

function fillGitHubForm() {
  const saved = githubSettings();
  // No próprio GitHub Pages o usuário já aparece no endereço.
  const owner = location.hostname.endsWith('.github.io') ? location.hostname.split('.')[0] : '';
  for (const [key, selector] of Object.entries(GITHUB_FIELDS)) {
    $(selector).value = saved?.[key] ?? (key === 'owner' ? owner : '');
  }
}

$('#ghSave').onclick = async () => {
  const status = $('#ghStatus');
  const input = Object.fromEntries(Object.entries(GITHUB_FIELDS).map(([key, selector]) => [key, $(selector).value]));
  $('#ghSave').disabled = true;
  try {
    const settings = checkSettings(input);
    status.textContent = 'Conferindo o repositório…';
    await testGitHub(settings);
    saveGitHubSettings(settings);
    $('#keyRow').hidden = true;
    status.textContent = `Repositório encontrado. Os links começarão com ${siteUrl(settings)}models/. A permissão de escrita é confirmada na primeira publicação.`;
  } catch (error) {
    status.textContent = `Não foi salvo: ${error.message}`;
  } finally {
    $('#ghSave').disabled = false;
    if (project) refresh();
  }
};

$('#ghForget').onclick = () => {
  forgetGitHub();
  fillGitHubForm();
  $('#ghStatus').textContent = 'Token apagado deste aparelho.';
  if (project) refresh();
};

$('#publishButton').onclick = () => publish(false);
$('#publishNewButton').onclick = () => publish(true);
$('#copyLink').onclick = async () => {
  const input = $('#modelLink');
  try {
    await navigator.clipboard.writeText(input.value);
  } catch {
    input.select();
    document.execCommand('copy');
  }
  $('#publishStatus').textContent = 'Link copiado.';
};
$('#shareLink').hidden = !navigator.share;
$('#shareLink').onclick = () => navigator.share({ title: project.name, url: $('#modelLink').value }).catch(() => {});

// ---------- Estado da tela ----------

function setBusy(value) {
  busy = value;
  // Trocar ou excluir o projeto no meio de um treino/envio perderia o resultado.
  document.body.classList.toggle('busy', value);
  refresh();
}

function refresh() {
  const ready = Boolean(model) && !stale && !busy;
  $('#trainButton').disabled = busy || !canTrain();
  tester.update();

  const published = project.published;
  const updatable = Boolean(updatableLink());
  $('#publishButton').disabled = !ready;
  $('#publishButton').textContent = updatable ? 'Atualizar o mesmo link' : 'Gerar link';
  $('#publishNewButton').hidden = !updatable;
  $('#publishNewButton').disabled = !ready;
  $('#linkBox').hidden = !published;
  if (published) {
    $('#modelLink').value = published.url;
    $('#openLink').href = published.url;
    $('#snippet').textContent = engine().snippet(published.url);
  }
}

// ---------- Início ----------

$('#trainButton').onclick = train;
for (const id of ['#epochs', '#batchSize', '#learningRate']) $(id).onchange = readParams;

$('#addClass').onclick = () => {
  releaseMedia();
  let number = project.classes.length + 1;
  while (project.classes.some(c => c.name === `Class ${number}`)) number++;
  project.classes.push({ id: newId(), name: `Class ${number}`, samples: [] });
  $('#classList').append(classCard(project.classes.at(-1), cardContext()));
  dataChanged();
};

$('#projectSelect').onchange = async event => {
  const next = projects.find(p => p.id === event.target.value);
  await flush();
  showProject(next);
};
$('#projectName').oninput = event => {
  project.name = event.target.value.trim() || 'Sem nome';
  $('#projectSelect').selectedOptions[0].textContent = optionText(project);
  save();
};

$('#homeButton').onclick = goHome;
$('.brand').onclick = event => {
  event.preventDefault();
  goHome();
};
window.addEventListener('hashchange', () => {
  // Durante um treino ou envio, o botão voltar não sai do projeto.
  if (busy && location.hash !== '#projeto') location.hash = 'projeto';
  else showView();
});

$('#deleteProject').onclick = async () => {
  if (!confirm(`Excluir o projeto "${project.name}" deste tablet? Links já publicados continuam no ar.`)) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  releaseMedia();
  discardModel();
  const removed = project;
  await store.remove(removed.id);
  projects = projects.filter(p => p !== removed);
  project = undefined;
  goHome();
};

window.addEventListener('pagehide', () => { if (saveTimer) flush(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) flush(); });

async function start() {
  projects = (await store.all()).sort((a, b) => b.updatedAt - a.updatedAt);
  // Projetos criados antes dos tipos são de imagem.
  for (const item of projects) item.type ??= 'image';
  // Ao recarregar dentro de um projeto, volta para ele; senão, abre a tela inicial.
  const last = projects.find(p => p.id === localStorage.getItem('lastProject'));
  if (location.hash === '#projeto' && last) showProject(last);
  showView();

  navigator.storage?.persist?.().catch(() => {});
  if (!window.isSecureContext) {
    notify('Endereço sem HTTPS: câmera ao vivo e microfone ficam bloqueados. Acesse por HTTPS.');
  }
  navigator.serviceWorker?.register('sw.js').catch(error => console.warn('Sem modo offline:', error));

  $('#publishKey').value = localStorage.getItem('publishKey') || '';
  fillGitHubForm();
  try {
    const response = await fetch('api/config');
    const config = response.ok ? await response.json() : null;
    serverAvailable = typeof config?.requiresKey === 'boolean';
    $('#keyRow').hidden = !config?.requiresKey || publishMode() !== 'server';
  } catch { /* sem servidor próprio: publica pelo GitHub */ }
  $('#githubPanel').open = publishMode() === 'github' && !githubSettings();
  if (project) refresh();
}

start().catch(error => notify(`Não foi possível iniciar o aplicativo: ${error.message || error}`));
