/**
 * Painel de Controle — a tela inicial, fiel ao mockup aprovado.
 *
 * Foto da recepção ocupando a tela inteira com o degradê vermelho por cima, o
 * logo da rede grande no alto, o título "Painel de Controle" em ouro e branco,
 * os botões de vidro à esquerda e os cartões das unidades à direita, com a
 * medalha saindo do canto de quem está no pódio.
 *
 * Nesta tela a casca some (trilho e cabeçalho): os botões da esquerda são a
 * navegação, como no desenho. Nas outras telas a casca volta.
 *
 * Duas fontes de dado, mescladas por slug:
 *   visao_geral (20s)  — números das últimas 24h e a notificação mais recente
 *   ranking     (60s)  — posição e pontos da semana, que dão a medalha e o nível
 */

import { api, assinarAtualizacao, formatarMinutos, formatarNumero, formatarTelefone,
         formatarQuando, TRACINHO } from './dados.js';

const IMG = 'app/img/';
const RODAPE = 'Software desenvolvido pela Daco Vet em parceria com Apaixonados Por Quatro Patas.';
const INTERVALO_GERAL_MS = 20000;
const INTERVALO_RANKING_MS = 60000;

/* Leitura de cor do tempo mediano, como no mockup: até 5 min verde, acima
   vermelho. Não é meta do treinamento — é a régua desta tela. */
const SLA_VERDE_MIN = 5;

let estilosInjetados = false;

