/*
  dados.js — cliente da API do WhatsApp 360° Vision.

  Único ponto do painel que fala com o servidor. Nenhum módulo de tela monta URL,
  guarda token ou formata número por conta própria: tudo passa por aqui.

  Contrato (seções 2 e 3 do CONTRATO.md):
    POST  https://www.n8nclouddaco.agentedaco.com.br/webhook/painel-rede-v1
    corpo     { acao, token, args }
    resposta  { ok: true, dados: {…} }  |  { ok: false, erro: "texto em português" }

  Três promessas deste arquivo:
  1. Nunca devolve dado inventado. Sem mock, sem exemplo, sem valor de reserva.
     Se o servidor não mandou, o módulo recebe null e desenha o estado vazio.
  2. null nunca vira 0. `ou()` devolve o tracinho para null/undefined e mantém o 0.
  3. Erro cru nunca chega na tela. Todo erro sai daqui com `.amigavel` em português.
*/

/* ───────────────────────── constantes ───────────────────────── */

export const BASE = 'https://www.n8nclouddaco.agentedaco.com.br/webhook/painel-rede-v1';

/** Tempo máximo de espera por resposta (seção 2: o proxy n8n é lento em pico). */
const TEMPO_LIMITE_MS = 20000;

/** Chave única da sessão nos dois armazéns do navegador. */
const CHAVE_SESSAO = 'wa360.sessao';

/** Nome do evento disparado no window quando o servidor recusa o token. */
const EVENTO_SESSAO_EXPIROU = 'sessao-expirou';

/** Tempo de vida do cache em memória, por ação. Ação fora daqui nunca é cacheada. */
const VIDA_DO_CACHE = {
  visao_geral: 20000,
  ranking: 60000,
  conversas: 10000,
  analise: 300000,
};

/** Nome de método (camelCase) → nome da ação no proxy (snake_case). */
const ACOES = {
  login: 'login',
  sair: 'sair',
  visaoGeral: 'visao_geral',
  visao_geral: 'visao_geral',
  unidade: 'unidade',
  conversas: 'conversas',
  conversa: 'conversa',
  analise: 'analise',
  ranking: 'ranking',
  leads: 'leads',
  configLer: 'config_ler',
  config_ler: 'config_ler',
  configGravar: 'config_gravar',
  config_gravar: 'config_gravar',
};

/** Espera máxima entre duas tentativas do polling quando o servidor está fora. */
const ESPERA_MAXIMA_MS = 300000;

/* ───────────────────────── erro ───────────────────────── */

/**
 * Erro de API. Sempre carrega `.amigavel` — é o único texto que pode ir para a tela.
 * `.codigo` serve para a lógica ('sessao_invalida', 'tempo_esgotado', 'rede'…).
 */
export class ErroApi extends Error {
  constructor(amigavel, { codigo = 'falha', acao = null, status = null, original = null } = {}) {
    super(amigavel);
    this.name = 'ErroApi';
    this.amigavel = amigavel;
    this.codigo = codigo;
    this.acao = acao;
    this.status = status;
    this.original = original;
  }
}

/** true quando o erro significa "o servidor não aceitou mais este token". */
export function ehErroDeSessao(erro) {
  return !!erro && erro.codigo === 'sessao_invalida';
}

/* ───────────────────────── sessão ───────────────────────── */

/* Guarda de memória para navegador com armazenamento bloqueado (janela anônima,
   cookies de terceiros desligados). Assim o painel ainda funciona até fechar a aba. */
let sessaoEmMemoria = null;

function armazem(lembrar) {
  try {
    const alvo = lembrar ? window.localStorage : window.sessionStorage;
    // Toque de leitura: em alguns navegadores o objeto existe mas lança ao ser usado.
    alvo.getItem(CHAVE_SESSAO);
    return alvo;
  } catch (e) {
    return null;
  }
}

/**
 * Sessão do usuário. `lembrar: true` no login guarda em localStorage (sobrevive a
 * fechar o navegador); sem lembrar, fica em sessionStorage (morre com a aba).
 */
