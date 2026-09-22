/*
  leads.js — Feed de Leads do WhatsApp 360° Vision.

  As notificações que caem nos GRUPOS de WhatsApp das unidades, capturadas pela
  ingestão e normalizadas pelo parser nos dois formatos da seção 3.3 do
  CONTRATO.md:

    origem 'ghl'     → "🔥 Novo Lead cadastrado!" (grupo Central de Leads)
    origem 'agente'  → "*Cliente pronto para atendimento* 📢" (a IA passando o
                       atendimento para a recepção)

  A tela tem duas partes: a faixa de números do período e a linha do tempo,
  agrupada por dia com cabeçalho grudento.

  O que esta tela promete:

  1. Nenhum número nasce no navegador. Tudo é contado sobre as linhas que a ação
     `leads` devolveu. Se a ação não devolveu nada, a tela explica o que falta —
     nunca inventa tutor, telefone, interesse ou contagem de exemplo.

  2. null nunca vira 0. Unidade sem captura de grupo não tem leads medidos: a
     faixa mostra o traço com o motivo, não um zero que pareceria "não entrou
     ninguém hoje". Zero só aparece quando houve medição e não houve lead.

  3. O valor de verdade da tela é o cruzamento: para cada lead, SE e QUANDO
     alguém da unidade falou com aquele telefone depois da notificação, e em
     quanto tempo. O treinamento da rede pede contato em até 5 minutos, então
     cada lead ganha um selo — até 5 min, depois de 5 min, ou sem resposta até
     agora. Quando a API não manda esse cruzamento, o selo diz "resposta não
     medida". O painel nunca conclui que ninguém respondeu por falta de dado.

  4. A crítica é sempre sobre o indicador (o tempo até o primeiro contato),
     nunca sobre a unidade.

  Convivência (seção 6 do contrato): só escreve dentro da `raiz` que recebe, usa
  os componentes compartilhados do tema.css e classes próprias com o prefixo
  `ld-`. Todo timer, ouvinte e assinatura morre em `desmontar()`.
*/

import {
  assinarAtualizacao,
  ehErroDeSessao,
  formatarMinutos,
  formatarNumero,
  formatarPorcentagem,
  formatarQuando,
  formatarTelefone,
  TRACINHO,
} from './dados.js';

/* ═════════════════════════ 1. CONSTANTES ════════════════════════════════ */

/** Atualização ao vivo desta tela: o pedido é de 15 s. */
const INTERVALO_MS = 15000;

/** De quanto em quanto tempo os textos relativos ("há 8 min") são reescritos. */
const INTERVALO_RELOGIO_MS = 30000;

/** Duração da contagem de um número que mudou (token --t-numero do tema). */
const DURACAO_CONTAGEM_MS = 600;

/** Quanto tempo o item recém-chegado fica com a animação de entrada. */
const DURACAO_CHEGADA_MS = 900;

/** Meta oficial do treinamento: contato em até 5 minutos. */
const META_MIN = 5;

/** Um dia em milissegundos. */
const DIA_MS = 86400000;

/** Períodos oferecidos. `dias` vira o `desde` da consulta. */
const PERIODOS = [
  { id: 'hoje', rotulo: 'Hoje', dias: 0, frase: 'hoje' },
  { id: '7', rotulo: 'Últimos 7 dias', dias: 7, frase: 'nos últimos 7 dias' },
  { id: '30', rotulo: 'Últimos 30 dias', dias: 30, frase: 'nos últimos 30 dias' },
];

/** A consulta nunca pede menos de 7 dias: a faixa do topo mede a semana. */
const DIAS_MINIMOS_DA_CONSULTA = 7;

/** Origens da seção 3.3. Só estas duas existem; qualquer outra vira "não informada". */
const ORIGENS = [
  { id: 'ghl', rotulo: 'GoHighLevel', curto: 'Cadastro', explicacao: 'Notificação do formulário cadastrada no GoHighLevel e avisada no grupo.' },
  { id: 'agente', rotulo: 'Agente de IA', curto: 'IA → recepção', explicacao: 'A IA terminou a triagem e passou o atendimento para a recepção.' },
];

/** Situações do cruzamento com as conversas da unidade. */
const SITUACOES = {
  rapido: { rotulo: 'Até 5 min', classe: 'selo-ok' },
  tarde: { rotulo: 'Depois de 5 min', classe: 'selo-atencao' },
  sem_resposta: { rotulo: 'Sem resposta', classe: 'selo-risco' },
  nao_medido: { rotulo: 'Não medido', classe: 'selo-neutro' },
};

/** Quantos interesses aparecem em barra antes de o resto virar "outros". */
const TETO_DE_INTERESSES = 6;

/* ═════════════════════════ 2. ÍCONES ════════════════════════════════════ */

const SVG_ABRE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
  + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';

/** Ícone da tela no trilho: caixa de entrada. */
const ICONE_TELA = SVG_ABRE
  + '<path d="M3 13h5l1.6 2.6h4.8L16 13h5"/>'
  + '<path d="M4.5 6.4 3 13v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5l-1.5-6.6A2 2 0 0 0 17.6 4.8H6.4a2 2 0 0 0-1.9 1.6Z"/></svg>';

const ICONES = {
  atencao: SVG_ABRE + '<path d="M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3'
    + 'l-7.9-13.7a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4.5"/><path d="M12 17.2h.01"/></svg>',
  grupo: SVG_ABRE + '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0"/>'
    + '<path d="M16.2 6.2a3 3 0 0 1 0 5.8"/><path d="M17.5 14.6a5 5 0 0 1 3 4.9"/></svg>',
  pet: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">'
    + '<ellipse cx="6.6" cy="9.5" rx="2.1" ry="2.7"/><ellipse cx="10.6" cy="7.3" rx="2.2" ry="2.9"/>'
    + '<ellipse cx="14.8" cy="7.5" rx="2.2" ry="2.9"/><ellipse cx="18.4" cy="10.1" rx="2" ry="2.5"/>'
    + '<path d="M12.6 12.2c2.8 0 5.2 2.1 5.2 4.6 0 2.1-1.7 3.4-3.9 3.4-.9 0-1.2-.4-1.3-.4s-.5.4-1.4.4'
    + 'c-2.2 0-3.9-1.3-3.9-3.4 0-2.5 2.5-4.6 5.3-4.6Z"/></svg>',
  etiqueta: SVG_ABRE + '<path d="M3.5 11.4V5a1.5 1.5 0 0 1 1.5-1.5h6.4a2 2 0 0 1 1.4.6l7 7a2 2 0 0 1 0 2.8'
    + 'l-6 6a2 2 0 0 1-2.8 0l-7-7a2 2 0 0 1-.5-1.5Z"/><path d="M7.7 7.7h.01"/></svg>',
  telefone: SVG_ABRE + '<path d="M6.5 3.5h3l1.5 4-2 1.4a12 12 0 0 0 6.1 6.1l1.4-2 4 1.5v3'
    + 'a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2Z"/></svg>',
  relogio: SVG_ABRE + '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></svg>',
  robo: SVG_ABRE + '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4.5V8"/>'
    + '<circle cx="12" cy="3.6" r="1.1"/><path d="M9 12.5h.01"/><path d="M15 12.5h.01"/>'
    + '<path d="M9.5 16h5"/></svg>',
  certo: SVG_ABRE + '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.2 2.4 2.4 4.6-4.9"/></svg>',
  semDado: SVG_ABRE + '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>',
  busca: SVG_ABRE + '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>',
  seta: SVG_ABRE + '<path d="M5 12h13"/><path d="m12.5 5.5 6.5 6.5-6.5 6.5"/></svg>',
  cima: SVG_ABRE + '<path d="M12 19V5"/><path d="m5.5 11.5 6.5-6.5 6.5 6.5"/></svg>',
};

/* ═════════════════════════ 3. ESTILO DO MÓDULO ══════════════════════════
   Só o que é exclusivo desta tela. Tokens e componentes compartilhados vêm do
   tema.css e nunca são redefinidos aqui.
   ════════════════════════════════════════════════════════════════════════ */

