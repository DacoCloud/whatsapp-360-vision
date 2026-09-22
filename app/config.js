/*
  config.js — Preferências do WhatsApp 360° Vision.

  A tela onde o dono da rede ajusta como o painel se comporta. Cinco seções:
  Conta, Aparência, Painel, Alertas e Sobre.

  O que esta tela promete (seção 1 do CONTRATO.md):
  1. Nenhum controle é enfeite. Tudo que se mexe aqui tem efeito — na hora, na
     tela, e gravado onde tem que ficar.
  2. Nada de dado inventado. O e-mail, o papel e o último acesso vêm da sessão;
     o que o servidor não mandou vira traço com o motivo. Os exemplos das faixas
     de alerta são contados sobre as unidades que a API devolveu agora — não há
     um único número ilustrativo nesta tela.
  3. null nunca vira 0. Unidade sem tempo medido é contada à parte, nunca
     empurrada para a faixa verde.
  4. Duas gavetas de persistência, ditas em voz alta na própria tela:
     • Painel e Alertas → `config_gravar` / `config_ler` (perfil do usuário).
     • Aparência        → localStorage deste navegador (é só visual).
     Enquanto a leitura do perfil não volta, os controles do servidor ficam
     desligados: melhor esperar do que sobrescrever o que está gravado.
  5. Gravou, aparece um "salvo" discreto. Falhou, o controle volta para o valor
     anterior e a tela explica o que não foi gravado.

  Convivência (seção 6): só escreve dentro da `raiz` que recebe, usa os
  componentes do tema.css sem redefinir nenhum e cria só classes com o prefixo
  `cf-`. Todo timer, ouvinte, observador e assinatura morre em `desmontar()`.

  Exceção consciente e documentada: a folha de Aparência (`cf-aparencia`) é
  injetada no <head> quando o módulo carrega e FICA — é ela que aplica
  densidade, tamanho de fonte e redução de movimento em toda a aplicação, não
  só nesta tela. Ela reajusta valores de token expostos pelo tema (espaçamento
  e escala tipográfica); não reescreve nenhum componente compartilhado.
*/

import {
  api,
  BASE,
  assinarAtualizacao,
  ehErroDeSessao,
  formatarMinutos,
  formatarNumero,
  formatarQuando,
  TRACINHO,
} from './dados.js';

/* ═════════════════════════ 1. CONSTANTES ════════════════════════════════ */

/** Versão desta interface. Sobe à mão quando o contrato muda. */
const VERSAO = '1.0';

/** Chave da aparência neste navegador (não é dado do servidor). */
const CHAVE_APARENCIA = 'wa360.aparencia';

/** Chave do trilho recolhido — a mesma que a casca usa. Não inventar outra. */
const CHAVE_TRILHO = 'wa360.trilho-recolhido';

/** Espera antes de gravar, para o deslizante não disparar uma chamada por pixel. */
const ESPERA_GRAVACAO_MS = 600;

/** Quanto tempo o selo "salvo" fica visível. */
const TEMPO_SALVO_MS = 2600;

/** Atualização da lista de unidades que alimenta os exemplos das faixas. */
const INTERVALO_REDE_MS = 60000;

/** Ordenações do Painel de Controle — os mesmos ids e rótulos daquela tela. */
const ORDENS = [
  { id: 'nota', rotulo: 'Nota' },
  { id: 'sla', rotulo: 'Tempo de resposta' },
  { id: 'mensagens', rotulo: 'Volume' },
  { id: 'nome', rotulo: 'Nome' },
];

/** Intervalos da atualização ao vivo. `0` é manual: só atualiza quando pedirem. */
const INTERVALOS = [
  { ms: 10000, rotulo: '10 s' },
  { ms: 20000, rotulo: '20 s' },
  { ms: 60000, rotulo: '1 min' },
  { ms: 0, rotulo: 'Manual' },
];

/** Linhas do bloco "ÚLTIMAS 24H" do cartão da unidade. */
const LINHAS_24H = [
  { id: 'leads', rotulo: 'Novos leads', nota: 'Vem da notificação de grupo. Sem captura ligada, a linha mostra "não medimos".' },
  { id: 'mensagens', rotulo: 'Mensagens', nota: 'Total capturado da Stevo nas últimas 24 h.' },
  { id: 'sla', rotulo: 'Tempo de resposta', nota: 'Mediana do intervalo entre a pergunta e a resposta.' },
  { id: 'nivel', rotulo: 'Nível de desempenho', nota: 'Leitura da nota da metodologia Daco.' },
  { id: 'servico', rotulo: 'Serviço mais buscado', nota: 'Interesse mais repetido no período.' },
];

/** Situações que podem destacar um cartão no Painel de Controle. */
const SITUACOES = [
  {
    id: 'silenciosa',
    rotulo: 'Unidade sem mensagem há muito tempo',
    nota: 'Usa o limite de silêncio logo acima.',
  },
  {
    id: 'sem_captura',
    rotulo: 'Captura de grupo desligada',
    nota: 'A unidade atende, mas os leads do grupo não estão sendo contados.',
  },
  {
    id: 'sla_alto',
    rotulo: 'Tempo de resposta acima do limite vermelho',
    nota: 'O indicador passou da segunda faixa; o cartão sobe para o topo da atenção.',
  },
  {
    id: 'inativa',
    rotulo: 'Unidade marcada como inativa no cadastro',
    nota: 'Fora do ar de propósito. Destacar ajuda a lembrar de religar.',
  },
];

/** Limites dos deslizantes. */
const LIMITE_SLA_VERDE = { min: 1, max: 30 };
const LIMITE_SLA_AMARELO = { min: 2, max: 120 };
const LIMITE_SILENCIO = { min: 1, max: 24 };

/**
 * Padrão da plataforma. Não é dado do usuário: é o que vale enquanto ele nunca
 * gravou nada. A tela diz isso em voz alta quando o perfil vem vazio.
 * Os dois limites de SLA são os mesmos que o Painel de Controle usa hoje.
 */
const PADRAO = {
  painel: {
    ordem: 'nota',
    intervalo_ms: 20000,
    linhas: { leads: true, mensagens: true, sla: true, nivel: true, servico: true },
    fixadas: [],
  },
  alertas: {
    sla_verde_min: 5,
    sla_amarelo_min: 15,
    silencio_horas: 4,
    destacar: { silenciosa: true, sem_captura: true, sla_alto: true, inativa: false },
  },
};

/** De onde vem cada número do painel. Uma linha por indicador (seção Sobre). */
const ORIGENS = [
  {
    indicador: 'Mensagens, entradas e saídas (24 h)',
    fonte: 'stevo',
    texto: 'Cada mensagem que entra ou sai do WhatsApp da unidade chega pelo webhook da '
      + 'instância na Stevo e é gravada uma a uma, com horário e autoria.',
  },
  {
    indicador: 'Áudios (24 h)',
    fonte: 'stevo',
    texto: 'Mesma captura da Stevo, filtrada pelo tipo áudio. O conteúdo é transcrito antes '
      + 'de a análise ler — áudio não some da conta por ser áudio.',
  },
  {
    indicador: 'Conversas abertas (24 h)',
    fonte: 'stevo',
    texto: 'Contatos distintos com pelo menos uma mensagem no período, contados sobre as '
      + 'mensagens capturadas.',
  },
  {
    indicador: 'Tempo de resposta (mediana e p90), % até 5 min e % respondidas',
    fonte: 'stevo',
    texto: 'Calculados sobre os pares pergunta/resposta das mensagens capturadas. Nas unidades '
      + 'com agente de IA o relógio mede a IA até a passagem para a recepção, e a tela de '
      + 'análise avisa isso.',
  },
  {
    indicador: 'Novos leads (24 h)',
    fonte: 'grupo',
    texto: 'Notificação publicada no grupo — formato do GoHighLevel ou do agente de IA — lida e '
      + 'normalizada pelo parser. Sem captura de grupo ligada o valor é "não medimos", nunca zero.',
  },
  {
    indicador: 'Última notificação mostrada no cartão',
    fonte: 'grupo',
    texto: 'A notificação de lead mais recente daquela unidade, com o horário em que chegou no grupo.',
  },
  {
    indicador: 'Série de 30 dias da unidade',
    fonte: 'congelada',
    texto: 'Métrica diária congelada: o dia fechado é gravado uma vez e não volta a ser '
      + 'recalculado, mesmo que a mensagem crua seja purgada depois.',
  },
  {
    indicador: 'Horário do "Atualizado" no topo',
    fonte: 'congelada',
    texto: 'Momento em que o servidor calculou o retrato da rede (campo atualizado_em). '
      + 'Não é o relógio deste navegador.',
  },
  {
    indicador: 'Nota de 0 a 10, prioridade e recomendação',
    fonte: 'daco',
    texto: 'Avaliação da Daco pela metodologia dos treinamentos: método 5C, temperatura do lead, '
      + 'os 4 indicadores de 30 dias e os 8 compromissos. Não é medida crua — é leitura sobre as '
      + 'conversas do período, e a tela de análise mostra os trechos que sustentam cada critério.',
  },
  {
    indicador: 'Serviço mais buscado',
    fonte: 'daco',
    texto: 'Interesse mais repetido nas conversas e nas notificações do período. Sem sinal '
      + 'suficiente, fica "não medimos".',
  },
];

/** Rótulo curto de cada origem, mostrado como selo ao lado da linha. */
const ROTULO_FONTE = {
  stevo: 'Mensagem da Stevo',
  grupo: 'Notificação de grupo',
  congelada: 'Métrica congelada',
  daco: 'Avaliação da Daco',
};

/* ═════════════════════════ 2. ÍCONES ════════════════════════════════════ */

const SVG_ABRE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
  + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';

/** Ícone da tela no trilho: controles deslizantes. */
const ICONE_TELA = SVG_ABRE
  + '<path d="M4 6h10"/><path d="M18 6h2"/><circle cx="16" cy="6" r="2"/>'
  + '<path d="M4 12h4"/><path d="M12 12h8"/><circle cx="10" cy="12" r="2"/>'
  + '<path d="M4 18h10"/><path d="M18 18h2"/><circle cx="16" cy="18" r="2"/></svg>';

const ICONES = {
  conta: SVG_ABRE + '<circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>',
  aparencia: SVG_ABRE + '<circle cx="12" cy="12" r="9"/><path d="M12 3v18"/>'
    + '<path d="M12 8h6.5"/><path d="M12 12h8.5"/><path d="M12 16h6.5"/></svg>',
  painel: SVG_ABRE + '<rect x="3" y="3" width="8" height="10" rx="2"/>'
    + '<rect x="13" y="3" width="8" height="6" rx="2"/><rect x="13" y="11" width="8" height="10" rx="2"/>'
    + '<rect x="3" y="15" width="8" height="6" rx="2"/></svg>',
  alertas: SVG_ABRE + '<path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6"/>'
    + '<path d="M10.3 20a2 2 0 0 0 3.4 0"/></svg>',
  sobre: SVG_ABRE + '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/></svg>',
  certo: SVG_ABRE + '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.2 2.4 2.4 4.6-4.9"/></svg>',
  atencao: SVG_ABRE + '<path d="M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3'
    + 'l-7.9-13.7a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4.5"/><path d="M12 17.2h.01"/></svg>',
  sair: SVG_ABRE + '<path d="M15 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/>'
    + '<path d="m10 17 5-5-5-5"/><path d="M15 12H3"/></svg>',
  chave: SVG_ABRE + '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8-8"/>'
    + '<path d="m17 6 2 2"/><path d="m14.5 8.5 2 2"/></svg>',
  alfinete: SVG_ABRE + '<path d="M15 3 21 9"/><path d="m10.5 7.5 6 6"/>'
    + '<path d="M13.5 4.5 9 9l-4.5 1.5L13.5 19.5 15 15l4.5-4.5"/><path d="m8 16-4.5 4.5"/></svg>',
  semDado: SVG_ABRE + '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>',
};

/* ═════════════════════════ 3. APARÊNCIA (vale na aplicação toda) ════════
   Densidade, escala de texto e redução de movimento mexem em toda a interface,
   não só nesta tela. Por isso a folha abaixo entra no <head> quando o módulo
   carrega e não sai em desmontar(). Ela só reajusta valores de token que o
   tema expõe — nenhum componente compartilhado é reescrito.
   ════════════════════════════════════════════════════════════════════════ */