export const sessao = {
  /** Devolve { token, usuario, expira_em, lembrar } ou null. Nunca lança. */
  ler() {
    for (const lembrar of [true, false]) {
      const dep = armazem(lembrar);
      if (!dep) continue;
      try {
        const cru = dep.getItem(CHAVE_SESSAO);
        if (!cru) continue;
        const guardada = JSON.parse(cru);
        if (guardada && typeof guardada.token === 'string' && guardada.token) {
          guardada.lembrar = lembrar;
          return guardada;
        }
        dep.removeItem(CHAVE_SESSAO); // lixo de versão antiga
      } catch (e) {
        /* armazém bloqueado ou JSON corrompido: segue para o próximo */
      }
    }
    return sessaoEmMemoria;
  },

  /** Grava a sessão. `dados` vem cru da ação `login`. */
  gravar(dados, lembrar) {
    const guardar = {
      token: dados && dados.token ? String(dados.token) : '',
      usuario: dados && dados.usuario ? dados.usuario : null,
      expira_em: dados && dados.expira_em ? dados.expira_em : null,
      lembrar: !!lembrar,
    };
    if (!guardar.token) return null;

    sessaoEmMemoria = guardar;
    const destino = armazem(!!lembrar);
    const outro = armazem(!lembrar);
    try { if (outro) outro.removeItem(CHAVE_SESSAO); } catch (e) { /* ignora */ }
    try { if (destino) destino.setItem(CHAVE_SESSAO, JSON.stringify(guardar)); } catch (e) { /* fica só em memória */ }
    return guardar;
  },

  /** Apaga a sessão dos dois armazéns e da memória. */
  limpar() {
    sessaoEmMemoria = null;
    for (const lembrar of [true, false]) {
      const dep = armazem(lembrar);
      try { if (dep) dep.removeItem(CHAVE_SESSAO); } catch (e) { /* ignora */ }
    }
  },

  /** Devolve o token ou null, sem o resto. */
  token() {
    const atual = this.ler();
    return atual ? atual.token : null;
  },

  /**
   * true se `expira_em` já passou, false se ainda vale, null se o servidor não
   * mandou validade (não medimos — quem decide é o servidor, na próxima chamada).
   */
  expirada() {
    const atual = this.ler();
    if (!atual || !atual.expira_em) return null;
    const fim = Date.parse(atual.expira_em);
    if (Number.isNaN(fim)) return null;
    return fim <= Date.now();
  },
};

/* ───────────────────────── cache em memória ───────────────────────── */

const cache = new Map();   // chave -> { em, valor }
const emVoo = new Map();   // chave -> Promise (duas telas pedindo o mesmo = uma chamada)

/** Serializa args com as chaves em ordem, para a mesma consulta gerar a mesma chave. */
function chaveDe(acao, args) {
  const limpo = {};
  const fonte = args && typeof args === 'object' ? args : {};
  Object.keys(fonte).sort().forEach((k) => {
    if (fonte[k] !== undefined) limpo[k] = fonte[k];
  });
  let corpo;
  try { corpo = JSON.stringify(limpo); } catch (e) { corpo = String(Date.now()); }
  return acao + '|' + corpo;
}

function lerCache(acao, chave) {
  const vida = VIDA_DO_CACHE[acao];
  if (!vida) return undefined;
  const linha = cache.get(chave);
  if (!linha) return undefined;
  if (Date.now() - linha.em > vida) {
    cache.delete(chave);
    return undefined;
  }
  return linha.valor;
}

function gravarCache(acao, chave, valor) {
  if (!VIDA_DO_CACHE[acao]) return;
  cache.set(chave, { em: Date.now(), valor });
}

/** Esvazia o cache inteiro, ou só o de uma ação. */
function invalidar(acao) {
  if (!acao) {
    cache.clear();
    return;
  }
  const nome = ACOES[acao] || acao;
  for (const chave of Array.from(cache.keys())) {
    if (chave.slice(0, nome.length + 1) === nome + '|') cache.delete(chave);
  }
}