const ESTILO = `
.ld-raiz { display: flex; flex-direction: column; gap: var(--esp-16); min-width: 0; }

/* --- Topo -------------------------------------------------------------- */
.ld-topo { display: flex; align-items: flex-start; flex-wrap: wrap; gap: var(--esp-12); min-width: 0; }
.ld-titulo-bloco { display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 1 1 340px; }
.ld-titulo {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--esp-12);
  font-size: clamp(26px, 1.9vw + 16px, 38px);
  font-weight: 800;
  line-height: 1.04;
  letter-spacing: -.03em;
}
.ld-subtitulo {
  font-size: var(--txt-pequeno);
  font-weight: 600;
  color: var(--tinta-2);
  max-width: 76ch;
}

/* Contador discreto de leads que chegaram com a tela aberta. */
.ld-novos {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: var(--alvo-toque);
  padding: 0 var(--esp-16);
  background: var(--veu-indigo);
  border: 1px solid rgba(91, 91, 214, .45);
  border-radius: var(--r-redondo);
  color: var(--indigo-cl);
  font-family: var(--fonte-titulo);
  font-size: var(--txt-legenda);
  font-weight: 800;
  letter-spacing: .06em;
  text-transform: uppercase;
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--transicao), color var(--transicao), border-color var(--transicao);
}
.ld-novos:hover { background: rgba(91, 91, 214, .28); color: var(--tinta); }
.ld-novos svg { width: 15px; height: 15px; }
.ld-novos[hidden] { display: none; }

.ld-acoes-topo { display: flex; align-items: center; gap: var(--esp-8); flex: none; }

/* --- Faixa de números -------------------------------------------------- */
.ld-resumo {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--esp-12);
  min-width: 0;
}
.ld-bloco { display: flex; flex-direction: column; gap: var(--esp-12); min-width: 0; }
.ld-bloco-titulo {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: var(--txt-legenda);
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--tinta-2);
}
.ld-bloco-titulo svg { width: 15px; height: 15px; color: var(--tinta-3); }

.ld-numeros { display: flex; align-items: stretch; gap: var(--esp-12); min-width: 0; }
.ld-numeros > .metrica { flex: 1 1 0; }
.ld-numeros .separador.vertical { flex: none; }

/* Linhas de origem e de interesse: rótulo, valor e barra do tema. */
.ld-linhas { display: flex; flex-direction: column; gap: var(--esp-12); min-width: 0; }
.ld-linha-barra { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.ld-linha-topo { display: flex; align-items: baseline; gap: var(--esp-8); min-width: 0; }
.ld-linha-nome {
  font-size: var(--txt-pequeno);
  font-weight: 700;
  color: var(--tinta);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.ld-linha-valor {
  margin-left: auto;
  font-family: var(--fonte-titulo);
  font-size: var(--txt-pequeno);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--tinta);
  flex: none;
}
.ld-linha-parte { font-size: var(--txt-legenda); font-weight: 700; color: var(--tinta-3); flex: none; }

/* --- Filtros ----------------------------------------------------------- */
.ld-filtros {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(168px, 1fr));
  gap: var(--esp-12);
  align-items: end;
  min-width: 0;
}
.ld-filtro { min-width: 0; }
.ld-busca { grid-column: span 2; }
.ld-busca-caixa { display: flex; align-items: center; gap: var(--esp-8); min-width: 0; }
.ld-busca-caixa svg { width: 16px; height: 16px; color: var(--tinta-3); flex: none; }

.ld-barra-inferior { display: flex; align-items: center; flex-wrap: wrap; gap: var(--esp-12); min-width: 0; }
.ld-contagem { font-size: var(--txt-pequeno); font-weight: 700; color: var(--tinta-2); }
.ld-contagem b { color: var(--tinta); font-family: var(--fonte-titulo); }

/* Legenda dos três selos de resposta. */
.ld-legenda { display: flex; align-items: center; flex-wrap: wrap; gap: var(--esp-8) var(--esp-12); }
.ld-legenda-item { display: inline-flex; align-items: center; gap: 6px; font-size: var(--txt-legenda);
  font-weight: 600; color: var(--tinta-3); }

/* --- Linha do tempo ---------------------------------------------------- */
.ld-tempo { display: flex; flex-direction: column; gap: 2px; min-width: 0; }

.ld-dia {
  position: sticky;
  top: var(--ld-topo, 0px);
  z-index: 3;
  display: flex;
  align-items: baseline;
  gap: var(--esp-8);
  margin: var(--esp-16) 0 var(--esp-8);
  padding: var(--esp-8) var(--esp-12);
  background: var(--fundo-2);
  border: 1px solid var(--linha);
  border-radius: var(--r-p);
  min-width: 0;
}
@supports (backdrop-filter: blur(10px)) {
  .ld-dia { background: rgba(11, 15, 26, .88); backdrop-filter: blur(10px); }
}
.ld-dia:first-child { margin-top: 0; }
.ld-dia-nome { font-family: var(--fonte-titulo); font-size: var(--txt-base); font-weight: 800; letter-spacing: -.01em; }
.ld-dia-data { font-size: var(--txt-legenda); font-weight: 700; color: var(--tinta-3); }
.ld-dia-contagem {
  margin-left: auto;
  font-size: var(--txt-legenda);
  font-weight: 700;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--tinta-2);
  flex: none;
}

.ld-lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--esp-8); }

.ld-item {
  display: flex;
  gap: var(--esp-12);
  padding: var(--esp-12) var(--esp-16);
  background: var(--carta);
  border: 1px solid var(--linha);
  border-left: 3px solid var(--linha-2);
  border-radius: var(--r);
  box-shadow: var(--sombra-1);
  min-width: 0;
  transition: background var(--transicao), border-color var(--transicao), box-shadow var(--transicao);
}
.ld-item:hover { background: var(--carta-2); border-color: var(--linha-2); border-left-color: var(--linha-2); }
.ld-item:focus-visible { outline: 2px solid var(--indigo-cl); outline-offset: 2px; }

/* Passagem da IA para a recepção: borda indigo e véu curto à esquerda. */
.ld-item[data-origem="agente"] {
  border-left-color: var(--indigo);
  background-image: linear-gradient(90deg, var(--veu-indigo), transparent 220px);
}
.ld-item[data-origem="agente"]:hover { border-left-color: var(--indigo-cl); }

.ld-hora { display: flex; flex-direction: column; gap: 2px; width: 78px; flex: none; text-align: right; }
.ld-hora-valor {
  font-family: var(--fonte-titulo);
  font-size: var(--txt-medio);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
  letter-spacing: -.02em;
  color: var(--tinta);
}
.ld-hora-rel { font-size: var(--txt-legenda); font-weight: 600; color: var(--tinta-3); }
.ld-item[data-situacao="rapido"] .ld-hora-valor { color: var(--ok); }
.ld-item[data-situacao="tarde"] .ld-hora-valor { color: var(--atencao); }
.ld-item[data-situacao="sem_resposta"] .ld-hora-valor { color: var(--risco); }
.ld-item[data-situacao="nao_medido"] .ld-hora-valor { color: var(--tinta-2); }

.ld-corpo { display: flex; flex-direction: column; gap: 7px; min-width: 0; flex: 1 1 auto; }
.ld-cabeca { display: flex; align-items: center; flex-wrap: wrap; gap: var(--esp-8); min-width: 0; }
.ld-tutor {
  font-family: var(--fonte-titulo);
  font-size: var(--txt-medio);
  font-weight: 700;
  letter-spacing: -.015em;
  color: var(--tinta);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.ld-selo-origem svg { width: 13px; height: 13px; }
/* Selo da passagem da IA e selo de "chegou agora": o mesmo indigo de ação. */
.ld-selo-ia,
.ld-selo-novo {
  background: var(--veu-indigo);
  border-color: rgba(91, 91, 214, .40);
  color: var(--indigo-cl);
}
.ld-legenda-bolinha { padding: 2px 6px; }
/* O .cresce do tema só vale dentro de .pilha/.pilha-h; a faixa de aviso é flex
   por conta do .aviso, então o miolo recebe aqui o mesmo comportamento. */
.ld-raiz .aviso > .cresce { flex: 1 1 auto; min-width: 0; }
.ld-limpar[hidden] { display: none; }

.ld-dados { display: flex; flex-wrap: wrap; gap: 6px var(--esp-16); min-width: 0; }
.ld-dado {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: var(--txt-pequeno);
  font-weight: 600;
  color: var(--tinta-2);
}
.ld-dado svg { width: 15px; height: 15px; color: var(--tinta-3); flex: none; }
.ld-dado span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.ld-dado.ld-sem-dado { color: var(--tinta-3); }
.ld-dado .mono { color: var(--tinta); }

.ld-resumo-ia {
  display: flex;
  gap: var(--esp-8);
  padding: var(--esp-8) var(--esp-12);
  background: var(--fundo-2);
  border: 1px solid var(--linha);
  border-radius: var(--r-p);
  font-size: var(--txt-pequeno);
  font-weight: 500;
  line-height: 1.55;
  color: var(--tinta-2);
  min-width: 0;
}
.ld-resumo-ia svg { width: 16px; height: 16px; color: var(--indigo-cl); flex: none; margin-top: 2px; }
.ld-resumo-ia b {
  display: block;
  font-family: var(--fonte-titulo);
  font-size: var(--txt-legenda);
  font-weight: 700;
  letter-spacing: .07em;
  text-transform: uppercase;
  color: var(--tinta-3);
  margin-bottom: 2px;
}

/* Os controles do item mantêm os 44px do tema — só o texto é menor. */
.ld-rodape-item { display: flex; align-items: center; flex-wrap: wrap; gap: var(--esp-8); }
.ld-rodape-item .btn { font-size: var(--txt-legenda); padding: 0 var(--esp-12); }

.ld-bruto { min-width: 0; flex: 1 1 100%; }
.ld-bruto > summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: var(--alvo-toque);
  padding: 0 var(--esp-8);
  margin-left: calc(var(--esp-8) * -1);
  list-style: none;
  cursor: pointer;
  font-size: var(--txt-legenda);
  font-weight: 700;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--tinta-3);
}
.ld-bruto > summary::-webkit-details-marker { display: none; }
.ld-bruto > summary:hover { color: var(--tinta-2); }
.ld-bruto > summary:focus-visible { outline: 2px solid var(--indigo-cl); outline-offset: 2px; }
.ld-bruto[open] > summary { color: var(--tinta-2); }
.ld-bruto pre {
  margin: 4px 0 0;
  padding: var(--esp-12);
  background: var(--fundo-2);
  border: 1px solid var(--linha);
  border-radius: var(--r-p);
  font-family: var(--fonte-mono);
  font-size: var(--txt-legenda);
  line-height: 1.6;
  color: var(--tinta-2);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 260px;
  overflow: auto;
}

/* --- Rodapé da tela ---------------------------------------------------- */
.ld-rodape {
  display: flex;
  align-items: flex-start;
  gap: var(--esp-8);
  padding-top: var(--esp-8);
  font-size: var(--txt-legenda);
  font-weight: 600;
  color: var(--tinta-3);
  line-height: 1.6;
}
.ld-rodape svg { width: 15px; height: 15px; flex: none; margin-top: 2px; }

/* --- Esqueleto de carregamento ----------------------------------------- */
.ld-esqueleto { display: flex; gap: var(--esp-12); margin-bottom: var(--esp-8);
  padding: var(--esp-12) var(--esp-16);
  background: var(--carta); border: 1px solid var(--linha); border-radius: var(--r); }
.ld-esqueleto-hora { width: 62px; flex: none; }
.ld-esqueleto .esqueleto.linha:nth-child(2) { width: 70%; }

/* --- Movimento --------------------------------------------------------- */
@media (prefers-reduced-motion: no-preference) {
  @keyframes ld-chegada {
    from { opacity: 0; transform: translateX(-12px); }
    to   { opacity: 1; transform: none; }
  }
  .ld-item.ld-chegou { animation: ld-chegada 320ms var(--curva) both; }
}

/* --- Responsivo -------------------------------------------------------- */
@media (max-width: 1180px) {
  .ld-resumo { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .ld-resumo > .ld-cartao-numeros { grid-column: span 2; }
  .ld-busca { grid-column: span 2; }
}

@media (max-width: 720px) {
  .ld-resumo { grid-template-columns: minmax(0, 1fr); }
  .ld-resumo > .ld-cartao-numeros { grid-column: auto; }
  .ld-numeros { flex-wrap: wrap; gap: var(--esp-8) var(--esp-16); }
  .ld-numeros > .metrica { flex: 1 1 40%; }
  .ld-numeros .separador.vertical { display: none; }

  .ld-filtros { grid-template-columns: minmax(0, 1fr); }
  .ld-busca { grid-column: auto; }

  .ld-item { flex-direction: column; gap: var(--esp-8); }
  .ld-hora {
    flex-direction: row;
    align-items: baseline;
    gap: var(--esp-8);
    width: auto;
    text-align: left;
  }
  .ld-hora-valor { font-size: var(--txt-base); }
  .ld-item[data-origem="agente"] { background-image: linear-gradient(180deg, var(--veu-indigo), transparent 90px); }
  .ld-rodape-item .btn { width: 100%; }
}
`;

/* ═════════════════════════ 4. ESTADO DO MÓDULO ══════════════════════════
   Os filtros ficam fora de `montar()` de propósito: quem sai para a conversa e
   volta encontra a tela como deixou.
   ════════════════════════════════════════════════════════════════════════ */

let periodoAtual = '7';
let origemAtual = 'todas';
let interesseAtual = 'todos';
let situacaoAtual = 'todas';
let buscaAtual = '';

let contexto = null;      /* o ctx da casca */
let raizTela = null;
let noEstilo = null;

let elViva = null;        /* região aria-live das mensagens curtas */
let elNovos = null;
let elNovosTexto = null;
let elSubtitulo = null;
let elAlerta = null;
let elContagem = null;
let elTempo = null;       /* onde a linha do tempo mora */
let elEstado = null;      /* esqueleto, vazio e erro */
let elRodape = null;
let elLegenda = null;

let elSelUnidade = null;
let elSelPeriodo = null;
let elSelOrigem = null;
let elSelInteresse = null;
let elSelSituacao = null;
let elBusca = null;
let elLimpar = null;

let refsNumeros = null;   /* { hoje, semana, ate5 } → nós das métricas */
let refsOrigens = null;   /* { ghl, agente } → { valor, parte, barra, preenchida } */
let elInteresses = null;

let leads = [];           /* lista normalizada, do mais novo para o mais antigo */
let disponivel = null;    /* true | false | null (a API ainda não disse) */
let motivo = null;        /* 'tabela_nao_criada' e outros que a API mandar */
let recebeuAlgo = false;
let ultimoErro = null;

let conhecidos = new Set();     /* ids já vistos nesta sessão de tela */
let recemChegados = new Set();  /* ids que chegaram com a tela aberta */
let jaAnimados = new Set();     /* ids que já fizeram a animação de chegada */
let novos = 0;

let itens = new Map();    /* id → { no, horaRel, situacaoSelo } para o relógio */
let assinaturaDesenhada = '';

let pararAssinatura = null;
let cancelarOuvinteUnidade = null;
let relogio = null;
let temporizadorMedida = 0;
let temporizadorBusca = 0;

const numerosEmCurso = new Map();  /* nó → id do requestAnimationFrame */
const esperas = new Set();         /* timeouts da animação de chegada */
const valoresAnteriores = new Map();

/* ═════════════════════════ 5. UTILIDADES ════════════════════════════════ */

function criar(tag, classe, texto) {
  const no = document.createElement(tag);
  if (classe) no.className = classe;
  if (texto !== undefined && texto !== null) no.textContent = texto;
  return no;
}

/**
 * Devolve o <svg> do ícone já marcado como decorativo. `innerHTML` aqui só
 * recebe constante deste arquivo — nada que venha da API passa por aqui.
 * A classe vai por setAttribute porque `className` de SVG é somente leitura.
 */
function icone(svg, classe) {
  const caixa = document.createElement('span');
  caixa.innerHTML = svg;
  const no = caixa.firstElementChild;
  if (!no) return caixa;
  if (classe) no.setAttribute('class', classe);
  no.setAttribute('aria-hidden', 'true');
  no.setAttribute('focusable', 'false');
  return no;
}

