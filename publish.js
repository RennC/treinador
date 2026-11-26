// Publicação do modelo: no GitHub Pages (sem servidor) ou no servidor próprio (server.js).
const API = 'https://api.github.com';
const STORAGE_KEY = 'treinador-github';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

// ---------- Configuração do GitHub (fica somente neste aparelho) ----------

export function githubSettings() {
  try {
    const settings = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return settings?.owner && settings.repo && settings.token ? settings : null;
  } catch {
    return null;
  }
}

export function checkSettings(input) {
  const settings = Object.fromEntries(
    ['owner', 'repo', 'branch', 'token', 'site'].map(key => [key, String(input[key] ?? '').trim()]));
  settings.branch ||= 'main';
  if (!/^[A-Za-z0-9-]+$/.test(settings.owner)) throw new Error('Informe o usuário ou a organização do GitHub (sem espaços).');
  if (!/^[A-Za-z0-9_.-]+$/.test(settings.repo) || /^\.+$/.test(settings.repo)) throw new Error('Informe só o nome do repositório, sem o endereço.');
  if (!/^[A-Za-z0-9_./-]+$/.test(settings.branch) || settings.branch.includes('..')) throw new Error('Nome de branch inválido.');
  if (!settings.token) throw new Error('Informe o token de acesso.');
  if (settings.site && !/^https:\/\/\S+$/.test(settings.site)) throw new Error('O endereço do site precisa começar com https://');
  return settings;
}

export function saveGitHubSettings(input) {
  const settings = checkSettings(input);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  return settings;
}

export const forgetGitHub = () => localStorage.removeItem(STORAGE_KEY);

export const repoName = settings => `${settings.owner}/${settings.repo}`.toLowerCase();

export function siteUrl({ owner, repo, site }) {
  if (site) return site.replace(/\/*$/, '/');
  const host = `${owner.toLowerCase()}.github.io`;
  return repo.toLowerCase() === host ? `https://${host}/` : `https://${host}/${repo}/`;
}

// ---------- API do GitHub ----------

function explain(status, message = '') {
  if (status === 401) return 'Token inválido ou vencido.';
  if (status === 403 || status === 429) {
    return /rate limit/i.test(message)
      ? 'O limite de uso do GitHub foi atingido. Tente de novo mais tarde.'
      : 'O token não tem permissão de escrita ("Contents: Read and write") neste repositório.';
  }
  if (status === 404) return 'Repositório ou branch não encontrado, ou o token não tem acesso a ele.';
  if (status === 409) return 'O repositório está vazio. Crie um arquivo README nele e tente de novo.';
  return `O GitHub respondeu ${status}${message ? `: ${message}` : ''}.`;
}

async function github(settings, path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`${API}/repos/${settings.owner}/${settings.repo}${path}`, {
      method,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${settings.token}`,
        ...(body && { 'Content-Type': 'application/json' }),
      },
      body: body && JSON.stringify(body),
    });
  } catch {
    throw new Error('Sem conexão com o GitHub.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(explain(response.status, data.message)), { status: response.status });
  return data;
}

export const testGitHub = settings => github(settings, `/git/ref/heads/${settings.branch}`);

const randomId = () => Array.from(crypto.getRandomValues(new Uint32Array(9)), n => ALPHABET[n % ALPHABET.length]).join('');

// Grava os arquivos do modelo em um único commit, o que gera uma única publicação no Pages.
export async function publishToGitHub(files, previous, settings, previewPage) {
  const id = previous?.id ?? randomId();
  const contents = [
    ['model.json', JSON.stringify(files.model), 'utf-8'],
    ['metadata.json', JSON.stringify(files.metadata), 'utf-8'],
    ['model.weights.bin', files.weights, 'base64'],
    ['index.html', previewPage, 'utf-8'],
  ];
  // ".nojekyll" faz o Pages entregar os arquivos como estão.
  const tree = [{ path: '.nojekyll', mode: '100644', type: 'blob', content: '' }];
  for (const [name, content, encoding] of contents) {
    const { sha } = await github(settings, '/git/blobs', { method: 'POST', body: { content, encoding } });
    tree.push({ path: `models/${id}/${name}`, mode: '100644', type: 'blob', sha });
  }

  for (let attempt = 1; ; attempt++) {
    const parent = (await testGitHub(settings)).object.sha;
    const base = (await github(settings, `/git/commits/${parent}`)).tree.sha;
    const next = await github(settings, '/git/trees', { method: 'POST', body: { base_tree: base, tree } });
    const commit = await github(settings, '/git/commits', {
      method: 'POST',
      body: { message: `${previous ? 'Atualiza' : 'Publica'} o modelo ${id}`, tree: next.sha, parents: [parent] },
    });
    try {
      await github(settings, `/git/refs/heads/${settings.branch}`, { method: 'PATCH', body: { sha: commit.sha } });
      break;
    } catch (error) {
      // Outro aparelho publicou no mesmo instante: refaz o commit em cima do mais novo.
      if (error.status !== 422 || attempt >= 3) throw error;
    }
  }
  return { target: 'github', repo: repoName(settings), id, url: `${siteUrl(settings)}models/${id}/` };
}

// O Pages leva um tempo para colocar o commit no ar.
export async function waitUntilLive(url, timeStamp, { tries = 36, delay = 5000 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const response = await fetch(`${url}metadata.json?${Date.now()}`, { cache: 'no-store' });
      if (response.ok && (await response.json()).timeStamp === timeStamp) return true;
    } catch { /* ainda não está no ar */ }
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  return false;
}

// Página de teste que fica no próprio link, usando os arquivos deste app.
export async function previewPage(appUrl) {
  const response = await fetch(new URL('preview.html', appUrl));
  const html = response.ok ? await response.text() : '';
  const marker = '<base href="../../">';
  if (!html.includes(marker)) throw new Error('Não foi possível montar a página do link.');
  return html.replace(marker, () => `<base href="${appUrl}">`);
}

// ---------- Servidor próprio ----------

export async function publishToServer(files, previous, key) {
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers['X-Publish-Key'] = key;
  if (previous) headers['X-Model-Token'] = previous.token;
  const response = await fetch(previous ? `api/models/${previous.id}` : 'api/models', {
    method: previous ? 'PUT' : 'POST',
    headers,
    body: JSON.stringify(files),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `o servidor respondeu ${response.status}`);
  return { target: 'server', id: body.id, url: body.url, token: body.token || previous.token };
}