/* ───────────────────────── chamada ───────────────────────── */

function mensagemPorStatus(status) {
  if (status === 404) return 'O endereço da API do painel não respondeu. Confira se o workflow do proxy está ativo no n8n.';
  if (status === 401 || status === 403) return 'O servidor recusou o acesso. Entre de novo.';
  if (status === 429) return 'Muitas consultas seguidas. Espere alguns segundos e tente de novo.';
  if (status >= 500) return 'O servidor do painel falhou ao montar a resposta. Tente de novo em instantes.';
  return 'O servidor respondeu de um jeito que eu não entendi.';
}

/** Deu ruim na sessão: limpa tudo e avisa a casca. Quem redireciona é ela, não este arquivo. */
function derrubarSessao(acao) {
  const tinhaSessao = !!sessao.token();
  sessao.limpar();
  invalidar();
  emVoo.clear();
  // Sem sessão anterior não há nada a expirar — evita enxurrada de eventos no polling.
  if (tinhaSessao && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(EVENTO_SESSAO_EXPIROU, { detail: { acao } }));
  }
}

/**
 * Faz uma chamada ao proxy. Devolve `dados` (ou null quando a ação só confirma).
 * Lança sempre ErroApi — nunca um erro cru de rede.
 *
 * @param {string} acao      nome da ação (snake_case do contrato ou camelCase do método)
 * @param {object} [args]
 * @param {object} [opcoes]  { forcar: true } ignora o cache mas ainda o atualiza
 */
async function chamar(acao, args, opcoes) {
  const nome = ACOES[acao] || acao;
  const corpoArgs = args && typeof args === 'object' ? args : {};
  const forcar = !!(opcoes && opcoes.forcar);
  const chave = chaveDe(nome, corpoArgs);

  if (!forcar) {
    const guardado = lerCache(nome, chave);
    if (guardado !== undefined) return guardado;
  }

  // Mesma consulta já em andamento: aproveita, em vez de bater duas vezes no n8n.
  if (emVoo.has(chave)) return emVoo.get(chave);

  const promessa = (async () => {
    const controle = new AbortController();
    let estourouTempo = false;
    const relogio = setTimeout(() => {
      estourouTempo = true;
      controle.abort();
    }, TEMPO_LIMITE_MS);

    let resposta;
    let texto;
    try {
      resposta = await fetch(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: nome, token: sessao.token(), args: corpoArgs }),
        signal: controle.signal,
        cache: 'no-store',
        credentials: 'omit',
      });
      texto = await resposta.text();
    } catch (erro) {
      if (estourouTempo) {
        throw new ErroApi(
          'O servidor demorou mais de 20 segundos para responder. Tente de novo.',
          { codigo: 'tempo_esgotado', acao: nome, original: erro }
        );
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new ErroApi(
          'Você está sem internet. Reconecte e tente de novo.',
          { codigo: 'sem_internet', acao: nome, original: erro }
        );
      }
      throw new ErroApi(
        'Não consegui falar com o servidor. Verifique a conexão.',
        { codigo: 'rede', acao: nome, original: erro }
      );
    } finally {
      clearTimeout(relogio);
    }

    let dados = null;
    if (texto && texto.trim()) {
      try {
        dados = JSON.parse(texto);
      } catch (erro) {
        throw new ErroApi(
          'O servidor respondeu em um formato inesperado. Provavelmente o workflow do proxy está com erro.',
          { codigo: 'resposta_invalida', acao: nome, status: resposta.status, original: erro }
        );
      }
    }

    // n8n às vezes devolve a resposta dentro de um array de um item só.
    if (Array.isArray(dados)) dados = dados.length ? dados[0] : null;

    if (!dados || typeof dados !== 'object') {
      if (!resposta.ok) {
        throw new ErroApi(mensagemPorStatus(resposta.status), {
          codigo: resposta.status >= 500 ? 'servidor' : 'http',
          acao: nome,
          status: resposta.status,
        });
      }
      throw new ErroApi('O servidor respondeu vazio. Tente de novo.', {
        codigo: 'resposta_vazia',
        acao: nome,
        status: resposta.status,
      });
    }

    if (dados.ok === false || (!resposta.ok && dados.erro)) {
      const motivo = typeof dados.erro === 'string' ? dados.erro : '';
      if (motivo === 'sessao_invalida' || resposta.status === 401 || resposta.status === 403) {
        derrubarSessao(nome);
        throw new ErroApi('Sua sessão expirou. Entre de novo para continuar.', {
          codigo: 'sessao_invalida',
          acao: nome,
          status: resposta.status,
        });
      }
      throw new ErroApi(motivo || mensagemPorStatus(resposta.status), {
        codigo: 'recusado',
        acao: nome,
        status: resposta.status,
      });
    }

    if (!resposta.ok) {
      throw new ErroApi(mensagemPorStatus(resposta.status), {
        codigo: resposta.status >= 500 ? 'servidor' : 'http',
        acao: nome,
        status: resposta.status,
      });
    }

    const conteudo = Object.prototype.hasOwnProperty.call(dados, 'dados') ? dados.dados : null;
    gravarCache(nome, chave, conteudo);
    return conteudo;
  })();

  emVoo.set(chave, promessa);
  try {
    return await promessa;
  } finally {
    emVoo.delete(chave);
  }
}