function movimentoReduzido() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {
    return false;
  }
}

/** Só é ausência de medida: null, undefined, NaN e texto vazio. O 0 passa. */
function semMedida(valor) {
  if (valor === null || valor === undefined) return true;
  if (typeof valor === 'number' && !Number.isFinite(valor)) return true;
  if (typeof valor === 'string' && valor.trim() === '') return true;
  return false;
}

function numeroOuNulo(valor) {
  if (semMedida(valor)) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function textoOuNulo(valor) {
  if (semMedida(valor)) return null;
  const t = String(valor).trim();
  return t ? t : null;
}

/** Texto sem acento e em minúsculas, para busca e agrupamento de interesse. */
function chaveDeBusca(texto) {
  const cru = String(texto || '').toLowerCase();
  try {
    return cru.normalize('NFD').replace(/[̀-ͯ]/g, '');
  } catch (e) {
    return cru;
  }
}

function soDigitos(texto) {
  return String(texto || '').replace(/\D+/g, '');
}

function doisDigitos(n) {
  return String(n).padStart(2, '0');
}

/** "18h58" no fuso do navegador. */
function horaDoDia(marca) {
  const d = new Date(marca);
  return doisDigitos(d.getHours()) + 'h' + doisDigitos(d.getMinutes());
}

function inicioDeHoje() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 'AAAA-MM-DD' no fuso do navegador — a chave do agrupamento por dia. */
function chaveDoDia(marca) {
  const d = new Date(marca);
  return d.getFullYear() + '-' + doisDigitos(d.getMonth() + 1) + '-' + doisDigitos(d.getDate());
}

/** "Hoje", "Ontem" ou "18/09" (com o ano quando não é o corrente). */
function rotuloDoDia(marca) {
  const d = new Date(marca);
  const hoje = inicioDeHoje();
  const dia = new Date(marca);
  dia.setHours(0, 0, 0, 0);
  const diferenca = Math.round((hoje - dia.getTime()) / DIA_MS);
  if (diferenca === 0) return 'Hoje';
  if (diferenca === 1) return 'Ontem';
  const curta = doisDigitos(d.getDate()) + '/' + doisDigitos(d.getMonth() + 1);
  if (d.getFullYear() !== new Date().getFullYear()) {
    return curta + '/' + String(d.getFullYear()).slice(-2);
  }
  return curta;
}

const DIAS_DA_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
  'quinta-feira', 'sexta-feira', 'sábado'];

function nomeDoDiaDaSemana(marca) {
  const d = new Date(marca);
  return DIAS_DA_SEMANA[d.getDay()] || '';
}

function plural(n, singular, plural2) {
  return n === 1 ? singular : plural2;
}

/**
 * Quanto tempo faz — sempre em distância, nunca repetindo a hora que já está na
 * coluna ao lado.  "agora" · "há 12 min" · "há 1h35" · "há 3d 2h"
 */
function desdeQuando(marca) {
  const segundos = Math.round((Date.now() - marca) / 1000);
  if (segundos < 0) return 'daqui a ' + formatarMinutos(Math.round(-segundos / 60));
  if (segundos < 60) return 'agora';
  const minutos = segundos / 60;
  if (minutos < 60) return 'há ' + Math.floor(minutos) + ' min';
  return 'há ' + formatarMinutos(Math.round(minutos));
}

/* ═════════════════════════ 6. NÚMEROS QUE CONTAM ════════════════════════ */

function cancelarContagem(no) {
  const id = numerosEmCurso.get(no);
  if (id) {
    cancelAnimationFrame(id);
    numerosEmCurso.delete(no);
  }
}

/** Interpola de um valor a outro em 600ms (seção 4 do contrato). */
function contar(no, de, para, formatar) {
  cancelarContagem(no);
  if (movimentoReduzido() || de === para) {
    no.textContent = formatar(para);
    return;
  }
  const inicio = (typeof performance !== 'undefined' && performance.now)
    ? performance.now() : Date.now();
  function passo(agora) {
    const t = Math.min(1, (agora - inicio) / DURACAO_CONTAGEM_MS);
    const suave = 1 - Math.pow(1 - t, 3);
    no.textContent = formatar(Math.round(de + (para - de) * suave));
    if (t < 1) numerosEmCurso.set(no, requestAnimationFrame(passo));
    else {
      numerosEmCurso.delete(no);
      no.textContent = formatar(para);
    }
  }
  numerosEmCurso.set(no, requestAnimationFrame(passo));
}

/**
 * Escreve uma métrica respeitando a diferença entre null e zero.
 * `valor` null → traço em tinta-3 com o título explicando por que não há medida.
 */
function definirNumero(refs, valor, formatar, tituloSemMedida, tituloComMedida) {
  if (!refs || !refs.valor) return;
  const chave = refs.chave;
  const anterior = valoresAnteriores.has(chave) ? valoresAnteriores.get(chave) : null;

  if (valor === null) {
    cancelarContagem(refs.valor);
    refs.valor.textContent = TRACINHO;
    refs.caixa.classList.add('sem-medida');
    refs.caixa.title = tituloSemMedida;
    valoresAnteriores.set(chave, null);
    return;
  }

  refs.caixa.classList.remove('sem-medida');
  refs.caixa.title = tituloComMedida || '';
  if (anterior === null || anterior === undefined) refs.valor.textContent = formatar(valor);
  else contar(refs.valor, anterior, valor, formatar);
  valoresAnteriores.set(chave, valor);
}

/* ═════════════════════════ 7. LEITURA DOS LEADS ═════════════════════════ */

/**
 * O cruzamento com as conversas da unidade.
 *
 * O contrato (3.3) descreve a notificação, mas quem calcula se alguém respondeu
 * aquele telefone é o servidor. Como o nome do campo pode chegar de mais de um
 * jeito, este leitor aceita os formatos abaixo e, se NENHUM vier, devolve
 * `medido: false` — a tela então diz "resposta não medida". Ausência de campo
 * nunca vira "ninguém respondeu".
 *
 *   lead.resposta = { respondido_em, minutos?, autor?, medido? }
 *   lead.respondido_em | lead.resposta_em | lead.primeira_resposta_em   (ISO)
 *   lead.resposta_min | lead.minutos_ate_resposta | lead.primeira_resposta_min
 *   lead.resposta_medida (booleano) | lead.sem_resposta (booleano)
 *
 * `resposta: { respondido_em: null }` significa "o cruzamento rodou e ninguém
 * respondeu" — é o único jeito de a tela afirmar isso. Um `resposta: null` solto
 * é ambíguo e cai em "não medido", de propósito.
 */
function lerResposta(cru, recebidoMarca) {
  const objeto = (cru && cru.resposta && typeof cru.resposta === 'object') ? cru.resposta : null;

  const respondidoEm = textoOuNulo(
    (objeto && (objeto.respondido_em || objeto.em || objeto.quando))
    || cru.respondido_em || cru.resposta_em || cru.primeira_resposta_em
  );

  let minutos = numeroOuNulo(
    (objeto && (objeto.minutos !== undefined ? objeto.minutos : objeto.minutos_ate_resposta))
  );
  if (minutos === null) {
    minutos = numeroOuNulo(cru.resposta_min);
  }
  if (minutos === null) minutos = numeroOuNulo(cru.minutos_ate_resposta);
  if (minutos === null) minutos = numeroOuNulo(cru.primeira_resposta_min);

  const autor = textoOuNulo((objeto && (objeto.autor || objeto.quem)) || cru.respondido_por);

  const marcaResposta = respondidoEm ? Date.parse(respondidoEm) : NaN;
  if (minutos === null && !Number.isNaN(marcaResposta) && recebidoMarca !== null) {
    minutos = Math.max(0, (marcaResposta - recebidoMarca) / 60000);
  }

  const houveResposta = (!Number.isNaN(marcaResposta) && respondidoEm !== null) || minutos !== null;

  // O cruzamento rodou? Só afirmamos isso quando o servidor deixou claro.
  const medido = houveResposta
    || !!objeto
    || cru.resposta_medida === true
    || typeof cru.sem_resposta === 'boolean';

  if (!medido) {
    return { medido: false, situacao: 'nao_medido', respondidoEm: null, minutos: null, autor: null };
  }
  if (houveResposta) {
    const situacao = (minutos !== null && minutos <= META_MIN) ? 'rapido' : 'tarde';
    return {
      medido: true,
      situacao: situacao,
      respondidoEm: respondidoEm,
      minutos: minutos,
      autor: autor,
    };
  }
  return { medido: true, situacao: 'sem_resposta', respondidoEm: null, minutos: null, autor: null };
}

/** Normaliza uma linha crua da ação `leads` no formato que a tela usa. */
function normalizarLead(cru, indice) {
  if (!cru || typeof cru !== 'object') return null;

  const recebidoEm = textoOuNulo(cru.recebido_em || cru.recebidoEm || cru.criado_em);
  const marca = recebidoEm ? Date.parse(recebidoEm) : NaN;
  const marcaValida = Number.isNaN(marca) ? null : marca;

  const origemCrua = textoOuNulo(cru.origem);
  const origem = (origemCrua === 'ghl' || origemCrua === 'agente') ? origemCrua : null;

  const telefone = textoOuNulo(cru.telefone);
  const id = textoOuNulo(cru.id)
    || [textoOuNulo(cru.unidade_slug), recebidoEm, telefone, indice].join('|');

  return {
    id: String(id),
    slug: textoOuNulo(cru.unidade_slug || cru.slug),
    origem: origem,
    origemCrua: origemCrua,
    recebidoEm: recebidoEm,
    marca: marcaValida,
    tutor: textoOuNulo(cru.tutor),
    pet: textoOuNulo(cru.pet),
    interesse: textoOuNulo(cru.interesse),
    telefone: telefone,
    resumo: textoOuNulo(cru.resumo),
    textoBruto: textoOuNulo(cru.texto_bruto || cru.textoBruto),
    resposta: lerResposta(cru, marcaValida),
  };
}

/** O retorno da ação `leads`: `{ leads, disponivel, motivo }`, tolerante a variações. */
function lerRetornoDaAcao(dados) {
  if (Array.isArray(dados)) return { lista: dados, disponivel: true, motivo: null };
  if (!dados || typeof dados !== 'object') return { lista: [], disponivel: null, motivo: null };
  const lista = Array.isArray(dados.leads) ? dados.leads
    : (Array.isArray(dados.lista) ? dados.lista : []);
  const disp = (typeof dados.disponivel === 'boolean') ? dados.disponivel : null;
  return { lista: lista, disponivel: disp, motivo: textoOuNulo(dados.motivo) };
}

/* ═════════════════════════ 8. ESCOPO E MEDIÇÃO ══════════════════════════
   Quem decide se a contagem é medida ou não é a captura de grupo da unidade —
   o mesmo campo `capturando` de 3.1 que a visão geral usa para `leads_novos`.
   ════════════════════════════════════════════════════════════════════════ */

function unidadePorSlug(slug) {
  if (!slug || !contexto) return null;
  const lista = contexto.unidades || [];
  for (let i = 0; i < lista.length; i += 1) {
    if (lista[i] && lista[i].slug === slug) return lista[i];
  }
  return null;
}

function nomeDaUnidade(slug) {
  const u = unidadePorSlug(slug);
  if (u && u.nome) return u.nome;
  return slug || 'Unidade não informada';
}

/** Quantas unidades da lista já estão com a captura de grupo ligada. */
function contarCapturando() {
  if (!contexto) return { ligadas: null, total: null };
  const rede = contexto.rede;
  const lista = contexto.unidades || [];

  let ligadas = null;
  if (rede && typeof rede.unidades_capturando === 'number') ligadas = rede.unidades_capturando;
  else if (lista.length) {
    ligadas = lista.filter(function (u) { return u && u.capturando === true; }).length;
  }

  let total = null;
  if (rede && typeof rede.unidades_total === 'number') total = rede.unidades_total;
  else if (lista.length) total = lista.length;

  return { ligadas: ligadas, total: total };
}

/**
 * O escopo atual está sendo medido?
 *   true  → há captura de grupo, então 0 significa "não houve lead"
 *   false → não há captura, então a contagem é traço, nunca zero
 *   null  → a lista de unidades ainda não chegou; não afirmamos nada
 */