const ESTILO_APARENCIA = `
/* --- Densidade compacta: menos respiro, mesma legibilidade -------------
   O alvo de toque NÃO encolhe: acessibilidade não é densidade. */
:root[data-cf-densidade="compacta"] {
  --carta-padding: 14px;
  --esp-32: 24px;
  --esp-24: 18px;
  --esp-16: 12px;
  --esp-12: 10px;
}

/* --- Escala do texto: três níveis sobre a mesma tipografia fluida ------ */
:root[data-cf-fonte="pequena"] {
  --txt-legenda:  clamp(9.7px,  .15vw + 9.2px,  11px);
  --txt-pequeno:  clamp(11px,   .18vw + 10.7px, 12.4px);
  --txt-base:     clamp(12.4px, .24vw + 11.8px, 14.3px);
  --txt-medio:    clamp(14.3px, .37vw + 13.2px, 16.6px);
  --txt-titulo:   clamp(16.6px, .92vw + 13.8px, 22px);
  --txt-numero-p: clamp(17.5px, 1.01vw + 14.4px, 24px);
  --txt-numero:   clamp(23px,   1.93vw + 16.6px, 36.8px);
}
:root[data-cf-fonte="grande"] {
  --txt-legenda:  clamp(11.8px, .18vw + 11.2px, 13.4px);
  --txt-pequeno:  clamp(13.4px, .22vw + 13px,   15.1px);
  --txt-base:     clamp(15.1px, .29vw + 14.3px, 17.4px);
  --txt-medio:    clamp(17.4px, .45vw + 16.1px, 20.2px);
  --txt-titulo:   clamp(20.2px, 1.12vw + 16.8px, 26.9px);
  --txt-numero-p: clamp(21.3px, 1.23vw + 17.5px, 29.1px);
  --txt-numero:   clamp(28px,   2.35vw + 20.2px, 44.8px);
}

/* --- Movimento reduzido forçado ---------------------------------------
   Mesmo efeito do @media (prefers-reduced-motion: reduce) do tema, só que
   ligado pelo usuário. Quem já pede menos movimento no sistema continua
   atendido pelo tema — este bloco nunca devolve animação a ninguém. */
:root[data-cf-movimento="reduzido"] *,
:root[data-cf-movimento="reduzido"] *::before,
:root[data-cf-movimento="reduzido"] *::after {
  animation-duration: .001ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: .001ms !important;
  scroll-behavior: auto !important;
}
:root[data-cf-movimento="reduzido"] .esqueleto::after { display: none; }
`;

/** Aparência padrão: o que vale antes de o usuário mexer em qualquer coisa. */
const APARENCIA_PADRAO = { densidade: 'confortavel', fonte: 'padrao', movimento: 'sistema' };

function lerLocal(chave) {
  try { return window.localStorage.getItem(chave); } catch (e) { return null; }
}

function gravarLocal(chave, valor) {
  try {
    if (valor === null) window.localStorage.removeItem(chave);
    else window.localStorage.setItem(chave, valor);
  } catch (e) { /* janela anônima: a preferência vale só nesta sessão */ }
}

/** Lê a aparência guardada neste navegador, sempre normalizada. */
function lerAparencia() {
  const base = { densidade: APARENCIA_PADRAO.densidade, fonte: APARENCIA_PADRAO.fonte,
    movimento: APARENCIA_PADRAO.movimento };
  const cru = lerLocal(CHAVE_APARENCIA);
  if (!cru) return base;
  let guardada = null;
  try { guardada = JSON.parse(cru); } catch (e) { return base; }
  if (!guardada || typeof guardada !== 'object') return base;
  if (guardada.densidade === 'compacta' || guardada.densidade === 'confortavel') {
    base.densidade = guardada.densidade;
  }
  if (guardada.fonte === 'pequena' || guardada.fonte === 'padrao' || guardada.fonte === 'grande') {
    base.fonte = guardada.fonte;
  }
  if (guardada.movimento === 'reduzido' || guardada.movimento === 'sistema') {
    base.movimento = guardada.movimento;
  }
  return base;
}

function gravarAparencia(aparencia) {
  try {
    gravarLocal(CHAVE_APARENCIA, JSON.stringify(aparencia));
  } catch (e) { /* segue valendo em memória até fechar a aba */ }
}

/** Escreve a aparência nos atributos do <html>. É o que a folha acima lê. */
function aplicarAparencia(aparencia) {
  const alvo = document.documentElement;
  if (!alvo) return;
  if (aparencia.densidade === 'compacta') alvo.setAttribute('data-cf-densidade', 'compacta');
  else alvo.removeAttribute('data-cf-densidade');

  if (aparencia.fonte === 'pequena' || aparencia.fonte === 'grande') {
    alvo.setAttribute('data-cf-fonte', aparencia.fonte);
  } else {
    alvo.removeAttribute('data-cf-fonte');
  }

  if (aparencia.movimento === 'reduzido') alvo.setAttribute('data-cf-movimento', 'reduzido');
  else alvo.removeAttribute('data-cf-movimento');
}

/** true quando o próprio sistema do usuário já pede menos movimento. */
function movimentoDoSistema() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {
    return false;
  }
}

/* A aparência entra assim que o módulo carrega — a casca importa este arquivo
   na primeira linha, então a preferência vale desde a tela de login, e não só
   depois que alguém abre as Preferências. */
(function instalarAparencia() {
  try {
    if (!document.getElementById('cf-aparencia')) {
      const folha = document.createElement('style');
      folha.id = 'cf-aparencia';
      folha.textContent = ESTILO_APARENCIA;
      document.head.appendChild(folha);
    }
    aplicarAparencia(lerAparencia());
  } catch (e) {
    console.error('[config] não consegui aplicar a aparência guardada', e);
  }
}());

/* ═════════════════════════ 4. ESTILO DA TELA ════════════════════════════
   Só o que é exclusivo daqui. Tokens e componentes vêm do tema.css.
   ════════════════════════════════════════════════════════════════════════ */

const ESTILO = `
/* --- Esqueleto da tela ------------------------------------------------- */
.cf-raiz {
  display: grid;
  grid-template-columns: 212px minmax(0, 1fr);
  gap: var(--esp-24);
  align-items: start;
  min-width: 0;
}

/* --- Índice lateral ---------------------------------------------------- */
.cf-indice {
  position: sticky;
  top: var(--cf-topo, 12px);
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.cf-indice-titulo { padding: 0 var(--esp-12) var(--esp-8); }
.cf-indice-item {
  display: flex;
  align-items: center;
  gap: var(--esp-8);
  width: 100%;
  min-height: var(--alvo-toque);
  padding: 0 var(--esp-12);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--r-p);
  color: var(--tinta-2);
  font-family: var(--fonte-texto);
  font-size: var(--txt-pequeno);
  font-weight: 700;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--transicao), color var(--transicao), border-color var(--transicao);
}
.cf-indice-item svg { width: 18px; height: 18px; flex: none; }
.cf-indice-item:hover { background: var(--carta); color: var(--tinta); }
.cf-indice-item[aria-current="true"] {
  background: var(--veu-indigo);
  border-color: rgba(91, 91, 214, .40);
  color: var(--tinta);
}
.cf-indice-item[aria-current="true"] svg { color: var(--indigo-cl); }

/* --- Coluna do conteúdo ------------------------------------------------ */
.cf-coluna { display: flex; flex-direction: column; gap: var(--esp-16); min-width: 0; }

.cf-topo {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: var(--esp-12);
  min-width: 0;
}
.cf-titulo {
  font-size: clamp(26px, 1.9vw + 16px, 38px);
  font-weight: 800;
  line-height: 1.05;
  letter-spacing: -.03em;
}
.cf-subtitulo { font-size: var(--txt-pequeno); color: var(--tinta-2); max-width: 62ch; }

/* Selo de gravação: "salvando…" e "salvo". Discreto, ao lado do título. */
.cf-salvo {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  padding: 6px 12px;
  border-radius: var(--r-redondo);
  border: 1px solid transparent;
  background: var(--veu-neutro);
  color: var(--tinta-2);
  font-size: var(--txt-legenda);
  font-weight: 700;
  letter-spacing: .06em;
  text-transform: uppercase;
  white-space: nowrap;
  opacity: 0;
  transform: translateY(-4px);
  transition: opacity var(--transicao), transform var(--transicao),
              background var(--transicao), color var(--transicao);
}
.cf-salvo[data-estado="gravando"],
.cf-salvo[data-estado="salvo"] { opacity: 1; transform: none; }
.cf-salvo[data-estado="salvo"] {
  background: var(--veu-ok);
  border-color: rgba(53, 208, 127, .30);
  color: var(--ok);
}
.cf-salvo svg { width: 15px; height: 15px; }
.cf-salvo-ponto {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  background: var(--indigo-cl);
}

/* --- Seção -------------------------------------------------------------- */
.cf-secao { scroll-margin-top: calc(var(--cf-topo, 12px) + 12px); }
.cf-secao:focus { outline: none; }
.cf-secao:focus-visible { outline: 2px solid var(--indigo-cl); outline-offset: 4px; }

.cf-secao-cabeca {
  display: flex;
  align-items: flex-start;
  gap: var(--esp-12);
  padding-bottom: var(--esp-12);
  margin-bottom: var(--esp-16);
  border-bottom: 1px solid var(--linha);
  min-width: 0;
}
.cf-secao-icone {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex: none;
  border-radius: var(--r-p);
  background: var(--carta-2);
  border: 1px solid var(--linha-2);
  color: var(--indigo-cl);
}
.cf-secao-icone svg { width: 20px; height: 20px; }
.cf-secao-texto { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.cf-secao-nota { font-size: var(--txt-pequeno); color: var(--tinta-2); max-width: 70ch; }

/* O <fieldset> desligado é o que segura os controles do servidor enquanto o
   perfil não chegou. Sem reset ele estoura a grade. */
.cf-campos {
  display: flex;
  flex-direction: column;
  gap: var(--esp-16);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.cf-campos[disabled] { opacity: .55; }

/* --- Linha de ajuste ---------------------------------------------------- */
.cf-ajuste {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--esp-12) var(--esp-16);
  padding: var(--esp-12) 0;
  border-top: 1px solid var(--linha);
  min-width: 0;
}
.cf-ajuste:first-child { border-top: 0; padding-top: 0; }
.cf-ajuste.cf-empilha { grid-template-columns: minmax(0, 1fr); }
.cf-ajuste-texto { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.cf-ajuste-nome {
  font-family: var(--fonte-titulo);
  font-size: var(--txt-base);
  font-weight: 700;
  color: var(--tinta);
}
.cf-ajuste-nota { font-size: var(--txt-pequeno); color: var(--tinta-2); max-width: 64ch; }
.cf-ajuste-controle { display: flex; align-items: center; justify-content: flex-end; min-width: 0; }

/* --- Interruptor -------------------------------------------------------- */
.cf-interruptor {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  width: 56px;
  min-width: 56px;
  height: var(--alvo-toque);
  padding: 0;
  background: transparent;
  border: 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.cf-interruptor-trilho {
  position: relative;
  width: 52px;
  height: 30px;
  border-radius: var(--r-redondo);
  background: var(--fundo-2);
  border: 1px solid var(--linha-2);
  transition: background var(--transicao), border-color var(--transicao), box-shadow var(--transicao);
}
.cf-interruptor-bolinha {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--tinta-3);
  box-shadow: var(--sombra-1);
  transition: transform var(--transicao), background var(--transicao);
}
.cf-interruptor[aria-checked="true"] .cf-interruptor-trilho {
  background: var(--indigo);
  border-color: var(--indigo);
}
.cf-interruptor[aria-checked="true"] .cf-interruptor-bolinha {
  transform: translateX(22px);
  background: #FFF;
}
.cf-interruptor:hover .cf-interruptor-trilho { border-color: var(--indigo-cl); }
.cf-interruptor:focus-visible .cf-interruptor-trilho { box-shadow: var(--anel-foco); }
.cf-interruptor:active .cf-interruptor-bolinha { width: 26px; }
.cf-interruptor[disabled],
.cf-interruptor[aria-disabled="true"] { cursor: not-allowed; opacity: .6; }

/* --- Seletor segmentado ------------------------------------------------- */
.cf-segmentado {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 3px;
  background: var(--fundo-2);
  border: 1px solid var(--linha);
  border-radius: var(--r-p);
  max-width: 100%;
}
.cf-seg-opcao {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* O alvo de toque é o botão, não a caixa em volta: 44px aqui dentro. */
  min-height: var(--alvo-toque);
  padding: 0 var(--esp-12);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 9px;
  color: var(--tinta-2);
  font-family: var(--fonte-texto);
  font-size: var(--txt-pequeno);
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--transicao), color var(--transicao), border-color var(--transicao);
}
.cf-seg-opcao:hover { background: var(--carta-2); color: var(--tinta); }
.cf-seg-opcao[aria-checked="true"] {
  background: var(--indigo);
  border-color: var(--indigo);
  color: #FFF;
  box-shadow: var(--sombra-indigo);
}
.cf-seg-opcao:focus-visible { outline: 2px solid var(--indigo-cl); outline-offset: 2px; }

/* --- Deslizante --------------------------------------------------------- */
.cf-deslizante {
  display: flex;
  align-items: center;
  gap: var(--esp-12);
  width: min(360px, 100%);
  min-height: var(--alvo-toque);
  min-width: 0;
}
.cf-range {
  -webkit-appearance: none;
  appearance: none;
  flex: 1 1 auto;
  min-width: 0;
  /* Quem arrasta é o próprio campo: ele tem a altura de toque inteira, mesmo
     com o trilho fino de 8px desenhado no meio. */
  height: var(--alvo-toque);
  margin: 0;
  background: transparent;
  cursor: pointer;
}
.cf-range::-webkit-slider-runnable-track {
  height: 8px;
  border-radius: var(--r-redondo);
  border: 1px solid var(--linha);
  background: linear-gradient(90deg, var(--indigo) var(--cf-pct, 0%), var(--fundo-2) var(--cf-pct, 0%));
}
.cf-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 20px;
  height: 20px;
  margin-top: -7px;
  border-radius: 50%;
  background: var(--tinta);
  border: 2px solid var(--indigo);
  box-shadow: var(--sombra-1);
  transition: transform var(--t-rapida) var(--curva);
}
.cf-range:hover::-webkit-slider-thumb { transform: scale(1.1); }
.cf-range:focus-visible::-webkit-slider-thumb { box-shadow: var(--anel-foco); }
.cf-range::-moz-range-track {
  height: 8px;
  border-radius: var(--r-redondo);
  border: 1px solid var(--linha);
  background: var(--fundo-2);
}
.cf-range::-moz-range-progress {
  height: 8px;
  border-radius: var(--r-redondo);
  background: var(--indigo);
}
.cf-range::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--tinta);
  border: 2px solid var(--indigo);
}
.cf-range[disabled] { cursor: not-allowed; }
.cf-valor {
  min-width: 78px;
  text-align: right;
  font-family: var(--fonte-titulo);
  font-size: var(--txt-medio);
  font-weight: 800;
  color: var(--tinta);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* Faixa de aviso que abre e fecha. A regra é obrigatória: o .aviso do tema
   define display, e display de classe vence o [hidden] da folha do navegador
   — a mesma armadilha que a casca já documentou no .ca-falha-rede. */
.cf-aviso[hidden] { display: none; }

/* --- Exemplo com o dado de agora ---------------------------------------- */
.cf-exemplo {
  display: flex;
  flex-direction: column;
  gap: var(--esp-8);
  padding: var(--esp-12);
  background: var(--fundo-2);
  border: 1px solid var(--linha);
  border-radius: var(--r-p);
  min-width: 0;
}
.cf-exemplo-titulo {
  font-size: var(--txt-legenda);
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--tinta-3);
}
.cf-faixas { display: flex; flex-wrap: wrap; gap: var(--esp-8); min-width: 0; }
.cf-faixa {
  display: inline-flex;
  align-items: baseline;
  gap: 7px;
  padding: 7px 12px;
  border-radius: var(--r-p);
  border: 1px solid var(--linha);
  background: var(--carta);
  min-width: 0;
}
.cf-faixa-numero {
  font-family: var(--fonte-titulo);
  font-size: var(--txt-numero-p);
  font-weight: 800;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.cf-faixa-texto { font-size: var(--txt-pequeno); font-weight: 600; color: var(--tinta-2); }
.cf-faixa[data-tom="ok"] { border-color: rgba(53, 208, 127, .34); background: var(--veu-ok); }
.cf-faixa[data-tom="ok"] .cf-faixa-numero { color: var(--ok); }
.cf-faixa[data-tom="atencao"] { border-color: rgba(255, 201, 60, .34); background: var(--veu-atencao); }
.cf-faixa[data-tom="atencao"] .cf-faixa-numero { color: var(--atencao); }
.cf-faixa[data-tom="risco"] { border-color: rgba(255, 90, 90, .34); background: var(--veu-risco); }
.cf-faixa[data-tom="risco"] .cf-faixa-numero { color: var(--risco); }
.cf-faixa[data-tom="sem"] { border-style: dashed; }
.cf-faixa[data-tom="sem"] .cf-faixa-numero { color: var(--tinta-3); }
.cf-exemplo-nota { font-size: var(--txt-legenda); color: var(--tinta-3); }

/* --- Prévia da aparência ------------------------------------------------ */
.cf-previa {
  display: flex;
  flex-direction: column;
  gap: var(--esp-12);
  padding: var(--esp-16);
  background: var(--fundo-2);
  border: 1px dashed var(--linha-2);
  border-radius: var(--r);
  min-width: 0;
}
.cf-previa-linha { display: flex; flex-wrap: wrap; align-items: center; gap: var(--esp-12); min-width: 0; }

/* --- Lista de unidades fixadas ------------------------------------------ */
.cf-unidades {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--esp-8);
  margin: 0;
  padding: 0;
  list-style: none;
  min-width: 0;
}
.cf-unidade {
  display: flex;
  align-items: center;
  gap: var(--esp-8);
  padding: 6px 6px 6px var(--esp-12);
  background: var(--carta-2);
  border: 1px solid var(--linha);
  border-radius: var(--r-p);
  min-width: 0;
  transition: border-color var(--transicao), background var(--transicao);
}
.cf-unidade[data-fixada="sim"] { border-color: rgba(255, 201, 60, .45); background: var(--veu-ouro); }
.cf-unidade-nome {
  font-family: var(--fonte-titulo);
  font-size: var(--txt-pequeno);
  font-weight: 700;
  color: var(--tinta);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1 1 auto;
}
.cf-unidade .btn-icone { flex: none; }
.cf-unidade[data-fixada="sim"] .btn-icone[aria-pressed="true"] {
  background: var(--veu-ouro);
  border-color: rgba(255, 201, 60, .5);
  color: var(--ouro);
}

/* --- Conta --------------------------------------------------------------- */
.cf-dados {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--esp-12);
  margin: 0;
  min-width: 0;
}
.cf-dado { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.cf-dado dt {
  font-size: var(--txt-legenda);
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--tinta-2);
}
.cf-dado dd {
  margin: 0;
  font-family: var(--fonte-titulo);
  font-size: var(--txt-base);
  font-weight: 700;
  color: var(--tinta);
  overflow-wrap: anywhere;
}
.cf-dado dd.cf-sem-medida { color: var(--tinta-3); }

.cf-acoes { display: flex; flex-wrap: wrap; gap: var(--esp-8); min-width: 0; }

/* --- Origem dos números (Sobre) ------------------------------------------ */
.cf-origens { display: flex; flex-direction: column; gap: 0; margin: 0; min-width: 0; }
.cf-origem {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 4px var(--esp-12);
  padding: var(--esp-12) 0;
  border-top: 1px solid var(--linha);
  min-width: 0;
}
.cf-origem:first-child { border-top: 0; padding-top: 0; }
/* As três peças recebem posição explícita: o selo tem linha definida e, sem
   isto, a colocação automática o jogaria para a primeira coluna, empurrando o
   nome do indicador para a direita. */
.cf-origem-nome {
  grid-column: 1;
  grid-row: 1;
  font-family: var(--fonte-titulo);
  font-size: var(--txt-pequeno);
  font-weight: 700;
  color: var(--tinta);
  min-width: 0;
}
.cf-origem-selo { grid-column: 2; grid-row: 1 / span 2; justify-self: end; }
.cf-origem-texto {
  grid-column: 1;
  grid-row: 2;
  font-size: var(--txt-pequeno);
  color: var(--tinta-2);
  max-width: 78ch;
}

.cf-assinatura {
  display: flex;
  align-items: center;
  gap: var(--esp-8);
  padding: var(--esp-12);
  margin-top: var(--esp-16);
  background: var(--fundo-2);
  border: 1px solid var(--linha);
  border-radius: var(--r-p);
  font-size: var(--txt-pequeno);
  font-weight: 700;
  color: var(--tinta-2);
  min-width: 0;
}
.cf-assinatura i {
  width: 9px;
  height: 9px;
  flex: none;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--daco-verde), var(--daco-laranja));
}
.cf-mono { font-family: var(--fonte-mono); font-size: .92em; color: var(--tinta-2); overflow-wrap: anywhere; }

/* --- Responsivo ---------------------------------------------------------- */
@media (max-width: 1180px) {
  .cf-raiz { grid-template-columns: minmax(0, 1fr); }
  .cf-indice {
    position: static;
    flex-direction: row;
    flex-wrap: wrap;
    gap: var(--esp-8);
  }
  .cf-indice-titulo { display: none; }
  .cf-indice-item {
    width: auto;
    flex: 0 1 auto;
    border-color: var(--linha);
    background: var(--carta);
  }
}

@media (max-width: 720px) {
  .cf-ajuste {
    grid-template-columns: minmax(0, 1fr);
    align-items: stretch;
  }
  .cf-ajuste-controle { justify-content: flex-start; }
  .cf-deslizante { width: 100%; }
  .cf-segmentado { width: 100%; }
  .cf-seg-opcao { flex: 1 1 auto; }
  .cf-unidades { grid-template-columns: minmax(0, 1fr); }
  .cf-origem { grid-template-columns: minmax(0, 1fr); }
  .cf-origem-nome { grid-column: 1; grid-row: 1; }
  .cf-origem-selo { grid-column: 1; grid-row: 2; justify-self: start; }
  .cf-origem-texto { grid-column: 1; grid-row: 3; }
  .cf-salvo { margin-left: 0; }
  .cf-acoes .btn { width: 100%; }
}
`;