/* ───────────────────────── ações ───────────────────────── */

export const api = {
  /**
   * Entra. Em sucesso grava a sessão e zera o cache da sessão anterior.
   * Devolve { token, usuario:{nome,papel}, expira_em }.
   */
  async login(email, senha, lembrar) {
    const dados = await chamar('login', {
      email: String(email || '').trim(),
      senha: String(senha || ''),
      lembrar: !!lembrar,
    }, { forcar: true });

    if (!dados || !dados.token) {
      throw new ErroApi('O servidor não devolveu a credencial de acesso. Tente de novo.', {
        codigo: 'login_sem_token',
        acao: 'login',
      });
    }
    invalidar();
    sessao.gravar(dados, !!lembrar);
    return dados;
  },

  /** Sai. Avisa o servidor, mas a sessão local some mesmo que o aviso falhe. */
  async sair() {
    try {
      await chamar('sair', {}, { forcar: true });
    } catch (e) {
      /* servidor fora não pode prender o usuário dentro do painel */
    } finally {
      sessao.limpar();
      invalidar();
      emVoo.clear();
    }
    return true;
  },

  /** Rede inteira: `unidades[]` (3.1) e `rede` (3.2). Cache de 20s. */
  visaoGeral(opcoes) {
    return chamar('visao_geral', {}, opcoes);
  },

  /** Detalhe de uma unidade + série de 30 dias. */
  unidade(slug, opcoes) {
    return chamar('unidade', { slug }, opcoes);
  },

  /** Lista de conversas da aba WhatsApp. Cache de 10s. */
  conversas(slug, { busca, pagina } = {}, opcoes) {
    return chamar('conversas', { slug, busca, pagina }, opcoes);
  },

  /** Uma conversa inteira, mensagem a mensagem. */
  conversa(conversaId, opcoes) {
    return chamar('conversa', { conversa_id: conversaId }, opcoes);
  },

  /** Avaliação pela metodologia Daco (seção 5). Cache de 5min — é cara de montar. */
  analise(slug, dias, opcoes) {
    return chamar('analise', { slug, dias }, opcoes);
  },

  /**
   * Ranking semanal das unidades: pódio, classificação, critérios com peso e o
   * movimento contra a semana anterior. `semanasAtras` 0 é a semana em curso.
   * O servidor esquenta poucas unidades por chamada; `completo:false` e
   * `pendentes[]` dizem quem ainda não foi calculado — não é zero, é "ainda não".
   */
  ranking(semanasAtras, opcoes) {
    return chamar('ranking', { semanas_atras: Number(semanasAtras) || 0 }, opcoes);
  },

  /** Notificações de lead capturadas dos grupos (3.3). */
  leads({ slug, desde } = {}, opcoes) {
    return chamar('leads', { slug, desde }, opcoes);
  },

  /** Preferências do usuário. */
  configLer(opcoes) {
    return chamar('config_ler', {}, opcoes);
  },

  /** Grava preferências e derruba o cache de leitura. */
  async configGravar(preferencias) {
    const resposta = await chamar('config_gravar', { preferencias }, { forcar: true });
    invalidar('config_ler');
    return resposta;
  },

  /** Esvazia o cache inteiro, ou só o de uma ação: `api.invalidar('visao_geral')`. */
  invalidar,

  /** Atalho: o mesmo `assinarAtualizacao` exportado abaixo. */
  assinarAtualizacao(acao, args, intervaloMs, callback) {
    return assinarAtualizacao(acao, args, intervaloMs, callback);
  },
};

