/*
  casca.js — a casca do WhatsApp 360° Vision.

  Responsabilidades (e só estas):
    1. registrar os seis módulos de tela e montar a navegação a partir do
       `titulo` e do `icone` que cada um exporta;
    2. rotear por hash (#/visao-geral, #/whatsapp/apx-meier, …), lendo e
       escrevendo o slug da unidade na URL para o link poder ser compartilhado;
    3. guardar a sessão: sem token válido, só a tela de login monta;
    4. trocar de tela sem nunca deixar duas montadas ao mesmo tempo;
    5. oferecer o seletor global de unidade e o `ctx` do contrato.

  O que a casca NÃO faz: desenhar conteúdo de tela, formatar número, falar com
  a API além de `visao_geral` (que alimenta o seletor e o relógio) e `sair`.

  Regra que vale aqui como em todo o resto: nada de dado inventado. Quando a
  lista de unidades não veio, o seletor diz o que falta — não mostra uma lista
  de mentira nem finge um horário de atualização.

  Convivência (seção 6 do CONTRATO.md): a casca usa o prefixo `ca-` e só
  escreve fora da raiz das telas. Os tokens e os componentes compartilhados
  vêm do tema.css e nunca são redefinidos aqui.
*/

import {
  api,
  sessao,
  assinarAtualizacao,
  ehErroDeSessao,
  formatarQuando,
  TRACINHO,
} from './dados.js';
import { marca as identidade } from './marca.js';

/* Os módulos de tela. Import estático: cada um exporta `export const tela`.
   Se algum export vier fora do contrato, `normalizarTela()` abaixo põe no
   lugar dele uma tela honesta dizendo o que faltou — um módulo quebrado não
   derruba a aplicação inteira. */
import * as moduloLogin from './login.js';
import * as moduloVisaoGeral from './visao-geral.js';
import * as moduloWhatsapp from './whatsapp.js';
import * as moduloAnalise from './analise.js';
import * as moduloLeads from './leads.js';
import * as moduloConfig from './config.js';

/* ═════════════════════════ 1. REGISTRO DAS TELAS ═════════════════════════ */

/*
  `escopo` diz o que a casca faz com o slug da unidade na URL:
    'rede'     → a tela é da rede inteira; nunca entra slug na URL.
    'unidade'  → a tela precisa de uma unidade; o slug entra na URL sempre.
    'opcional' → a tela aceita uma unidade ou a rede toda (é o caso de `leads`,
                 cujo argumento `slug` é opcional no contrato).
  `menu: false` fica fora da navegação (a tela de login não é um destino).
*/
const DEFINICOES = [
  { id: 'login', modulo: moduloLogin, escopo: 'rede', menu: false, publica: true },
  { id: 'visao-geral', modulo: moduloVisaoGeral, escopo: 'rede', menu: true },
  { id: 'whatsapp', modulo: moduloWhatsapp, escopo: 'unidade', menu: true },
  { id: 'analise', modulo: moduloAnalise, escopo: 'unidade', menu: true },
  { id: 'leads', modulo: moduloLeads, escopo: 'opcional', menu: true },
  { id: 'config', modulo: moduloConfig, escopo: 'rede', menu: true },
];

/** Para onde vai quem entra sem pedir rota. */
const ROTA_PADRAO = 'visao-geral';

/** Nome da aplicação no <title> e na marca do trilho. */
const NOME_APP = identidade.app;
const NOME_REDE = identidade.dono;

/** De quanto em quanto tempo a casca reconsulta a rede (seletor + relógio). */
const INTERVALO_REDE_MS = 60000;

/** De quanto em quanto tempo o texto "há 3 min" é reescrito na tela. */
const INTERVALO_RELOGIO_MS = 30000;

/** Chaves das preferências locais desta máquina (não são dado do servidor). */
const CHAVE_TRILHO = 'wa360.trilho-recolhido';
const CHAVE_UNIDADE = 'wa360.unidade-atual';

/** Duração da saída da tela. A entrada é a animação `entrada-tela` do tema. */
const SAIDA_MS = 140;

/* ═════════════════════════ 2. ÍCONES DA CASCA ════════════════════════════
   Só os da própria casca. O ícone de cada tela vem do módulo dela.
   ════════════════════════════════════════════════════════════════════════ */

const SVG_ABRE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
  + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';

const ICONES = {
  seta: SVG_ABRE + '<path d="m6 9 6 6 6-6"/></svg>',
  busca: SVG_ABRE + '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>',
  sair: SVG_ABRE + '<path d="M15 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/>'
    + '<path d="m10 17 5-5-5-5"/><path d="M15 12H3"/></svg>',
  recolher: SVG_ABRE + '<path d="m15 18-6-6 6-6"/></svg>',
  alerta: SVG_ABRE + '<path d="M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3'
    + 'l-7.9-13.7a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4.5"/><path d="M12 17.2h.01"/></svg>',
  relogio: SVG_ABRE + '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></svg>',
  pessoa: SVG_ABRE + '<circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>',
  fechar: SVG_ABRE + '<path d="m6 6 12 12"/><path d="m18 6-12 12"/></svg>',
  certo: SVG_ABRE + '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.2 2.4 2.4 4.6-4.9"/></svg>',
  modulo: SVG_ABRE + '<rect x="3" y="3" width="7" height="7" rx="2"/>'
    + '<rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/>'
    + '<rect x="14" y="14" width="7" height="7" rx="2"/></svg>',
};

/* ═════════════════════════ 3. ESTILO DA CASCA ════════════════════════════
   O tema.css é dono dos tokens e dos componentes compartilhados; aqui ficam
   apenas as peças que só a casca tem (trilho, cabeçalho, seletor), todas com
   o prefixo `ca-` e construídas com os tokens do tema.
   ════════════════════════════════════════════════════════════════════════ */