/* ═══════════════════════════ estilos ═══════════════════════════ */
const CSS = `
/* A casca sai de cena nesta tela: o desenho não tem trilho nem cabeçalho.
   Só a variável do trilho é zerada — abaixo de 1180px a casca já usa uma
   coluna só, e forçar duas colunas aqui deixava o conteúdo com largura zero. */
body[data-tela="painel"] .ca-raiz[data-modo="painel"] { --ca-trilho: 0px; }
body[data-tela="painel"] .ca-trilho,
body[data-tela="painel"] .ca-cabecalho { display: none !important; }
body[data-tela="painel"] .ca-conteudo { padding: 0; max-width: none; }
body[data-tela="painel"] { background: #12081C; }

.vg-cena {
  position: relative;
  min-height: 100dvh;
  overflow: hidden;
  color: #fff;
  font-family: var(--sans, "Manrope", system-ui, sans-serif);
  isolation: isolate;
}

/* ---- foto e degradê ---- */
.vg-fundo {
  position: fixed; inset: 0; z-index: -2;
  background-color: #1B0D2A;
  background-size: cover;
  background-position: center 30%;
  filter: saturate(.85);
}
.vg-veu {
  position: fixed; inset: 0; z-index: -1;
  background:
    linear-gradient(180deg, rgba(20,8,36,.55) 0%, rgba(20,8,36,0) 30%, rgba(40,6,20,.55) 100%),
    linear-gradient(100deg, rgba(24,10,44,.94) 0%, rgba(52,12,48,.82) 38%, rgba(128,18,34,.80) 72%, rgba(150,22,30,.86) 100%);
}

/* ---- topo ---- */
.vg-topo {
  position: absolute; inset: 0 0 auto 0;
  height: 0; z-index: 5;
  pointer-events: none;
}
.vg-usuario {
  position: absolute; right: 26px; top: 18px;
  display: flex; align-items: center; gap: 10px;
  pointer-events: auto;
}
.vg-usuario-nome { font-weight: 700; font-size: 14px; color: #fff; }
.vg-usuario-papel { font-size: 11px; color: rgba(255,255,255,.62); letter-spacing: .06em; text-transform: uppercase; }
.vg-sair {
  display: inline-flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; border-radius: 12px;
  border: 1px solid rgba(255,255,255,.14);
  background: rgba(255,255,255,.08);
  color: #fff; cursor: pointer;
  transition: background 180ms cubic-bezier(.22,.61,.36,1), transform 180ms cubic-bezier(.22,.61,.36,1);
}
.vg-sair:hover { background: rgba(255,255,255,.16); }
.vg-sair:active { transform: scale(.96); }
.vg-sair:focus-visible { outline: 2px solid #9B9BFF; outline-offset: 2px; }
.vg-sair svg { width: 20px; height: 20px; }

/* ---- grade principal ---- */
.vg-grade {
  position: relative; z-index: 1;
  display: grid;
  grid-template-columns: minmax(300px, 400px) minmax(0, 1fr);
  gap: clamp(28px, 4vw, 72px);
  padding: clamp(56px, 8vh, 84px) clamp(24px, 4vw, 64px) 72px;
  min-height: 100dvh;
}

/* ---- coluna esquerda ---- */
.vg-esq { display: flex; flex-direction: column; gap: 22px; }

.vg-titulo {
  margin: 0;
  font-family: var(--disp, "Sora", system-ui, sans-serif);
  font-weight: 800;
  font-size: clamp(44px, 5.4vw, 78px);
  line-height: .96;
  letter-spacing: -.035em;
  color: #fff;
}
.vg-titulo .vg-ouro { color: #FFC93C; }

.vg-selecao {
  display: flex; align-items: center; gap: 12px;
  min-height: 56px;
  font-family: var(--disp, "Sora", system-ui, sans-serif);
  font-weight: 700; font-size: 20px; line-height: 1.15; color: #fff;
}
.vg-selecao-icone {
  width: 44px; height: 44px; flex: none;
  display: grid; place-items: center;
}
.vg-selecao-icone svg { width: 40px; height: 40px; }
.vg-selecao-avatar {
  width: 50px; height: 50px; flex: none; border-radius: 50%;
  background: #7DBF3A center/118% no-repeat;
  box-shadow: 0 6px 16px rgba(0,0,0,.35);
}
.vg-selecao-nome { color: #FFC93C; text-transform: uppercase; letter-spacing: .01em; }
.vg-selecao small { display: block; font-size: 17px; font-weight: 700; color: #fff; }

.vg-botoes { display: flex; flex-direction: column; gap: 16px; margin-top: 6px; }
.vg-botao {
  position: relative;
  display: grid; grid-template-columns: minmax(0, 1fr) 52px; align-items: center; gap: 16px;
  width: 100%; text-align: left;
  padding: 22px 22px 22px 26px;
  border-radius: 24px;
  border: 1px solid rgba(255,255,255,.14);
  background: linear-gradient(180deg, rgba(255,255,255,.085) 0%, rgba(255,255,255,.045) 100%);
  box-shadow: 0 16px 40px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.10);
  -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
  color: #fff; cursor: pointer; font-family: inherit;
  transition: transform 180ms cubic-bezier(.22,.61,.36,1), border-color 180ms, background 180ms;
}
.vg-botao:hover { transform: translateY(-2px); border-color: rgba(255,255,255,.26); }
.vg-botao:active { transform: translateY(0) scale(.995); }
.vg-botao:focus-visible { outline: 2px solid #9B9BFF; outline-offset: 3px; }
.vg-botao[disabled] { cursor: not-allowed; opacity: .55; transform: none; }
.vg-botao-titulo {
  font-family: var(--disp, "Sora", system-ui, sans-serif);
  font-size: 25px; line-height: 1.08; letter-spacing: -.02em; font-weight: 500;
}
.vg-botao-titulo b { display: block; font-weight: 800; }
.vg-botao-sub { margin-top: 8px; font-size: 15px; line-height: 1.35; color: rgba(255,255,255,.62); }
.vg-botao-seta {
  width: 52px; height: 52px; border-radius: 14px;
  background: #5B5BD6;
  box-shadow: 0 10px 22px rgba(91,91,214,.45);
  display: grid; place-items: center;
  transition: transform 180ms cubic-bezier(.22,.61,.36,1);
}
.vg-botao:hover .vg-botao-seta { transform: translate(-2px, 2px); }
.vg-botao-seta svg { width: 22px; height: 22px; }
.vg-botao.vg-menor { padding: 14px 14px 14px 18px; border-radius: 18px; grid-template-columns: minmax(0,1fr) 40px; gap: 10px; }
.vg-botao.vg-menor .vg-botao-titulo { font-size: 15px; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vg-botao.vg-menor .vg-botao-titulo b { display: inline; }
.vg-botao.vg-menor .vg-botao-seta { width: 40px; height: 40px; border-radius: 11px; }
.vg-botao.vg-menor .vg-botao-seta svg { width: 18px; height: 18px; }
.vg-botoes-menores { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

.vg-rede {
  margin-top: 8px;
  display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px 18px;
  padding: 16px 20px;
  border-radius: 18px;
  border: 1px solid rgba(255,255,255,.10);
  background: rgba(10,8,24,.42);
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
}
.vg-rede-titulo { grid-column: 1 / -1; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: rgba(255,255,255,.62); font-weight: 700; }
.vg-rede-item b { display: block; font-family: var(--disp, "Sora", system-ui, sans-serif); font-size: 24px; font-weight: 800; letter-spacing: -.02em; color: #fff; }
.vg-rede-item span { font-size: 12px; color: rgba(255,255,255,.62); line-height: 1.25; }

/* ---- cartões ---- */
.vg-dir { min-width: 0; display: flex; flex-direction: column; gap: 14px; padding-top: 24px; }
.vg-ordem {
  font-size: 13px; color: rgba(255,255,255,.72);
  display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: baseline;
  padding: 0 6px;
}
.vg-ordem b { color: #fff; }
.vg-ordem .vg-semana { color: #FFC93C; font-weight: 700; }

.vg-rolagem {
  position: relative;
  max-height: calc(100dvh - 190px);
  overflow-y: auto; overflow-x: hidden;
  padding: 34px 22px 24px 6px;
  scrollbar-width: thin;
  scrollbar-color: #6B6BE6 rgba(255,255,255,.10);
}
.vg-rolagem::-webkit-scrollbar { width: 12px; }
.vg-rolagem::-webkit-scrollbar-track { background: rgba(255,255,255,.10); border-radius: 999px; }
.vg-rolagem::-webkit-scrollbar-thumb { background: #6B6BE6; border-radius: 999px; }

.vg-cartoes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 30px 28px;
  align-items: start;
}

.vg-cartao {
  position: relative;
  display: block; width: 100%; text-align: left;
  padding: 24px 26px 26px;
  border-radius: 20px;
  border: 1px solid rgba(255,255,255,.10);
  background: linear-gradient(180deg, #0D1224 0%, #090D1C 100%);
  box-shadow: 0 22px 50px rgba(0,0,0,.42);
  color: #fff; cursor: pointer; font-family: inherit;
  transition: transform 200ms cubic-bezier(.22,.61,.36,1), background 260ms, border-color 260ms, box-shadow 260ms;
}
.vg-cartao:hover { transform: translateY(-3px); border-color: rgba(255,255,255,.22); }
.vg-cartao:focus-visible { outline: 2px solid #9B9BFF; outline-offset: 3px; }
.vg-cartao[aria-pressed="true"] {
  background: linear-gradient(180deg, #8E0F22 0%, #4B0A14 100%);
  border-color: rgba(255,120,120,.35);
  box-shadow: 0 22px 50px rgba(120,10,30,.5);
}
.vg-cartao.vg-apagado { opacity: .62; }

.vg-cabeca { display: flex; align-items: flex-start; gap: 12px; min-height: 60px; padding-right: 165px; }
.vg-avatar {
  width: 44px; height: 44px; flex: none; border-radius: 50%;
  background: #7DBF3A center/118% no-repeat;
  box-shadow: 0 4px 12px rgba(0,0,0,.35);
}
.vg-nome {
  font-family: var(--disp, "Sora", system-ui, sans-serif);
  font-size: 23px; font-weight: 800; letter-spacing: -.02em; line-height: 1.05; color: #fff;
  overflow-wrap: anywhere;
}
.vg-status { margin-top: 4px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; font-weight: 700; color: rgba(255,255,255,.85); display: flex; align-items: center; gap: 6px; }
.vg-status-ponto { width: 9px; height: 9px; border-radius: 50%; background: #35D07F; box-shadow: 0 0 0 3px rgba(53,208,127,.22); }
.vg-status[data-tom="parada"] .vg-status-ponto { background: #FFC93C; box-shadow: 0 0 0 3px rgba(255,201,60,.22); }
.vg-status[data-tom="fora"] .vg-status-ponto { background: #8A93A8; box-shadow: none; }

.vg-top {
  position: absolute; right: 26px; top: 22px;
  display: flex; align-items: center; gap: 14px;
}
.vg-top-texto {
  font-family: var(--disp, "Sora", system-ui, sans-serif);
  font-weight: 800; font-size: 30px; letter-spacing: -.05em; line-height: 1;
  color: #fff; text-transform: uppercase;
  transform: scaleX(.82); transform-origin: right center;
}
.vg-medalha { width: 84px; height: 112px; margin-top: -48px; margin-right: -12px; flex: none; filter: drop-shadow(0 10px 18px rgba(0,0,0,.45)); }
.vg-posicao { font-family: var(--disp, "Sora", system-ui, sans-serif); font-weight: 800; font-size: 20px; color: rgba(255,255,255,.55); letter-spacing: -.02em; }

.vg-zap { margin-top: 18px; font-size: 19px; color: #fff; }
.vg-zap b { font-weight: 500; }
.vg-sep { height: 1px; background: rgba(255,255,255,.14); margin: 16px 0; }
.vg-cartao[aria-pressed="true"] .vg-sep { background: rgba(255,255,255,.22); }

.vg-bloco-titulo { font-weight: 800; font-size: 17px; margin-bottom: 8px; }
.vg-linha { font-size: 17px; line-height: 1.55; color: #fff; }
.vg-linha b { font-weight: 800; }
.vg-linha .vg-val-ok { color: #35E07F; }
.vg-linha .vg-val-ruim { color: #FF5A5A; }
.vg-linha .vg-val-meio { color: #C9F04A; }
.vg-linha .vg-val-nulo { color: rgba(255,255,255,.55); font-weight: 600; }

.vg-notif { font-size: 17px; line-height: 1.55; }
.vg-notif-titulo { font-weight: 800; margin-bottom: 4px; }
.vg-notif-vazia { color: rgba(255,255,255,.62); font-size: 15px; line-height: 1.4; }

.vg-vazio, .vg-erro {
  padding: 36px 28px; border-radius: 20px; text-align: center;
  border: 1px solid rgba(255,255,255,.12); background: rgba(10,8,24,.55);
  color: rgba(255,255,255,.82); font-size: 16px; line-height: 1.5;
}
.vg-erro { border-color: rgba(255,90,90,.4); }
.vg-erro button { margin-top: 14px; }

.vg-rodape {
  position: relative; z-index: 2; margin: -48px 0 0;
  text-align: center; font-size: 12px; color: rgba(255,255,255,.62);
  padding: 0 16px 16px;
}

/* ---- movimento ---- */
@keyframes vg-sobe { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes vg-pisca-indigo { 0% { box-shadow: 0 0 0 0 rgba(91,91,214,.75); } 100% { box-shadow: 0 0 0 18px rgba(91,91,214,0); } }
@media (prefers-reduced-motion: no-preference) {
  .vg-esq > * { animation: vg-sobe 420ms cubic-bezier(.22,.61,.36,1) both; }
  .vg-esq > *:nth-child(2) { animation-delay: 60ms; }
  .vg-esq > *:nth-child(3) { animation-delay: 120ms; }
  .vg-esq > *:nth-child(4) { animation-delay: 180ms; }
  .vg-cartao { animation: vg-sobe 460ms cubic-bezier(.22,.61,.36,1) both; }
  .vg-cartoes.vg-pronto .vg-cartao { animation: none; }
  .vg-cartoes .vg-cartao.vg-nova-notif { animation: vg-pisca-indigo 900ms ease-out 1; }
}

/* ---- celular ---- */
@media (max-width: 1180px) {
  .vg-grade { grid-template-columns: 1fr; gap: 26px; padding-top: 84px; }
  .vg-dir { padding-top: 0; }
  .vg-cartoes { grid-template-columns: repeat(auto-fill, minmax(min(100%, 380px), 1fr)); }
  .vg-usuario { right: auto; left: 18px; top: 14px; }
  .vg-rolagem { max-height: none; overflow: visible; padding: 30px 0 0; }
  .vg-cabeca { padding-right: 120px; }
}
@media (max-width: 720px) {
  .vg-grade { padding-left: 16px; padding-right: 16px; padding-bottom: 88px; }
  .vg-titulo { font-size: 48px; }
  .vg-botoes-menores { grid-template-columns: 1fr; }
  .vg-cartao { padding: 20px 18px 22px; }
  .vg-nome { font-size: 21px; }
  .vg-top-texto { font-size: 24px; }
  .vg-medalha { width: 66px; height: 88px; margin-top: -38px; }
  .vg-linha, .vg-notif, .vg-zap { font-size: 15px; }
  .vg-rede { grid-template-columns: 1fr 1fr; }
}
`;