/* ───────────────────────── atualização ao vivo ───────────────────────── */

/**
 * Consulta uma ação de tempos em tempos e entrega o resultado ao callback.
 *
 *   const parar = assinarAtualizacao('visao_geral', {}, 30000, (dados, erro) => { … });
 *   // em desmontar(): parar();
 *
 * Comportamento:
 * - a primeira consulta sai na hora, sem esperar o intervalo;
 * - sempre busca fresco (ignora o cache) e alimenta o cache para as outras telas;
 * - erro seguido aumenta a espera (2×, 4×, 8×… até 5 min) e volta ao normal no primeiro acerto;
 * - com a aba escondida não consulta nada; ao voltar o foco, consulta na hora;
 * - `sessao_invalida` cancela a assinatura sozinho — quem trata é a casca, pelo evento.
 *
 * O callback recebe (dados, erro): um dos dois sempre é null. Erro traz `.amigavel`.
 *
 * @returns {Function} cancela a assinatura. Chamar em `desmontar()` é obrigatório.
 */
export function assinarAtualizacao(acao, args, intervaloMs, callback) {
  const nome = ACOES[acao] || acao;
  const intervaloBase = Math.max(2000, Number(intervaloMs) || 30000);
  const retorno = typeof callback === 'function' ? callback : function () {};

  let cancelado = false;
  let relogio = null;
  let falhas = 0;
  let ultimaTentativaEm = 0;

  function agendar(espera) {
    if (cancelado) return;
    clearTimeout(relogio);
    relogio = setTimeout(rodar, espera);
  }

  function escondida() {
    return typeof document !== 'undefined' && document.hidden === true;
  }

  function entregar(dados, erro) {
    try {
      retorno(dados, erro);
    } catch (falha) {
      // Erro dentro da tela não pode matar o ciclo de atualização.
      console.error('[dados] falha ao desenhar a atualização de ' + nome, falha);
    }
  }

  async function rodar() {
    if (cancelado) return;
    if (escondida()) {
      // Aba no fundo não gasta chamada; o retorno do foco retoma.
      clearTimeout(relogio);
      relogio = null;
      return;
    }
    ultimaTentativaEm = Date.now();
    try {
      const dados = await chamar(nome, args, { forcar: true });
      if (cancelado) return;
      falhas = 0;
      entregar(dados, null);
      agendar(intervaloBase);
    } catch (erro) {
      if (cancelado) return;
      if (ehErroDeSessao(erro)) {
        entregar(null, erro);
        cancelar();
        return;
      }
      falhas += 1;
      entregar(null, erro);
      agendar(Math.min(intervaloBase * Math.pow(2, falhas), ESPERA_MAXIMA_MS));
    }
  }

  function retomar() {
    if (cancelado || escondida()) return;
    // Voltou para a aba: se a última consulta já tem idade, atualiza na hora.
    const idade = Date.now() - ultimaTentativaEm;
    const minimo = Math.min(intervaloBase, 5000);
    if (idade >= minimo) rodar();
    else agendar(minimo - idade);
  }

  function cancelar() {
    if (cancelado) return;
    cancelado = true;
    clearTimeout(relogio);
    relogio = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', retomar);
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', retomar);
      window.removeEventListener('online', retomar);
    }
  }

  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', retomar);
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', retomar);
    window.addEventListener('online', retomar);
  }

  rodar();
  return cancelar;
}