const ESTILO = `
/* --- Esqueleto da aplicação ------------------------------------------- */
.ca-raiz {
  --ca-trilho: var(--trilho-largura);
  display: grid;
  grid-template-columns: var(--ca-trilho) minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
  grid-template-areas: "trilho cabecalho" "trilho conteudo";
  min-height: 100vh;
  min-height: 100dvh;
  transition: grid-template-columns var(--t-padrao) var(--curva);
}
.ca-raiz[data-recolhido="sim"] { --ca-trilho: 76px; }
.ca-raiz[data-modo="login"] {
  grid-template-columns: minmax(0, 1fr);
  grid-template-areas: "conteudo";
}

/* --- Trilho de navegação ---------------------------------------------- */
.ca-trilho {
  grid-area: trilho;
  position: sticky;
  top: 0;
  align-self: start;
  z-index: var(--z-trilho);
  display: flex;
  flex-direction: column;
  gap: var(--esp-8);
  height: 100vh;
  height: 100dvh;
  padding: var(--esp-16) var(--esp-12) var(--esp-12);
  background: var(--fundo-2);
  border-right: 1px solid var(--linha);
  overflow: hidden;
}

.ca-marca-bloco {
  display: flex;
  align-items: center;
  gap: var(--esp-12);
  min-height: var(--alvo-toque);
  padding: 0 var(--esp-8);
  min-width: 0;
}
.ca-emblema {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex: none;
  border-radius: var(--r-p);
  background: linear-gradient(145deg, var(--indigo-cl), var(--indigo));
  color: #FFF;
  font-size: 13px;
  box-shadow: var(--sombra-indigo);
}
.ca-marca-texto { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.ca-marca-nome { font-size: 15px; color: var(--tinta); }
.ca-marca-sub {
  font-size: var(--txt-legenda);
  font-weight: 600;
  color: var(--tinta-3);
  letter-spacing: .02em;
}

.ca-nav {
  display: flex;
  flex-direction: column;
  gap: var(--esp-4);
  margin-top: var(--esp-8);
  min-width: 0;
}

.ca-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--esp-12);
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
  transition: background var(--transicao), color var(--transicao),
              border-color var(--transicao);
}
.ca-item .ca-icone { display: flex; flex: none; }
.ca-item svg { width: 22px; height: 22px; }
.ca-item-rotulo { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ca-item-curto { display: none; }
.ca-item:hover { background: var(--carta); color: var(--tinta); }
.ca-item[aria-current="page"] {
  background: var(--veu-indigo);
  border-color: rgba(91, 91, 214, .40);
  color: var(--tinta);
}
.ca-item[aria-current="page"] .ca-icone { color: var(--indigo-cl); }
.ca-item[aria-current="page"]::before {
  content: '';
  position: absolute;
  left: -12px;
  top: 50%;
  width: 3px;
  height: 22px;
  margin-top: -11px;
  border-radius: 0 3px 3px 0;
  background: var(--indigo-cl);
}

.ca-rodape-trilho { margin-top: auto; display: flex; flex-direction: column; gap: var(--esp-8); }
.ca-recolher {
  align-self: flex-start;
  color: var(--tinta-3);
}
.ca-recolher svg { transition: transform var(--transicao); }
.ca-raiz[data-recolhido="sim"] .ca-recolher svg { transform: rotate(180deg); }

.ca-assinatura {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 var(--esp-12) var(--esp-4);
  font-size: var(--txt-legenda);
  font-weight: 700;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--tinta-3);
  white-space: nowrap;
}
.ca-assinatura i {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--daco-verde), var(--daco-laranja));
}

/* Trilho recolhido: só os ícones, centralizados. O nome acessível continua
   no aria-label de cada item, então nada se perde para o leitor de tela. */
.ca-raiz[data-recolhido="sim"] .ca-item { justify-content: center; padding: 0; gap: 0; }
.ca-raiz[data-recolhido="sim"] .ca-item-rotulo,
.ca-raiz[data-recolhido="sim"] .ca-marca-texto,
.ca-raiz[data-recolhido="sim"] .ca-assinatura span { display: none; }
.ca-raiz[data-recolhido="sim"] .ca-marca-bloco { justify-content: center; padding: 0; }
.ca-raiz[data-recolhido="sim"] .ca-recolher { align-self: center; }
.ca-raiz[data-recolhido="sim"] .ca-assinatura { justify-content: center; padding: 0 0 var(--esp-4); }

/* --- Cabeçalho --------------------------------------------------------- */
.ca-cabecalho {
  grid-area: cabecalho;
  position: sticky;
  top: 0;
  z-index: var(--z-cabecalho);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--esp-12);
  padding: var(--esp-12) var(--esp-24);
  background: rgba(11, 15, 26, .90);
  border-bottom: 1px solid var(--linha);
}
@supports (backdrop-filter: blur(10px)) {
  .ca-cabecalho { background: rgba(11, 15, 26, .78); backdrop-filter: blur(12px); }
}

.ca-marca-celular { display: none; align-items: center; gap: var(--esp-8); min-width: 0; }

.ca-direita {
  display: flex;
  align-items: center;
  gap: var(--esp-8);
  margin-left: auto;
  min-width: 0;
}

.ca-relogio {
  display: flex;
  align-items: center;
  gap: var(--esp-8);
  padding: 6px var(--esp-12);
  border: 1px solid var(--linha);
  border-radius: var(--r-p);
  background: var(--carta);
  min-width: 0;
}
.ca-relogio svg { width: 16px; height: 16px; color: var(--tinta-3); }
.ca-relogio-texto { display: flex; flex-direction: column; gap: 0; min-width: 0; }
.ca-relogio-rotulo {
  font-size: var(--txt-legenda);
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--tinta-3);
  line-height: 1.2;
}
.ca-relogio-valor {
  font-family: var(--fonte-titulo);
  font-size: var(--txt-pequeno);
  font-weight: 700;
  color: var(--tinta-2);
  line-height: 1.3;
  white-space: nowrap;
}

.ca-usuario { display: flex; align-items: center; gap: var(--esp-8); min-width: 0; }
.ca-avatar {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex: none;
  border-radius: 50%;
  background: var(--carta-2);
  border: 1px solid var(--linha-2);
  color: var(--tinta-2);
  font-family: var(--fonte-titulo);
  font-size: var(--txt-pequeno);
  font-weight: 800;
}
.ca-avatar svg { width: 18px; height: 18px; }
.ca-usuario-texto { display: flex; flex-direction: column; min-width: 0; max-width: 200px; }
.ca-usuario-nome {
  font-family: var(--fonte-titulo);
  font-size: var(--txt-pequeno);
  font-weight: 700;
  color: var(--tinta);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ca-usuario-papel {
  font-size: var(--txt-legenda);
  font-weight: 600;
  color: var(--tinta-3);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Sinal de que a última consulta da rede falhou. Aparece só quando falhou.
   A regra do [hidden] é obrigatória: o .btn-icone do tema define display,
   e display de classe vence o [hidden] da folha do navegador. */
.ca-falha-rede[hidden] { display: none; }
.ca-falha-rede { color: var(--atencao); border: 1px solid rgba(255, 201, 60, .38); }
.ca-falha-rede:hover { background: var(--veu-atencao); color: var(--atencao); }

/* --- Seletor de unidade ------------------------------------------------ */
.ca-seletor { position: relative; flex: 1 1 260px; max-width: 380px; min-width: 0; }

.ca-seletor-botao {
  display: flex;
  align-items: center;
  gap: var(--esp-8);
  width: 100%;
  min-height: var(--alvo-toque);
  padding: 0 var(--esp-12);
  background: var(--carta);
  border: 1px solid var(--linha-2);
  border-radius: var(--r-p);
  color: var(--tinta);
  font-family: var(--fonte-texto);
  font-size: var(--txt-pequeno);
  font-weight: 700;
  text-align: left;
  cursor: pointer;
  transition: border-color var(--transicao), background var(--transicao);
}
.ca-seletor-botao:hover { background: var(--carta-2); border-color: var(--indigo); }
.ca-seletor-botao[aria-expanded="true"] { border-color: var(--indigo); box-shadow: var(--anel-foco); }
.ca-seletor-botao .ca-seletor-nome {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ca-seletor-botao svg { width: 18px; height: 18px; color: var(--tinta-3); margin-left: auto; flex: none; }
.ca-seletor-botao[aria-expanded="true"] svg { transform: rotate(180deg); }
.ca-seletor-botao svg { transition: transform var(--transicao); }

.ca-painel {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  right: 0;
  z-index: var(--z-flutuante);
  display: flex;
  flex-direction: column;
  gap: var(--esp-8);
  padding: var(--esp-12);
  background: var(--carta);
  border: 1px solid var(--linha-2);
  border-radius: var(--r);
  box-shadow: var(--sombra-3);
}
.ca-painel[hidden] { display: none; }

.ca-busca {
  display: flex;
  align-items: center;
  gap: var(--esp-8);
  min-height: var(--alvo-toque);
  padding: 0 var(--esp-12);
  background: var(--carta-2);
  border: 1px solid var(--linha);
  border-radius: var(--r-p);
}
.ca-busca:focus-within { border-color: var(--indigo); box-shadow: var(--anel-foco); }
.ca-busca svg { width: 18px; height: 18px; color: var(--tinta-3); flex: none; }
.ca-busca input {
  width: 100%;
  min-width: 0;
  background: transparent;
  border: 0;
  color: var(--tinta);
  font-family: var(--fonte-texto);
  font-size: var(--txt-base);
  font-weight: 600;
}
.ca-busca input:focus { outline: none; }
.ca-busca input::placeholder { color: var(--tinta-3); font-weight: 500; }

.ca-contagem { padding: 0 var(--esp-4); }

.ca-lista {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: min(52vh, 380px);
  padding-right: 2px;
  margin: 0;
  list-style: none;
}

.ca-opcao {
  display: flex;
  align-items: center;
  gap: var(--esp-12);
  width: 100%;
  min-height: var(--alvo-toque);
  padding: var(--esp-8) var(--esp-12);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--r-p);
  color: var(--tinta);
  font-family: var(--fonte-texto);
  font-size: var(--txt-pequeno);
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: background var(--transicao), border-color var(--transicao);
}
.ca-opcao:hover { background: var(--carta-2); }
.ca-opcao[aria-current="true"] {
  background: var(--veu-indigo);
  border-color: rgba(91, 91, 214, .40);
}
.ca-opcao-texto { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.ca-opcao-nome {
  font-family: var(--fonte-titulo);
  font-weight: 700;
  color: var(--tinta);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ca-opcao-estado {
  font-size: var(--txt-legenda);
  font-weight: 600;
  color: var(--tinta-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* --- Conteúdo ---------------------------------------------------------- */
.ca-conteudo {
  grid-area: conteudo;
  width: 100%;
  max-width: 1560px;
  margin: 0 auto;
  padding: var(--esp-24);
  min-width: 0;
}
.ca-raiz[data-modo="login"] .ca-conteudo {
  display: grid;
  max-width: none;
  padding: 0;
  min-height: 100vh;
  min-height: 100dvh;
}
.ca-secao { min-width: 0; }
.ca-secao:focus { outline: none; }
.ca-secao:focus-visible { outline: 2px solid var(--indigo-cl); outline-offset: 6px; }
.ca-saindo { pointer-events: none; }

.ca-falha-tela { margin-bottom: var(--esp-16); }
/* O .cresce do tema só vale dentro de .pilha/.pilha-h. Estas faixas são
   flex por conta do .aviso, então o miolo de texto recebe aqui o mesmo
   comportamento — sem mexer na regra compartilhada. */
.ca-falha-tela > .cresce,
.ca-fora-da-lista > .cresce,
.ca-faixa > .cresce { flex: 1 1 auto; min-width: 0; }
.ca-carregando { display: flex; flex-direction: column; gap: var(--esp-12); }

/* Faixa fixa de sessão/conexão — o topo de tudo, inclusive do login. */
.ca-faixa {
  position: fixed;
  top: var(--esp-12);
  left: 50%;
  transform: translateX(-50%);
  z-index: var(--z-aviso);
  width: min(560px, calc(100% - 24px));
  box-shadow: var(--sombra-3);
}
.ca-faixa .ca-faixa-fechar { margin-left: auto; align-self: flex-start; width: 32px; height: 32px; }
.ca-faixa .ca-faixa-fechar svg { width: 16px; height: 16px; }

/* --- Abaixo de 1180px: o trilho vira barra inferior fixa --------------- */
@media (max-width: 1180px) {
  .ca-raiz {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: "cabecalho" "conteudo";
  }
  .ca-trilho {
    position: fixed;
    inset: auto 0 0 0;
    top: auto;
    height: auto;
    flex-direction: row;
    align-items: center;
    gap: 0;
    padding: 6px var(--esp-8);
    padding-bottom: calc(6px + env(safe-area-inset-bottom, 0px));
    border-right: 0;
    border-top: 1px solid var(--linha);
    box-shadow: 0 -8px 24px rgba(0, 0, 0, .34);
  }
  .ca-marca-bloco,
  .ca-rodape-trilho { display: none; }
  .ca-nav { flex-direction: row; width: 100%; margin: 0; gap: 2px; }
  .ca-item {
    flex: 1 1 0;
    /* Sem o min-width:0 o rótulo mais comprido dita a largura e os cinco itens
       ficam desiguais — com ele todos repartem a barra em partes iguais. */
    min-width: 0;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    min-height: 56px;
    padding: 6px 2px;
    font-size: var(--txt-legenda);
    letter-spacing: 0;
    text-align: center;
  }
  .ca-item .ca-item-rotulo { display: none; }
  .ca-item .ca-item-curto { display: block; max-width: 100%; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; }
  .ca-item[aria-current="page"]::before {
    left: 50%;
    top: -6px;
    width: 26px;
    height: 3px;
    margin: 0 0 0 -13px;
    border-radius: 0 0 3px 3px;
  }
  .ca-marca-celular { display: flex; }
  .ca-cabecalho { padding: var(--esp-8) var(--esp-16); }
  .ca-conteudo {
    padding: var(--esp-16);
    padding-bottom: calc(var(--trilho-altura) + var(--esp-24) + env(safe-area-inset-bottom, 0px));
  }
  .ca-raiz[data-modo="login"] .ca-conteudo { padding: 0; }
}

/* --- Abaixo de 720px: cabeçalho em duas linhas ------------------------- */
@media (max-width: 720px) {
  .ca-cabecalho { padding: var(--esp-8) var(--esp-12); row-gap: var(--esp-8); }
  .ca-seletor { order: 2; flex: 1 1 100%; max-width: none; }
  .ca-marca-celular { order: 0; }
  .ca-direita { order: 1; }
  .ca-usuario-texto { display: none; }
  .ca-relogio { padding: 5px var(--esp-8); }
  .ca-relogio-rotulo { display: none; }
  .ca-conteudo { padding: var(--esp-12); padding-bottom:
    calc(var(--trilho-altura) + var(--esp-24) + env(safe-area-inset-bottom, 0px)); }
  .ca-lista { max-height: min(60vh, 340px); }
}

@media (max-width: 360px) {
  .ca-marca-celular .ca-marca-nome { font-size: 13px; }
  .ca-relogio { display: none; }
}

/* Quem pediu menos movimento não recebe o deslize do trilho. */
@media (prefers-reduced-motion: reduce) {
  .ca-raiz { transition: none; }
  .ca-recolher svg,
  .ca-seletor-botao svg { transition: none; }
}
`;