function injetarEstilos() {
  if (estilosInjetados) return;
  const el = document.createElement('style');
  el.id = 'vg-estilos';
  el.textContent = CSS;
  document.head.appendChild(el);
  estilosInjetados = true;
}

/* ═══════════════════════════ ajudantes ═══════════════════════════ */
function criar(tag, classe, texto) {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (texto !== undefined && texto !== null) el.textContent = texto;
  return el;
}

/** Nome curto para o cartão: a rede inteira é Apaixonados, o prefixo só ocupa espaço. */
function nomeCurto(nome) {
  return String(nome || '').replace(/^apaixonados\s+(por\s+quatro\s+patas\s+)?/i, '').trim() || nome || '';
}

/** Fundo com a foto só depois que ela carregar; sem ela, o degradê segura sozinho. */
function fundoOpcional(el, arquivo) {
  const teste = new Image();
  teste.addEventListener('load', function () { el.style.backgroundImage = 'url("' + IMG + arquivo + '")'; });
  teste.src = IMG + arquivo;
}

/** Medalha do pódio em SVG, no estilo das artes da rede: disco com o número e as fitas vermelhas. */
function medalhaSvg(posicao) {
  const cores = {
    1: { fora: '#FFC21A', dentro: '#F5A21B', numero: '#FFF3B0' },
    2: { fora: '#CFD1EE', dentro: '#A9ABD9', numero: '#F4F4FF' },
    3: { fora: '#F6A868', dentro: '#F07A3A', numero: '#FFE0C2' },
  }[posicao];
  if (!cores) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 84 112');
  svg.setAttribute('class', 'vg-medalha');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML =
    '<path d="M22 54 L8 96 L26 90 L36 108 L42 84 Z" fill="#D9341A"/>' +
    '<path d="M62 54 L76 96 L58 90 L48 108 L42 84 Z" fill="#D9341A"/>' +
    '<path d="M28 60 L18 90 L30 86 L38 102 L42 84 Z" fill="#FF4A20"/>' +
    '<path d="M56 60 L66 90 L54 86 L46 102 L42 84 Z" fill="#FF4A20"/>' +
    '<circle cx="42" cy="42" r="36" fill="' + cores.fora + '"/>' +
    '<circle cx="42" cy="42" r="28" fill="' + cores.dentro + '"/>' +
    '<path d="M20 30 l2 -5 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 z" fill="' + cores.numero + '" opacity=".9"/>' +
    '<path d="M60 52 l1.5 -4 l1.5 4 l4 1.5 l-4 1.5 l-1.5 4 l-1.5 -4 l-4 -1.5 z" fill="' + cores.numero + '" opacity=".9"/>' +
    '<text x="42" y="55" text-anchor="middle" font-family="Sora, Manrope, system-ui, sans-serif" font-weight="800" font-size="36" fill="' + cores.numero + '">' + posicao + '</text>';
  return svg;
}