function escopoMedido() {
  if (!contexto) return null;
  const slug = contexto.unidadeAtual;

  if (slug) {
    const u = unidadePorSlug(slug);
    if (!u) return null;
    if (u.capturando === true) return true;
    if (u.capturando === false) return false;
    return null;
  }

  const contas = contarCapturando();
  if (contas.ligadas === null) return null;
  return contas.ligadas > 0;
}

/**
 * A contagem desta tela está sendo medida?
 * Duas coisas podem impedir: a unidade sem captura de grupo (3.1) e a própria
 * ação `leads` dizendo `disponivel: false` — por exemplo quando a tabela de
 * leads ainda não existe no banco. Em qualquer um dos casos a faixa mostra
 * traço; zero aqui seria afirmar que não entrou ninguém.
 */
function medindo() {
  /* Sem nenhuma resposta na mão não há medida nenhuma: zero aqui seria contar
     uma lista que nunca chegou. */
  if (!recebeuAlgo) return null;
  /* Vieram linhas: contá-las É medir, mesmo que o cadastro da unidade ainda
     diga que a captura está desligada. A faixa não pode mostrar traço enquanto
     a linha do tempo mostra notificações. */
  if (leads.length) return true;
  if (disponivel === false) return false;
  return escopoMedido();
}

/** O texto do título quando a contagem não é medida. */
function motivoDeNaoMedir() {
  const slug = contexto ? contexto.unidadeAtual : null;
  if (!recebeuAlgo) {
    if (ultimoErro) {
      return 'Não medimos: a consulta ao servidor falhou. ' + (ultimoErro.amigavel || '');
    }
    return 'Ainda não medimos: a primeira resposta da ação leads não chegou.';
  }
  if (disponivel === false) {
    if (motivo === 'tabela_nao_criada') {
      return 'Não medimos: o servidor respondeu que a tabela de leads ainda não existe no banco '
        + '(motivo: tabela_nao_criada), então não há onde as notificações serem gravadas.';
    }
    return 'Não medimos: a ação leads respondeu que a captura de notificações ainda não está '
      + 'disponível' + (motivo ? ' (motivo: ' + motivo + ')' : '') + '.';
  }
  const medido = escopoMedido();
  if (medido === false && slug) {
    return 'Não medimos: a captura do grupo desta unidade ainda não foi ligada, '
      + 'então nenhuma notificação chega ao painel. Zero aqui seria mentira.';
  }
  if (medido === false) {
    return 'Não medimos: nenhuma unidade da rede está com a captura de grupo ligada.';
  }
  return 'Não medimos: a lista de unidades ainda não chegou, então o painel não sabe '
    + 'se este escopo tem captura de grupo ligada.';
}

/* ═════════════════════════ 9. FILTRO E CONTAGEM ═════════════════════════ */

function periodoPorId(id) {
  for (let i = 0; i < PERIODOS.length; i += 1) {
    if (PERIODOS[i].id === id) return PERIODOS[i];
  }
  return PERIODOS[1];
}

/** Início do período escolhido, em milissegundos. */
function inicioDoPeriodo() {
  const p = periodoPorId(periodoAtual);
  if (p.dias === 0) return inicioDeHoje();
  return Date.now() - p.dias * DIA_MS;
}

/**
 * O `desde` da consulta. Nunca menor que 7 dias, porque a faixa do topo mede a
 * semana mesmo quando a linha do tempo está mostrando só hoje.
 */
function desdeDaConsulta() {
  const minimo = Date.now() - DIAS_MINIMOS_DA_CONSULTA * DIA_MS;
  const escolhido = inicioDoPeriodo();
  return new Date(Math.min(minimo, escolhido)).toISOString();
}

/** Leads dentro do período escolhido (sem os outros filtros). */
function leadsDoPeriodo() {
  const inicio = inicioDoPeriodo();
  return leads.filter(function (l) {
    if (l.marca === null) return true;  /* sem data legível: não some da tela */
    return l.marca >= inicio;
  });
}

function passaNosFiltros(l) {
  if (origemAtual !== 'todas') {
    if (origemAtual === 'sem_origem') {
      if (l.origem !== null) return false;
    } else if (l.origem !== origemAtual) return false;
  }

  if (interesseAtual !== 'todos') {
    const chave = l.interesse ? chaveDeBusca(l.interesse) : '';
    if (interesseAtual === 'sem_interesse') {
      if (chave) return false;
    } else if (chave !== interesseAtual) return false;
  }

  if (situacaoAtual !== 'todas' && l.resposta.situacao !== situacaoAtual) return false;

  if (buscaAtual) {
    const alvo = chaveDeBusca(buscaAtual);
    const digitosBusca = soDigitos(buscaAtual);
    const nome = chaveDeBusca((l.tutor || '') + ' ' + (l.pet || ''));
    const achouNome = alvo && nome.indexOf(alvo) >= 0;
    const achouTelefone = digitosBusca.length >= 3
      && soDigitos(l.telefone).indexOf(digitosBusca) >= 0;
    if (!achouNome && !achouTelefone) return false;
  }

  return true;
}

function algumFiltroLigado() {
  return origemAtual !== 'todas'
    || interesseAtual !== 'todos'
    || situacaoAtual !== 'todas'
    || !!buscaAtual;
}

/** Contagem por interesse no período, do mais pedido para o menos. */
function contarInteresses(lista) {
  const mapa = new Map();
  lista.forEach(function (l) {
    const chave = l.interesse ? chaveDeBusca(l.interesse) : 'sem_interesse';
    const rotulo = l.interesse || 'Sem interesse informado';
    const linha = mapa.get(chave) || { chave: chave, rotulo: rotulo, total: 0 };
    linha.total += 1;
    mapa.set(chave, linha);
  });
  const linhas = Array.from(mapa.values());
  linhas.sort(function (a, b) {
    if (b.total !== a.total) return b.total - a.total;
    return a.rotulo.localeCompare(b.rotulo, 'pt-BR');
  });
  return linhas;
}

/* ═════════════════════════ 10. TOPO DA TELA ═════════════════════════════ */

function montarTopo() {
  const topo = criar('div', 'ld-topo');

  const bloco = criar('div', 'ld-titulo-bloco');
  const h1 = criar('h1', 'ld-titulo');
  h1.appendChild(criar('span', null, 'Feed de Leads'));

  elNovos = criar('button', 'ld-novos');
  elNovos.type = 'button';
  elNovos.hidden = true;
  /* Nome de reserva: o contador só ganha texto quando chega lead, e um botão
     nunca pode existir sem nome acessível, nem escondido. */
  elNovos.setAttribute('aria-label', 'Leads novos desde que a tela foi aberta');
  elNovos.appendChild(icone(ICONES.cima));
  elNovosTexto = criar('span', null, '');
  elNovos.appendChild(elNovosTexto);
  elNovos.addEventListener('click', function () {
    zerarNovos();
    if (raizTela) {
      try { raizTela.scrollIntoView({ behavior: movimentoReduzido() ? 'auto' : 'smooth', block: 'start' }); }
      catch (e) { window.scrollTo(0, 0); }
    }
  });
  h1.appendChild(elNovos);
  bloco.appendChild(h1);

  elSubtitulo = criar('p', 'ld-subtitulo', '');
  bloco.appendChild(elSubtitulo);
  topo.appendChild(bloco);

  const acoes = criar('div', 'ld-acoes-topo');
  const atualizar = criar('button', 'btn', 'Atualizar agora');
  atualizar.type = 'button';
  atualizar.addEventListener('click', function () { recarregar(atualizar); });
  acoes.appendChild(atualizar);
  topo.appendChild(acoes);

  return topo;
}

/** Diz o escopo e o estado da captura em uma linha — tudo vindo de 3.1 e 3.2. */
function desenharSubtitulo() {
  if (!elSubtitulo) return;
  const base = 'As notificações que caem nos grupos de WhatsApp, com o tempo até alguém da '
    + 'unidade falar com aquele telefone — o treinamento pede o primeiro contato em até '
    + META_MIN + ' minutos. ';

  const slug = contexto ? contexto.unidadeAtual : null;
  if (!slug) {
    elSubtitulo.textContent = base + 'Escopo: toda a rede. ' + fraseDaCobertura();
    return;
  }
  const u = unidadePorSlug(slug);
  let estado;
  if (!u) estado = 'A lista de unidades ainda não chegou, então o painel não sabe se a captura está ligada.';
  else if (u.capturando === true) estado = 'Captura de grupo ligada.';
  else if (u.capturando === false) estado = 'Captura de grupo ainda não ligada.';
  else estado = 'A API não informou se a captura de grupo está ligada.';
  elSubtitulo.textContent = base + 'Escopo: ' + nomeDaUnidade(slug) + '. ' + estado;
}

function zerarNovos() {
  novos = 0;
  recemChegados.clear();
  desenharContadorDeNovos();
  desenharTempo(true);
}

function desenharContadorDeNovos() {
  if (!elNovos) return;
  if (novos <= 0) {
    elNovos.hidden = true;
    return;
  }
  elNovos.hidden = false;
  elNovosTexto.textContent = novos + ' ' + plural(novos, 'lead novo', 'leads novos');
  elNovos.setAttribute('aria-label',
    novos + ' ' + plural(novos, 'notificação nova chegou', 'notificações novas chegaram')
    + ' desde que você abriu esta tela. Ir para o topo da lista.');
  elNovos.title = 'Chegaram com a tela aberta. Clique para voltar ao topo e limpar a marcação.';
}

/* ═════════════════════════ 11. FAIXA DE NÚMEROS ═════════════════════════ */

function montarResumo() {
  const caixa = criar('div', 'ld-resumo');
  caixa.appendChild(montarCartaoNumeros());
  caixa.appendChild(montarCartaoOrigens());
  caixa.appendChild(montarCartaoInteresses());
  return caixa;
}

function metricaCompacta(rotulo, chave) {
  const caixa = criar('div', 'metrica compacta');
  const valor = criar('span', 'metrica-valor numero', TRACINHO);
  caixa.appendChild(valor);
  caixa.appendChild(criar('span', 'metrica-rotulo', rotulo));
  return { caixa: caixa, valor: valor, chave: chave };
}

function montarCartaoNumeros() {
  const carta = criar('div', 'carta ld-bloco ld-cartao-numeros');
  const titulo = criar('div', 'ld-bloco-titulo');
  titulo.appendChild(icone(ICONES.grupo));
  titulo.appendChild(criar('span', null, 'Números do período'));
  carta.appendChild(titulo);

  const linha = criar('div', 'ld-numeros');
  refsNumeros = {
    hoje: metricaCompacta('Leads hoje', 'hoje'),
    semana: metricaCompacta('Em 7 dias', 'semana'),
    ate5: metricaCompacta('Contato até 5 min', 'ate5'),
  };
  linha.appendChild(refsNumeros.hoje.caixa);
  linha.appendChild(criar('hr', 'separador vertical'));
  linha.appendChild(refsNumeros.semana.caixa);
  linha.appendChild(criar('hr', 'separador vertical'));
  linha.appendChild(refsNumeros.ate5.caixa);
  carta.appendChild(linha);

  return carta;
}

function linhaDeBarra(rotulo, tom) {
  const caixa = criar('div', 'ld-linha-barra');
  const topo = criar('div', 'ld-linha-topo');
  const nome = criar('span', 'ld-linha-nome', rotulo);
  topo.appendChild(nome);
  const parte = criar('span', 'ld-linha-parte', '');
  topo.appendChild(parte);
  const valor = criar('span', 'ld-linha-valor numero', TRACINHO);
  topo.appendChild(valor);
  caixa.appendChild(topo);

  const barra = criar('div', 'barra');
  barra.setAttribute('role', 'img');
  const preenchida = criar('span', 'barra-preenchida');
  if (tom) preenchida.dataset.tom = tom;
  barra.appendChild(preenchida);
  caixa.appendChild(barra);

  return { caixa: caixa, nome: nome, valor: valor, parte: parte, barra: barra, preenchida: preenchida };
}