/* ═════════════════════════ 4. ESTADO DA CASCA ════════════════════════════ */

let raiz = null;          /* .ca-raiz */
let cabecalho = null;
let trilho = null;
let navegacao = null;
let conteudo = null;      /* <main> onde a tela mora */
let avisoVivo = null;     /* região aria-live que anuncia a troca de tela */

let telaAtiva = null;     /* { def, tela } da tela montada — nunca duas */
let secaoAtual = null;    /* <section> da tela montada */
let rotaAtual = null;     /* { id, slug } */
let rotaPretendida = null;/* rota pedida antes do login */
let geracao = 0;          /* corta transições atropeladas por outra navegação */
let primeiraTroca = true; /* não roubar o foco na primeira montagem */

let unidades = [];        /* lista crua de 3.1, como veio da API */
let rede = null;          /* objeto 3.2 */
let erroRede = null;      /* ErroApi da última consulta que falhou */
let redeRespondeu = false;/* já houve UMA resposta (com dado ou com erro) */
let esperaDaRede = null;  /* { promessa, resolver } da primeira resposta */

let unidadeAtual = null;  /* slug da unidade escolhida, ou null = toda a rede */
let ouvintesUnidade = []; /* callbacks de aoTrocarUnidade da tela montada */

let pararRede = null;     /* cancela a assinatura de visao_geral */
let relogio = null;       /* timer que reescreve "há 3 min" */
let saindo = false;

/* Elementos do cabeçalho que mudam sozinhos. */
let elRelogioValor = null;
let elFalhaRede = null;
let elSeletorBotao = null;
let elSeletorNome = null;
let elSeletorPonto = null;
let elPainel = null;
let elBusca = null;
let elLista = null;
let elContagem = null;
let elBotaoSair = null;
let elRecolher = null;

/* ═════════════════════════ 5. UTILIDADES ════════════════════════════════ */

/** Cria um elemento já com classe, texto e atributos. */
function criar(tag, classe, texto) {
  const no = document.createElement(tag);
  if (classe) no.className = classe;
  if (texto !== undefined && texto !== null) no.textContent = texto;
  return no;
}

/** Envelopa um SVG de ícone. `innerHTML` aqui só recebe constante do projeto. */
function icone(svg, classe) {
  const caixa = criar('span', classe || 'ca-icone');
  caixa.setAttribute('aria-hidden', 'true');
  caixa.innerHTML = svgValido(svg) ? svg : ICONES.modulo;
  return caixa;
}

/** Aceita só o que parece mesmo um ícone; qualquer outra coisa cai no padrão. */
function svgValido(valor) {
  return typeof valor === 'string'
    && /^\s*<svg[\s>]/i.test(valor)
    && !/<script/i.test(valor);
}

/** Leitura tolerante do armazém local: navegador bloqueado não pode quebrar nada. */
function lerLocal(chave) {
  try { return window.localStorage.getItem(chave); } catch (e) { return null; }
}
function gravarLocal(chave, valor) {
  try {
    if (valor === null) window.localStorage.removeItem(chave);
    else window.localStorage.setItem(chave, valor);
  } catch (e) { /* janela anônima: a preferência vale só nesta sessão */ }
}

/** true quando o usuário pediu menos movimento no sistema. */
function movimentoReduzido() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {
    return false;
  }
}