const SETA = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 7L7 17"/><path d="M15 17H7V9"/></svg>';
const ALERTA = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 5 L45 41 H3 Z" fill="#fff"/><rect x="22" y="17" width="4" height="13" rx="2" fill="#2A0A16"/><circle cx="24" cy="35.5" r="2.4" fill="#2A0A16"/></svg>';
const SAIR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>';

function valor(texto, tom) {
  const b = criar('b', tom ? 'vg-val-' + tom : null, texto);
  return b;
}

function linha(emoji, rotulo, valorEl, titulo) {
  const el = criar('div', 'vg-linha');
  el.appendChild(document.createTextNode(emoji + ' ' + rotulo + ': '));
  el.appendChild(valorEl);
  if (titulo) el.title = titulo;
  return el;
}

/* ═══════════════════════════ a tela ═══════════════════════════ */
export const tela = {
  id: 'visao-geral',
  titulo: 'Painel de Controle',
  icone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/></svg>',

  async montar(raiz, ctx) {
    injetarEstilos();
    this._ctx = ctx;
    this._vivo = true;
    this._cancelar = [];
    this._geral = null;
    this._ranking = null;
    this._notifVista = {};
    document.body.dataset.tela = 'painel';

    const cena = criar('div', 'vg-cena');
    const fundo = criar('div', 'vg-fundo');
    fundoOpcional(fundo, 'recepcao-larga.webp');
    cena.appendChild(fundo);
    cena.appendChild(criar('div', 'vg-veu'));

    /* ---------- topo: logo e usuário ---------- */
    // Sem o logo grande no alto: ele pediu para tirar. Fica só o usuário à direita.
    const topo = criar('div', 'vg-topo');

    const usuario = criar('div', 'vg-usuario');
    const uTexto = criar('div');
    uTexto.appendChild(criar('div', 'vg-usuario-nome', (ctx.usuario && ctx.usuario.nome) || 'Usuário'));
    uTexto.appendChild(criar('div', 'vg-usuario-papel', (ctx.usuario && ctx.usuario.papel === 'daco') ? 'Daco Vet' : 'Rede'));
    usuario.appendChild(uTexto);
    const sair = criar('button', 'vg-sair');
    sair.type = 'button';
    sair.setAttribute('aria-label', 'Sair');
    sair.title = 'Sair';
    sair.innerHTML = SAIR;
    sair.addEventListener('click', function () {
      // a casca cuida da saída; aqui só pedimos
      api.sair().finally(function () { location.hash = '#/'; location.reload(); });
    });
    usuario.appendChild(sair);
    topo.appendChild(usuario);
    cena.appendChild(topo);

    /* ---------- grade ---------- */
    const grade = criar('div', 'vg-grade');
    const esq = criar('div', 'vg-esq');
    const dir = criar('div', 'vg-dir');

    const titulo = criar('h1', 'vg-titulo');
    titulo.appendChild(criar('span', 'vg-ouro', 'Painel'));
    titulo.appendChild(document.createTextNode(' de'));
    titulo.appendChild(criar('br'));
    titulo.appendChild(document.createTextNode('Controle'));
    esq.appendChild(titulo);

    const selecao = criar('div', 'vg-selecao');
    esq.appendChild(selecao);
    this._elSelecao = selecao;

    const botoes = criar('div', 'vg-botoes');
    const self = this;
    function botao(tituloNormal, tituloForte, sub, destino, menor) {
      const b = criar('button', 'vg-botao' + (menor ? ' vg-menor' : ''));
      b.type = 'button';
      const txt = criar('div');
      const t = criar('div', 'vg-botao-titulo');
      if (tituloNormal) t.appendChild(document.createTextNode(tituloNormal + (menor ? ' ' : '')));
      t.appendChild(criar('b', null, tituloForte));
      txt.appendChild(t);
      if (sub) txt.appendChild(criar('div', 'vg-botao-sub', sub));
      const seta = criar('span', 'vg-botao-seta');
      seta.innerHTML = SETA;
      b.appendChild(txt);
      b.appendChild(seta);
      b.dataset.destino = destino;
      b.addEventListener('click', function () {
        if (b.disabled) return;
        ctx.irPara(destino, ctx.unidadeAtual || null);
      });
      return b;
    }
    const bZap = botao('Acessar o', 'WhatsApp', 'Visualize as conversas da unidade ao vivo.', 'whatsapp');
    const bAna = botao('Análise', 'Detalhada', 'Acesse uma análise completa do desempenho.', 'analise');
    botoes.appendChild(bZap);
    botoes.appendChild(bAna);
    const menores = criar('div', 'vg-botoes-menores');
    menores.appendChild(botao('Feed de', 'Leads', null, 'leads', true));
    menores.appendChild(botao('', 'Preferências', null, 'config', true));
    botoes.appendChild(menores);
    esq.appendChild(botoes);
    this._botoesUnidade = [bZap, bAna];

    const rede = criar('div', 'vg-rede');
    esq.appendChild(rede);
    this._elRede = rede;

    /* ---------- direita: ordem e cartões ---------- */
    const ordem = criar('div', 'vg-ordem');
    dir.appendChild(ordem);
    this._elOrdem = ordem;

    const rolagem = criar('div', 'vg-rolagem');
    const cartoes = criar('div', 'vg-cartoes');
    rolagem.appendChild(cartoes);
    dir.appendChild(rolagem);
    this._elCartoes = cartoes;

    grade.appendChild(esq);
    grade.appendChild(dir);
    cena.appendChild(grade);
    cena.appendChild(criar('p', 'vg-rodape', RODAPE));
    raiz.appendChild(cena);

    this._desenharSelecao();
    this._desenharCartoes();

    /* ---------- dados ao vivo ---------- */
    // Primeiro desenho com o que já está em cache (a tela de carregamento acabou
    // de buscar a visão geral): aparece na hora, sem esperar a rodada da assinatura.
    api.visaoGeral().then(function (dados) {
      if (!self._vivo || self._geral || !dados) return;
      self._geral = dados; self._desenharRede(); self._desenharCartoes();
    }).catch(function () { /* a assinatura abaixo tenta de novo e mostra o erro */ });
    api.ranking(0).then(function (dados) {
      if (!self._vivo || self._ranking || !dados) return;
      self._ranking = dados; self._desenharCartoes();
    }).catch(function () { /* idem */ });

    this._cancelar.push(assinarAtualizacao('visao_geral', {}, INTERVALO_GERAL_MS, function (dados, erro) {
      if (!self._vivo) return;
      if (erro) { self._erro = erro; self._desenharCartoes(); return; }
      self._erro = null;
      self._geral = dados;
      self._desenharRede();
      self._desenharCartoes();
    }));
    this._cancelar.push(assinarAtualizacao('ranking', { semanas_atras: 0 }, INTERVALO_RANKING_MS, function (dados, erro) {
      if (!self._vivo || erro) return;
      self._ranking = dados;
      self._desenharCartoes();
    }));
    this._cancelar.push(ctx.aoTrocarUnidade(function () {
      if (!self._vivo) return;
      self._desenharSelecao();
      self._marcarSelecionado();
    }));
  },

  /* ---------- "Selecione a unidade" ou "Unidade selecionada" ---------- */
  _desenharSelecao() {
    const el = this._elSelecao;
    el.textContent = '';
    const ctx = this._ctx;
    const slug = ctx.unidadeAtual;
    const u = slug ? this._unidade(slug) : null;
    if (!u) {
      const ic = criar('span', 'vg-selecao-icone');
      ic.innerHTML = ALERTA;
      el.appendChild(ic);
      const t = criar('div');
      t.appendChild(document.createTextNode('Selecione a'));
      t.appendChild(criar('br'));
      t.appendChild(document.createTextNode('unidade desejada.'));
      el.appendChild(t);
    } else {
      const av = criar('span', 'vg-selecao-avatar');
      av.style.backgroundImage = 'url("' + IMG + 'cachorro-160.png")';
      el.appendChild(av);
      const t = criar('div');
      t.appendChild(criar('small', null, 'Unidade selecionada:'));
      t.appendChild(criar('span', 'vg-selecao-nome', nomeCurto(u.nome)));
      el.appendChild(t);
    }
    this._botoesUnidade.forEach(function (b) {
      b.disabled = !u;
      b.title = u ? '' : 'Escolha uma unidade nos cartões ao lado primeiro.';
    });
  },

  _unidade(slug) {
    const lista = (this._geral && this._geral.unidades) || this._ctx.unidades || [];
    return lista.find(function (x) { return x.slug === slug; }) || null;
  },

  _marcarSelecionado() {
    const atual = this._ctx.unidadeAtual;
    Array.prototype.forEach.call(this._elCartoes.querySelectorAll('.vg-cartao'), function (c) {
      c.setAttribute('aria-pressed', c.dataset.slug === atual ? 'true' : 'false');
    });
  },

  /* ---------- resumo da rede ---------- */
  _desenharRede() {
    const el = this._elRede;
    const r = this._geral && this._geral.rede;
    el.textContent = '';
    if (!r) return;
    el.appendChild(criar('div', 'vg-rede-titulo', 'A rede agora'));
    function item(v, rot, formato) {
      const d = criar('div', 'vg-rede-item');
      const b = criar('b', null, v === null || v === undefined ? TRACINHO : (formato ? formato(v) : String(v)));
      if (v === null || v === undefined) b.title = 'Ainda não medido.';
      d.appendChild(b);
      d.appendChild(criar('span', null, rot));
      return d;
    }
    el.appendChild(item(r.unidades_capturando, 'de ' + r.unidades_total + ' unidades capturando'));
    el.appendChild(item(r.mensagens_24h, 'mensagens em 24 h', formatarNumero));
    el.appendChild(item(r.sla_mediana_min, 'tempo mediano de resposta', formatarMinutos));
    el.appendChild(item(r.pct_respondidas, 'das conversas respondidas', function (v) { return v + '%'; }));
  },

  /* ---------- cartões ---------- */
  _desenharCartoes() {
    const el = this._elCartoes;
    const ctx = this._ctx;
    const self = this;

    if (this._erro && !this._geral) {
      el.textContent = '';
      const e = criar('div', 'vg-erro', this._erro.amigavel || 'Não consegui carregar as unidades.');
      const b = criar('button', 'btn btn-primario', 'Tentar de novo');
      b.addEventListener('click', function () { api.invalidar('visao_geral'); });
      e.appendChild(b);
      el.appendChild(e);
      return;
    }
    if (!this._geral) {
      if (!el.childElementCount) {
        for (let i = 0; i < 2; i++) {
          const s = criar('div', 'vg-cartao esqueleto');
          s.style.minHeight = '420px';
          el.appendChild(s);
        }
      }
      return;
    }

    const unidades = this._geral.unidades || [];
    const rk = this._ranking;
    const porSlug = {};
    if (rk) {
      (rk.classificacao || []).forEach(function (l) { porSlug[l.slug] = l; });
      (rk.sem_base || []).forEach(function (l) { porSlug[l.slug] = Object.assign({ sem_base: true }, l); });
    }

    // ordem: pódio e classificação da semana; depois quem ainda não tem base;
    // depois quem está capturando sem cálculo; por fim quem não captura.
    const lista = unidades.slice().sort(function (a, b) {
      const ra = porSlug[a.slug], rb = porSlug[b.slug];
      const pa = ra && ra.posicao ? ra.posicao : 999;
      const pb = rb && rb.posicao ? rb.posicao : 999;
      if (pa !== pb) return pa - pb;
      if (a.capturando !== b.capturando) return a.capturando ? -1 : 1;
      return nomeCurto(a.nome).localeCompare(nomeCurto(b.nome));
    });

    // texto de ordem
    const ord = this._elOrdem;
    ord.textContent = '';
    if (rk && rk.semana) {
      ord.appendChild(criar('span', null, 'Ranking da semana '));
      ord.appendChild(criar('span', 'vg-semana', rk.semana.rotulo));
      ord.appendChild(criar('span', null, ' · pontos de 0 a 10 pelos critérios da metodologia Daco · base mínima de ' + rk.base_minima + ' conversas'));
      if (!rk.completo) ord.appendChild(criar('span', null, ' · ' + rk.pendentes.length + ' unidade(s) ainda calculando'));
    } else {
      ord.appendChild(criar('span', null, 'Calculando o ranking da semana…'));
    }

    // Atualiza no lugar: o cartão de cada unidade é o MESMO elemento entre uma
    // rodada e outra. Recriar tudo a cada 20 s reiniciava a animação de entrada
    // dos 17 cartões e derrubava foco e hover de quem estava olhando.
    Array.prototype.forEach.call(el.querySelectorAll('.esqueleto'), function (s) { s.remove(); });
    const existentes = {};
    Array.prototype.forEach.call(el.children, function (c) { if (c.dataset.slug) existentes[c.dataset.slug] = c; });
    const vistos = {};
    lista.forEach(function (u, i) {
      const r = porSlug[u.slug] || null;
      const novo = self._cartao(u, r, i);
      const velho = existentes[u.slug];
      vistos[u.slug] = true;
      if (velho) {
        velho.className = novo.className + (velho.classList.contains('vg-nova-notif') || novo.classList.contains('vg-nova-notif') ? ' vg-nova-notif' : '');
        velho.setAttribute('aria-label', novo.getAttribute('aria-label'));
        while (velho.firstChild) velho.removeChild(velho.firstChild);
        while (novo.firstChild) velho.appendChild(novo.firstChild);
        // mudou de posição no ranking: move o elemento, sem recriar
        if (el.children[i] !== velho) el.insertBefore(velho, el.children[i] || null);
      } else {
        el.insertBefore(novo, el.children[i] || null);
      }
    });
    Object.keys(existentes).forEach(function (slug) { if (!vistos[slug]) existentes[slug].remove(); });
    // depois do primeiro desenho, cartão novo entra sem a animação de abertura
    el.classList.add('vg-pronto');
    this._marcarSelecionado();
  },

  _cartao(u, r, indice) {
    const ctx = this._ctx;
    const c = criar('button', 'vg-cartao' + (u.capturando ? '' : ' vg-apagado'));
    c.type = 'button';
    c.dataset.slug = u.slug;
    c.setAttribute('aria-pressed', ctx.unidadeAtual === u.slug ? 'true' : 'false');
    c.setAttribute('aria-label', u.nome + '. Selecionar esta unidade.');
    c.style.animationDelay = Math.min(indice, 8) * 45 + 'ms';
    c.addEventListener('click', function () { ctx.trocarUnidade(u.slug); });

    /* cabeça */
    const cab = criar('div', 'vg-cabeca');
    const av = criar('span', 'vg-avatar');
    av.style.backgroundImage = 'url("' + IMG + 'cachorro-160.png")';
    cab.appendChild(av);
    const txt = criar('div');
    const nome = criar('div', 'vg-nome', nomeCurto(u.nome));
    nome.title = u.nome;
    txt.appendChild(nome);
    const st = criar('div', 'vg-status');
    let tom = 'ok', rotulo = 'Status: ativo';
    if (!u.capturando) { tom = 'fora'; rotulo = 'Status: sem captura'; }
    else if (u.silenciosa) { tom = 'parada'; rotulo = 'Status: sem mensagens há ' + Math.round(u.horas_parada) + 'h'; }
    st.dataset.tom = tom;
    st.appendChild(criar('span', 'vg-status-ponto'));
    st.appendChild(criar('span', null, rotulo));
    txt.appendChild(st);
    cab.appendChild(txt);
    c.appendChild(cab);

    /* TOP N + medalha */
    const top = criar('div', 'vg-top');
    if (r && r.posicao) {
      if (r.posicao <= 3) {
        top.appendChild(criar('span', 'vg-top-texto', 'TOP ' + r.posicao));
        top.appendChild(medalhaSvg(r.posicao));
      } else {
        top.appendChild(criar('span', 'vg-posicao', r.posicao + 'º'));
      }
    } else if (r && r.sem_base) {
      const s = criar('span', 'vg-posicao', 'sem base');
      s.title = 'Menos de ' + (this._ranking ? this._ranking.base_minima : 10) + ' conversas na semana: não entra no ranking.';
      top.appendChild(s);
    }
    c.appendChild(top);

    /* WhatsApp */
    const zap = criar('div', 'vg-zap');
    zap.appendChild(document.createTextNode('WhatsApp: '));
    const tel = criar('b', null, u.telefone ? '+' + String(u.telefone).replace(/\D/g, '') : TRACINHO);
    if (!u.telefone) tel.title = 'O número desta unidade ainda não foi cadastrado.';
    zap.appendChild(tel);
    c.appendChild(zap);
    c.appendChild(criar('div', 'vg-sep'));

    /* últimas 24h */
    const h = u.h24 || {};
    c.appendChild(criar('div', 'vg-bloco-titulo', '⏰ ÚLTIMAS 24H'));

    const leads = h.leads_novos;
    c.appendChild(linha('👤', 'Novos leads',
      leads === null || leads === undefined ? valor(TRACINHO, 'nulo') : valor(formatarNumero(leads)),
      leads === null || leads === undefined ? 'A captura das notificações de lead do grupo ainda não está ligada nesta unidade. Não é zero: não medimos.' : ''));

    c.appendChild(linha('💬', 'Mensagens', valor(formatarNumero(h.mensagens || 0))));

    const sla = h.sla_mediana_min;
    let slaEl;
    if (sla === null || sla === undefined) slaEl = valor(TRACINHO, 'nulo');
    else slaEl = valor(formatarMinutos(sla), sla <= SLA_VERDE_MIN ? 'ok' : 'ruim');
    c.appendChild(linha('⏳', 'SLA (Tempo médio de resposta)', slaEl,
      sla === null || sla === undefined ? 'Nenhuma resposta medida nas últimas 24 h.' : 'Mediana do tempo entre a pergunta do tutor e a resposta da clínica.'));

    const pontos = r && r.pontos !== null && r.pontos !== undefined ? r.pontos : null;
    let nivelEl;
    if (pontos === null) nivelEl = valor(TRACINHO, 'nulo');
    else nivelEl = valor(String(pontos).replace('.', ',') + '/10', pontos >= 7 ? 'ok' : (pontos >= 5 ? 'meio' : 'ruim'));
    c.appendChild(linha('🚀', 'Nível de desempenho geral', nivelEl,
      pontos === null ? (r && r.sem_base ? 'Sem base suficiente nesta semana.' : 'Ainda calculando a semana.') : 'Pontuação da semana pelos critérios da metodologia Daco.'));

    c.appendChild(linha('🔍', 'Serviço mais buscado',
      u.servico_top ? valor(u.servico_top) : valor(TRACINHO, 'nulo'),
      u.servico_top ? '' : 'Ainda sem sinal suficiente nas conversas do período.'));

    c.appendChild(criar('div', 'vg-sep'));

    /* notificação mais recente */
    const n = u.ultima_notificacao;
    const notif = criar('div', 'vg-notif');
    notif.appendChild(criar('div', 'vg-notif-titulo', 'Notificação mais recente:'));
    if (n) {
      notif.appendChild(criar('div', 'vg-linha', n.origem === 'agente' ? '📢 Cliente pronto para atendimento' : '🔥 Novo Lead cadastrado!'));
      notif.appendChild(linha('👤', 'Nome', valor(n.tutor || TRACINHO)));
      if (n.pet) notif.appendChild(linha('🐾', 'Nome do Pet', valor(n.pet)));
      notif.appendChild(linha('🤔', 'Interesse', valor(n.interesse || TRACINHO)));
      notif.appendChild(linha('🟢', 'WhatsApp', valor(formatarTelefone(n.telefone))));
      const q = criar('div', 'vg-notif-vazia', formatarQuando(n.recebido_em));
      notif.appendChild(q);
      // chegou notificação nova desde a última vez que desenhamos este cartão
      if (this._notifVista[u.slug] && this._notifVista[u.slug] !== n.id) c.classList.add('vg-nova-notif');
      this._notifVista[u.slug] = n.id;
    } else {
      notif.appendChild(criar('div', 'vg-notif-vazia',
        u.capturando
          ? 'Nenhuma notificação de lead chegou pelo grupo desta unidade nas capturas mais recentes.'
          : 'A captura desta unidade ainda não foi ligada.'));
    }
    c.appendChild(notif);

    return c;
  },

  desmontar() {
    this._vivo = false;
    (this._cancelar || []).forEach(function (f) { try { f(); } catch (e) { /* já cancelado */ } });
    this._cancelar = [];
    delete document.body.dataset.tela;
    this._ctx = null;
  },
};