/* ───────────────────────── formatação ─────────────────────────
   Os seis módulos mostram os mesmos números; o jeito de mostrar mora aqui.
   Toda função devolve o tracinho quando o valor é null/undefined — e mantém o 0,
   porque 0 é medida ("medimos e não houve") e null é ausência de medida.
------------------------------------------------------------------ */

export const TRACINHO = '—';

/** Só é ausência de medida: null, undefined, NaN e texto vazio. O 0 passa. */
function semMedida(valor) {
  if (valor === null || valor === undefined) return true;
  if (typeof valor === 'number' && !Number.isFinite(valor)) return true;
  if (typeof valor === 'string' && valor.trim() === '') return true;
  return false;
}

/**
 * Devolve o tracinho quando não há medida; devolve o próprio valor quando há.
 * `ou(0)` → 0.  `ou(null)` → '—'.  `ou(null, 'sem captura')` → 'sem captura'.
 */
export function ou(valor, tracinho = TRACINHO) {
  return semMedida(valor) ? tracinho : valor;
}

/**
 * Minutos em texto curto.
 *   formatarMinutos(0)    -> "0 min"
 *   formatarMinutos(0.5)  -> "30 s"
 *   formatarMinutos(4.0)  -> "4 min"
 *   formatarMinutos(4.6)  -> "4,6 min"
 *   formatarMinutos(95)   -> "1h35"
 *   formatarMinutos(null) -> "—"
 */
export function formatarMinutos(minutos, tracinho = TRACINHO) {
  if (semMedida(minutos)) return tracinho;
  const n = Number(minutos);
  if (!Number.isFinite(n)) return tracinho;
  const m = Math.max(0, n);

  if (m === 0) return '0 min';
  if (m < 1) return Math.max(1, Math.round(m * 60)) + ' s';

  if (m < 60) {
    const arredondado = Math.round(m * 10) / 10;
    if (Number.isInteger(arredondado)) return arredondado + ' min';
    return String(arredondado).replace('.', ',') + ' min';
  }

  let horas = Math.floor(m / 60);
  let resto = Math.round(m - horas * 60);
  if (resto === 60) { horas += 1; resto = 0; }

  if (horas >= 24) {
    const dias = Math.floor(horas / 24);
    const sobra = horas - dias * 24;
    return sobra ? dias + 'd ' + sobra + 'h' : dias + 'd';
  }
  return horas + 'h' + String(resto).padStart(2, '0');
}

/**
 * Número no padrão brasileiro.
 *   formatarNumero(3180)      -> "3.180"
 *   formatarNumero(0)         -> "0"
 *   formatarNumero(7.14, 1)   -> "7,1"
 *   formatarNumero(null)      -> "—"
 */
export function formatarNumero(valor, casas = 0, tracinho = TRACINHO) {
  if (semMedida(valor)) return tracinho;
  const n = Number(valor);
  if (!Number.isFinite(n)) return tracinho;
  try {
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: casas,
      maximumFractionDigits: casas,
    }).format(n);
  } catch (e) {
    // Sem Intl: separa o milhar na mão.
    const fixo = n.toFixed(casas);
    const partes = fixo.split('.');
    partes[0] = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return partes.join(',');
  }
}

/**
 * Percentual. Mantém o 0 e devolve o tracinho quando não houve medida.
 *   formatarPorcentagem(63)   -> "63%"
 *   formatarPorcentagem(0)    -> "0%"
 *   formatarPorcentagem(null) -> "—"
 */
export function formatarPorcentagem(valor, casas = 0, tracinho = TRACINHO) {
  const texto = formatarNumero(valor, casas, tracinho);
  return texto === tracinho ? tracinho : texto + '%';
}