/** Texto sem acento e em minúsculas, para a busca do seletor. */
function chaveDeBusca(texto) {
  const cru = String(texto || '').toLowerCase();
  try {
    return cru.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch (e) {
    return cru;
  }
}

/** Iniciais do nome para o avatar. Sem nome, o avatar vira um ícone. */
function iniciais(nome) {
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '';
  const primeira = partes[0].charAt(0);
  const ultima = partes.length > 1 ? partes[partes.length - 1].charAt(0) : '';
  return (primeira + ultima).toUpperCase();
}

/**
 * Rótulo curto do item na barra inferior do celular, derivado do `titulo` do
 * módulo — nada é inventado, é o mesmo título encurtado:
 *   "Painel de Controle"    → "Painel"    (corta na preposição)
 *   "Análise de Desempenho" → "Análise"
 *   "Leads Recebidos"       → "Leads"     (duas palavras longas: fica a primeira)
 *   "Preferências"          → "Preferências"  (palavra única continua inteira)
 * O que sobrar comprido demais o CSS corta com reticências.
 */
function rotuloCurto(titulo) {
  const inteiro = String(titulo || '').trim();
  if (!inteiro) return '';
  const semPreposicao = inteiro.split(/\s+(?:de|da|do|das|dos|ao|aos|à|às|no|na|em|por|para|com)\s+/i)[0] || inteiro;
  const palavras = semPreposicao.split(/\s+/);
  if (palavras.length > 1 && semPreposicao.length > 10) return palavras[0];
  return semPreposicao;
}

/* ═════════════════════════ 6. TELAS REGISTRADAS ═════════════════════════ */

/**
 * Garante a interface do contrato. Um módulo que ainda não exporta `tela`
 * (ou exporta errado) não pode derrubar a aplicação: ele vira uma tela que
 * explica exatamente o que falta, em português.
 */
function normalizarTela(def) {
  const bruta = def.modulo && def.modulo.tela ? def.modulo.tela : null;
  const valida = bruta && typeof bruta.montar === 'function';

  if (valida) {
    return {
      id: def.id,
      titulo: typeof bruta.titulo === 'string' && bruta.titulo.trim() ? bruta.titulo.trim() : def.id,
      icone: svgValido(bruta.icone) ? bruta.icone : ICONES.modulo,
      montar: bruta.montar.bind(bruta),
      desmontar: typeof bruta.desmontar === 'function' ? bruta.desmontar.bind(bruta) : null,
    };
  }

  return {
    id: def.id,
    titulo: def.id,
    icone: ICONES.modulo,
    montar(alvo) {
      const caixa = criar('div', 'vazio');
      caixa.appendChild(icone(ICONES.alerta, 'vazio-icone'));
      caixa.appendChild(criar('p', 'vazio-titulo', 'O módulo "' + def.id + '" não carregou'));
      caixa.appendChild(criar('p', 'vazio-texto',
        'O arquivo app/' + def.id + '.js existe, mas não exporta `export const tela` com a '
        + 'função montar(). Nenhum dado desta tela pode ser mostrado enquanto isso não for '
        + 'corrigido — e nada aqui será preenchido com valor de exemplo.'));
      alvo.appendChild(caixa);
    },
    desmontar: null,
  };
}

const TELAS = DEFINICOES.map(function (def) {
  return {
    id: def.id,
    escopo: def.escopo,
    menu: def.menu !== false,
    publica: !!def.publica,
    tela: normalizarTela(def),
  };
});

function acharTela(id) {
  for (let i = 0; i < TELAS.length; i += 1) {
    if (TELAS[i].id === id) return TELAS[i];
  }
  return null;
}

/* ═════════════════════════ 7. SESSÃO ════════════════════════════════════ */

/** Há token e ele ainda não venceu pelo relógio do navegador. */
function temSessao() {
  const atual = sessao.ler();
  if (!atual || !atual.token) return false;
  // `expirada()` devolve null quando o servidor não informou validade:
  // nesse caso quem decide é a próxima chamada, não a casca.
  return sessao.expirada() !== true;
}

/** Objeto `sessao` do ctx: o do dados.js, mais os atalhos de leitura. */
const sessaoDoCtx = Object.create(sessao, {
  usuario: {
    enumerable: true,
    get: function () { const s = sessao.ler(); return s && s.usuario ? s.usuario : null; },
  },
  nome: {
    enumerable: true,
    get: function () { const u = this.usuario; return u && u.nome ? u.nome : null; },
  },
  papel: {
    enumerable: true,
    get: function () { const u = this.usuario; return u && u.papel ? u.papel : null; },
  },
  expira_em: {
    enumerable: true,
    get: function () { const s = sessao.ler(); return s && s.expira_em ? s.expira_em : null; },
  },
});

/* ═════════════════════════ 8. CONTEXTO DAS TELAS ════════════════════════ */

/**
 * O `ctx` da seção 6 do contrato. É um objeto vivo: `unidadeAtual` é um getter,
 * então uma tela que guardou o ctx continua lendo o valor certo depois de o
 * usuário trocar de unidade.
 */
const ctx = {
  api: api,
  sessao: sessaoDoCtx,
  irPara: irPara,
  aoTrocarUnidade: aoTrocarUnidade,
  trocarUnidade: trocarUnidade,

  get unidadeAtual() { return unidadeAtual; },
  set unidadeAtual(slug) { trocarUnidade(slug); },

  /** Objeto 3.1 da unidade escolhida, ou null enquanto a lista não chegou. */
  get unidade() { return unidadePorSlug(unidadeAtual); },

  /** Cópia da lista de unidades já conhecida. Vazia = ainda não sabemos. */
  get unidades() { return unidades.slice(); },

  /** Objeto 3.2 da rede, ou null. Nunca um resumo montado aqui. */
  get rede() { return rede; },

  get usuario() { return sessaoDoCtx.usuario; },
};

/**
 * Registra um ouvinte de troca de unidade. Devolve a função que cancela.
 * A casca limpa a lista inteira a cada troca de tela, então um módulo que
 * esquecer de cancelar em `desmontar()` ainda assim não vaza.
 */
function aoTrocarUnidade(fn) {
  if (typeof fn !== 'function') return function () {};
  ouvintesUnidade.push(fn);
  return function () {
    ouvintesUnidade = ouvintesUnidade.filter(function (outro) { return outro !== fn; });
  };
}

function avisarOuvintes() {
  const objeto = unidadePorSlug(unidadeAtual);
  ouvintesUnidade.slice().forEach(function (fn) {
    try {
      fn(unidadeAtual, objeto);
    } catch (e) {
      console.error('[casca] uma tela falhou ao reagir à troca de unidade', e);
    }
  });
}

/* ═════════════════════════ 9. UNIDADES ══════════════════════════════════ */

function unidadePorSlug(slug) {
  if (!slug) return null;
  for (let i = 0; i < unidades.length; i += 1) {
    if (unidades[i] && unidades[i].slug === slug) return unidades[i];
  }
  return null;
}

/** Nome da unidade; sem a lista carregada, mostra o próprio slug (é o que sabemos). */
function nomeDaUnidade(slug) {
  const u = unidadePorSlug(slug);
  if (u && u.nome) return u.nome;
  return slug || '';
}

/**
 * Estado da bolinha, direto dos campos de 3.1. `ponto` null = verde vivo
 * (é o padrão do .ponto-vivo do tema); 'parado' e 'risco' são as variantes.
 */
function estadoDaUnidade(u) {
  if (!u) return { ponto: 'parado', texto: 'Estado desconhecido' };
  if (u.ativo === false) return { ponto: 'parado', texto: 'Unidade inativa' };
  if (u.silenciosa === true) return { ponto: 'risco', texto: 'Sem mensagem há mais de 4 h úteis' };
  if (u.capturando === true) return { ponto: null, texto: 'Captura ligada' };
  if (u.capturando === false) return { ponto: 'parado', texto: 'Captura de grupo desligada' };
  return { ponto: 'parado', texto: 'Estado não informado pela API' };
}

/** Troca a unidade, atualiza a URL e avisa a tela montada. */
function trocarUnidade(slug) {
  const novo = slug ? String(slug) : null;
  if (novo === unidadeAtual) return;
  unidadeAtual = novo;
  if (novo) gravarLocal(CHAVE_UNIDADE, novo);
  desenharSeletorBotao();
  sincronizarUrlDaUnidade();
  avisarOuvintes();
}

/** Muda a unidade sem avisar ninguém — usado antes de montar a próxima tela. */
function definirUnidadeSilenciosa(slug) {
  unidadeAtual = slug ? String(slug) : null;
  if (unidadeAtual) gravarLocal(CHAVE_UNIDADE, unidadeAtual);
  desenharSeletorBotao();
}

/** Reescreve o hash com a unidade atual, sem remontar a tela. */
function sincronizarUrlDaUnidade() {
  if (!rotaAtual) return;
  const def = acharTela(rotaAtual.id);
  if (!def || def.escopo === 'rede') return;
  const destino = { id: rotaAtual.id, slug: unidadeAtual };
  rotaAtual = destino;
  const alvo = montarHash(destino);
  if (location.hash !== alvo) {
    try {
      history.replaceState(history.state, '', alvo);
    } catch (e) {
      location.hash = alvo; /* navegador antigo: aceita o salto extra no histórico */
    }
  }
}

/* ═════════════════════════ 10. ROTEAMENTO ═══════════════════════════════ */

/** '#/whatsapp/apx-meier' → { id:'whatsapp', slug:'apx-meier' }. */
function lerHash() {
  const cru = String(location.hash || '').replace(/^#/, '');
  if (!cru) return null;
  const partes = cru.split('/').filter(function (p) { return p !== ''; });
  if (!partes.length) return null;
  let slug = partes[1] || null;
  if (slug) {
    try { slug = decodeURIComponent(slug); } catch (e) { /* fica como veio */ }
  }
  return { id: partes[0], slug: slug };
}

function montarHash(destino) {
  const base = '#/' + destino.id;
  return destino.slug ? base + '/' + encodeURIComponent(destino.slug) : base;
}

/** Última unidade usada nesta máquina, se ela ainda existe na lista da API. */
function unidadeLembrada() {
  const guardada = lerLocal(CHAVE_UNIDADE);
  if (!guardada) return null;
  if (!unidades.length) return guardada;      /* sem lista, confiamos no que há */
  return unidadePorSlug(guardada) ? guardada : null;
}

function primeiraUnidade() {
  return unidades.length && unidades[0] ? unidades[0].slug : null;
}

/** Completa o destino conforme o escopo da tela. */
function normalizarDestino(pedido) {
  const def = acharTela(pedido.id) || acharTela(ROTA_PADRAO);
  let slug = pedido.slug || null;

  if (def.escopo === 'rede') {
    slug = null;
  } else if (def.escopo === 'unidade') {
    if (!slug) slug = unidadeAtual || unidadeLembrada() || primeiraUnidade();
  } else if (!slug) {
    slug = unidadeAtual;           /* 'opcional': null continua valendo "toda a rede" */
  }

  return { id: def.id, slug: slug || null };
}

/**
 * `irPara` do contrato. `params` aceita o slug direto ou { slug } / { unidade }.
 * Logo depois do login, uma rota guardada tem preferência sobre o destino
 * padrão — quem abriu um link de análise volta para a análise, não para o painel.
 */
function irPara(id, params) {
  let slug = null;
  if (typeof params === 'string') slug = params;
  else if (params && typeof params === 'object') slug = params.slug || params.unidade || null;

  let pedido = { id: String(id || ROTA_PADRAO), slug: slug };

  if (rotaPretendida && temSessao()) {
    pedido = rotaPretendida;
    rotaPretendida = null;
  }

  const destino = normalizarDestino(pedido);
  const alvo = montarHash(destino);
  if (location.hash === alvo) aplicarRota();
  else location.hash = alvo;       /* o hashchange chama aplicarRota */
}

/**
 * Único ponto que decide o que está na tela. Chamado no início, a cada
 * hashchange e depois do login. É aqui que a casca visível nasce: quem entra
 * pela tela de login passa por este caminho e ganha trilho, cabeçalho e a
 * assinatura da rede sem que o módulo de login precise saber disso.
 */
function aplicarRota() {
  const pedido = lerHash();

  if (!temSessao()) {
    if (pedido && acharTela(pedido.id) && !acharTela(pedido.id).publica) {
      rotaPretendida = normalizarDestino(pedido);
    }
    mostrarLogin();
    return;
  }

  limparFaixa();
  garantirCasca();
  ligarRede();

  let destino = pedido;
  const def = destino ? acharTela(destino.id) : null;

  if (!def || def.publica) {
    // Hash vazio, âncora solta ou #/login com sessão válida: vai para onde faz
    // sentido, sem empilhar histórico.
    destino = rotaPretendida || rotaAtual || { id: ROTA_PADRAO, slug: null };
    rotaPretendida = null;
  }

  destino = normalizarDestino(destino);

  const alvo = montarHash(destino);
  if (location.hash !== alvo) {
    try {
      history.replaceState(history.state, '', alvo);
    } catch (e) { /* sem history: a URL fica como está, a navegação segue */ }
  }

  navegar(destino);
}

/**
 * Leva o destino para a tela. Mesma tela com outro slug NÃO remonta: quem
 * avisa é `aoTrocarUnidade`, como manda a seção 6 do contrato.
 */
function navegar(destino, opcoes) {
  const forcar = !!(opcoes && opcoes.forcar);

  if (!forcar && rotaAtual && rotaAtual.id === destino.id && telaAtiva) {
    rotaAtual = destino;
    if ((destino.slug || null) !== unidadeAtual) trocarUnidade(destino.slug);
    marcarItemAtivo();
    return;
  }

  rotaAtual = destino;
  marcarItemAtivo();
  trocarTela(acharTela(destino.id), destino);
}

/* ═════════════════════════ 11. TROCA DE TELA ════════════════════════════ */

/** Desmonta a tela montada. Erro dentro de desmontar() não trava a troca. */
function desmontarAtiva() {
  if (!telaAtiva) return;
  const morta = telaAtiva;
  telaAtiva = null;
  ouvintesUnidade = [];
  if (morta.tela.desmontar) {
    try {
      morta.tela.desmontar();
    } catch (e) {
      console.error('[casca] falha ao desmontar a tela "' + morta.id + '"', e);
    }
  }
}

/** Animação de saída: fade + 8px para cima. Nunca passa de 140ms. */
function animarSaida(no) {
  if (movimentoReduzido() || typeof no.animate !== 'function') return Promise.resolve();
  return new Promise(function (resolver) {
    let terminou = false;
    const fim = function () { if (!terminou) { terminou = true; resolver(); } };
    try {
      const bicho = no.animate(
        [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-8px)' }],
        { duration: SAIDA_MS, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' }
      );
      bicho.onfinish = fim;
      bicho.oncancel = fim;
    } catch (e) {
      fim();
      return;
    }
    setTimeout(fim, SAIDA_MS + 80);   /* rede de segurança: a troca nunca fica presa */
  });
}

/** Tira do DOM qualquer seção que ficou animando a saída. */
function limparSaindo() {
  if (!conteudo) return;
  const restos = conteudo.querySelectorAll('.ca-saindo');
  for (let i = 0; i < restos.length; i += 1) restos[i].remove();
}

async function trocarTela(def, destino) {
  if (!def) return;
  const minhaVez = (geracao += 1);

  desmontarAtiva();
  limparSaindo();

  const antiga = secaoAtual;
  secaoAtual = null;
  if (antiga) {
    antiga.classList.add('ca-saindo');
    antiga.setAttribute('aria-hidden', 'true');
    await animarSaida(antiga);
    antiga.remove();
    if (minhaVez !== geracao) return;    /* outra navegação passou na frente */
  }
  limparAvisoDeTela();

  // A unidade certa precisa estar valendo ANTES de montar, porque a tela lê
  // `ctx.unidadeAtual` logo no começo.
  definirUnidadeSilenciosa(def.escopo === 'rede' ? unidadeAtual : destino.slug);

  // Tela de unidade sem slug e sem lista ainda: esperar a primeira resposta da
  // rede evita que a tela nasça consultando a API com slug nulo.
  if (def.escopo === 'unidade' && !unidadeAtual && !redeRespondeu && temSessao()) {
    const espera = blocoEsperandoUnidades();
    conteudo.appendChild(espera);
    await esperarRede();
    espera.remove();
    if (minhaVez !== geracao) return;
    definirUnidadeSilenciosa(normalizarDestino(destino).slug);
    if (rotaAtual && rotaAtual.id === def.id) sincronizarUrlDaUnidade();
  }

  const secao = criar('section', 'ca-secao entrando');
  secao.id = 'tela-' + def.id;
  secao.tabIndex = -1;
  secao.setAttribute('aria-label', def.tela.titulo);
  conteudo.appendChild(secao);
  secaoAtual = secao;
  telaAtiva = { id: def.id, tela: def.tela };

  document.title = def.tela.titulo + ' · ' + NOME_APP;
  anunciar(def.tela.titulo);

  try {
    await def.tela.montar(secao, ctx);
  } catch (erro) {
    if (minhaVez !== geracao) return;
    console.error('[casca] a tela "' + def.id + '" falhou ao montar', erro);
    desmontarAtiva();
    secao.remove();
    secaoAtual = null;
    mostrarFalhaDeTela(def, erro);
    return;
  }

  if (minhaVez !== geracao) return;

  // O foco vai para a tela nova — menos na primeira montagem, para não roubar
  // o cursor de quem acabou de abrir o painel.
  if (!primeiraTroca) {
    try { secao.focus({ preventScroll: true }); } catch (e) { /* navegador antigo */ }
    window.scrollTo(0, 0);
  }
  primeiraTroca = false;

  revisarUnidadeDaRota();
}

/** Placa de carregamento enquanto a lista de unidades não chega. Não é dado. */
function blocoEsperandoUnidades() {
  const caixa = criar('div', 'ca-carregando ca-espera');
  const aviso = criar('span', 'sr-apenas', 'Carregando a lista de unidades…');
  const titulo = criar('div', 'esqueleto titulo');
  const bloco = criar('div', 'esqueleto bloco');
  caixa.appendChild(aviso);
  caixa.appendChild(titulo);
  caixa.appendChild(bloco);
  return caixa;
}

/** Faixa de erro quando montar() lança. A aplicação continua de pé. */
function mostrarFalhaDeTela(def, erro) {
  limparAvisoDeTela();
  const faixa = criar('div', 'aviso aviso-erro ca-falha-tela');
  faixa.setAttribute('role', 'alert');
  faixa.appendChild(icone(ICONES.alerta));

  const texto = criar('div', 'cresce');
  texto.appendChild(criar('span', 'aviso-titulo', 'Não consegui abrir "' + def.tela.titulo + '"'));
  const detalhe = (erro && erro.amigavel)
    || (erro && erro.message)
    || 'A tela parou antes de terminar de desenhar.';
  texto.appendChild(criar('span', 'aviso-texto', detalhe));
  faixa.appendChild(texto);

  const botao = criar('button', 'btn', 'Tentar de novo');
  botao.type = 'button';
  botao.addEventListener('click', function () {
    navegar(rotaAtual || { id: def.id, slug: unidadeAtual }, { forcar: true });
  });
  faixa.appendChild(botao);

  conteudo.appendChild(faixa);
  anunciar('Falha ao abrir ' + def.tela.titulo);
}

function limparAvisoDeTela() {
  if (!conteudo) return;
  const velhos = conteudo.querySelectorAll('.ca-falha-tela, .ca-espera, .ca-fora-da-lista');
  for (let i = 0; i < velhos.length; i += 1) velhos[i].remove();
}

/**
 * Se a URL pediu uma unidade que não veio na lista, a tela diz isso — em vez
 * de trocar por outra em silêncio e mostrar o dado de quem o usuário não pediu.
 */
function revisarUnidadeDaRota() {
  if (!conteudo || !rotaAtual) return;
  const antigo = conteudo.querySelector('.ca-fora-da-lista');
  if (antigo) antigo.remove();

  const def = acharTela(rotaAtual.id);
  if (!def || def.escopo === 'rede') return;
  if (!unidadeAtual || !unidades.length) return;
  if (unidadePorSlug(unidadeAtual)) return;

  const faixa = criar('div', 'aviso aviso-atencao ca-fora-da-lista');
  faixa.setAttribute('role', 'status');
  faixa.appendChild(icone(ICONES.alerta));
  const texto = criar('div', 'cresce');
  texto.appendChild(criar('span', 'aviso-titulo', 'Unidade "' + unidadeAtual + '" fora da lista'));
  texto.appendChild(criar('span', 'aviso-texto',
    'A API não devolveu nenhuma unidade com esse identificador. O link pode estar '
    + 'antigo ou a unidade pode ter saído da rede. Escolha outra no seletor do topo.'));
  faixa.appendChild(texto);
  const botao = criar('button', 'btn', 'Escolher unidade');
  botao.type = 'button';
  botao.addEventListener('click', function () { abrirSeletor(); });
  faixa.appendChild(botao);
  conteudo.insertBefore(faixa, conteudo.firstChild);
}

/* ═════════════════════════ 12. CASCA VISÍVEL ════════════════════════════ */

function garantirRaiz() {
  if (raiz) return;

  let alvo = document.getElementById('app');
  if (!alvo) {
    alvo = criar('div');
    alvo.id = 'app';
    document.body.appendChild(alvo);
  }

  const estilo = criar('style');
  estilo.id = 'ca-estilo';
  estilo.textContent = ESTILO;
  document.head.appendChild(estilo);

  raiz = criar('div', 'ca-raiz');
  raiz.dataset.modo = 'login';

  // Pular para o conteúdo: é um botão, não um link com href="#…", para não
  // mexer no hash que carrega a rota.
  const pular = criar('button', 'sr-apenas foco-mostra', 'Pular para o conteúdo');
  pular.type = 'button';
  pular.addEventListener('click', function () {
    if (!conteudo) return;
    conteudo.setAttribute('tabindex', '-1');
    conteudo.focus({ preventScroll: false });
  });
  raiz.appendChild(pular);

  conteudo = criar('main', 'ca-conteudo');
  conteudo.id = 'ca-conteudo';
  raiz.appendChild(conteudo);

  avisoVivo = criar('div', 'sr-apenas');
  avisoVivo.setAttribute('role', 'status');
  avisoVivo.setAttribute('aria-live', 'polite');
  raiz.appendChild(avisoVivo);

  alvo.appendChild(raiz);
}

function anunciar(texto) {
  if (!avisoVivo) return;
  avisoVivo.textContent = texto;
}

/** Monta trilho e cabeçalho uma vez só, quando há sessão. */
function garantirCasca() {
  garantirRaiz();
  raiz.dataset.modo = 'painel';
  if (trilho) {
    desenharUsuario();
    return;
  }

  trilho = montarTrilho();
  cabecalho = montarCabecalho();
  raiz.insertBefore(trilho, conteudo);
  raiz.insertBefore(cabecalho, conteudo);

  const recolhido = lerLocal(CHAVE_TRILHO) === 'sim';
  aplicarRecolhido(recolhido);
  desenharUsuario();
  desenharRelogio();
  desenharSeletorBotao();
}

function removerCasca() {
  garantirRaiz();
  raiz.dataset.modo = 'login';
  fecharSeletor();
  if (trilho) { trilho.remove(); trilho = null; navegacao = null; }
  if (cabecalho) { cabecalho.remove(); cabecalho = null; }
  elRelogioValor = null;
  elFalhaRede = null;
  elSeletorBotao = null;
  elSeletorNome = null;
  elSeletorPonto = null;
  elPainel = null;
  elBusca = null;
  elLista = null;
  elContagem = null;
  elBotaoSair = null;
  elRecolher = null;
}

/* --- Trilho ------------------------------------------------------------ */

function montarTrilho() {
  const caixa = criar('aside', 'ca-trilho');

  const marca = criar('div', 'ca-marca-bloco');
  const emblema = criar('span', 'ca-emblema marca', '360');
  emblema.setAttribute('aria-hidden', 'true');
  marca.appendChild(emblema);
  const textoMarca = criar('span', 'ca-marca-texto');
  textoMarca.appendChild(criar('span', 'ca-marca-nome marca', identidade.appCurto));
  textoMarca.appendChild(criar('span', 'ca-marca-sub', NOME_REDE));
  marca.appendChild(textoMarca);
  caixa.appendChild(marca);

  navegacao = criar('nav', 'ca-nav');
  navegacao.setAttribute('aria-label', 'Telas do painel');
  TELAS.filter(function (t) { return t.menu; }).forEach(function (t) {
    navegacao.appendChild(montarItem(t));
  });
  caixa.appendChild(navegacao);

  const rodape = criar('div', 'ca-rodape-trilho');

  elRecolher = criar('button', 'btn-icone ca-recolher');
  elRecolher.type = 'button';
  elRecolher.innerHTML = ICONES.recolher;
  elRecolher.setAttribute('aria-label', 'Recolher o menu');
  elRecolher.setAttribute('aria-expanded', 'true');
  elRecolher.setAttribute('aria-controls', 'ca-nav');
  elRecolher.addEventListener('click', function () {
    aplicarRecolhido(raiz.dataset.recolhido !== 'sim');
  });
  navegacao.id = 'ca-nav';
  rodape.appendChild(elRecolher);

  const assinatura = criar('div', 'ca-assinatura');
  const bolinha = criar('i');
  bolinha.setAttribute('aria-hidden', 'true');
  assinatura.appendChild(bolinha);
  assinatura.appendChild(criar('span', null, identidade.assinaturaCurta));
  assinatura.title = 'Plataforma desenvolvida pela Daco Vet';
  rodape.appendChild(assinatura);

  caixa.appendChild(rodape);
  return caixa;
}

/** Item de menu: ícone e rótulo saem do próprio módulo da tela. */
function montarItem(registro) {
  const botao = criar('button', 'ca-item');
  botao.type = 'button';
  botao.dataset.tela = registro.id;
  botao.setAttribute('aria-label', registro.tela.titulo);
  botao.title = registro.tela.titulo;
  botao.appendChild(icone(registro.tela.icone));
  botao.appendChild(criar('span', 'ca-item-rotulo', registro.tela.titulo));
  botao.appendChild(criar('span', 'ca-item-curto', rotuloCurto(registro.tela.titulo)));
  botao.addEventListener('click', function () { irPara(registro.id); });
  return botao;
}

function marcarItemAtivo() {
  if (!navegacao) return;
  const itens = navegacao.querySelectorAll('.ca-item');
  for (let i = 0; i < itens.length; i += 1) {
    const ativo = rotaAtual && itens[i].dataset.tela === rotaAtual.id;
    if (ativo) itens[i].setAttribute('aria-current', 'page');
    else itens[i].removeAttribute('aria-current');
  }
}

function aplicarRecolhido(recolhido) {
  raiz.dataset.recolhido = recolhido ? 'sim' : 'nao';
  gravarLocal(CHAVE_TRILHO, recolhido ? 'sim' : 'nao');
  if (elRecolher) {
    elRecolher.setAttribute('aria-label', recolhido ? 'Expandir o menu' : 'Recolher o menu');
    elRecolher.setAttribute('aria-expanded', recolhido ? 'false' : 'true');
    elRecolher.title = recolhido ? 'Expandir o menu' : 'Recolher o menu';
  }
}

/* --- Cabeçalho --------------------------------------------------------- */

function montarCabecalho() {
  const caixa = criar('header', 'ca-cabecalho');

  // Marca compacta: no celular o trilho vira barra inferior e perde a marca.
  const marca = criar('div', 'ca-marca-celular');
  const emblema = criar('span', 'ca-emblema marca', '360');
  emblema.setAttribute('aria-hidden', 'true');
  marca.appendChild(emblema);
  marca.appendChild(criar('span', 'ca-marca-nome marca', identidade.appCurto));
  caixa.appendChild(marca);

  caixa.appendChild(montarSeletor());

  const direita = criar('div', 'ca-direita');

  const relogioCaixa = criar('div', 'ca-relogio');
  relogioCaixa.appendChild(icone(ICONES.relogio));
  const textoRelogio = criar('div', 'ca-relogio-texto');
  textoRelogio.appendChild(criar('span', 'ca-relogio-rotulo', 'Atualizado'));
  elRelogioValor = criar('span', 'ca-relogio-valor numero', TRACINHO);
  textoRelogio.appendChild(elRelogioValor);
  relogioCaixa.appendChild(textoRelogio);
  direita.appendChild(relogioCaixa);

  elFalhaRede = criar('button', 'btn-icone ca-falha-rede');
  elFalhaRede.type = 'button';
  elFalhaRede.innerHTML = ICONES.alerta;
  elFalhaRede.setAttribute('aria-label', 'A última consulta à rede falhou. Tentar de novo agora');
  elFalhaRede.hidden = true;
  elFalhaRede.addEventListener('click', function () { recarregarRede(); });
  direita.appendChild(elFalhaRede);

  direita.appendChild(montarUsuario());

  elBotaoSair = criar('button', 'btn-icone');
  elBotaoSair.type = 'button';
  elBotaoSair.innerHTML = ICONES.sair;
  elBotaoSair.setAttribute('aria-label', 'Sair da conta');
  elBotaoSair.title = 'Sair da conta';
  elBotaoSair.addEventListener('click', sair);
  direita.appendChild(elBotaoSair);

  caixa.appendChild(direita);
  return caixa;
}

function montarUsuario() {
  const caixa = criar('div', 'ca-usuario');
  const avatar = criar('span', 'ca-avatar');
  avatar.setAttribute('aria-hidden', 'true');
  caixa.appendChild(avatar);
  const texto = criar('div', 'ca-usuario-texto');
  texto.appendChild(criar('span', 'ca-usuario-nome', ''));
  texto.appendChild(criar('span', 'ca-usuario-papel', ''));
  caixa.appendChild(texto);
  return caixa;
}

/** Nome e papel vêm da sessão. Sem nome, o avatar mostra ícone — não um apelido. */
function desenharUsuario() {
  if (!cabecalho) return;
  const usuario = sessaoDoCtx.usuario;
  const avatar = cabecalho.querySelector('.ca-avatar');
  const nome = cabecalho.querySelector('.ca-usuario-nome');
  const papel = cabecalho.querySelector('.ca-usuario-papel');
  if (!avatar || !nome || !papel) return;

  const letras = iniciais(usuario && usuario.nome);
  if (letras) {
    avatar.textContent = letras;
    avatar.removeAttribute('aria-hidden');
    avatar.setAttribute('role', 'img');
    avatar.setAttribute('aria-label', 'Conta de ' + usuario.nome);
  } else {
    avatar.innerHTML = ICONES.pessoa;
    avatar.setAttribute('aria-hidden', 'true');
    avatar.title = 'O servidor não informou o nome do usuário.';
  }

  nome.textContent = (usuario && usuario.nome) ? usuario.nome : 'Usuário sem nome';
  if (!(usuario && usuario.nome)) nome.title = 'O login não devolveu o nome do usuário.';
  papel.textContent = (usuario && usuario.papel) ? usuario.papel : '';
  papel.hidden = !(usuario && usuario.papel);
}

/** Relógio da última atualização: o horário é o do servidor, não o do navegador. */
function desenharRelogio() {
  if (!elRelogioValor) return;
  const quando = rede && rede.atualizado_em ? rede.atualizado_em : null;
  if (!quando) {
    elRelogioValor.textContent = TRACINHO;
    elRelogioValor.title = 'O servidor ainda não informou quando calculou o retrato da rede.';
    return;
  }
  elRelogioValor.textContent = formatarQuando(quando);
  elRelogioValor.title = 'Momento em que o servidor calculou o retrato da rede.';
}

/* --- Seletor de unidade ------------------------------------------------ */

function montarSeletor() {
  const caixa = criar('div', 'ca-seletor');

  elSeletorBotao = criar('button', 'ca-seletor-botao');
  elSeletorBotao.type = 'button';
  elSeletorBotao.id = 'ca-seletor-botao';
  elSeletorBotao.setAttribute('aria-haspopup', 'listbox');
  elSeletorBotao.setAttribute('aria-expanded', 'false');
  elSeletorBotao.setAttribute('aria-controls', 'ca-painel-unidades');

  elSeletorPonto = criar('span', 'ponto-vivo');
  elSeletorPonto.setAttribute('aria-hidden', 'true');
  elSeletorBotao.appendChild(elSeletorPonto);
  elSeletorNome = criar('span', 'ca-seletor-nome', 'Toda a rede');
  elSeletorBotao.appendChild(elSeletorNome);
  const seta = criar('span');
  seta.setAttribute('aria-hidden', 'true');
  seta.innerHTML = ICONES.seta;
  elSeletorBotao.appendChild(seta.firstChild);
  elSeletorBotao.addEventListener('click', function () {
    if (elPainel.hidden) abrirSeletor();
    else fecharSeletor();
  });
  caixa.appendChild(elSeletorBotao);

  elPainel = criar('div', 'ca-painel');
  elPainel.id = 'ca-painel-unidades';
  elPainel.hidden = true;

  const busca = criar('div', 'ca-busca');
  busca.appendChild(icone(ICONES.busca));
  elBusca = criar('input');
  elBusca.type = 'search';
  elBusca.placeholder = 'Buscar unidade pelo nome';
  elBusca.setAttribute('aria-label', 'Buscar unidade pelo nome');
  elBusca.autocomplete = 'off';
  elBusca.addEventListener('input', function () { desenharLista(); });
  elBusca.addEventListener('keydown', function (evento) {
    if (evento.key === 'ArrowDown') {
      evento.preventDefault();
      focarOpcao(0);
    }
  });
  busca.appendChild(elBusca);
  elPainel.appendChild(busca);

  elContagem = criar('p', 'ca-contagem legenda', '');
  elContagem.setAttribute('role', 'status');
  elPainel.appendChild(elContagem);

  elLista = criar('ul', 'ca-lista rolagem-fina');
  elPainel.appendChild(elLista);

  caixa.appendChild(elPainel);
  return caixa;
}

function abrirSeletor() {
  if (!elPainel) return;
  elPainel.hidden = false;
  elSeletorBotao.setAttribute('aria-expanded', 'true');
  elBusca.value = '';
  desenharLista();
  try { elBusca.focus({ preventScroll: true }); } catch (e) { elBusca.focus(); }
  document.addEventListener('pointerdown', cliqueFora, true);
  document.addEventListener('keydown', teclaNoSeletor, true);
}

function fecharSeletor(devolverFoco) {
  if (!elPainel || elPainel.hidden) return;
  elPainel.hidden = true;
  elSeletorBotao.setAttribute('aria-expanded', 'false');
  document.removeEventListener('pointerdown', cliqueFora, true);
  document.removeEventListener('keydown', teclaNoSeletor, true);
  if (devolverFoco) {
    try { elSeletorBotao.focus({ preventScroll: true }); } catch (e) { elSeletorBotao.focus(); }
  }
}

function cliqueFora(evento) {
  if (!elPainel || elPainel.hidden) return;
  const dentro = elPainel.contains(evento.target) || elSeletorBotao.contains(evento.target);
  if (!dentro) fecharSeletor(false);
}

function teclaNoSeletor(evento) {
  if (!elPainel || elPainel.hidden) return;
  if (evento.key === 'Escape') {
    evento.preventDefault();
    fecharSeletor(true);
    return;
  }
  if (evento.key === 'Tab') {
    // Sair do painel pelo teclado fecha o painel — não deixa um menu aberto
    // "fantasma" enquanto o foco já está em outro lugar.
    setTimeout(function () {
      if (elPainel && !elPainel.hidden && !elPainel.contains(document.activeElement)
        && document.activeElement !== elSeletorBotao) {
        fecharSeletor(false);
      }
    }, 0);
    return;
  }
  const opcoes = elLista ? elLista.querySelectorAll('.ca-opcao') : [];
  if (!opcoes.length) return;
  let indice = -1;
  for (let i = 0; i < opcoes.length; i += 1) {
    if (opcoes[i] === document.activeElement) { indice = i; break; }
  }
  if (evento.key === 'ArrowDown') {
    evento.preventDefault();
    focarOpcao(indice + 1);
  } else if (evento.key === 'ArrowUp') {
    evento.preventDefault();
    if (indice <= 0) { try { elBusca.focus(); } catch (e) { /* segue */ } }
    else focarOpcao(indice - 1);
  } else if (evento.key === 'Home') {
    evento.preventDefault();
    focarOpcao(0);
  } else if (evento.key === 'End') {
    evento.preventDefault();
    focarOpcao(opcoes.length - 1);
  }
}

function focarOpcao(indice) {
  const opcoes = elLista ? elLista.querySelectorAll('.ca-opcao') : [];
  if (!opcoes.length) return;
  const alvo = Math.max(0, Math.min(indice, opcoes.length - 1));
  try { opcoes[alvo].focus({ preventScroll: false }); } catch (e) { opcoes[alvo].focus(); }
}

/** Texto e bolinha do botão do seletor. */
function desenharSeletorBotao() {
  if (!elSeletorBotao) return;
  const u = unidadePorSlug(unidadeAtual);

  if (!unidadeAtual) {
    elSeletorNome.textContent = 'Toda a rede';
    elSeletorPonto.dataset.estado = 'parado';
    const total = rede && typeof rede.unidades_total === 'number' ? rede.unidades_total : null;
    elSeletorBotao.setAttribute('aria-label', total === null
      ? 'Unidade: toda a rede. Trocar de unidade'
      : 'Unidade: toda a rede, ' + total + ' unidades. Trocar de unidade');
    elSeletorBotao.title = 'Trocar de unidade';
    return;
  }

  elSeletorNome.textContent = nomeDaUnidade(unidadeAtual);
  const estado = estadoDaUnidade(u);
  if (estado.ponto) elSeletorPonto.dataset.estado = estado.ponto;
  else delete elSeletorPonto.dataset.estado;
  const complemento = u ? estado.texto : 'ainda não confirmada pela API';
  elSeletorBotao.setAttribute('aria-label',
    'Unidade: ' + nomeDaUnidade(unidadeAtual) + ', ' + complemento + '. Trocar de unidade');
  elSeletorBotao.title = complemento;
}

/** Lista do painel, filtrada pela busca. Nunca inventa linha. */
function desenharLista() {
  if (!elLista) return;
  elLista.textContent = '';

  const def = rotaAtual ? acharTela(rotaAtual.id) : null;
  const aceitaRede = !def || def.escopo !== 'unidade';
  const filtro = chaveDeBusca(elBusca ? elBusca.value : '');

  if (!unidades.length) {
    elContagem.textContent = '';
    const item = criar('li');
    item.appendChild(erroRede ? blocoErroDaLista() : blocoListaVazia());
    elLista.appendChild(item);
    return;
  }

  const achadas = unidades.filter(function (u) {
    if (!filtro) return true;
    return chaveDeBusca((u && u.nome) || '').indexOf(filtro) >= 0
      || chaveDeBusca((u && u.slug) || '').indexOf(filtro) >= 0;
  });

  elContagem.textContent = filtro
    ? achadas.length + ' de ' + unidades.length + ' unidades'
    : unidades.length + (unidades.length === 1 ? ' unidade' : ' unidades');

  if (aceitaRede && !filtro) {
    elLista.appendChild(montarOpcao(null));
  }

  if (!achadas.length) {
    const item = criar('li');
    const vazio = criar('div', 'vazio');
    vazio.appendChild(criar('p', 'vazio-titulo', 'Nenhuma unidade com esse nome'));
    vazio.appendChild(criar('p', 'vazio-texto', 'Apague parte da busca para ver a rede inteira.'));
    item.appendChild(vazio);
    elLista.appendChild(item);
    return;
  }

  achadas.forEach(function (u) { elLista.appendChild(montarOpcao(u)); });
}

function blocoListaVazia() {
  const vazio = criar('div', 'vazio');
  vazio.appendChild(criar('p', 'vazio-titulo', 'Nenhuma unidade cadastrada'));
  vazio.appendChild(criar('p', 'vazio-texto',
    'A ação visao_geral respondeu sem unidades. Confira o cadastro no banco antes de '
    + 'procurar erro na tela — o painel não preenche esta lista sozinho.'));
  return vazio;
}

function blocoErroDaLista() {
  const vazio = criar('div', 'vazio');
  vazio.appendChild(criar('p', 'vazio-titulo', 'Não consegui carregar as unidades'));
  vazio.appendChild(criar('p', 'vazio-texto',
    (erroRede && erroRede.amigavel) || 'A consulta à rede falhou.'));
  const botao = criar('button', 'btn btn-primario', 'Tentar de novo');
  botao.type = 'button';
  botao.addEventListener('click', function () { recarregarRede(); desenharLista(); });
  vazio.appendChild(botao);
  return vazio;
}

/** Uma linha do seletor. `u` nulo é a opção "Toda a rede". */
function montarOpcao(u) {
  const item = criar('li');
  const botao = criar('button', 'ca-opcao');
  botao.type = 'button';

  const slug = u ? u.slug : null;
  const escolhida = (slug || null) === (unidadeAtual || null);
  if (escolhida) botao.setAttribute('aria-current', 'true');

  const ponto = criar('span', 'ponto-vivo');
  ponto.setAttribute('aria-hidden', 'true');
  const estado = u
    ? estadoDaUnidade(u)
    : { ponto: 'parado', texto: 'Soma de todas as unidades' };
  if (estado.ponto) ponto.dataset.estado = estado.ponto;
  botao.appendChild(ponto);

  const texto = criar('div', 'ca-opcao-texto');
  texto.appendChild(criar('span', 'ca-opcao-nome', u ? (u.nome || u.slug) : 'Toda a rede'));
  texto.appendChild(criar('span', 'ca-opcao-estado', estado.texto));
  botao.appendChild(texto);

  botao.setAttribute('aria-label',
    (u ? (u.nome || u.slug) : 'Toda a rede') + '. ' + estado.texto);

  botao.addEventListener('click', function () {
    fecharSeletor(true);
    trocarUnidade(slug);
    desenharSeletorBotao();
    revisarUnidadeDaRota();
  });

  item.appendChild(botao);
  return item;
}

/* ═════════════════════════ 13. DADOS DA REDE ════════════════════════════ */

function esperarRede() {
  if (redeRespondeu) return Promise.resolve();
  if (!esperaDaRede) {
    let resolver;
    const promessa = new Promise(function (r) { resolver = r; });
    esperaDaRede = { promessa: promessa, resolver: resolver };
  }
  return esperaDaRede.promessa;
}

function soltarEspera() {
  redeRespondeu = true;
  if (esperaDaRede) {
    const pendente = esperaDaRede;
    esperaDaRede = null;
    pendente.resolver();
  }
}

/**
 * Assina `visao_geral` só para o que a casca precisa: a lista do seletor e o
 * relógio. O cache do dados.js faz esta consulta servir também à tela de
 * visão geral, então não é uma chamada a mais no n8n a cada minuto.
 */
function ligarRede() {
  if (pararRede) return;
  pararRede = assinarAtualizacao('visao_geral', {}, INTERVALO_REDE_MS, function (dados, erro) {
    if (erro) {
      // Sessão inválida já derruba tudo pelo evento do dados.js.
      if (ehErroDeSessao(erro)) return;
      erroRede = erro;
      if (elFalhaRede) {
        elFalhaRede.hidden = false;
        elFalhaRede.title = erro.amigavel;
      }
      soltarEspera();
      if (elPainel && !elPainel.hidden) desenharLista();
      return;
    }

    erroRede = null;
    if (elFalhaRede) { elFalhaRede.hidden = true; elFalhaRede.title = ''; }

    unidades = dados && Array.isArray(dados.unidades) ? dados.unidades : [];
    rede = dados && dados.rede ? dados.rede : null;

    desenharRelogio();
    desenharSeletorBotao();
    if (elPainel && !elPainel.hidden) desenharLista();

    // Primeira lista: a tela de unidade que abriu sem slug agora ganha um.
    const def = rotaAtual ? acharTela(rotaAtual.id) : null;
    if (def && def.escopo === 'unidade' && !unidadeAtual) {
      const escolhida = unidadeLembrada() || primeiraUnidade();
      if (escolhida) trocarUnidade(escolhida);
    }
    revisarUnidadeDaRota();
    soltarEspera();
  });

  if (!relogio) relogio = setInterval(desenharRelogio, INTERVALO_RELOGIO_MS);
}

function desligarRede() {
  if (pararRede) { pararRede(); pararRede = null; }
  if (relogio) { clearInterval(relogio); relogio = null; }
  unidades = [];
  rede = null;
  erroRede = null;
  redeRespondeu = false;
  if (esperaDaRede) { const p = esperaDaRede; esperaDaRede = null; p.resolver(); }
}

/** Cancela e reassina: a assinatura consulta na hora ao nascer. */
function recarregarRede() {
  if (pararRede) { pararRede(); pararRede = null; }
  redeRespondeu = false;
  ligarRede();
}

/* ═════════════════════════ 14. LOGIN E SAÍDA ════════════════════════════ */

function mostrarLogin() {
  garantirRaiz();
  desligarRede();
  removerCasca();
  document.title = 'Entrar · ' + NOME_APP;

  const def = acharTela('login');
  rotaAtual = { id: 'login', slug: null };
  trocarTela(def, rotaAtual);
}

async function sair() {
  if (saindo) return;
  saindo = true;
  if (elBotaoSair) {
    elBotaoSair.disabled = true;
    elBotaoSair.setAttribute('aria-busy', 'true');
  }
  try {
    await api.sair();
  } finally {
    saindo = false;
    rotaPretendida = null;
    unidadeAtual = null;
    // A URL não pode continuar apontando para a unidade de quem acabou de sair.
    try { history.replaceState(history.state, '', location.pathname + location.search + '#/'); }
    catch (e) { location.hash = '#/'; }
    mostrarLogin();
    mostrarFaixa('aviso-ok', 'Você saiu', 'A sessão foi encerrada neste navegador.');
  }
}

/** Faixa fixa no topo, para sessão e conexão. Some no X ou no próximo login. */
function mostrarFaixa(tom, titulo, texto) {
  garantirRaiz();
  const antiga = document.querySelector('.ca-faixa');
  if (antiga) antiga.remove();

  const faixa = criar('div', 'aviso ' + tom + ' ca-faixa');
  faixa.setAttribute('role', 'status');
  faixa.appendChild(icone(tom === 'aviso-ok' ? ICONES.certo : ICONES.alerta));
  const corpo = criar('div', 'cresce');
  corpo.appendChild(criar('span', 'aviso-titulo', titulo));
  corpo.appendChild(criar('span', 'aviso-texto', texto));
  faixa.appendChild(corpo);

  const fechar = criar('button', 'btn-icone ca-faixa-fechar');
  fechar.type = 'button';
  fechar.innerHTML = ICONES.fechar;
  fechar.setAttribute('aria-label', 'Fechar o aviso');
  fechar.addEventListener('click', function () { faixa.remove(); });
  faixa.appendChild(fechar);

  raiz.appendChild(faixa);
}

function limparFaixa() {
  const antiga = document.querySelector('.ca-faixa');
  if (antiga) antiga.remove();
}

/* ═════════════════════════ 15. EVENTOS GLOBAIS ══════════════════════════ */

window.addEventListener('hashchange', function () {
  aplicarRota();
});

/* O dados.js dispara isto quando o servidor recusa o token. */
window.addEventListener('sessao-expirou', function () {
  if (rotaAtual && rotaAtual.id !== 'login') rotaPretendida = rotaAtual;
  mostrarLogin();
  mostrarFaixa('aviso-atencao', 'Sua sessão expirou',
    'Entre de novo para continuar. A tela que você estava vendo volta depois do login.');
});

/* Sinal opcional para o módulo de login: quem preferir avisar por evento em vez
   de chamar ctx.irPara() também é atendido. */
window.addEventListener('sessao-iniciada', function () {
  if (temSessao()) { limparFaixa(); aplicarRota(); }
});

/* Entrou ou saiu em outra aba do mesmo navegador: esta aba acompanha. */
window.addEventListener('storage', function (evento) {
  if (!evento || String(evento.key || '').indexOf('wa360.sessao') !== 0) return;
  const dentro = temSessao();
  const estavaNoLogin = !rotaAtual || rotaAtual.id === 'login';
  if (dentro && estavaNoLogin) { limparFaixa(); aplicarRota(); }
  if (!dentro && !estavaNoLogin) mostrarLogin();
});

/* ═════════════════════════ 16. INÍCIO ═══════════════════════════════════ */

function iniciar() {
  garantirRaiz();
  aplicarRota();
}

/* `type="module"` já roda depois do parse, mas a checagem mantém a casca segura
   se alguém carregar este arquivo de outro jeito. */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', iniciar, { once: true });
} else {
  iniciar();
}