/* ═════════════════════════ 5. ESTADO DO MÓDULO ══════════════════════════ */

let contexto = null;
let raizTela = null;
let noEstilo = null;

let preferencias = null;      /* o que está valendo na tela */
let carregou = false;         /* o servidor já devolveu o perfil? */
let erroCarga = null;         /* ErroApi da leitura do perfil */
let perfilVazio = false;      /* o servidor respondeu sem nenhuma preferência */

let aparencia = lerAparencia();

let unidades = [];            /* lista 3.1, como veio da API */
let recebeuUnidades = false;
let erroUnidades = null;

/* Controles registrados: cada um sabe se redesenhar a partir de `preferencias`. */
let sincronizadores = [];

/* Gravação */
let relogioGravacao = 0;
let relogioSalvo = 0;
let gravando = false;
let antesDaJanela = null;     /* cópia anterior à primeira mudança da janela */
let descricaoPendente = '';
let ultimaTentativa = null;   /* { desejado, antes, descricao } para o "tentar de novo" */

/* Elementos vivos */
let elViva = null;
let elSalvo = null;
let elErro = null;
let elCampos = [];            /* <fieldset> que dependem do perfil */
let elIndice = [];
let elExemploSla = null;
let elExemploSilencio = null;
let elExemploSituacoes = null;
let elListaUnidades = null;
let elCaixaUnidades = null;
let elAvisoMovimento = null;

/* Ouvintes e observadores */
let pararAssinatura = null;
let observador = null;
let consultaMovimento = null;
let aoMudarMovimento = null;
let quadroMedida = 0;

/* ═════════════════════════ 6. UTILIDADES ════════════════════════════════ */

function criar(tag, classe, texto) {
  const no = document.createElement(tag);
  if (classe) no.className = classe;
  if (texto !== undefined && texto !== null) no.textContent = texto;
  return no;
}

/** Envelopa um ícone do projeto. `innerHTML` aqui só recebe constante daqui. */
function icone(svg, classe) {
  const caixa = criar('span', classe || null);
  caixa.setAttribute('aria-hidden', 'true');
  /* Sem classe própria, o embrulho vira um item de flex que não encolhe. Com
     classe, quem manda no tamanho é o CSS — o inline atrapalharia. */
  if (!classe) {
    caixa.style.display = 'inline-flex';
    caixa.style.flex = 'none';
  }
  caixa.innerHTML = svg;
  return caixa;
}

/**
 * Ícone sem embrulho, com a classe direto no <svg> — é assim que o tema espera
 * receber o `.vazio-icone` (ver o exemplo do componente no tema.css).
 */
function iconeSolto(svg, classe) {
  const caixa = document.createElement('div');
  caixa.innerHTML = svg;
  const no = caixa.firstElementChild;
  if (!no) return criar('span');
  if (classe) no.setAttribute('class', classe);
  no.setAttribute('aria-hidden', 'true');
  return no;
}

let contadorId = 0;
function idUnico(prefixo) {
  contadorId += 1;
  return 'cf-' + prefixo + '-' + contadorId;
}

function clonar(valor) {
  try {
    return JSON.parse(JSON.stringify(valor));
  } catch (e) {
    return valor;
  }
}

function plural(quantidade, singular, plural2) {
  return quantidade === 1 ? singular : plural2;
}