function montarCartaoOrigens() {
  const carta = criar('div', 'carta ld-bloco');
  const titulo = criar('div', 'ld-bloco-titulo');
  titulo.appendChild(icone(ICONES.etiqueta));
  titulo.appendChild(criar('span', null, 'Por origem'));
  carta.appendChild(titulo);

  const linhas = criar('div', 'ld-linhas');
  refsOrigens = {
    ghl: linhaDeBarra('GoHighLevel', null),
    agente: linhaDeBarra('Agente de IA → recepção', 'ouro'),
  };
  refsOrigens.ghl.caixa.title = ORIGENS[0].explicacao;
  refsOrigens.agente.caixa.title = ORIGENS[1].explicacao;
  linhas.appendChild(refsOrigens.ghl.caixa);
  linhas.appendChild(refsOrigens.agente.caixa);
  carta.appendChild(linhas);

  return carta;
}

function montarCartaoInteresses() {
  const carta = criar('div', 'carta ld-bloco');
  const titulo = criar('div', 'ld-bloco-titulo');
  titulo.appendChild(icone(ICONES.etiqueta));
  titulo.appendChild(criar('span', null, 'Interesses mais pedidos'));
  carta.appendChild(titulo);

  elInteresses = criar('div', 'ld-linhas');
  carta.appendChild(elInteresses);
  return carta;
}

/** Desenha a faixa inteira a partir das linhas que a API devolveu. */
function desenharResumo() {
  const medido = medindo();
  const doPeriodo = leadsDoPeriodo();

  /* Leads de hoje e dos últimos 7 dias saem sempre da janela consultada, não do
     período escolhido: a faixa é o retrato do movimento, a linha do tempo é a
     leitura detalhada. */
  const comecoDeHoje = inicioDeHoje();
  const comecoDaSemana = Date.now() - 7 * DIA_MS;
  const comData = leads.filter(function (l) { return l.marca !== null; });

  const hoje = medido === true ? comData.filter(function (l) { return l.marca >= comecoDeHoje; }).length : null;
  const semana = medido === true ? comData.filter(function (l) { return l.marca >= comecoDaSemana; }).length : null;

  definirNumero(refsNumeros.hoje, hoje, function (v) { return formatarNumero(v); },
    motivoDeNaoMedir(),
    'Notificações recebidas desde as 00h de hoje, no escopo escolhido.');
  definirNumero(refsNumeros.semana, semana, function (v) { return formatarNumero(v); },
    motivoDeNaoMedir(),
    'Notificações recebidas nos últimos 7 dias, no escopo escolhido.');

  /* Contato em até 5 min: só sobre os leads em que o cruzamento foi medido.
     Sem nenhum medido, é traço — não 0%. */
  const medidos = doPeriodo.filter(function (l) { return l.resposta.medido; });
  const rapidos = medidos.filter(function (l) { return l.resposta.situacao === 'rapido'; }).length;
  const percentual = medidos.length ? Math.round(100 * rapidos / medidos.length) : null;

  definirNumero(refsNumeros.ate5, percentual, function (v) { return formatarPorcentagem(v); },
    medido === true
      ? 'Não medimos: a ação leads não devolveu o cruzamento com as conversas, então o painel '
        + 'não afirma em quanto tempo os leads foram atendidos.'
      : motivoDeNaoMedir(),
    rapidos + ' de ' + medidos.length + ' leads medidos tiveram contato em até '
      + META_MIN + ' minutos — a meta do treinamento da rede.');

  desenharOrigens(doPeriodo, medido);
  desenharInteresses(doPeriodo, medido);
  desenharRodape(doPeriodo, medido);
}

function desenharOrigens(lista, medido) {
  const total = lista.length;
  const contas = {
    ghl: lista.filter(function (l) { return l.origem === 'ghl'; }).length,
    agente: lista.filter(function (l) { return l.origem === 'agente'; }).length,
  };
  const semOrigem = total - contas.ghl - contas.agente;

  ['ghl', 'agente'].forEach(function (id) {
    const refs = refsOrigens[id];
    const valor = medido === true ? contas[id] : null;
    if (valor === null) {
      refs.valor.textContent = TRACINHO;
      refs.parte.textContent = '';
      refs.barra.classList.add('sem-medida');
      refs.barra.setAttribute('aria-label', refs.nome.textContent + ': sem medida');
      return;
    }
    refs.barra.classList.remove('sem-medida');
    refs.valor.textContent = formatarNumero(valor);
    const parte = total ? Math.round(100 * valor / total) : 0;
    refs.parte.textContent = total ? parte + '%' : '';
    refs.preenchida.style.width = (total ? parte : 0) + '%';
    refs.barra.setAttribute('aria-label',
      refs.nome.textContent + ': ' + valor + ' ' + plural(valor, 'lead', 'leads')
      + (total ? ', ' + parte + '% do período' : ''));
  });

  /* Origem fora dos dois formatos do contrato existe? A tela diz, em vez de
     encaixar a linha num dos dois. */
  const jaTem = refsOrigens.agente.caixa.parentNode
    ? refsOrigens.agente.caixa.parentNode.querySelector('.ld-origem-outra') : null;
  if (jaTem) jaTem.remove();
  if (medido === true && semOrigem > 0) {
    const nota = criar('p', 'ld-origem-outra ld-linha-parte',
      semOrigem + ' ' + plural(semOrigem, 'notificação chegou', 'notificações chegaram')
      + ' sem o campo origem preenchido.');
    refsOrigens.agente.caixa.parentNode.appendChild(nota);
  }
}

function desenharInteresses(lista, medido) {
  if (!elInteresses) return;
  elInteresses.textContent = '';

  if (medido !== true) {
    const vazio = criar('p', 'ld-linha-parte', motivoDeNaoMedir());
    elInteresses.appendChild(vazio);
    return;
  }
  if (!lista.length) {
    elInteresses.appendChild(criar('p', 'ld-linha-parte',
      'Nenhuma notificação no período — não há interesse para ordenar.'));
    return;
  }

  const linhas = contarInteresses(lista);
  const maior = linhas.length ? linhas[0].total : 0;
  const mostradas = linhas.slice(0, TETO_DE_INTERESSES);
  const resto = linhas.slice(TETO_DE_INTERESSES);

  mostradas.forEach(function (linha) {
    const refs = linhaDeBarra(linha.rotulo, null);
    refs.valor.textContent = formatarNumero(linha.total);
    const parte = lista.length ? Math.round(100 * linha.total / lista.length) : 0;
    refs.parte.textContent = parte + '%';
    refs.preenchida.style.width = (maior ? Math.round(100 * linha.total / maior) : 0) + '%';
    refs.barra.setAttribute('aria-label',
      linha.rotulo + ': ' + linha.total + ' ' + plural(linha.total, 'lead', 'leads')
      + ', ' + parte + '% do período');
    refs.nome.title = linha.rotulo;
    elInteresses.appendChild(refs.caixa);
  });

  if (resto.length) {
    const soma = resto.reduce(function (s, l) { return s + l.total; }, 0);
    elInteresses.appendChild(criar('p', 'ld-linha-parte',
      'Mais ' + resto.length + ' ' + plural(resto.length, 'interesse', 'interesses')
      + ' com ' + soma + ' ' + plural(soma, 'lead', 'leads') + ' no período.'));
  }
}

/* ═════════════════════════ 12. FILTROS ══════════════════════════════════ */

function campoSelect(rotulo, aoMudar) {
  const campo = criar('label', 'campo ld-filtro');
  campo.appendChild(criar('span', 'campo-rotulo', rotulo));
  const select = criar('select');
  select.addEventListener('change', aoMudar);
  campo.appendChild(select);
  return { campo: campo, select: select };
}

function opcao(select, valor, rotulo, escolhido) {
  const op = criar('option', null, rotulo);
  op.value = valor;
  if (escolhido) op.selected = true;
  select.appendChild(op);
  return op;
}

function montarFiltros() {
  const caixa = criar('div', 'ld-filtros');
  caixa.setAttribute('role', 'group');
  caixa.setAttribute('aria-label', 'Filtros do feed de leads');

  const unidade = campoSelect('Unidade', function (e) {
    const valor = e.target.value || null;
    if (contexto && typeof contexto.trocarUnidade === 'function') contexto.trocarUnidade(valor);
  });
  elSelUnidade = unidade.select;
  caixa.appendChild(unidade.campo);

  const periodo = campoSelect('Período', function (e) {
    periodoAtual = e.target.value;
    assinar();
    desenharTudo();
  });
  elSelPeriodo = periodo.select;
  PERIODOS.forEach(function (p) { opcao(elSelPeriodo, p.id, p.rotulo, p.id === periodoAtual); });
  caixa.appendChild(periodo.campo);

  const origem = campoSelect('Origem', function (e) {
    origemAtual = e.target.value;
    desenharLista();
  });
  elSelOrigem = origem.select;
  caixa.appendChild(origem.campo);

  const interesse = campoSelect('Interesse', function (e) {
    interesseAtual = e.target.value;
    desenharLista();
  });
  elSelInteresse = interesse.select;
  caixa.appendChild(interesse.campo);

  const situacao = campoSelect('Resposta', function (e) {
    situacaoAtual = e.target.value;
    desenharLista();
  });
  elSelSituacao = situacao.select;
  opcao(elSelSituacao, 'todas', 'Todas', situacaoAtual === 'todas');
  opcao(elSelSituacao, 'rapido', 'Até 5 min', situacaoAtual === 'rapido');
  opcao(elSelSituacao, 'tarde', 'Depois de 5 min', situacaoAtual === 'tarde');
  opcao(elSelSituacao, 'sem_resposta', 'Sem resposta', situacaoAtual === 'sem_resposta');
  opcao(elSelSituacao, 'nao_medido', 'Não medido', situacaoAtual === 'nao_medido');
  caixa.appendChild(situacao.campo);

  const busca = criar('label', 'campo ld-filtro ld-busca');
  busca.appendChild(criar('span', 'campo-rotulo', 'Buscar'));
  const linha = criar('div', 'ld-busca-caixa');
  linha.appendChild(icone(ICONES.busca));
  elBusca = criar('input');
  elBusca.type = 'search';
  elBusca.value = buscaAtual;
  elBusca.placeholder = 'Nome do tutor, do pet ou telefone';
  elBusca.setAttribute('aria-label', 'Buscar por nome do tutor, nome do pet ou telefone');
  elBusca.autocomplete = 'off';
  elBusca.addEventListener('input', function (e) {
    const valor = e.target.value;
    if (temporizadorBusca) clearTimeout(temporizadorBusca);
    temporizadorBusca = setTimeout(function () {
      temporizadorBusca = 0;
      buscaAtual = valor.trim();
      desenharLista();
    }, 160);
  });
  linha.appendChild(elBusca);
  busca.appendChild(linha);
  caixa.appendChild(busca);

  return caixa;
}

/** Opções de unidade, origem e interesse saem SEMPRE do que a API devolveu. */
function desenharFiltros() {
  if (elSelUnidade) {
    const escolhido = (contexto && contexto.unidadeAtual) || '';
    elSelUnidade.textContent = '';
    opcao(elSelUnidade, '', 'Toda a rede', !escolhido);
    const lista = (contexto && contexto.unidades) ? contexto.unidades : [];
    lista.forEach(function (u) {
      if (!u || !u.slug) return;
      opcao(elSelUnidade, u.slug, u.nome || u.slug, u.slug === escolhido);
    });
    if (escolhido && !unidadePorSlug(escolhido)) {
      const solta = opcao(elSelUnidade, escolhido, escolhido + ' (fora da lista da API)', true);
      solta.title = 'A ação visao_geral não devolveu esta unidade.';
    }
  }

  if (elSelOrigem) {
    elSelOrigem.textContent = '';
    opcao(elSelOrigem, 'todas', 'Todas as origens', origemAtual === 'todas');
    ORIGENS.forEach(function (o) {
      opcao(elSelOrigem, o.id, o.rotulo, o.id === origemAtual);
    });
    const temSemOrigem = leads.some(function (l) { return l.origem === null; });
    if (temSemOrigem || origemAtual === 'sem_origem') {
      opcao(elSelOrigem, 'sem_origem', 'Origem não informada', origemAtual === 'sem_origem');
    }
    if (!elSelOrigem.value) elSelOrigem.value = 'todas';
  }

  if (elSelInteresse) {
    const linhas = contarInteresses(leadsDoPeriodo());
    elSelInteresse.textContent = '';
    opcao(elSelInteresse, 'todos', 'Todos os interesses', interesseAtual === 'todos');
    let achou = interesseAtual === 'todos';
    linhas.forEach(function (linha) {
      const escolhido = linha.chave === interesseAtual;
      if (escolhido) achou = true;
      opcao(elSelInteresse, linha.chave, linha.rotulo + ' (' + linha.total + ')', escolhido);
    });
    if (!achou) {
      /* O interesse escolhido sumiu do período: a opção continua, para o usuário
         entender que o filtro está ligado, em vez de a lista zerar sem motivo. */
      const solta = opcao(elSelInteresse, interesseAtual, 'Filtro sem leads no período', true);
      solta.title = 'Nenhum lead do período tem este interesse.';
    }
  }
}