/**
 * Telefone brasileiro legível.
 *   formatarTelefone('5521972647887') -> "(21) 97264-7887"
 *   formatarTelefone('2124861234')    -> "(21) 2486-1234"
 *   formatarTelefone(null)            -> "—"
 * Número fora do padrão volta como veio — melhor um número estranho do que um errado.
 */
export function formatarTelefone(telefone, tracinho = TRACINHO) {
  if (semMedida(telefone)) return tracinho;
  const cru = String(telefone).trim();
  let digitos = cru.replace(/\D+/g, '');
  if (!digitos) return tracinho;

  if (digitos.length > 11 && digitos.slice(0, 2) === '55') digitos = digitos.slice(2);

  if (digitos.length === 11) {
    return '(' + digitos.slice(0, 2) + ') ' + digitos.slice(2, 7) + '-' + digitos.slice(7);
  }
  if (digitos.length === 10) {
    return '(' + digitos.slice(0, 2) + ') ' + digitos.slice(2, 6) + '-' + digitos.slice(6);
  }
  if (digitos.length === 9) return digitos.slice(0, 5) + '-' + digitos.slice(5);
  if (digitos.length === 8) return digitos.slice(0, 4) + '-' + digitos.slice(4);
  return cru;
}

function doisDigitos(n) {
  return String(n).padStart(2, '0');
}

function horaCurta(data) {
  return doisDigitos(data.getHours()) + 'h' + doisDigitos(data.getMinutes());
}

function mesmoDia(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/**
 * Quando foi, em relação a agora (fuso do navegador).
 *   "agora" · "há 8 min" · "hoje 14h02" · "ontem 14h02" · "18/09 09h12" · "18/09/25 09h12"
 * Data ausente ou ilegível vira o tracinho — nunca "agora" por engano.
 */
export function formatarQuando(iso, tracinho = TRACINHO) {
  if (semMedida(iso)) return tracinho;
  const quando = iso instanceof Date ? iso : new Date(iso);
  const marca = quando.getTime();
  if (Number.isNaN(marca)) return tracinho;

  const agora = new Date();
  const segundos = Math.round((agora.getTime() - marca) / 1000);

  if (segundos >= -60 && segundos < 60) return 'agora';

  if (segundos > 0 && segundos < 3600) {
    return 'há ' + Math.floor(segundos / 60) + ' min';
  }
  if (segundos < 0 && segundos > -3600) {
    return 'em ' + Math.floor(-segundos / 60) + ' min';
  }

  if (mesmoDia(quando, agora)) return 'hoje ' + horaCurta(quando);

  const ontem = new Date(agora.getTime());
  ontem.setDate(ontem.getDate() - 1);
  if (mesmoDia(quando, ontem)) return 'ontem ' + horaCurta(quando);

  const dataCurta = doisDigitos(quando.getDate()) + '/' + doisDigitos(quando.getMonth() + 1);
  if (quando.getFullYear() === agora.getFullYear()) {
    return dataCurta + ' ' + horaCurta(quando);
  }
  return dataCurta + '/' + String(quando.getFullYear()).slice(-2) + ' ' + horaCurta(quando);
}

/**
 * Primeiro nome, limpo dos enfeites que vêm da notificação do grupo.
 *   primeiroNome('Elaine Cristina') -> "Elaine"
 *   primeiroNome('Juu ✨')          -> "Juu"
 *   primeiroNome(null)              -> ""
 */
export function primeiroNome(nome) {
  if (semMedida(nome)) return '';
  const pedacos = String(nome).trim().split(/\s+/);
  for (const pedaco of pedacos) {
    let limpo;
    try {
      limpo = pedaco.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.'’-]+$/gu, '');
    } catch (e) {
      limpo = pedaco.replace(/^[^A-Za-zÀ-ÿ0-9]+|[^A-Za-zÀ-ÿ0-9.'’-]+$/g, '');
    }
    if (limpo) return limpo;
  }
  return '';
}