/** Número finito ou null. Nunca devolve 0 para "não veio". */
function numeroOuNulo(valor) {
  if (valor === null || valor === undefined) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function anunciar(texto) {
  if (elViva) elViva.textContent = texto;
}

/* ═════════════════════════ 7. PREFERÊNCIAS ══════════════════════════════ */

function inteiroDentro(valor, min, max, padrao) {
  const n = numeroOuNulo(valor);
  if (n === null) return padrao;
  const inteiro = Math.round(n);
  if (inteiro < min) return min;
  if (inteiro > max) return max;
  return inteiro;
}

/**
 * Deixa o que veio do servidor no formato que a tela entende. Campo ausente ou
 * fora do combinado cai no padrão da plataforma — e a tela avisa quando o
 * perfil inteiro veio vazio.
 */
function normalizarPreferencias(cru) {
  const base = clonar(PADRAO);
  if (!cru || typeof cru !== 'object') return base;

  const painel = cru.painel && typeof cru.painel === 'object' ? cru.painel : {};
  for (let i = 0; i < ORDENS.length; i += 1) {
    if (ORDENS[i].id === painel.ordem) base.painel.ordem = painel.ordem;
  }
  for (let i = 0; i < INTERVALOS.length; i += 1) {
    if (INTERVALOS[i].ms === numeroOuNulo(painel.intervalo_ms)) {
      base.painel.intervalo_ms = INTERVALOS[i].ms;
    }
  }
  const linhas = painel.linhas && typeof painel.linhas === 'object' ? painel.linhas : {};
  LINHAS_24H.forEach(function (linha) {
    if (typeof linhas[linha.id] === 'boolean') base.painel.linhas[linha.id] = linhas[linha.id];
  });
  if (Array.isArray(painel.fixadas)) {
    const vistas = {};
    base.painel.fixadas = painel.fixadas.filter(function (slug) {
      if (typeof slug !== 'string' || !slug) return false;
      if (vistas[slug]) return false;
      vistas[slug] = true;
      return true;
    });
  }

  const alertas = cru.alertas && typeof cru.alertas === 'object' ? cru.alertas : {};
  base.alertas.sla_verde_min = inteiroDentro(
    alertas.sla_verde_min, LIMITE_SLA_VERDE.min, LIMITE_SLA_VERDE.max, PADRAO.alertas.sla_verde_min
  );
  base.alertas.sla_amarelo_min = inteiroDentro(
    alertas.sla_amarelo_min, LIMITE_SLA_AMARELO.min, LIMITE_SLA_AMARELO.max, PADRAO.alertas.sla_amarelo_min
  );
  /* A segunda faixa nunca pode ficar abaixo da primeira: seria uma faixa vazia. */
  if (base.alertas.sla_amarelo_min <= base.alertas.sla_verde_min) {
    base.alertas.sla_amarelo_min = Math.min(LIMITE_SLA_AMARELO.max, base.alertas.sla_verde_min + 1);
  }
  base.alertas.silencio_horas = inteiroDentro(
    alertas.silencio_horas, LIMITE_SILENCIO.min, LIMITE_SILENCIO.max, PADRAO.alertas.silencio_horas
  );
  const destacar = alertas.destacar && typeof alertas.destacar === 'object' ? alertas.destacar : {};
  SITUACOES.forEach(function (s) {
    if (typeof destacar[s.id] === 'boolean') base.alertas.destacar[s.id] = destacar[s.id];
  });

  return base;
}

/** true quando o servidor respondeu sem nada gravado ainda. */
function pareceVazio(cru) {
  if (!cru || typeof cru !== 'object') return true;
  return Object.keys(cru).length === 0;
}

/* ═════════════════════════ 8. GRAVAÇÃO ══════════════════════════════════ */

function mostrarSelo(estado, texto) {
  if (!elSalvo) return;
  clearTimeout(relogioSalvo);
  elSalvo.textContent = '';
  if (!estado) {
    elSalvo.removeAttribute('data-estado');
    return;
  }
  if (estado === 'salvo') elSalvo.appendChild(icone(ICONES.certo));
  else elSalvo.appendChild(criar('span', 'cf-salvo-ponto'));
  elSalvo.appendChild(criar('span', null, texto));
  elSalvo.dataset.estado = estado;
  if (estado === 'salvo') {
    relogioSalvo = setTimeout(function () {
      if (elSalvo) elSalvo.removeAttribute('data-estado');
    }, TEMPO_SALVO_MS);
  }
}

function limparErroDeGravacao() {
  if (elErro) { elErro.textContent = ''; elErro.hidden = true; }
}

/**
 * Falhou a gravação: o valor VOLTA para o que estava antes e a tela diz o que
 * não foi gravado. Nada de deixar a tela mostrando uma escolha que o servidor
 * não aceitou.
 */
function mostrarErroDeGravacao(descricao, erro) {
  if (!elErro) return;
  elErro.textContent = '';
  elErro.hidden = false;
  elErro.className = 'aviso aviso-erro cf-aviso cf-erro';
  elErro.setAttribute('role', 'alert');
  elErro.appendChild(icone(ICONES.atencao));

  const corpo = criar('div');
  corpo.style.flex = '1 1 auto';
  corpo.style.minWidth = '0';
  corpo.appendChild(criar('span', 'aviso-titulo', 'Não consegui gravar: ' + descricao));
  corpo.appendChild(criar('span', 'aviso-texto',
    ((erro && erro.amigavel) || 'A gravação falhou.')
    + ' O controle voltou para o valor que estava gravado antes.'));
  elErro.appendChild(corpo);

  const botao = criar('button', 'btn', 'Tentar de novo');
  botao.type = 'button';
  botao.addEventListener('click', function () {
    if (!ultimaTentativa) { limparErroDeGravacao(); return; }
    const tentativa = ultimaTentativa;
    preferencias = clonar(tentativa.desejado);
    sincronizarTudo();
    antesDaJanela = clonar(tentativa.antes);
    descricaoPendente = tentativa.descricao;
    limparErroDeGravacao();
    gravarAgora();
  });
  elErro.appendChild(botao);
  anunciar('Falha ao gravar: ' + descricao);
}

/**
 * Registra uma mudança do usuário: aplica no estado, atualiza o que depende
 * dela e agenda a gravação. A cópia "antes" da janela é a mais antiga — é para
 * ela que a tela volta se a gravação falhar.
 */
function mudar(descricao, mutacao) {
  /* Enquanto o perfil não chegou, nada é gravado: o <fieldset> desligado já
     impede, e esta trava garante que nenhum caminho novo passe por cima. */
  if (!preferencias || !carregou) return;
  if (!antesDaJanela) antesDaJanela = clonar(preferencias);
  descricaoPendente = descricao;
  mutacao(preferencias);
  sincronizarTudo();
  limparErroDeGravacao();
  mostrarSelo('gravando', 'Salvando');
  clearTimeout(relogioGravacao);
  relogioGravacao = setTimeout(gravarAgora, ESPERA_GRAVACAO_MS);
}

async function gravarAgora() {
  clearTimeout(relogioGravacao);
  relogioGravacao = 0;
  if (!preferencias || !antesDaJanela) return;
  if (gravando) {
    /* Já tem uma gravação no ar: espera ela terminar e manda o estado final. */
    relogioGravacao = setTimeout(gravarAgora, ESPERA_GRAVACAO_MS);
    return;
  }

  const desejado = clonar(preferencias);
  const antes = clonar(antesDaJanela);
  const descricao = descricaoPendente || 'preferência';
  antesDaJanela = null;
  descricaoPendente = '';
  gravando = true;
  mostrarSelo('gravando', 'Salvando');

  try {
    await api.configGravar(desejado);
    if (!raizTela || !raizTela.isConnected) return;
    ultimaTentativa = null;
    mostrarSelo('salvo', 'Salvo');
    anunciar('Preferência gravada: ' + descricao + '.');
  } catch (erro) {
    if (!raizTela || !raizTela.isConnected) return;
    if (ehErroDeSessao(erro)) return;          /* quem leva para o login é a casca */
    ultimaTentativa = { desejado: desejado, antes: antes, descricao: descricao };
    preferencias = clonar(antes);
    sincronizarTudo();
    mostrarSelo(null, '');
    mostrarErroDeGravacao(descricao, erro);
  } finally {
    gravando = false;
  }
}

/* ═════════════════════════ 9. CONTROLES ═════════════════════════════════ */

function registrar(fn) {
  sincronizadores.push(fn);
  try { fn(); } catch (e) { console.error('[config] falha ao desenhar um controle', e); }
}

function sincronizarTudo() {
  sincronizadores.forEach(function (fn) {
    try { fn(); } catch (e) { console.error('[config] falha ao redesenhar um controle', e); }
  });
  desenharExemplos();
}

/**
 * Linha de ajuste: nome, explicação e o controle à direita.
 * Devolve { linha, textoId, notaId } para o controle se descrever por aria.
 */
function montarLinha(nome, nota, opcoes) {
  const empilha = !!(opcoes && opcoes.empilha);
  const linha = criar('div', 'cf-ajuste' + (empilha ? ' cf-empilha' : ''));
  const texto = criar('div', 'cf-ajuste-texto');
  const elNome = criar('span', 'cf-ajuste-nome', nome);
  elNome.id = idUnico('nome');
  texto.appendChild(elNome);
  let notaId = null;
  if (nota) {
    const elNota = criar('p', 'cf-ajuste-nota', nota);
    elNota.id = idUnico('nota');
    notaId = elNota.id;
    texto.appendChild(elNota);
  }
  linha.appendChild(texto);

  const controle = criar('div', 'cf-ajuste-controle');
  linha.appendChild(controle);

  return { linha: linha, caixa: controle, nomeId: elNome.id, notaId: notaId };
}

/**
 * Interruptor (role="switch"). `ler()` devolve o estado atual, `escrever(v)`
 * aplica a escolha. Teclado: Enter e Espaço, de graça, porque é um <button>.
 */
function montarInterruptor(alvo, ler, escrever) {
  const botao = criar('button', 'cf-interruptor');
  botao.type = 'button';
  botao.setAttribute('role', 'switch');
  if (alvo.nomeId) botao.setAttribute('aria-labelledby', alvo.nomeId);
  if (alvo.notaId) botao.setAttribute('aria-describedby', alvo.notaId);

  const trilho = criar('span', 'cf-interruptor-trilho');
  trilho.appendChild(criar('span', 'cf-interruptor-bolinha'));
  botao.appendChild(trilho);

  botao.addEventListener('click', function () {
    if (botao.getAttribute('aria-disabled') === 'true') return;
    escrever(botao.getAttribute('aria-checked') !== 'true');
  });

  alvo.caixa.appendChild(botao);
  registrar(function () {
    botao.setAttribute('aria-checked', ler() ? 'true' : 'false');
  });
  return botao;
}

/**
 * Seletor segmentado (radiogroup). Setas andam e escolhem, Home/End vão às
 * pontas — o padrão de grupo de rádio, com tabulação única no item marcado.
 */
function montarSegmentado(alvo, opcoes, ler, escrever) {
  const grupo = criar('div', 'cf-segmentado');
  grupo.setAttribute('role', 'radiogroup');
  if (alvo.nomeId) grupo.setAttribute('aria-labelledby', alvo.nomeId);
  if (alvo.notaId) grupo.setAttribute('aria-describedby', alvo.notaId);

  const botoes = opcoes.map(function (opcao) {
    const botao = criar('button', 'cf-seg-opcao', opcao.rotulo);
    botao.type = 'button';
    botao.setAttribute('role', 'radio');
    botao.dataset.valor = String(opcao.valor);
    botao.addEventListener('click', function () { escrever(opcao.valor); });
    grupo.appendChild(botao);
    return botao;
  });

  grupo.addEventListener('keydown', function (evento) {
    const teclas = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (teclas.indexOf(evento.key) < 0) return;
    evento.preventDefault();
    let indice = botoes.indexOf(document.activeElement);
    if (indice < 0) indice = 0;
    let destino = indice;
    if (evento.key === 'ArrowRight' || evento.key === 'ArrowDown') destino = (indice + 1) % botoes.length;
    else if (evento.key === 'ArrowLeft' || evento.key === 'ArrowUp') destino = (indice - 1 + botoes.length) % botoes.length;
    else if (evento.key === 'Home') destino = 0;
    else destino = botoes.length - 1;
    const escolhido = opcoes[destino];
    escrever(escolhido.valor);
    try { botoes[destino].focus({ preventScroll: true }); } catch (e) { botoes[destino].focus(); }
  });

  alvo.caixa.appendChild(grupo);
  registrar(function () {
    const atual = String(ler());
    let achou = false;
    botoes.forEach(function (botao) {
      const marcado = botao.dataset.valor === atual;
      if (marcado) achou = true;
      botao.setAttribute('aria-checked', marcado ? 'true' : 'false');
      botao.tabIndex = marcado ? 0 : -1;
    });
    /* Nenhum marcado (valor estranho vindo do servidor): o primeiro recebe a
       tabulação para o grupo continuar alcançável pelo teclado. */
    if (!achou && botoes.length) botoes[0].tabIndex = 0;
  });
  return grupo;
}

/**
 * Deslizante com valor legível ao lado. Usa <input type="range"> de verdade:
 * teclado, leitor de tela e toque já funcionam sem gambiarra.
 * `formatar(n)` devolve o texto do valor; `descrever(n)` o texto para o leitor.
 */
function montarDeslizante(alvo, limites, ler, escrever, formatar, descrever) {
  const caixa = criar('div', 'cf-deslizante');
  const campo = criar('input', 'cf-range');
  campo.type = 'range';
  campo.min = String(limites.min);
  campo.max = String(limites.max);
  campo.step = '1';
  if (alvo.nomeId) campo.setAttribute('aria-labelledby', alvo.nomeId);
  if (alvo.notaId) campo.setAttribute('aria-describedby', alvo.notaId);

  const valor = criar('output', 'cf-valor');
  valor.setAttribute('aria-hidden', 'true');   /* o leitor já ouve o aria-valuetext */

  campo.addEventListener('input', function () {
    escrever(Number(campo.value));
  });

  caixa.appendChild(campo);
  caixa.appendChild(valor);
  alvo.caixa.appendChild(caixa);

  registrar(function () {
    const atual = ler();
    /* Limite dinâmico primeiro: a segunda faixa nunca desce abaixo da primeira,
       e mexer no min depois do value faria o navegador cortar o valor. */
    if (typeof limites.minimoVivo === 'function') {
      campo.min = String(limites.minimoVivo());
    }
    campo.value = String(atual);
    const min = Number(campo.min);
    const max = Number(campo.max);
    const pct = max > min ? ((atual - min) / (max - min)) * 100 : 0;
    campo.style.setProperty('--cf-pct', Math.max(0, Math.min(100, pct)) + '%');
    campo.setAttribute('aria-valuetext', descrever ? descrever(atual) : formatar(atual));
    valor.textContent = formatar(atual);
  });
  return campo;
}

/* ═════════════════════════ 10. EXEMPLOS COM O DADO DE AGORA ═════════════
   Nenhum número destes blocos é ilustrativo: todos são contados sobre as
   unidades que `visao_geral` devolveu nesta sessão. Unidade sem medida é
   contada à parte — nunca cai na faixa verde por falta de dado.
   ════════════════════════════════════════════════════════════════════════ */

function h24De(u) {
  return u && u.h24 && typeof u.h24 === 'object' ? u.h24 : {};
}

/** Horas desde um instante ISO, ou null quando não dá para medir. */
function horasDesde(iso) {
  if (!iso) return null;
  const marca = Date.parse(iso);
  if (Number.isNaN(marca)) return null;
  const horas = (Date.now() - marca) / 3600000;
  return horas < 0 ? 0 : horas;
}

function contarFaixasDoSla(verde, amarelo) {
  const conta = { dentro: 0, meio: 0, fora: 0, sem: 0 };
  unidades.forEach(function (u) {
    const valor = numeroOuNulo(h24De(u).sla_mediana_min);
    if (valor === null) { conta.sem += 1; return; }
    if (valor <= verde) conta.dentro += 1;
    else if (valor <= amarelo) conta.meio += 1;
    else conta.fora += 1;
  });
  return conta;
}

function contarSilencio(horas) {
  const conta = { passam: 0, sem: 0, dentro: 0 };
  unidades.forEach(function (u) {
    const medida = horasDesde(u && u.ultima_mensagem_em);
    if (medida === null) { conta.sem += 1; return; }
    if (medida >= horas) conta.passam += 1;
    else conta.dentro += 1;
  });
  return conta;
}

function contarSituacao(id, alertas) {
  let total = 0;
  unidades.forEach(function (u) {
    if (!u) return;
    if (id === 'silenciosa') {
      const medida = horasDesde(u.ultima_mensagem_em);
      if (medida !== null && medida >= alertas.silencio_horas) total += 1;
    } else if (id === 'sem_captura') {
      if (u.capturando === false && u.ativo !== false) total += 1;
    } else if (id === 'sla_alto') {
      const valor = numeroOuNulo(h24De(u).sla_mediana_min);
      if (valor !== null && valor > alertas.sla_amarelo_min) total += 1;
    } else if (id === 'inativa') {
      if (u.ativo === false) total += 1;
    }
  });
  return total;
}

function faixa(numero, texto, tom) {
  const caixa = criar('div', 'cf-faixa');
  if (tom) caixa.dataset.tom = tom;
  caixa.appendChild(criar('span', 'cf-faixa-numero numero', formatarNumero(numero)));
  caixa.appendChild(criar('span', 'cf-faixa-texto', texto));
  return caixa;
}

/** Bloco honesto para quando a lista de unidades ainda não chegou. */
function exemploSemDado(alvo) {
  alvo.textContent = '';
  const caixa = criar('div', 'cf-exemplo');
  caixa.appendChild(criar('p', 'cf-exemplo-titulo', 'Efeito deste limite hoje'));
  if (erroUnidades) {
    caixa.appendChild(criar('p', 'cf-exemplo-nota',
      'Não consegui ler as unidades para mostrar o efeito: ' + erroUnidades.amigavel
      + ' O limite continua valendo — só o exemplo está sem base.'));
  } else if (!recebeuUnidades) {
    caixa.appendChild(criar('p', 'cf-exemplo-nota', 'Carregando as unidades para calcular o efeito…'));
  } else {
    caixa.appendChild(criar('p', 'cf-exemplo-nota',
      'A ação visao_geral respondeu sem unidades, então não há base para contar o efeito. '
      + 'Nenhum número de exemplo é inventado aqui.'));
  }
  alvo.appendChild(caixa);
}

function desenharExemploSla() {
  if (!elExemploSla || !preferencias) return;
  if (!unidades.length) { exemploSemDado(elExemploSla); return; }

  const verde = preferencias.alertas.sla_verde_min;
  const amarelo = preferencias.alertas.sla_amarelo_min;
  const conta = contarFaixasDoSla(verde, amarelo);

  elExemploSla.textContent = '';
  const caixa = criar('div', 'cf-exemplo');
  caixa.appendChild(criar('p', 'cf-exemplo-titulo',
    'Com estes limites, as ' + formatarNumero(unidades.length) + ' unidades de agora ficam assim'));

  const faixas = criar('div', 'cf-faixas');
  faixas.appendChild(faixa(conta.dentro,
    plural(conta.dentro, 'unidade até ', 'unidades até ') + formatarMinutos(verde), 'ok'));
  faixas.appendChild(faixa(conta.meio,
    'entre ' + formatarMinutos(verde) + ' e ' + formatarMinutos(amarelo), 'atencao'));
  faixas.appendChild(faixa(conta.fora, 'acima de ' + formatarMinutos(amarelo), 'risco'));
  if (conta.sem) {
    faixas.appendChild(faixa(conta.sem, 'sem tempo medido', 'sem'));
  }
  caixa.appendChild(faixas);

  caixa.appendChild(criar('p', 'cf-exemplo-nota', conta.sem
    ? 'As ' + formatarNumero(conta.sem) + ' ' + plural(conta.sem, 'unidade', 'unidades')
      + ' sem tempo medido não entram em faixa nenhuma: ausência de medida não é resposta rápida.'
    : 'Todas as unidades da lista têm tempo mediano medido nas últimas 24 h.'));
  elExemploSla.appendChild(caixa);
}

function desenharExemploSilencio() {
  if (!elExemploSilencio || !preferencias) return;
  if (!unidades.length) { exemploSemDado(elExemploSilencio); return; }

  const horas = preferencias.alertas.silencio_horas;
  const conta = contarSilencio(horas);

  elExemploSilencio.textContent = '';
  const caixa = criar('div', 'cf-exemplo');
  caixa.appendChild(criar('p', 'cf-exemplo-titulo', 'Efeito deste limite agora'));

  const faixas = criar('div', 'cf-faixas');
  faixas.appendChild(faixa(conta.passam,
    plural(conta.passam, 'unidade passa', 'unidades passam') + ' de ' + horas + ' h sem mensagem',
    conta.passam ? 'risco' : 'ok'));
  faixas.appendChild(faixa(conta.dentro, 'dentro do limite', 'ok'));
  if (conta.sem) faixas.appendChild(faixa(conta.sem, 'sem data da última mensagem', 'sem'));
  caixa.appendChild(faixas);

  caixa.appendChild(criar('p', 'cf-exemplo-nota',
    'A conta é feita sobre o horário da última mensagem capturada de cada unidade. '
    + 'A API também marca a unidade como silenciosa pela régua dela (mais de 4 h úteis); '
    + 'este limite manda no destaque do painel.'));
  elExemploSilencio.appendChild(caixa);
}

function desenharExemploSituacoes() {
  if (!elExemploSituacoes || !preferencias) return;
  if (!unidades.length) { exemploSemDado(elExemploSituacoes); return; }

  elExemploSituacoes.textContent = '';
  const caixa = criar('div', 'cf-exemplo');
  caixa.appendChild(criar('p', 'cf-exemplo-titulo', 'Quantos cartões cada destaque pegaria agora'));

  const faixas = criar('div', 'cf-faixas');
  let ligados = 0;
  SITUACOES.forEach(function (s) {
    if (!preferencias.alertas.destacar[s.id]) return;
    ligados += 1;
    const total = contarSituacao(s.id, preferencias.alertas);
    faixas.appendChild(faixa(total, s.rotulo.toLowerCase(), total ? 'atencao' : 'ok'));
  });

  if (!ligados) {
    caixa.appendChild(criar('p', 'cf-exemplo-nota',
      'Nenhuma situação ligada: nenhum cartão recebe destaque no Painel de Controle.'));
  } else {
    caixa.appendChild(faixas);
    caixa.appendChild(criar('p', 'cf-exemplo-nota',
      'Contado sobre as ' + formatarNumero(unidades.length) + ' unidades desta leitura. '
      + 'Um cartão pode entrar em mais de uma situação.'));
  }
  elExemploSituacoes.appendChild(caixa);
}

function desenharExemplos() {
  desenharExemploSla();
  desenharExemploSilencio();
  desenharExemploSituacoes();
  desenharListaUnidades();
}

/* ═════════════════════════ 11. SEÇÃO: CONTA ═════════════════════════════ */

function linhaDeDado(lista, rotulo, valor, motivoSemMedida) {
  const bloco = criar('div', 'cf-dado');
  bloco.appendChild(criar('dt', null, rotulo));
  const dd = criar('dd', null, valor === null || valor === undefined || valor === '' ? TRACINHO : String(valor));
  if (valor === null || valor === undefined || valor === '') {
    dd.classList.add('cf-sem-medida');
    if (motivoSemMedida) dd.title = motivoSemMedida;
  }
  bloco.appendChild(dd);
  lista.appendChild(bloco);
  return dd;
}

function montarConta() {
  const secao = criar('section', 'carta cf-secao');
  secao.id = 'cf-conta';
  secao.tabIndex = -1;
  secao.setAttribute('aria-labelledby', 'cf-conta-titulo');

  const cabeca = criar('div', 'cf-secao-cabeca');
  cabeca.appendChild(icone(ICONES.conta, 'cf-secao-icone'));
  const texto = criar('div', 'cf-secao-texto');
  const titulo = criar('h2', null, 'Conta');
  titulo.id = 'cf-conta-titulo';
  texto.appendChild(titulo);
  texto.appendChild(criar('p', 'cf-secao-nota',
    'Quem está usando o painel neste navegador. Os campos vêm da sessão devolvida no login; '
    + 'o que o servidor não mandou aparece como traço, nunca preenchido por fora.'));
  cabeca.appendChild(texto);
  secao.appendChild(cabeca);

  const usuario = (contexto && contexto.sessao && contexto.sessao.usuario) || null;
  const bruta = contexto && contexto.sessao && typeof contexto.sessao.ler === 'function'
    ? contexto.sessao.ler()
    : null;

  const lista = criar('dl', 'cf-dados');
  linhaDeDado(lista, 'Nome', usuario && usuario.nome ? usuario.nome : null,
    'A ação login não devolveu o nome do usuário.');
  linhaDeDado(lista, 'E-mail de acesso', usuario && usuario.email ? usuario.email : null,
    'A ação login devolve apenas nome e papel (seção 3 do contrato). O e-mail usado para entrar '
    + 'não é guardado neste navegador.');
  linhaDeDado(lista, 'Papel', usuario && usuario.papel ? usuario.papel : null,
    'A ação login não devolveu o papel deste usuário.');

  const ultimo = usuario && (usuario.ultimo_acesso || usuario.ultimo_acesso_em);
  linhaDeDado(lista, 'Último acesso', ultimo ? formatarQuando(ultimo) : null,
    'O servidor não informa o acesso anterior nesta versão da API.');

  const expira = bruta && bruta.expira_em ? bruta.expira_em : null;
  linhaDeDado(lista, 'Esta sessão vence', expira ? formatarQuando(expira) : null,
    'O login não informou validade: quem decide é o servidor, na próxima chamada.');

  linhaDeDado(lista, 'Guardada neste navegador',
    bruta ? (bruta.lembrar ? 'Até você sair' : 'Só até fechar a aba') : null,
    'Nenhuma sessão encontrada no armazenamento deste navegador.');
  secao.appendChild(lista);

  /* --- Ações da conta -------------------------------------------------- */
  const acoes = criar('div', 'cf-acoes');
  acoes.style.marginTop = 'var(--esp-16)';

  const avisoSenha = criar('div', 'aviso cf-aviso');
  avisoSenha.id = idUnico('senha');
  avisoSenha.hidden = true;

  const botaoSenha = criar('button', 'btn');
  botaoSenha.type = 'button';
  botaoSenha.appendChild(icone(ICONES.chave));
  botaoSenha.appendChild(criar('span', null, 'Trocar a senha'));
  botaoSenha.setAttribute('aria-expanded', 'false');
  botaoSenha.setAttribute('aria-controls', avisoSenha.id);
  botaoSenha.addEventListener('click', function () {
    const abrindo = avisoSenha.hidden;
    avisoSenha.hidden = !abrindo;
    botaoSenha.setAttribute('aria-expanded', abrindo ? 'true' : 'false');
    if (abrindo) anunciar('A troca de senha é feita pela Daco.');
  });
  acoes.appendChild(botaoSenha);

  /* --- Sair ------------------------------------------------------------ */
  const confirmar = criar('div', 'aviso aviso-atencao cf-aviso');
  confirmar.id = idUnico('sair');
  confirmar.hidden = true;

  const botaoSair = criar('button', 'btn btn-perigo');
  botaoSair.type = 'button';
  botaoSair.appendChild(icone(ICONES.sair));
  botaoSair.appendChild(criar('span', null, 'Sair da conta'));
  botaoSair.setAttribute('aria-expanded', 'false');
  botaoSair.setAttribute('aria-controls', confirmar.id);
  botaoSair.addEventListener('click', function () {
    const abrindo = confirmar.hidden;
    confirmar.hidden = !abrindo;
    botaoSair.setAttribute('aria-expanded', abrindo ? 'true' : 'false');
    if (abrindo) {
      const primeiro = confirmar.querySelector('button');
      if (primeiro) { try { primeiro.focus({ preventScroll: true }); } catch (e) { primeiro.focus(); } }
    }
  });
  acoes.appendChild(botaoSair);
  secao.appendChild(acoes);

  /* Conteúdo dos dois avisos. */
  avisoSenha.appendChild(icone(ICONES.chave));
  const corpoSenha = criar('div');
  corpoSenha.style.flex = '1 1 auto';
  corpoSenha.style.minWidth = '0';
  corpoSenha.appendChild(criar('span', 'aviso-titulo', 'A troca de senha é pedida à Daco'));
  corpoSenha.appendChild(criar('span', 'aviso-texto',
    'Esta plataforma não tem tela de troca de senha: a API do painel (seção 3 do contrato) não expõe '
    + 'essa ação, e nenhum botão daqui vai fingir que expõe. Peça a troca à Daco pelo canal de sempre; '
    + 'a nova senha passa a valer no próximo login, neste e em qualquer outro aparelho.'));
  avisoSenha.appendChild(corpoSenha);
  secao.appendChild(avisoSenha);

  confirmar.appendChild(icone(ICONES.atencao));
  const corpoSair = criar('div');
  corpoSair.style.flex = '1 1 auto';
  corpoSair.style.minWidth = '0';
  corpoSair.appendChild(criar('span', 'aviso-titulo', 'Encerrar a sessão neste navegador?'));
  corpoSair.appendChild(criar('span', 'aviso-texto',
    'As preferências gravadas ficam no seu perfil e voltam no próximo login. '
    + 'A aparência (densidade, texto e movimento) continua guardada só neste navegador.'));
  confirmar.appendChild(corpoSair);

  const confirmaSair = criar('button', 'btn btn-perigo', 'Confirmar saída');
  confirmaSair.type = 'button';
  confirmaSair.addEventListener('click', function () {
    confirmaSair.disabled = true;
    confirmaSair.setAttribute('aria-busy', 'true');
    sairDaConta();
  });
  confirmar.appendChild(confirmaSair);

  const cancelar = criar('button', 'btn btn-fantasma', 'Cancelar');
  cancelar.type = 'button';
  cancelar.addEventListener('click', function () {
    confirmar.hidden = true;
    botaoSair.setAttribute('aria-expanded', 'false');
    try { botaoSair.focus({ preventScroll: true }); } catch (e) { botaoSair.focus(); }
  });
  confirmar.appendChild(cancelar);
  secao.appendChild(confirmar);

  return secao;
}

/**
 * Sair sem invadir a casca: quem manda na sessão é ela. Primeiro tentamos o
 * próprio botão de sair do cabeçalho (é a via oficial); só se ele não existir
 * é que chamamos a API daqui e avisamos a casca pelo mesmo evento que ela já
 * escuta para acompanhar outra aba.
 */
async function sairDaConta() {
  const botaoDaCasca = document.querySelector('.ca-cabecalho button[aria-label="Sair da conta"]');
  if (botaoDaCasca) { botaoDaCasca.click(); return; }

  try {
    await api.sair();
  } catch (e) {
    /* api.sair() já apaga a sessão local mesmo com o servidor fora */
  }
  try {
    window.dispatchEvent(new StorageEvent('storage', { key: 'wa360.sessao' }));
  } catch (e) {
    /* navegador que não deixa construir StorageEvent: o irPara abaixo resolve */
  }
  if (contexto && typeof contexto.irPara === 'function') contexto.irPara('login');
}

/* ═════════════════════════ 12. SEÇÃO: APARÊNCIA ═════════════════════════ */

function aplicarEGravarAparencia(descricao) {
  aplicarAparencia(aparencia);
  gravarAparencia(aparencia);
  mostrarSelo('salvo', 'Salvo neste aparelho');
  anunciar(descricao);
}

function montarAparencia() {
  const secao = criar('section', 'carta cf-secao');
  secao.id = 'cf-aparencia-secao';
  secao.tabIndex = -1;
  secao.setAttribute('aria-labelledby', 'cf-aparencia-titulo');

  const cabeca = criar('div', 'cf-secao-cabeca');
  cabeca.appendChild(icone(ICONES.aparencia, 'cf-secao-icone'));
  const texto = criar('div', 'cf-secao-texto');
  const titulo = criar('h2', null, 'Aparência');
  titulo.id = 'cf-aparencia-titulo';
  texto.appendChild(titulo);
  texto.appendChild(criar('p', 'cf-secao-nota',
    'Vale para a plataforma inteira e fica guardada só neste navegador — é ajuste de tela, '
    + 'não dado do perfil. Cada mudança aparece na hora, inclusive na prévia aqui embaixo.'));
  cabeca.appendChild(texto);
  secao.appendChild(cabeca);

  const campos = criar('div', 'cf-campos');

  /* Densidade */
  const densidade = montarLinha('Densidade',
    'Confortável dá mais respiro; compacta cabe mais unidade na tela sem encolher o alvo de toque.');
  montarSegmentado(densidade,
    [{ valor: 'confortavel', rotulo: 'Confortável' }, { valor: 'compacta', rotulo: 'Compacta' }],
    function () { return aparencia.densidade; },
    function (valor) {
      if (aparencia.densidade === valor) return;
      aparencia.densidade = valor;
      aplicarEGravarAparencia('Densidade ' + (valor === 'compacta' ? 'compacta' : 'confortável') + '.');
      sincronizarTudo();
    });
  campos.appendChild(densidade.linha);

  /* Tamanho do texto */
  const fonte = montarLinha('Tamanho do texto',
    'Três níveis sobre a mesma tipografia. O número grande do cartão acompanha a escala.');
  montarSegmentado(fonte,
    [{ valor: 'pequena', rotulo: 'Menor' }, { valor: 'padrao', rotulo: 'Padrão' }, { valor: 'grande', rotulo: 'Maior' }],
    function () { return aparencia.fonte; },
    function (valor) {
      if (aparencia.fonte === valor) return;
      aparencia.fonte = valor;
      aplicarEGravarAparencia('Tamanho do texto: ' + valor + '.');
      sincronizarTudo();
      medirTopo();
    });
  campos.appendChild(fonte.linha);

  /* Movimento */
  const movimento = montarLinha('Reduzir animações',
    'Desliga as transições e as contagens de número. O painel continua igual, só parado.');
  const interruptorMovimento = montarInterruptor(movimento,
    function () { return aparencia.movimento === 'reduzido' || movimentoDoSistema(); },
    function (ligado) {
      aparencia.movimento = ligado ? 'reduzido' : 'sistema';
      aplicarEGravarAparencia(ligado ? 'Animações reduzidas.' : 'Animações no padrão do sistema.');
      sincronizarTudo();
    });
  campos.appendChild(movimento.linha);

  elAvisoMovimento = criar('p', 'cf-ajuste-nota');
  elAvisoMovimento.hidden = true;
  movimento.linha.querySelector('.cf-ajuste-texto').appendChild(elAvisoMovimento);

  /* O sistema do usuário manda: se ele já pede menos movimento, o interruptor
     fica marcado e travado — ninguém devolve animação por engano. */
  registrar(function () {
    const doSistema = movimentoDoSistema();
    if (doSistema) {
      interruptorMovimento.setAttribute('aria-disabled', 'true');
      interruptorMovimento.setAttribute('aria-checked', 'true');
      if (elAvisoMovimento) {
        elAvisoMovimento.hidden = false;
        elAvisoMovimento.textContent = 'Este aparelho já pede menos movimento nas configurações do '
          + 'sistema, então o painel fica parado de qualquer jeito. Mude no sistema para liberar.';
      }
    } else {
      interruptorMovimento.removeAttribute('aria-disabled');
      if (elAvisoMovimento) { elAvisoMovimento.hidden = true; elAvisoMovimento.textContent = ''; }
    }
  });

  /* Trilho recolhido */
  const trilho = montarLinha('Abrir com o menu recolhido',
    'Na tela larga o menu lateral começa só com os ícones. No celular ele já é a barra de baixo, '
    + 'e este ajuste não muda nada lá.');
  montarInterruptor(trilho,
    function () { return lerLocal(CHAVE_TRILHO) === 'sim'; },
    function (ligado) {
      /* A casca é a dona do trilho: mexemos pelo botão dela, que grava a mesma
         chave e mantém o aria certinho. */
      const raizCasca = document.querySelector('.ca-raiz');
      const botao = document.querySelector('.ca-recolher');
      const agora = raizCasca ? raizCasca.dataset.recolhido === 'sim' : lerLocal(CHAVE_TRILHO) === 'sim';
      if (botao && agora !== ligado) botao.click();
      else gravarLocal(CHAVE_TRILHO, ligado ? 'sim' : 'nao');
      mostrarSelo('salvo', 'Salvo neste aparelho');
      anunciar(ligado ? 'O menu passa a abrir recolhido.' : 'O menu passa a abrir aberto.');
      sincronizarTudo();
    });
  campos.appendChild(trilho.linha);

  secao.appendChild(campos);

  /* Prévia: peças reais do tema, que reagem à escala e à densidade. */
  const previa = criar('div', 'cf-previa');
  previa.setAttribute('role', 'group');
  previa.setAttribute('aria-label', 'Prévia da aparência escolhida');
  previa.appendChild(criar('p', 'cf-exemplo-titulo', 'Prévia'));

  const linhaPrevia = criar('div', 'cf-previa-linha');
  const cartaPrevia = criar('div', 'carta');
  cartaPrevia.style.flex = '1 1 240px';
  cartaPrevia.style.minWidth = '0';
  const metrica = criar('div', 'metrica');
  const valorPrevia = criar('span', 'metrica-valor numero', TRACINHO);
  valorPrevia.title = 'Prévia da tipografia: nenhum número de exemplo é mostrado aqui.';
  metrica.appendChild(valorPrevia);
  metrica.appendChild(criar('span', 'metrica-rotulo', 'Tempo de resposta'));
  cartaPrevia.appendChild(metrica);
  linhaPrevia.appendChild(cartaPrevia);

  const selo = criar('span', 'selo selo-ok', 'Captura ligada');
  linhaPrevia.appendChild(selo);
  const botaoPrevia = criar('button', 'btn', 'Botão de ação');
  botaoPrevia.type = 'button';
  botaoPrevia.tabIndex = -1;
  botaoPrevia.setAttribute('aria-hidden', 'true');
  linhaPrevia.appendChild(botaoPrevia);
  previa.appendChild(linhaPrevia);

  previa.appendChild(criar('p', 'cf-exemplo-nota',
    'O valor aparece como traço de propósito: esta é uma prévia de tipografia e espaçamento, '
    + 'não um número medido.'));
  secao.appendChild(previa);

  return secao;
}

/* ═════════════════════════ 13. SEÇÃO: PAINEL ════════════════════════════ */

function montarPainel() {
  const secao = criar('section', 'carta cf-secao');
  secao.id = 'cf-painel';
  secao.tabIndex = -1;
  secao.setAttribute('aria-labelledby', 'cf-painel-titulo');

  const cabeca = criar('div', 'cf-secao-cabeca');
  cabeca.appendChild(icone(ICONES.painel, 'cf-secao-icone'));
  const texto = criar('div', 'cf-secao-texto');
  const titulo = criar('h2', null, 'Painel de Controle');
  titulo.id = 'cf-painel-titulo';
  texto.appendChild(titulo);
  texto.appendChild(criar('p', 'cf-secao-nota',
    'Define como o Painel de Controle deve abrir: por onde começa o ranking, de quanto em quanto '
    + 'tempo ele se atualiza e o que cada cartão mostra. Fica gravado no seu perfil pela ação '
    + 'config_gravar.'));
  cabeca.appendChild(texto);
  secao.appendChild(cabeca);

  const campos = criar('fieldset', 'cf-campos');
  campos.disabled = true;
  elCampos.push(campos);

  /* Ordenação */
  const ordem = montarLinha('Ordenação dos cartões',
    'Por nota, por tempo de resposta, por volume ou em ordem alfabética. Ordem alfabética não é '
    + 'ranking: nessa opção nenhuma posição aparece nos cartões.');
  montarSegmentado(ordem,
    ORDENS.map(function (o) { return { valor: o.id, rotulo: o.rotulo }; }),
    function () { return preferencias ? preferencias.painel.ordem : PADRAO.painel.ordem; },
    function (valor) {
      if (!preferencias || preferencias.painel.ordem === valor) return;
      mudar('ordenação dos cartões', function (p) { p.painel.ordem = valor; });
    });
  campos.appendChild(ordem.linha);

  /* Intervalo */
  const intervalo = montarLinha('Atualização ao vivo',
    'De quanto em quanto tempo o painel reconsulta a rede. Em "Manual" ele só busca quando você '
    + 'pedir — útil em conexão fraca.');
  montarSegmentado(intervalo,
    INTERVALOS.map(function (i) { return { valor: i.ms, rotulo: i.rotulo }; }),
    function () { return preferencias ? preferencias.painel.intervalo_ms : PADRAO.painel.intervalo_ms; },
    function (valor) {
      if (!preferencias || preferencias.painel.intervalo_ms === valor) return;
      mudar('intervalo de atualização', function (p) { p.painel.intervalo_ms = Number(valor); });
    });
  campos.appendChild(intervalo.linha);

  /* Linhas do cartão */
  const cabecaLinhas = montarLinha('Linhas das ÚLTIMAS 24H',
    'O que aparece no miolo de cada cartão de unidade. Pelo menos uma linha precisa ficar visível.',
    { empilha: true });
  campos.appendChild(cabecaLinhas.linha);

  LINHAS_24H.forEach(function (linha) {
    const alvo = montarLinha(linha.rotulo, linha.nota);
    montarInterruptor(alvo,
      function () { return preferencias ? !!preferencias.painel.linhas[linha.id] : true; },
      function (ligado) {
        if (!preferencias) return;
        if (!ligado) {
          const restantes = LINHAS_24H.filter(function (outra) {
            return outra.id !== linha.id && preferencias.painel.linhas[outra.id];
          });
          if (!restantes.length) {
            anunciar('Pelo menos uma linha precisa ficar visível no cartão.');
            sincronizarTudo();
            return;
          }
        }
        mudar('linha "' + linha.rotulo + '" do cartão', function (p) {
          p.painel.linhas[linha.id] = ligado;
        });
      });
    campos.appendChild(alvo.linha);
  });

  /* Unidades fixadas */
  const fixadas = montarLinha('Unidades fixadas no topo',
    'A unidade fixada abre sempre no começo da lista, mesmo que o ranking a colocaria mais abaixo. '
    + 'A ordem escolhida continua valendo para todas as outras.',
    { empilha: true });
  campos.appendChild(fixadas.linha);

  elCaixaUnidades = criar('div');
  elCaixaUnidades.style.minWidth = '0';
  campos.appendChild(elCaixaUnidades);

  secao.appendChild(campos);
  return secao;
}

/** Lista de unidades para fixar. Sem lista da API, estado vazio honesto. */
function desenharListaUnidades() {
  if (!elCaixaUnidades) return;

  /* Quem estava com o foco continua com ele depois do redesenho — clicar num
     alfinete não pode jogar o teclado de volta para o começo da página. */
  let focado = null;
  const ativo = document.activeElement;
  if (ativo && elCaixaUnidades.contains(ativo) && ativo.dataset && ativo.dataset.slug) {
    focado = ativo.dataset.slug;
  }
  elCaixaUnidades.textContent = '';

  if (!unidades.length) {
    const vazio = criar('div', 'vazio');
    vazio.appendChild(iconeSolto(erroUnidades ? ICONES.atencao : ICONES.semDado, 'vazio-icone'));
    if (erroUnidades) {
      vazio.appendChild(criar('p', 'vazio-titulo', 'Não consegui carregar as unidades'));
      vazio.appendChild(criar('p', 'vazio-texto', erroUnidades.amigavel
        + ' Sem a lista não dá para escolher quem fica fixado — e nenhuma unidade é inventada aqui.'));
    } else if (!recebeuUnidades) {
      vazio.appendChild(criar('p', 'vazio-titulo', 'Carregando as unidades…'));
      vazio.appendChild(criar('p', 'vazio-texto', 'A lista vem da ação visao_geral, a mesma do seletor do topo.'));
    } else {
      vazio.appendChild(criar('p', 'vazio-titulo', 'Nenhuma unidade cadastrada'));
      vazio.appendChild(criar('p', 'vazio-texto',
        'A ação visao_geral respondeu sem unidades. Confira o cadastro no banco antes de procurar '
        + 'erro na tela.'));
    }
    elCaixaUnidades.appendChild(vazio);
    return;
  }

  const atuais = preferencias ? preferencias.painel.fixadas : [];
  const contagem = criar('p', 'cf-exemplo-nota',
    formatarNumero(atuais.length) + ' de ' + formatarNumero(unidades.length)
    + ' ' + plural(unidades.length, 'unidade', 'unidades') + ' ' + plural(atuais.length, 'fixada', 'fixadas'));
  contagem.style.marginBottom = 'var(--esp-8)';
  elCaixaUnidades.appendChild(contagem);

  elListaUnidades = criar('ul', 'cf-unidades');
  unidades.forEach(function (u) {
    if (!u || !u.slug) return;
    const fixada = atuais.indexOf(u.slug) >= 0;
    const item = criar('li', 'cf-unidade');
    item.dataset.fixada = fixada ? 'sim' : 'nao';

    const nome = criar('span', 'cf-unidade-nome', u.nome || u.slug);
    nome.title = u.nome || u.slug;
    item.appendChild(nome);

    const botao = criar('button', 'btn-icone');
    botao.type = 'button';
    botao.innerHTML = ICONES.alfinete;
    botao.dataset.slug = u.slug;
    botao.setAttribute('aria-pressed', fixada ? 'true' : 'false');
    botao.setAttribute('aria-label', (fixada ? 'Desafixar ' : 'Fixar no topo ') + (u.nome || u.slug));
    botao.title = fixada ? 'Desafixar do topo' : 'Fixar no topo';
    botao.addEventListener('click', function () {
      if (!preferencias) return;
      mudar('unidades fixadas', function (p) {
        const indice = p.painel.fixadas.indexOf(u.slug);
        if (indice >= 0) p.painel.fixadas.splice(indice, 1);
        else p.painel.fixadas.push(u.slug);
      });
      anunciar((u.nome || u.slug) + (fixada ? ' desafixada.' : ' fixada no topo.'));
    });
    item.appendChild(botao);
    elListaUnidades.appendChild(item);
  });
  elCaixaUnidades.appendChild(elListaUnidades);

  if (focado) {
    const volta = elListaUnidades.querySelector('[data-slug="' + focado.replace(/"/g, '\\"') + '"]');
    if (volta) { try { volta.focus({ preventScroll: true }); } catch (e) { volta.focus(); } }
  }

  /* Fixação de unidade que não está mais na lista: dizer, não apagar calado. */
  const orfas = atuais.filter(function (slug) {
    for (let i = 0; i < unidades.length; i += 1) {
      if (unidades[i] && unidades[i].slug === slug) return false;
    }
    return true;
  });
  if (orfas.length) {
    const aviso = criar('p', 'cf-exemplo-nota',
      formatarNumero(orfas.length) + ' ' + plural(orfas.length, 'unidade fixada', 'unidades fixadas')
      + ' não ' + plural(orfas.length, 'aparece', 'aparecem') + ' na lista desta leitura '
      + '(' + orfas.join(', ') + '). A fixação continua gravada até você tirar.');
    aviso.style.marginTop = 'var(--esp-8)';
    elCaixaUnidades.appendChild(aviso);
  }
}

/* ═════════════════════════ 14. SEÇÃO: ALERTAS ═══════════════════════════ */

function montarAlertas() {
  const secao = criar('section', 'carta cf-secao');
  secao.id = 'cf-alertas';
  secao.tabIndex = -1;
  secao.setAttribute('aria-labelledby', 'cf-alertas-titulo');

  const cabeca = criar('div', 'cf-secao-cabeca');
  cabeca.appendChild(icone(ICONES.alertas, 'cf-secao-icone'));
  const texto = criar('div', 'cf-secao-texto');
  const titulo = criar('h2', null, 'Alertas');
  titulo.id = 'cf-alertas-titulo';
  texto.appendChild(titulo);
  texto.appendChild(criar('p', 'cf-secao-nota',
    'As réguas que pintam o painel: até onde o tempo de resposta é verde, quando vira vermelho, '
    + 'quanto tempo sem mensagem conta como unidade parada. Cada régua mostra, logo abaixo, o efeito '
    + 'que teria sobre as unidades desta leitura.'));
  cabeca.appendChild(texto);
  secao.appendChild(cabeca);

  const campos = criar('fieldset', 'cf-campos');
  campos.disabled = true;
  elCampos.push(campos);

  /* Faixa verde */
  const verde = montarLinha('Limite da faixa verde',
    'Tempo mediano de resposta até aqui: a unidade aparece em verde no painel.');
  montarDeslizante(verde, LIMITE_SLA_VERDE,
    function () { return preferencias ? preferencias.alertas.sla_verde_min : PADRAO.alertas.sla_verde_min; },
    function (valor) {
      if (!preferencias || preferencias.alertas.sla_verde_min === valor) return;
      mudar('limite da faixa verde', function (p) {
        p.alertas.sla_verde_min = valor;
        if (p.alertas.sla_amarelo_min <= valor) {
          p.alertas.sla_amarelo_min = Math.min(LIMITE_SLA_AMARELO.max, valor + 1);
        }
      });
    },
    function (n) { return formatarMinutos(n); },
    function (n) { return 'Até ' + formatarMinutos(n) + ' o painel mostra verde'; });
  campos.appendChild(verde.linha);

  /* Faixa amarela */
  const amarelo = montarLinha('Limite da faixa amarela',
    'Entre o limite verde e este, a unidade fica em amarelo. Acima daqui, vermelho.');
  montarDeslizante(amarelo,
    {
      min: LIMITE_SLA_AMARELO.min,
      max: LIMITE_SLA_AMARELO.max,
      minimoVivo: function () {
        const base = preferencias ? preferencias.alertas.sla_verde_min : PADRAO.alertas.sla_verde_min;
        return Math.max(LIMITE_SLA_AMARELO.min, base + 1);
      },
    },
    function () { return preferencias ? preferencias.alertas.sla_amarelo_min : PADRAO.alertas.sla_amarelo_min; },
    function (valor) {
      if (!preferencias) return;
      const minimo = preferencias.alertas.sla_verde_min + 1;
      const seguro = Math.max(minimo, valor);
      if (preferencias.alertas.sla_amarelo_min === seguro) return;
      mudar('limite da faixa amarela', function (p) { p.alertas.sla_amarelo_min = seguro; });
    },
    function (n) { return formatarMinutos(n); },
    function (n) { return 'Acima de ' + formatarMinutos(n) + ' o painel mostra vermelho'; });
  campos.appendChild(amarelo.linha);

  elExemploSla = criar('div');
  elExemploSla.style.minWidth = '0';
  campos.appendChild(elExemploSla);

  /* Silêncio */
  const silencio = montarLinha('Unidade parada depois de',
    'Horas sem nenhuma mensagem capturada. Passou disso, o painel trata a unidade como parada.');
  montarDeslizante(silencio, LIMITE_SILENCIO,
    function () { return preferencias ? preferencias.alertas.silencio_horas : PADRAO.alertas.silencio_horas; },
    function (valor) {
      if (!preferencias || preferencias.alertas.silencio_horas === valor) return;
      mudar('limite de silêncio', function (p) { p.alertas.silencio_horas = valor; });
    },
    function (n) { return n + ' h'; },
    function (n) { return n + ' ' + plural(n, 'hora', 'horas') + ' sem mensagem'; });
  campos.appendChild(silencio.linha);

  elExemploSilencio = criar('div');
  elExemploSilencio.style.minWidth = '0';
  campos.appendChild(elExemploSilencio);

  /* Situações que destacam */
  const cabecaSituacoes = montarLinha('Situações que destacam o cartão',
    'Cada situação ligada pinta a faixa do cartão e sobe a unidade na ordem de atenção.',
    { empilha: true });
  campos.appendChild(cabecaSituacoes.linha);

  SITUACOES.forEach(function (s) {
    const alvo = montarLinha(s.rotulo, s.nota);
    montarInterruptor(alvo,
      function () { return preferencias ? !!preferencias.alertas.destacar[s.id] : false; },
      function (ligado) {
        if (!preferencias) return;
        mudar('destaque "' + s.rotulo.toLowerCase() + '"', function (p) {
          p.alertas.destacar[s.id] = ligado;
        });
      });
    campos.appendChild(alvo.linha);
  });

  elExemploSituacoes = criar('div');
  elExemploSituacoes.style.minWidth = '0';
  campos.appendChild(elExemploSituacoes);

  secao.appendChild(campos);
  return secao;
}

/* ═════════════════════════ 15. SEÇÃO: SOBRE ═════════════════════════════ */

function montarSobre() {
  const secao = criar('section', 'carta cf-secao');
  secao.id = 'cf-sobre';
  secao.tabIndex = -1;
  secao.setAttribute('aria-labelledby', 'cf-sobre-titulo');

  const cabeca = criar('div', 'cf-secao-cabeca');
  cabeca.appendChild(icone(ICONES.sobre, 'cf-secao-icone'));
  const texto = criar('div', 'cf-secao-texto');
  const titulo = criar('h2', null, 'Sobre a plataforma');
  titulo.id = 'cf-sobre-titulo';
  texto.appendChild(titulo);
  texto.appendChild(criar('p', 'cf-secao-nota',
    'De onde vem cada número que o painel mostra. Medida e avaliação ficam separadas: o que foi '
    + 'contado sobre as mensagens não se mistura com o que é leitura da Daco.'));
  cabeca.appendChild(texto);
  secao.appendChild(cabeca);

  const dados = criar('dl', 'cf-dados');
  linhaDeDado(dados, 'Versão da interface', VERSAO);
  linhaDeDado(dados, 'Rede atendida', 'Apaixonados Por Quatro Patas');
  const endereco = linhaDeDado(dados, 'Endereço da API', BASE);
  endereco.classList.add('cf-mono');
  endereco.style.fontSize = 'var(--txt-pequeno)';
  secao.appendChild(dados);

  const listaOrigens = criar('div', 'cf-origens');
  listaOrigens.style.marginTop = 'var(--esp-16)';
  ORIGENS.forEach(function (origem) {
    const linha = criar('div', 'cf-origem');
    linha.appendChild(criar('p', 'cf-origem-nome', origem.indicador));
    const selo = criar('span', 'selo sem-ponto cf-origem-selo', ROTULO_FONTE[origem.fonte] || origem.fonte);
    if (origem.fonte === 'daco') selo.classList.add('selo-atencao');
    else if (origem.fonte === 'congelada') selo.classList.add('selo-neutro');
    linha.appendChild(selo);
    linha.appendChild(criar('p', 'cf-origem-texto', origem.texto));
    listaOrigens.appendChild(linha);
  });
  secao.appendChild(listaOrigens);

  const assinatura = criar('div', 'cf-assinatura');
  const bolinha = criar('i');
  bolinha.setAttribute('aria-hidden', 'true');
  assinatura.appendChild(bolinha);
  assinatura.appendChild(criar('span', null,
    'Software desenvolvido pela Daco Vet em parceria com Apaixonados Por Quatro Patas.'));
  secao.appendChild(assinatura);

  return secao;
}

/* ═════════════════════════ 16. ÍNDICE E MEDIDA ══════════════════════════ */

const SECOES = [
  { id: 'cf-conta', rotulo: 'Conta', icone: ICONES.conta },
  { id: 'cf-aparencia-secao', rotulo: 'Aparência', icone: ICONES.aparencia },
  { id: 'cf-painel', rotulo: 'Painel', icone: ICONES.painel },
  { id: 'cf-alertas', rotulo: 'Alertas', icone: ICONES.alertas },
  { id: 'cf-sobre', rotulo: 'Sobre', icone: ICONES.sobre },
];

function montarIndice() {
  const caixa = criar('nav', 'cf-indice');
  caixa.setAttribute('aria-label', 'Seções das preferências');
  caixa.appendChild(criar('p', 'cf-indice-titulo legenda', 'Seções'));

  elIndice = SECOES.map(function (secao) {
    const botao = criar('button', 'cf-indice-item');
    botao.type = 'button';
    botao.dataset.alvo = secao.id;
    botao.appendChild(icone(secao.icone));
    botao.appendChild(criar('span', null, secao.rotulo));
    botao.addEventListener('click', function () {
      const alvo = document.getElementById(secao.id);
      if (!alvo) return;
      try {
        alvo.scrollIntoView({ behavior: movimentoReduzidoAgora() ? 'auto' : 'smooth', block: 'start' });
      } catch (e) {
        alvo.scrollIntoView();
      }
      try { alvo.focus({ preventScroll: true }); } catch (e) { /* navegador antigo */ }
    });
    caixa.appendChild(botao);
    return botao;
  });

  return caixa;
}

function movimentoReduzidoAgora() {
  return aparencia.movimento === 'reduzido' || movimentoDoSistema();
}

function marcarIndice(id) {
  elIndice.forEach(function (botao) {
    if (botao.dataset.alvo === id) botao.setAttribute('aria-current', 'true');
    else botao.removeAttribute('aria-current');
  });
}

/** O índice para logo abaixo do cabeçalho real da casca — medido, não chutado. */
function medirTopo() {
  if (!raizTela || !raizTela.isConnected) return;
  let alto = 0;
  const cabecalho = document.querySelector('.ca-cabecalho');
  if (cabecalho) {
    const caixa = cabecalho.getBoundingClientRect();
    alto = caixa.height || 0;
  }
  raizTela.style.setProperty('--cf-topo', (Math.round(alto) + 12) + 'px');
}

function aoRedimensionar() {
  if (quadroMedida) cancelAnimationFrame(quadroMedida);
  quadroMedida = requestAnimationFrame(function () {
    quadroMedida = 0;
    medirTopo();
  });
}

/* ═════════════════════════ 17. CARGA DO PERFIL ══════════════════════════ */

function liberarCampos(liberar) {
  elCampos.forEach(function (campo) { campo.disabled = !liberar; });
}

function mostrarAvisoDeCarga() {
  if (!elErro) return;
  if (erroCarga) {
    elErro.textContent = '';
    elErro.hidden = false;
    elErro.className = 'aviso aviso-erro cf-aviso cf-erro';
    elErro.setAttribute('role', 'alert');
    elErro.appendChild(icone(ICONES.atencao));
    const corpo = criar('div');
    corpo.style.flex = '1 1 auto';
    corpo.style.minWidth = '0';
    corpo.appendChild(criar('span', 'aviso-titulo', 'Não consegui ler as preferências gravadas'));
    corpo.appendChild(criar('span', 'aviso-texto', erroCarga.amigavel
      + ' Os controles do Painel e dos Alertas ficam desligados: mexer neles agora gravaria por cima '
      + 'do que está no servidor sem saber o que está lá.'));
    elErro.appendChild(corpo);
    const botao = criar('button', 'btn', 'Tentar de novo');
    botao.type = 'button';
    botao.addEventListener('click', function () { carregarPerfil(true); });
    elErro.appendChild(botao);
    return;
  }

  if (perfilVazio) {
    elErro.textContent = '';
    elErro.hidden = false;
    elErro.className = 'aviso cf-aviso cf-erro';
    elErro.setAttribute('role', 'status');
    elErro.appendChild(icone(ICONES.sobre));
    const corpo = criar('div');
    corpo.style.flex = '1 1 auto';
    corpo.style.minWidth = '0';
    corpo.appendChild(criar('span', 'aviso-titulo', 'Seu perfil ainda não tem preferência gravada'));
    corpo.appendChild(criar('span', 'aviso-texto',
      'Os controles abaixo mostram o padrão da plataforma. A primeira mudança que você fizer já '
      + 'grava o perfil inteiro.'));
    elErro.appendChild(corpo);
    return;
  }

  limparErroDeGravacao();
}

async function carregarPerfil(forcar) {
  if (elErro && forcar) limparErroDeGravacao();
  carregou = false;
  erroCarga = null;
  perfilVazio = false;
  liberarCampos(false);
  mostrarSelo('gravando', 'Lendo o perfil');

  try {
    const dados = await api.configLer(forcar ? { forcar: true } : undefined);
    if (!raizTela || !raizTela.isConnected) return;
    const cru = dados && typeof dados === 'object' && dados.preferencias ? dados.preferencias : dados;
    perfilVazio = pareceVazio(cru);
    preferencias = normalizarPreferencias(cru);
    carregou = true;
    liberarCampos(true);
    mostrarSelo(null, '');
    sincronizarTudo();
    mostrarAvisoDeCarga();
    anunciar('Preferências carregadas.');
  } catch (erro) {
    if (!raizTela || !raizTela.isConnected) return;
    if (ehErroDeSessao(erro)) return;      /* a casca leva para o login */
    erroCarga = erro;
    preferencias = clonar(PADRAO);
    liberarCampos(false);
    mostrarSelo(null, '');
    sincronizarTudo();
    mostrarAvisoDeCarga();
  }
}

/* ═════════════════════════ 18. LISTA DE UNIDADES ════════════════════════ */

function receberRede(dados, erro) {
  if (!raizTela || !raizTela.isConnected) return;
  if (erro) {
    if (ehErroDeSessao(erro)) return;
    erroUnidades = erro;
    recebeuUnidades = true;
    desenharExemplos();
    return;
  }
  erroUnidades = null;
  recebeuUnidades = true;
  unidades = (dados && Array.isArray(dados.unidades))
    ? dados.unidades.filter(function (u) { return u && u.slug; })
    : [];
  desenharExemplos();
}

/* ═════════════════════════ 19. INTERFACE DA TELA ════════════════════════ */

export const tela = {
  id: 'config',
  titulo: 'Preferências',
  icone: ICONE_TELA,

  async montar(raiz, ctx) {
    contexto = ctx;
    aparencia = lerAparencia();
    aplicarAparencia(aparencia);

    if (!document.getElementById('cf-estilo')) {
      noEstilo = document.createElement('style');
      noEstilo.id = 'cf-estilo';
      noEstilo.textContent = ESTILO;
      document.head.appendChild(noEstilo);
    } else {
      noEstilo = document.getElementById('cf-estilo');
    }

    sincronizadores = [];
    elCampos = [];
    preferencias = clonar(PADRAO);

    raizTela = criar('div', 'cf-raiz');

    elViva = criar('p', 'sr-apenas');
    elViva.setAttribute('role', 'status');
    elViva.setAttribute('aria-live', 'polite');
    raizTela.appendChild(elViva);

    raizTela.appendChild(montarIndice());

    const coluna = criar('div', 'cf-coluna');

    const topo = criar('div', 'cf-topo');
    const textoTopo = criar('div');
    textoTopo.style.minWidth = '0';
    textoTopo.appendChild(criar('h1', 'cf-titulo', 'Preferências'));
    textoTopo.appendChild(criar('p', 'cf-subtitulo',
      'Painel e Alertas ficam gravados no seu perfil, no servidor. Aparência fica só neste '
      + 'navegador. Toda mudança vale na hora.'));
    topo.appendChild(textoTopo);

    elSalvo = criar('span', 'cf-salvo');
    elSalvo.setAttribute('role', 'status');
    topo.appendChild(elSalvo);
    coluna.appendChild(topo);

    elErro = criar('div');
    elErro.hidden = true;
    coluna.appendChild(elErro);

    coluna.appendChild(montarConta());
    coluna.appendChild(montarAparencia());
    coluna.appendChild(montarPainel());
    coluna.appendChild(montarAlertas());
    coluna.appendChild(montarSobre());

    raizTela.appendChild(coluna);
    raiz.appendChild(raizTela);

    /* A lista de unidades que a casca já tem serve de partida; a assinatura
       mantém os exemplos frescos sem uma chamada a mais (o cache é o mesmo). */
    if (ctx && Array.isArray(ctx.unidades) && ctx.unidades.length) {
      unidades = ctx.unidades.filter(function (u) { return u && u.slug; });
      recebeuUnidades = true;
    }
    desenharExemplos();
    medirTopo();

    /* O sistema pode mudar a preferência de movimento com o painel aberto. */
    try {
      consultaMovimento = window.matchMedia('(prefers-reduced-motion: reduce)');
      aoMudarMovimento = function () { sincronizarTudo(); };
      if (typeof consultaMovimento.addEventListener === 'function') {
        consultaMovimento.addEventListener('change', aoMudarMovimento);
      } else if (typeof consultaMovimento.addListener === 'function') {
        consultaMovimento.addListener(aoMudarMovimento);
      }
    } catch (e) {
      consultaMovimento = null;
      aoMudarMovimento = null;
    }

    /* Índice acompanha a rolagem. Sem IntersectionObserver, o índice continua
       navegando — só não marca sozinho. */
    if (typeof IntersectionObserver === 'function') {
      observador = new IntersectionObserver(function (entradas) {
        let melhor = null;
        entradas.forEach(function (entrada) {
          if (!entrada.isIntersecting) return;
          if (!melhor || entrada.intersectionRatio > melhor.intersectionRatio) melhor = entrada;
        });
        if (melhor && melhor.target && melhor.target.id) marcarIndice(melhor.target.id);
      }, { rootMargin: '-20% 0px -60% 0px', threshold: [0, .25, .5] });
      SECOES.forEach(function (secao) {
        const no = document.getElementById(secao.id);
        if (no) observador.observe(no);
      });
    }
    marcarIndice(SECOES[0].id);

    window.addEventListener('resize', aoRedimensionar);
    window.addEventListener('orientationchange', aoRedimensionar);

    pararAssinatura = assinarAtualizacao('visao_geral', null, INTERVALO_REDE_MS, receberRede);

    await carregarPerfil(false);
  },

  desmontar() {
    /* Mudança ainda no ar: grava antes de sair, para nada se perder no caminho. */
    if (relogioGravacao) {
      clearTimeout(relogioGravacao);
      relogioGravacao = 0;
      if (preferencias && antesDaJanela) {
        api.configGravar(clonar(preferencias)).catch(function () {
          /* Sem tela para avisar: o erro fica no console e o valor volta na
             próxima leitura do perfil. */
          console.error('[config] a última mudança não foi gravada antes de sair da tela');
        });
      }
    }
    clearTimeout(relogioSalvo);
    relogioSalvo = 0;

    if (pararAssinatura) { pararAssinatura(); pararAssinatura = null; }
    if (observador) { observador.disconnect(); observador = null; }
    if (quadroMedida) { cancelAnimationFrame(quadroMedida); quadroMedida = 0; }

    if (consultaMovimento && aoMudarMovimento) {
      if (typeof consultaMovimento.removeEventListener === 'function') {
        consultaMovimento.removeEventListener('change', aoMudarMovimento);
      } else if (typeof consultaMovimento.removeListener === 'function') {
        consultaMovimento.removeListener(aoMudarMovimento);
      }
    }
    consultaMovimento = null;
    aoMudarMovimento = null;

    window.removeEventListener('resize', aoRedimensionar);
    window.removeEventListener('orientationchange', aoRedimensionar);

    if (noEstilo && noEstilo.parentNode) noEstilo.parentNode.removeChild(noEstilo);

    sincronizadores = [];
    elCampos = [];
    elIndice = [];
    antesDaJanela = null;
    descricaoPendente = '';
    ultimaTentativa = null;
    gravando = false;
    carregou = false;
    erroCarga = null;
    perfilVazio = false;

    contexto = null;
    raizTela = null;
    noEstilo = null;
    elViva = null;
    elSalvo = null;
    elErro = null;
    elExemploSla = null;
    elExemploSilencio = null;
    elExemploSituacoes = null;
    elListaUnidades = null;
    elCaixaUnidades = null;
    elAvisoMovimento = null;
    /* A folha `cf-aparencia` e os atributos do <html> ficam de propósito: a
       aparência escolhida vale na aplicação inteira, não só nesta tela. */
  },
};