function montarBarraInferior() {
  const caixa = criar('div', 'ld-barra-inferior');

  elContagem = criar('p', 'ld-contagem');
  elContagem.setAttribute('role', 'status');
  caixa.appendChild(elContagem);

  elLimpar = criar('button', 'btn btn-fantasma ld-limpar', 'Limpar filtros');
  elLimpar.type = 'button';
  elLimpar.hidden = true;
  elLimpar.addEventListener('click', function () {
    origemAtual = 'todas';
    interesseAtual = 'todos';
    situacaoAtual = 'todas';
    buscaAtual = '';
    if (elBusca) elBusca.value = '';
    if (elSelSituacao) elSelSituacao.value = 'todas';
    desenharFiltros();
    desenharLista();
    anunciar('Filtros limpos.');
  });
  caixa.appendChild(elLimpar);

  elLegenda = criar('div', 'ld-legenda empurra');
  caixa.appendChild(elLegenda);
  desenharLegenda();

  return caixa;
}

function desenharLegenda() {
  if (!elLegenda) return;
  elLegenda.textContent = '';
  const pares = [
    { classe: 'selo-ok', texto: 'até 5 min' },
    { classe: 'selo-atencao', texto: 'depois de 5 min' },
    { classe: 'selo-risco', texto: 'sem resposta' },
    { classe: 'selo-neutro', texto: 'não medido' },
  ];
  pares.forEach(function (p) {
    const item = criar('span', 'ld-legenda-item');
    const bolinha = criar('span', 'selo ' + p.classe + ' ld-legenda-bolinha');
    bolinha.setAttribute('aria-hidden', 'true');
    item.appendChild(bolinha);
    item.appendChild(criar('span', null, p.texto));
    elLegenda.appendChild(item);
  });
  elLegenda.title = 'O treinamento da rede pede o primeiro contato em até '
    + META_MIN + ' minutos depois da notificação.';
}

/* ═════════════════════════ 13. LINHA DO TEMPO ═══════════════════════════ */

/** Selo da origem: o da IA carrega o ícone de robô e o rótulo da passagem. */
function seloDeOrigem(l) {
  if (l.origem === 'agente') {
    const selo = criar('span', 'selo sem-ponto ld-selo-origem ld-selo-ia');
    selo.appendChild(icone(ICONES.robo));
    selo.appendChild(criar('span', null, 'IA → recepção'));
    selo.title = ORIGENS[1].explicacao;
    return selo;
  }
  if (l.origem === 'ghl') {
    const selo = criar('span', 'selo selo-neutro sem-ponto ld-selo-origem');
    selo.appendChild(icone(ICONES.etiqueta));
    selo.appendChild(criar('span', null, 'GoHighLevel'));
    selo.title = ORIGENS[0].explicacao;
    return selo;
  }
  const selo = criar('span', 'selo selo-neutro', 'Origem não informada');
  selo.title = l.origemCrua
    ? 'A notificação veio com origem "' + l.origemCrua + '", fora dos dois formatos do contrato.'
    : 'A linha chegou sem o campo origem. O painel não adivinha de qual grupo ela veio.';
  return selo;
}

/** Texto e título do selo de resposta. Recalculado pelo relógio da tela. */
function textoDaSituacao(l) {
  const r = l.resposta;
  if (r.situacao === 'nao_medido') {
    return {
      texto: 'Resposta não medida',
      titulo: 'A ação leads não devolveu o cruzamento com as conversas desta unidade. '
        + 'O painel não afirma que ninguém respondeu — só que não mediu.',
    };
  }
  if (r.situacao === 'sem_resposta') {
    const decorrido = l.marca !== null ? Math.max(0, (Date.now() - l.marca) / 60000) : null;
    return {
      texto: decorrido === null ? 'Sem resposta' : 'Sem resposta há ' + formatarMinutos(decorrido),
      titulo: 'Nenhuma mensagem da unidade para este telefone depois da notificação, '
        + 'até a última leitura. O treinamento pede contato em até ' + META_MIN + ' minutos.',
    };
  }
  const tempo = r.minutos !== null ? formatarMinutos(r.minutos) : null;
  const quando = r.respondidoEm ? formatarQuando(r.respondidoEm) : null;
  const complemento = (r.autor ? ' Quem respondeu: ' + r.autor + '.' : '');
  if (r.situacao === 'rapido') {
    return {
      texto: tempo ? 'Respondido em ' + tempo : 'Respondido',
      titulo: 'A unidade falou com este telefone'
        + (tempo ? ' ' + tempo + ' depois' : '') + (quando ? ' (' + quando + ')' : '')
        + ' — dentro dos ' + META_MIN + ' minutos que o treinamento pede.' + complemento,
    };
  }
  return {
    texto: tempo ? 'Respondido em ' + tempo : 'Respondido',
    titulo: 'A unidade falou com este telefone'
      + (tempo ? ' ' + tempo + ' depois' : '') + (quando ? ' (' + quando + ')' : '')
      + ' — acima dos ' + META_MIN + ' minutos que o treinamento pede. O indicador aqui é o '
      + 'tempo até o primeiro contato, não o resultado da conversa.' + complemento,
  };
}

function dadoDaLinha(iconeSvg, valor, rotuloAcessivel, tituloSemDado) {
  const caixa = criar('span', 'ld-dado');
  caixa.appendChild(icone(iconeSvg));
  const texto = criar('span', null, valor || '—');
  caixa.appendChild(texto);
  if (!valor) {
    caixa.classList.add('ld-sem-dado');
    caixa.title = tituloSemDado || 'A notificação chegou sem este campo.';
  } else {
    caixa.title = rotuloAcessivel + ': ' + valor;
  }
  return caixa;
}

/**
 * O telefone da notificação, formatado. Fica como texto: quem abre a conversa é
 * o botão do rodapé do item, que tem os 44px de alvo de toque.
 */
function blocoTelefone(l) {
  const caixa = criar('span', 'ld-dado');
  caixa.appendChild(icone(ICONES.telefone));
  if (!l.telefone) {
    caixa.appendChild(criar('span', null, '—'));
    caixa.classList.add('ld-sem-dado');
    caixa.title = 'A notificação chegou sem telefone. Sem ele não dá para cruzar com as conversas.';
    return caixa;
  }
  const bonito = formatarTelefone(l.telefone);
  caixa.appendChild(criar('span', null, bonito));
  caixa.title = 'Telefone da notificação: ' + bonito;
  return caixa;
}

/** Número em formato internacional para o link do WhatsApp, ou null. */
function digitosDoWhatsapp(telefone) {
  let digitos = soDigitos(telefone);
  if (!digitos) return null;
  if (digitos.length === 10 || digitos.length === 11) digitos = '55' + digitos;
  return digitos.length >= 12 ? digitos : null;
}

function montarItem(l) {
  const item = criar('li', 'ld-item');
  item.dataset.origem = l.origem || 'nao_informada';
  item.dataset.situacao = l.resposta.situacao;
  item.dataset.lead = l.id;
  item.tabIndex = -1;

  const novo = recemChegados.has(l.id);
  if (novo && !jaAnimados.has(l.id)) {
    item.classList.add('ld-chegou');
    jaAnimados.add(l.id);
    const espera = setTimeout(function () {
      esperas.delete(espera);
      if (item.isConnected) item.classList.remove('ld-chegou');
    }, DURACAO_CHEGADA_MS);
    esperas.add(espera);
  }

  /* Hora */
  const hora = criar('div', 'ld-hora');
  const horaValor = criar('span', 'ld-hora-valor', l.marca !== null ? horaDoDia(l.marca) : TRACINHO);
  if (l.marca === null) horaValor.title = 'A linha chegou sem data legível em recebido_em.';
  hora.appendChild(horaValor);
  const horaRel = criar('span', 'ld-hora-rel', l.marca !== null ? desdeQuando(l.marca) : '');
  hora.appendChild(horaRel);
  item.appendChild(hora);

  /* Corpo */
  const corpo = criar('div', 'ld-corpo');

  const cabeca = criar('div', 'ld-cabeca');
  const tutor = criar('span', 'ld-tutor', l.tutor || 'Tutor não informado');
  if (!l.tutor) tutor.title = 'A notificação chegou sem o nome do tutor.';
  cabeca.appendChild(tutor);

  if (novo) {
    const seloNovo = criar('span', 'selo sem-ponto ld-selo-novo', 'Novo');
    seloNovo.title = 'Chegou depois que você abriu esta tela.';
    cabeca.appendChild(seloNovo);
  }

  cabeca.appendChild(seloDeOrigem(l));

  const situacao = textoDaSituacao(l);
  const seloSituacao = criar('span', 'selo ' + SITUACOES[l.resposta.situacao].classe, situacao.texto);
  seloSituacao.title = situacao.titulo;
  cabeca.appendChild(seloSituacao);
  corpo.appendChild(cabeca);

  /* Dados */
  const dados = criar('div', 'ld-dados');
  if (!contexto.unidadeAtual) {
    dados.appendChild(dadoDaLinha(ICONES.grupo, nomeDaUnidade(l.slug), 'Unidade',
      'A linha chegou sem unidade_slug.'));
  }
  dados.appendChild(dadoDaLinha(ICONES.pet, l.pet, 'Pet',
    'A notificação chegou sem o nome do pet.'));
  dados.appendChild(dadoDaLinha(ICONES.etiqueta, l.interesse, 'Interesse',
    'A notificação chegou sem o interesse.'));
  dados.appendChild(blocoTelefone(l));
  corpo.appendChild(dados);

  /* Resumo do agente: só existe no formato da IA. */
  if (l.origem === 'agente' && l.resumo) {
    const caixa = criar('div', 'ld-resumo-ia');
    caixa.appendChild(icone(ICONES.robo));
    const texto = criar('div');
    texto.appendChild(criar('b', null, 'Resumo da IA na passagem'));
    texto.appendChild(criar('span', null, l.resumo));
    caixa.appendChild(texto);
    corpo.appendChild(caixa);
  } else if (l.origem === 'agente' && !l.resumo) {
    const caixa = criar('div', 'ld-resumo-ia');
    caixa.appendChild(icone(ICONES.robo));
    const texto = criar('div');
    texto.appendChild(criar('b', null, 'Resumo da IA na passagem'));
    texto.appendChild(criar('span', 'texto-3',
      'A notificação desta passagem chegou sem o campo Resumo.'));
    caixa.appendChild(texto);
    corpo.appendChild(caixa);
  }

  /* Rodapé do item */
  const rodape = criar('div', 'ld-rodape-item');
  const whats = digitosDoWhatsapp(l.telefone);
  if (whats) {
    const abrir = criar('a', 'btn');
    abrir.appendChild(icone(ICONES.telefone));
    abrir.appendChild(criar('span', null, 'Falar no WhatsApp'));
    abrir.href = 'https://wa.me/' + whats;
    abrir.target = '_blank';
    abrir.rel = 'noopener noreferrer';
    abrir.title = 'Abre a conversa com ' + formatarTelefone(l.telefone) + ' no WhatsApp.';
    rodape.appendChild(abrir);
  }
  if (l.slug) {
    const irWhats = criar('button', 'btn btn-fantasma', 'Abrir conversas da unidade');
    irWhats.type = 'button';
    irWhats.title = 'Abre a aba WhatsApp de ' + nomeDaUnidade(l.slug)
      + '. Lá a busca aceita o telefone deste lead.';
    irWhats.addEventListener('click', function () {
      if (contexto && typeof contexto.irPara === 'function') contexto.irPara('whatsapp', l.slug);
    });
    rodape.appendChild(irWhats);
  }
  if (l.textoBruto) {
    const bruto = criar('details', 'ld-bruto');
    const resumo = criar('summary', null, 'Ver a notificação original');
    bruto.appendChild(resumo);
    const pre = criar('pre', null, l.textoBruto);
    bruto.appendChild(pre);
    rodape.appendChild(bruto);
  }
  if (rodape.childNodes.length) corpo.appendChild(rodape);

  item.appendChild(corpo);

  itens.set(l.id, { no: item, horaRel: horaRel, selo: seloSituacao, lead: l });
  return item;
}

/**
 * Assinatura do que está desenhado: evita reconstruir a lista sem necessidade.
 * Entram também os filtros e o estado da captura, porque duas listas vazias por
 * motivos diferentes precisam de textos diferentes na tela.
 */
function assinaturaDaLista(lista) {
  const partes = [];
  for (let i = 0; i < lista.length; i += 1) {
    const l = lista[i];
    partes.push(l.id + ':' + l.resposta.situacao + ':' + (recemChegados.has(l.id) ? '1' : '0'));
  }
  return [
    String(contexto && contexto.unidadeAtual),
    periodoAtual,
    origemAtual,
    interesseAtual,
    situacaoAtual,
    buscaAtual,
    String(disponivel),
    String(recebeuAlgo),
    String(medindo()),
    partes.join(','),
  ].join('|');
}

/** Desenha a linha do tempo inteira, agrupada por dia. */
function desenharTempo(forcar) {
  if (!elTempo) return;

  const visiveis = leadsDoPeriodo().filter(passaNosFiltros);
  const assinatura = assinaturaDaLista(visiveis);
  if (!forcar && assinatura === assinaturaDesenhada) {
    reescreverTemporais();
    return;
  }
  assinaturaDesenhada = assinatura;

  /* Quem estava com o foco na lista continua com ele depois da reconstrução. */
  const focado = document.activeElement;
  const idFocado = (focado && focado.closest) ? (function () {
    const dono = focado.closest('.ld-item');
    return dono ? dono.dataset.lead : null;
  })() : null;

  itens.clear();
  elTempo.textContent = '';

  if (!visiveis.length) {
    desenharEstadoDaLista();
    return;
  }
  limparEstado();

  /* Do mais novo para o mais antigo; linha sem data legível vai para o fim. */
  const ordenados = visiveis.slice().sort(function (a, b) {
    if (a.marca === null && b.marca === null) return 0;
    if (a.marca === null) return 1;
    if (b.marca === null) return -1;
    return b.marca - a.marca;
  });

  let chaveAtual = null;
  let lista = null;

  ordenados.forEach(function (l) {
    const chave = l.marca !== null ? chaveDoDia(l.marca) : 'sem-data';
    if (chave !== chaveAtual) {
      chaveAtual = chave;
      const cabecalho = criar('div', 'ld-dia');
      if (l.marca !== null) {
        cabecalho.appendChild(criar('span', 'ld-dia-nome', rotuloDoDia(l.marca)));
        const rotulo = rotuloDoDia(l.marca);
        const data = new Date(l.marca);
        const completa = doisDigitos(data.getDate()) + '/' + doisDigitos(data.getMonth() + 1)
          + '/' + data.getFullYear();
        cabecalho.appendChild(criar('span', 'ld-dia-data',
          (rotulo === 'Hoje' || rotulo === 'Ontem' ? completa + ' · ' : '')
          + nomeDoDiaDaSemana(l.marca)));
      } else {
        const nome = criar('span', 'ld-dia-nome', 'Sem data legível');
        nome.title = 'A linha chegou com recebido_em vazio ou fora do padrão ISO.';
        cabecalho.appendChild(nome);
      }
      const contagem = criar('span', 'ld-dia-contagem', '');
      cabecalho.appendChild(contagem);
      cabecalho.dataset.dia = chave;
      elTempo.appendChild(cabecalho);

      lista = criar('ul', 'ld-lista');
      lista.dataset.dia = chave;
      elTempo.appendChild(lista);
    }
    lista.appendChild(montarItem(l));
  });

  /* A contagem de cada dia sai da lista já montada — nada é estimado. */
  const cabecalhos = elTempo.querySelectorAll('.ld-dia');
  for (let i = 0; i < cabecalhos.length; i += 1) {
    const chave = cabecalhos[i].dataset.dia;
    const alvo = elTempo.querySelector('.ld-lista[data-dia="' + chave + '"]');
    const total = alvo ? alvo.childNodes.length : 0;
    const marcador = cabecalhos[i].querySelector('.ld-dia-contagem');
    if (marcador) marcador.textContent = total + ' ' + plural(total, 'lead', 'leads');
  }

  if (idFocado && itens.has(idFocado)) {
    try { itens.get(idFocado).no.focus({ preventScroll: true }); } catch (e) { /* segue */ }
  }
}

/** Contagem embaixo dos filtros: quanto está visível de quanto veio. */
function desenharContagem() {
  if (!elContagem) return;
  const doPeriodo = leadsDoPeriodo();
  const visiveis = doPeriodo.filter(passaNosFiltros);
  const periodo = periodoPorId(periodoAtual).rotulo.toLowerCase();

  elContagem.textContent = '';
  if (medindo() !== true && !doPeriodo.length) {
    elContagem.textContent = '';
    if (elLimpar) elLimpar.hidden = !algumFiltroLigado();
    return;
  }

  const b = criar('b', null, formatarNumero(visiveis.length));
  elContagem.appendChild(b);

  /* Linha sem data legível entra em qualquer período, então ela é declarada:
     senão a contagem aqui brigaria com o "leads hoje" da faixa. */
  const semData = visiveis.filter(function (l) { return l.marca === null; }).length;
  elContagem.appendChild(document.createTextNode(
    ' ' + plural(visiveis.length, 'lead', 'leads')
    + (visiveis.length === doPeriodo.length ? '' : ' de ' + formatarNumero(doPeriodo.length))
    + ' · ' + periodo
    + (semData ? ' · ' + semData + ' sem data legível' : '')));

  if (elLimpar) elLimpar.hidden = !algumFiltroLigado();
}

/* ═════════════════════════ 14. ESTADOS DA TELA ══════════════════════════ */

function limparEstado() {
  if (elEstado) elEstado.textContent = '';
}

function mostrarEsqueleto() {
  if (!elEstado) return;
  elEstado.textContent = '';
  const aviso = criar('span', 'sr-apenas', 'Carregando as notificações de lead…');
  elEstado.appendChild(aviso);
  for (let i = 0; i < 4; i += 1) {
    const linha = criar('div', 'ld-esqueleto');
    linha.appendChild(criar('span', 'esqueleto linha ld-esqueleto-hora'));
    const coluna = criar('div', 'pilha espaco-8 cresce');
    coluna.appendChild(criar('span', 'esqueleto linha'));
    coluna.appendChild(criar('span', 'esqueleto linha'));
    linha.appendChild(coluna);
    elEstado.appendChild(linha);
  }
}

function blocoVazio(titulo, paragrafos, comBotao) {
  const caixa = criar('div', 'vazio');
  caixa.appendChild(icone(ICONES.grupo, 'vazio-icone'));
  caixa.appendChild(criar('p', 'vazio-titulo', titulo));
  paragrafos.forEach(function (texto) {
    caixa.appendChild(criar('p', 'vazio-texto', texto));
  });
  if (comBotao) caixa.appendChild(botaoTentarDeNovo());
  return caixa;
}

/** Quantas unidades já estão com a captura ligada — número real, nunca estimado. */
function fraseDaCobertura() {
  const contas = contarCapturando();
  if (contas.ligadas === null) {
    return 'O painel ainda não sabe quantas unidades estão com a captura ligada: '
      + 'a ação visao_geral não respondeu nesta sessão.';
  }
  if (contas.total === null) {
    return contas.ligadas + ' ' + plural(contas.ligadas, 'unidade já está', 'unidades já estão')
      + ' com a captura de grupo ligada.';
  }
  return contas.ligadas + ' de ' + contas.total + ' unidades já '
    + plural(contas.ligadas, 'está', 'estão') + ' com a captura de grupo ligada.';
}

/** O estado vazio principal: explica o que é a captura de grupo e o que falta. */
function mostrarEstadoSemCaptura() {
  if (!elEstado) return;
  elEstado.textContent = '';
  const slug = contexto ? contexto.unidadeAtual : null;

  const paragrafos = [
    'As notificações de lead não chegam pelo atendimento: elas caem em um GRUPO de '
    + 'WhatsApp — o cadastro do GoHighLevel avisa no grupo de leads, e o agente de IA avisa '
    + 'no grupo da recepção quando termina a triagem.',
    'A captura é ligada uma unidade por vez: a instância precisa entregar as mensagens de '
    + 'grupo, e o grupo daquela unidade precisa estar apontado na ingestão. Enquanto isso não '
    + 'existe, este feed fica vazio de propósito — nenhum lead de exemplo é desenhado aqui.',
    fraseDaCobertura(),
  ];
  if (motivo === 'tabela_nao_criada') {
    paragrafos.push('O servidor respondeu que a tabela de leads ainda não existe no banco '
      + '(motivo: tabela_nao_criada). Ela é criada por banco/01-leads.sql; sem a tabela, nem as '
      + 'notificações já capturadas têm onde ser gravadas.');
  }
  let titulo;
  if (motivo === 'tabela_nao_criada') titulo = 'A tabela de leads ainda não existe no banco';
  else if (slug) titulo = 'A captura de grupo de ' + nomeDaUnidade(slug) + ' ainda não está ligada';
  else titulo = 'A captura de grupo ainda não está ligada';

  elEstado.appendChild(blocoVazio(titulo, paragrafos, true));
}

/** Houve captura, o período só não teve notificação. */
function mostrarEstadoSemLeads() {
  if (!elEstado) return;
  elEstado.textContent = '';
  elEstado.appendChild(blocoVazio(
    'Nenhuma notificação ' + periodoPorId(periodoAtual).frase,
    [
      'A consulta respondeu — o período escolhido é que não teve notificação. Este zero é '
      + 'medida, não falta de dado.',
      'Troque o período no filtro acima para olhar uma janela maior.',
    ],
    false
  ));
}

/** Os filtros zeraram a lista. */
function mostrarEstadoSemFiltro() {
  if (!elEstado) return;
  elEstado.textContent = '';
  const caixa = blocoVazio(
    'Nenhum lead com esses filtros',
    ['Há notificações no período, mas nenhuma passa pela combinação de origem, interesse, '
      + 'situação de resposta e busca que está ligada agora.'],
    false
  );
  const botao = criar('button', 'btn btn-primario', 'Limpar filtros');
  botao.type = 'button';
  botao.addEventListener('click', function () { if (elLimpar) elLimpar.click(); });
  caixa.appendChild(botao);
  elEstado.appendChild(caixa);
}

function mostrarEstadoDeErro(erro) {
  if (!elEstado) return;
  elEstado.textContent = '';
  const caixa = criar('div', 'vazio');
  caixa.appendChild(icone(ICONES.atencao, 'vazio-icone'));
  caixa.appendChild(criar('p', 'vazio-titulo', 'Não consegui carregar o feed de leads'));
  caixa.appendChild(criar('p', 'vazio-texto', (erro && erro.amigavel) || 'A consulta falhou.'));
  caixa.appendChild(criar('p', 'vazio-texto',
    'Enquanto a consulta não voltar, nada aparece aqui: uma lista vazia honesta vale mais '
    + 'que uma lista preenchida por estimativa.'));
  caixa.appendChild(botaoTentarDeNovo());
  elEstado.appendChild(caixa);
}

function botaoTentarDeNovo() {
  const botao = criar('button', 'btn btn-primario', 'Tentar de novo');
  botao.type = 'button';
  botao.addEventListener('click', function () { recarregar(botao); });
  return botao;
}

/** Decide qual estado vazio aparece quando a lista visível está zerada. */
function desenharEstadoDaLista() {
  if (!recebeuAlgo) {
    if (ultimoErro) mostrarEstadoDeErro(ultimoErro);
    else mostrarEsqueleto();
    return;
  }
  /* Há leads no período e mesmo assim a lista está vazia: quem esvaziou foram
     os filtros — este caso vem antes de qualquer conversa sobre captura. */
  if (leadsDoPeriodo().length) {
    mostrarEstadoSemFiltro();
    return;
  }
  /* Vieram notificações, só não neste período: a fonte está funcionando. */
  if (leads.length) {
    mostrarEstadoSemLeads();
    return;
  }
  if (disponivel === false || escopoMedido() !== true) {
    mostrarEstadoSemCaptura();
    return;
  }
  mostrarEstadoSemLeads();
}

/** Faixa discreta quando a atualização falhou mas o que já veio continua na tela. */
function desenharAlerta() {
  if (!elAlerta) return;
  elAlerta.textContent = '';
  if (!ultimoErro || !recebeuAlgo) return;

  const faixa = criar('div', 'aviso aviso-atencao');
  faixa.setAttribute('role', 'status');
  faixa.appendChild(icone(ICONES.atencao));
  const texto = criar('div', 'cresce');
  texto.appendChild(criar('span', 'aviso-titulo', 'A última atualização não chegou'));
  texto.appendChild(criar('span', 'aviso-texto',
    (ultimoErro.amigavel || '') + ' A lista abaixo é a última resposta que chegou.'));
  faixa.appendChild(texto);

  const botao = criar('button', 'btn', 'Atualizar agora');
  botao.type = 'button';
  botao.addEventListener('click', function () { recarregar(botao); });
  faixa.appendChild(botao);
  elAlerta.appendChild(faixa);
}

/** Rodapé: de onde veio o que está na tela e o que ainda não é medido. */
function desenharRodape(doPeriodo, medido) {
  if (!elRodape) return;
  elRodape.textContent = '';
  if (!recebeuAlgo) return;

  const partes = [];
  partes.push('Lista devolvida pela ação leads para a janela consultada.');

  if (medido === true && !contexto.unidadeAtual) {
    const contas = contarCapturando();
    if (contas.ligadas !== null && contas.total !== null && contas.ligadas < contas.total) {
      const fora = contas.total - contas.ligadas;
      partes.push('A contagem cobre ' + contas.ligadas + ' '
        + plural(contas.ligadas, 'unidade', 'unidades') + ' com captura de grupo ligada; '
        + (fora === 1 ? 'a outra ainda não é medida.' : 'as outras ' + fora + ' ainda não são medidas.'));
    }
  }

  const naoMedidos = doPeriodo.filter(function (l) { return !l.resposta.medido; }).length;
  if (naoMedidos) {
    partes.push(naoMedidos + ' de ' + doPeriodo.length + ' '
      + plural(naoMedidos, 'lead está', 'leads estão') + ' sem o cruzamento com as conversas: '
      + 'o painel não afirma se alguém respondeu.');
  }

  elRodape.appendChild(icone(ICONES.semDado));
  elRodape.appendChild(criar('span', null, partes.join(' ')));
}

/* ═════════════════════════ 15. DESENHO E CICLO ══════════════════════════ */

function desenharLista() {
  desenharTempo(false);
  desenharContagem();
}

function desenharTudo() {
  desenharSubtitulo();
  desenharFiltros();
  desenharResumo();
  desenharTempo(true);
  desenharContagem();
  desenharAlerta();
}

function anunciar(texto) {
  if (elViva) elViva.textContent = texto;
}

/** Ponto único de entrada dos dados: a assinatura e o botão manual caem aqui. */
function receber(dados, erro) {
  if (!raizTela || !raizTela.isConnected) return;

  if (erro) {
    if (ehErroDeSessao(erro)) return;   // quem leva para o login é a casca
    ultimoErro = erro;
    if (!recebeuAlgo) desenharEstadoDaLista();
    desenharAlerta();
    return;
  }

  ultimoErro = null;
  const resposta = lerRetornoDaAcao(dados);
  disponivel = resposta.disponivel;
  motivo = resposta.motivo;

  const antes = recebeuAlgo;
  const normalizados = [];
  resposta.lista.forEach(function (cru, i) {
    const l = normalizarLead(cru, i);
    if (l) normalizados.push(l);
  });
  leads = normalizados;
  recebeuAlgo = true;

  /* Chegou alguém novo? Só depois da primeira resposta — na primeira, a lista
     inteira é "o que já existia", não novidade. */
  let chegaram = 0;
  leads.forEach(function (l) {
    if (conhecidos.has(l.id)) return;
    conhecidos.add(l.id);
    if (antes) {
      recemChegados.add(l.id);
      chegaram += 1;
    }
  });
  if (chegaram) {
    novos += chegaram;
    desenharContadorDeNovos();
    anunciar(chegaram + ' ' + plural(chegaram, 'lead novo chegou', 'leads novos chegaram') + '.');
  }

  desenharTudo();
}

/** Consulta fora do ciclo, a pedido do usuário. */
async function recarregar(botao) {
  if (!contexto || !contexto.api) return;
  if (botao) {
    botao.disabled = true;
    botao.setAttribute('aria-busy', 'true');
  }
  try {
    const dados = await contexto.api.leads(
      { slug: contexto.unidadeAtual || undefined, desde: desdeDaConsulta() },
      { forcar: true }
    );
    receber(dados, null);
    anunciar('Feed atualizado.');
  } catch (erro) {
    receber(null, erro);
  } finally {
    if (botao && botao.isConnected) {
      botao.disabled = false;
      botao.removeAttribute('aria-busy');
    }
  }
}

/** (Re)assina a ação `leads` com o escopo e o período atuais. */
function assinar() {
  if (pararAssinatura) { pararAssinatura(); pararAssinatura = null; }
  const args = { desde: desdeDaConsulta() };
  if (contexto && contexto.unidadeAtual) args.slug = contexto.unidadeAtual;
  pararAssinatura = assinarAtualizacao('leads', args, INTERVALO_MS, receber);
}

/* Os textos relativos ("há 12 min", "sem resposta há 2h15") envelhecem sozinhos:
   este ciclo reescreve só eles, sem pedir nada ao servidor. */
function reescreverTemporais() {
  if (!recebeuAlgo) return;
  itens.forEach(function (refs) {
    const l = refs.lead;
    if (l.marca !== null && refs.horaRel) refs.horaRel.textContent = desdeQuando(l.marca);
    if (refs.selo && l.resposta.situacao === 'sem_resposta') {
      const situacao = textoDaSituacao(l);
      refs.selo.textContent = situacao.texto;
      refs.selo.title = situacao.titulo;
    }
  });
}

/* ═════════════════════════ 16. MEDIDA DO LAYOUT ═════════════════════════
   O cabeçalho do dia gruda logo abaixo do cabeçalho real da casca — medido,
   nunca um número chutado.
   ════════════════════════════════════════════════════════════════════════ */

function medirTopo() {
  if (!raizTela || !raizTela.isConnected) return;
  let alto = 0;
  const cabecalho = document.querySelector('.ca-cabecalho');
  if (cabecalho) {
    const caixa = cabecalho.getBoundingClientRect();
    alto = caixa.height || 0;
  }
  raizTela.style.setProperty('--ld-topo', Math.round(alto) + 'px');
}

function aoRedimensionar() {
  if (temporizadorMedida) cancelAnimationFrame(temporizadorMedida);
  temporizadorMedida = requestAnimationFrame(function () {
    temporizadorMedida = 0;
    medirTopo();
  });
}

/* ═════════════════════════ 17. INTERFACE DA TELA ════════════════════════ */

export const tela = {
  id: 'leads',
  titulo: 'Feed de Leads',
  icone: ICONE_TELA,

  montar(raiz, ctx) {
    contexto = ctx;

    if (!document.getElementById('ld-estilo')) {
      noEstilo = document.createElement('style');
      noEstilo.id = 'ld-estilo';
      noEstilo.textContent = ESTILO;
      document.head.appendChild(noEstilo);
    } else {
      noEstilo = document.getElementById('ld-estilo');
    }

    /* Estado de sessão de tela: nada sobrevive a uma remontagem. */
    leads = [];
    disponivel = null;
    motivo = null;
    recebeuAlgo = false;
    ultimoErro = null;
    conhecidos = new Set();
    recemChegados = new Set();
    jaAnimados = new Set();
    novos = 0;
    itens = new Map();
    assinaturaDesenhada = '';
    valoresAnteriores.clear();

    raizTela = criar('div', 'ld-raiz');

    elViva = criar('p', 'sr-apenas');
    elViva.setAttribute('role', 'status');
    elViva.setAttribute('aria-live', 'polite');
    raizTela.appendChild(elViva);

    raizTela.appendChild(montarTopo());
    raizTela.appendChild(montarResumo());
    raizTela.appendChild(montarFiltros());

    elAlerta = criar('div');
    raizTela.appendChild(elAlerta);

    raizTela.appendChild(montarBarraInferior());

    elTempo = criar('div', 'ld-tempo');
    raizTela.appendChild(elTempo);

    elEstado = criar('div');
    raizTela.appendChild(elEstado);

    elRodape = criar('p', 'ld-rodape');
    raizTela.appendChild(elRodape);

    raiz.appendChild(raizTela);

    desenharSubtitulo();
    desenharFiltros();
    desenharResumo();
    desenharContagem();
    mostrarEsqueleto();
    medirTopo();

    /* A unidade também troca pelo seletor do topo: a tela acompanha e reassina. */
    if (typeof ctx.aoTrocarUnidade === 'function') {
      cancelarOuvinteUnidade = ctx.aoTrocarUnidade(function () {
        leads = [];
        disponivel = null;
        motivo = null;
        recebeuAlgo = false;
        ultimoErro = null;
        conhecidos = new Set();
        recemChegados = new Set();
        jaAnimados = new Set();
        novos = 0;
        valoresAnteriores.clear();
        desenharContadorDeNovos();
        desenharSubtitulo();
        desenharFiltros();
        desenharResumo();
        desenharTempo(true);
        desenharContagem();
        mostrarEsqueleto();
        assinar();
      });
    }

    window.addEventListener('resize', aoRedimensionar);
    window.addEventListener('orientationchange', aoRedimensionar);

    relogio = setInterval(reescreverTemporais, INTERVALO_RELOGIO_MS);

    /* Ao vivo a cada 15 s — a primeira consulta sai na hora. */
    assinar();
  },

  desmontar() {
    if (pararAssinatura) { pararAssinatura(); pararAssinatura = null; }
    if (cancelarOuvinteUnidade) { cancelarOuvinteUnidade(); cancelarOuvinteUnidade = null; }
    if (relogio) { clearInterval(relogio); relogio = null; }
    if (temporizadorMedida) { cancelAnimationFrame(temporizadorMedida); temporizadorMedida = 0; }
    if (temporizadorBusca) { clearTimeout(temporizadorBusca); temporizadorBusca = 0; }

    window.removeEventListener('resize', aoRedimensionar);
    window.removeEventListener('orientationchange', aoRedimensionar);

    numerosEmCurso.forEach(function (id) { cancelAnimationFrame(id); });
    numerosEmCurso.clear();

    esperas.forEach(function (timer) { clearTimeout(timer); });
    esperas.clear();

    valoresAnteriores.clear();
    itens.clear();

    if (noEstilo && noEstilo.parentNode) noEstilo.parentNode.removeChild(noEstilo);
    noEstilo = null;

    contexto = null;
    raizTela = null;
    elViva = null;
    elNovos = null;
    elNovosTexto = null;
    elSubtitulo = null;
    elAlerta = null;
    elContagem = null;
    elTempo = null;
    elEstado = null;
    elRodape = null;
    elLegenda = null;
    elSelUnidade = null;
    elSelPeriodo = null;
    elSelOrigem = null;
    elSelInteresse = null;
    elSelSituacao = null;
    elBusca = null;
    elLimpar = null;
    refsNumeros = null;
    refsOrigens = null;
    elInteresses = null;
    leads = [];
    recebeuAlgo = false;
    ultimoErro = null;
    assinaturaDesenhada = '';
  },
};
