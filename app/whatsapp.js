/*
  whatsapp.js — aba "WhatsApp ao Vivo" do WhatsApp 360° Vision.

  Réplica da interface de conversa do WhatsApp, vestida com o visual da
  plataforma: três painéis no desktop (lista de conversas | conversa aberta |
  ficha do contato) e um painel por vez no celular, com navegação para trás.

  O que esta tela é: uma janela de leitura sobre o que a ingestão gravou. Ela
  não envia mensagem, não edita nada e não guarda estado no servidor.

  ── De onde vem cada dado (seção 3 do CONTRATO.md) ───────────────────────────

  api.conversas(slug, { busca, pagina })  →
    { unidade: 'Apaixonados Méier',
      motivo: 'captura_nao_ligada' | ausente,
      fim: true|false,
      conversas: [{
        id, nome|null, telefone|null, tipo_contato,
        iniciada_em, ultima_mensagem_em,
        previa: { quem: 'tutor'|'clinica', tipo, texto, hora } | null,
        aguardando_resposta: true|false
      }] }

  api.conversa(conversa_id)  →  (RPC conversa_completa)
    { conversa_id, contato|nome, telefone, tipo|tipo_contato, tipo_motivo,
      iniciada_em, primeiro_contato_em, total_conversas,
      primeira_resposta_min, maior_espera_min,
      mensagens: [{
        quem: 'contato'|'tutor'|'clinica', autor: 'ia'|'humano'|null,
        tipo: 'texto'|'audio'|'imagem'|'documento'|'video'|'localizacao',
        texto|conteudo, transcrito: true|false,
        midia: { mimetype, bytes, segundos } | null,
        enviada_em (ISO)  ou  dia ('DD/MM') + hora ('14h02'),
        push_name
      }] }

  Os dois formatos de `quem` convivem de propósito: a lista devolve
  'tutor'/'clinica' e a RPC devolve 'contato'/'clinica'. `ladoDaMensagem()`
  normaliza os dois e NÃO chuta nada além disso — nome de campo que o banco
  nunca devolveu já zerou relatório aqui antes.

  ── Regras que este arquivo obedece ─────────────────────────────────────────

  1. Nada de dado inventado. Sem tutor de exemplo, sem métrica estimada, sem
     balão de demonstração. Faltou dado? Entra o estado vazio explicando o que
     falta e o que fazer.
  2. null não é zero. Campo que não veio vira tracinho com `title` dizendo por
     que não há medida. Zero medido continua sendo 0.
  3. Nenhum balão anônimo. Todo balão mostra QUEM FALOU, com nome: o primeiro
     nome do tutor de um lado e "Clínica" do outro. Sem isso não dá para
     entender a conversa — foi a lição de uma análise anterior.
  4. Mídia não existe aqui: o banco guarda só o metadado (foi base64 em coluna
     que derrubou o banco antigo). Imagem, vídeo e documento aparecem como
     metadado, e o rodapé diz isso.
  5. Só classes com o prefixo `wa-`, além das compartilhadas do tema.css.
     Nenhum token e nenhum componente do tema é redefinido aqui.
  6. Todo timer, listener, observador e assinatura entra em `estado.limpezas` e
     morre em `desmontar()`.
*/

import {
  api,
  assinarAtualizacao,
  ehErroDeSessao,
  formatarQuando,
  formatarTelefone,
  formatarMinutos,
  formatarNumero,
  primeiroNome,
  TRACINHO,
} from './dados.js';

/* ═════════════════════════ 1. CONSTANTES ════════════════════════════════ */

/** De quanto em quanto tempo a lista e a conversa aberta reconsultam o servidor. */
const AO_VIVO_MS = 10000;

/** De quanto em quanto tempo o texto "há 8 min" da lista é reescrito. */
const RELOGIO_MS = 60000;

/** Espera depois da última tecla antes de consultar a busca no servidor. */
const ESPERA_BUSCA_MS = 350;

/** Distância do fim da rolagem que ainda conta como "está lendo o fim". */
const COLADO_PX = 64;

/** Quantos pixels antes do fim da lista disparam a próxima página. */
const MARGEM_PAGINA_PX = 320;

/** Filtros da lista. `prova` diz, em português, o que cada um mede de fato. */
const FILTROS = [
  {
    id: 'todas',
    rotulo: 'Todas',
    dica: 'Todas as conversas já carregadas desta unidade.',
    vazioTitulo: 'Nenhuma conversa gravada até agora',
    vazioTexto: 'A captura está ligada, mas ainda não chegou nenhuma mensagem desta unidade. '
      + 'Assim que a primeira conversa for gravada ela aparece aqui sozinha: esta tela '
      + 'reconsulta o servidor a cada 10 segundos.',
  },
  {
    id: 'sem-resposta',
    rotulo: 'Sem resposta',
    dica: 'Conversas em que a última mensagem foi do tutor e a clínica ainda não respondeu.',
    vazioTitulo: 'Nenhuma conversa esperando resposta',
    vazioTexto: 'Em todas as conversas carregadas, a última mensagem foi da clínica. '
      + 'Isso é medido pela direção da última mensagem gravada, não por leitura do conteúdo.',
  },
  {
    id: 'audio',
    rotulo: 'Com áudio',
    dica: 'A lista só traz o tipo da ÚLTIMA mensagem de cada conversa, então este filtro '
      + 'mostra as conversas cuja última mensagem é um áudio. Áudios mais antigos aparecem '
      + 'ao abrir a conversa.',
    vazioTitulo: 'Nenhuma conversa com áudio na última mensagem',
    vazioTexto: 'A lista de conversas só informa o tipo da última mensagem de cada uma. '
      + 'Pode haver áudio mais atrás na conversa: abra a conversa para ver todos eles.',
  },
  {
    id: 'hoje',
    rotulo: 'Só de hoje',
    dica: 'Conversas cuja última mensagem é de hoje, pelo relógio deste computador.',
    vazioTitulo: 'Nenhuma conversa com mensagem de hoje',
    vazioTexto: 'Entre as conversas carregadas, nenhuma teve mensagem hoje. '
      + 'O dia é o deste computador; role a lista para carregar conversas mais antigas.',
  },
];

/** Rótulo de tela para cada tipo de contato do banco (contatos.tipo). */
const TIPOS_DE_CONTATO = {
  tutor: { rotulo: 'Tutor', selo: 'selo-ok' },
  equipe: { rotulo: 'Equipe', selo: 'selo-neutro' },
  fornecedor: { rotulo: 'Fornecedor', selo: 'selo-neutro' },
  outro: { rotulo: 'Outro', selo: 'selo-neutro' },
  desconhecido: { rotulo: 'Não classificado', selo: 'selo-atencao' },
};

/** Rótulo de tela para cada tipo de mensagem (mensagens.tipo). */
const TIPOS_DE_MENSAGEM = {
  texto: 'Texto',
  audio: 'Áudio',
  imagem: 'Imagem',
  documento: 'Documento',
  video: 'Vídeo',
  localizacao: 'Localização',
};

/** Autoria da mensagem nas unidades com agente de IA (mensagens.autor). */
const AUTORIAS = {
  ia: { rotulo: 'IA', dica: 'Mensagem enviada pelo agente de IA, antes da recepção.' },
  humano: { rotulo: 'Recepção', dica: 'Mensagem enviada por uma pessoa da recepção.' },
};

/* ═════════════════════════ 2. ÍCONES ════════════════════════════════════
   24×24, currentColor, sem fill fixo — como manda a seção 6 do contrato.
   ════════════════════════════════════════════════════════════════════════ */

/* `width`/`height` no próprio SVG de propósito: atributo de apresentação perde
   para qualquer regra de CSS, então o tamanho padrão nunca vira 150px quando o
   ícone cai num contexto sem regra de tamanho. */
const ABRE = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
  + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" '
  + 'focusable="false">';

const ICONES = {
  balao: ABRE + '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.6-.7L3 21l1.9-5.1A8.3 8.3'
    + ' 0 0 1 4 11.5 8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5Z"/>'
    + '<path d="M8.5 10.5h8"/><path d="M8.5 14h5"/></svg>',
  busca: ABRE + '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>',
  audio: ABRE + '<rect x="9" y="3" width="6" height="11" rx="3"/>'
    + '<path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v3"/></svg>',
  imagem: ABRE + '<rect x="3" y="4" width="18" height="16" rx="3"/>'
    + '<circle cx="8.8" cy="9.5" r="1.6"/><path d="m4 17 4.6-4.4 3.3 3 3-2.6L20 17"/></svg>',
  documento: ABRE + '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/>'
    + '<path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/></svg>',
  video: ABRE + '<rect x="3" y="5" width="13" height="14" rx="3"/>'
    + '<path d="m16 10 5-2.6v9.2L16 14Z"/></svg>',
  local: ABRE + '<path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z"/>'
    + '<circle cx="12" cy="10" r="2.6"/></svg>',
  pessoa: ABRE + '<circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>',
  ficha: ABRE + '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.8h.01"/></svg>',
  voltar: ABRE + '<path d="m14 18-6-6 6-6"/></svg>',
  descer: ABRE + '<path d="M12 5v13"/><path d="m6 13 6 6 6-6"/></svg>',
  alerta: ABRE + '<path d="M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3'
    + 'l-7.9-13.7a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4.5"/><path d="M12 17.2h.01"/></svg>',
  relogio: ABRE + '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></svg>',
  sino: ABRE + '<path d="M6 9a6 6 0 0 1 12 0c0 4.2 1.4 5.6 1.4 5.6H4.6S6 13.2 6 9Z"/>'
    + '<path d="M10.2 18.4a2 2 0 0 0 3.6 0"/></svg>',
  vazio: ABRE + '<rect x="3" y="4" width="18" height="16" rx="3"/>'
    + '<path d="M7.5 10h9"/><path d="M7.5 14h5"/></svg>',
};

/** Ícone do tipo da mensagem. Tipo desconhecido cai no ícone de documento. */
function iconeDoTipo(tipo) {
  if (tipo === 'audio') return ICONES.audio;
  if (tipo === 'imagem') return ICONES.imagem;
  if (tipo === 'video') return ICONES.video;
  if (tipo === 'localizacao') return ICONES.local;
  return ICONES.documento;
}

/* ═════════════════════════ 3. ESTILO DO MÓDULO ══════════════════════════
   Só peças que existem nesta tela, todas com o prefixo `wa-` e construídas
   com os tokens do tema. Injetado uma vez; a mesma folha serve a todas as
   montagens da tela.
   ════════════════════════════════════════════════════════════════════════ */

const ESTILO = `
/* --- Armação ---------------------------------------------------------- */
.wa { display: flex; flex-direction: column; gap: var(--esp-16); min-width: 0; }

/* [hidden] perde para o display de uma classe — a mesma armadilha que a casca
   já pagou no botão de falha da rede. Todo nó desta tela que esconde por
   propriedade precisa da regra explícita. */
.wa [hidden] { display: none !important; }

/* O ícone do estado vazio ocupa a caixa que o tema dimensionou. */
.wa .vazio-icone { display: inline-flex; }
.wa .vazio-icone svg { width: 100%; height: 100%; }

.wa-topo { display: flex; align-items: flex-start; gap: var(--esp-12); flex-wrap: wrap; }
.wa-topo-texto { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.wa-topo-sub { font-size: var(--txt-pequeno); font-weight: 600; color: var(--tinta-2); }
.wa-topo-selos { display: flex; align-items: center; gap: var(--esp-8); flex-wrap: wrap; margin-left: auto; }

.wa-quadro {
  display: grid;
  grid-template-columns: minmax(258px, 340px) minmax(0, 1fr) minmax(248px, 316px);
  grid-template-areas: "lista conversa ficha";
  gap: var(--esp-12);
  height: clamp(460px, calc(100dvh - 208px), 980px);
  min-width: 0;
}

.wa-painel {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--carta);
  border: 1px solid var(--linha);
  border-radius: var(--r);
  box-shadow: var(--sombra-1);
  overflow: hidden;
}
.wa-lista-painel { grid-area: lista; }
.wa-conversa-painel { grid-area: conversa; }
.wa-ficha-painel { grid-area: ficha; }

.wa-cabeca {
  display: flex;
  align-items: center;
  gap: var(--esp-8);
  flex: none;
  min-height: 62px;
  padding: var(--esp-8) var(--esp-12);
  background: var(--fundo-2);
  border-bottom: 1px solid var(--linha);
}
.wa-cabeca-texto { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1 1 auto; }
.wa-cabeca-nome {
  font-family: var(--fonte-titulo);
  font-size: var(--txt-base);
  font-weight: 700;
  color: var(--tinta);
  letter-spacing: -.01em;
}
.wa-cabeca-sub { font-size: var(--txt-legenda); font-weight: 600; color: var(--tinta-3); }

/* Botões de navegação entre painéis: só existem nas larguras onde fazem falta. */
.wa-voltar, .wa-abrir-ficha { display: none; }

/* --- Lista de conversas ------------------------------------------------ */
.wa-busca {
  display: flex;
  align-items: center;
  gap: var(--esp-8);
  flex: 1 1 auto;
  min-width: 0;
  min-height: var(--alvo-toque);
  padding: 0 var(--esp-12);
  background: var(--carta-2);
  border: 1px solid var(--linha);
  border-radius: var(--r-p);
  transition: border-color var(--transicao), box-shadow var(--transicao);
}
.wa-busca:focus-within { border-color: var(--indigo); box-shadow: var(--anel-foco); }
.wa-busca svg { width: 18px; height: 18px; color: var(--tinta-3); flex: none; }
.wa-busca input {
  width: 100%;
  min-width: 0;
  background: transparent;
  border: 0;
  color: var(--tinta);
  font-family: var(--fonte-texto);
  font-size: var(--txt-base);
  font-weight: 600;
}
.wa-busca input:focus { outline: none; }
.wa-busca input::placeholder { color: var(--tinta-3); font-weight: 500; }

.wa-filtros {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex: none;
  padding: var(--esp-8) var(--esp-12);
  border-bottom: 1px solid var(--linha);
}
.wa-filtro {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: var(--alvo-toque);
  padding: 0 var(--esp-12);
  background: var(--carta-2);
  border: 1px solid var(--linha);
  border-radius: var(--r-redondo);
  color: var(--tinta-2);
  font-family: var(--fonte-texto);
  font-size: var(--txt-legenda);
  font-weight: 700;
  letter-spacing: .04em;
  text-transform: uppercase;
  white-space: nowrap;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--transicao), border-color var(--transicao), color var(--transicao);
}
.wa-filtro:hover { background: var(--linha); color: var(--tinta); }
.wa-filtro[aria-pressed="true"] {
  background: var(--veu-indigo);
  border-color: rgba(91, 91, 214, .45);
  color: var(--indigo-cl);
}
.wa-filtro-conta {
  font-variant-numeric: tabular-nums;
  font-weight: 800;
  color: var(--tinta-3);
}
.wa-filtro[aria-pressed="true"] .wa-filtro-conta { color: var(--indigo-cl); }

.wa-conta-linha {
  display: flex;
  align-items: center;
  gap: var(--esp-8);
  flex: none;
  padding: var(--esp-8) var(--esp-12);
  border-bottom: 1px solid var(--linha);
}

.wa-lista {
  flex: 1 1 auto;
  min-height: 0;
  margin: 0;
  padding: var(--esp-8);
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.wa-linha {
  display: flex;
  align-items: center;
  gap: var(--esp-12);
  width: 100%;
  min-height: 64px;
  padding: var(--esp-8) var(--esp-12);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--r-p);
  color: var(--tinta);
  font-family: var(--fonte-texto);
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--transicao), border-color var(--transicao);
}
.wa-linha:hover { background: var(--carta-2); }
.wa-linha[aria-current="true"] {
  background: var(--veu-indigo);
  border-color: rgba(91, 91, 214, .40);
}
.wa-linha-corpo { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1 1 auto; }
.wa-linha-alto, .wa-linha-baixo { display: flex; align-items: center; gap: var(--esp-8); min-width: 0; }
.wa-linha-nome {
  font-family: var(--fonte-titulo);
  font-size: var(--txt-pequeno);
  font-weight: 700;
  color: var(--tinta);
  flex: 1 1 auto;
}
/* Horário relativo da última mensagem. Quando a clínica ainda não respondeu,
   este mesmo lugar vira o marcador de espera: o número passa a significar
   "há quanto tempo o tutor está esperando", que é o que o dono quer ver. */
.wa-linha-hora {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  font-size: var(--txt-legenda);
  font-weight: 700;
  color: var(--tinta-3);
  white-space: nowrap;
}
.wa-linha-hora svg { width: 12px; height: 12px; }
.wa-linha-hora[data-espera="sim"] {
  padding: 2px 8px;
  border-radius: var(--r-redondo);
  background: var(--veu-atencao);
  border: 1px solid rgba(255, 201, 60, .34);
  color: var(--atencao);
  font-weight: 800;
}
.wa-previa {
  font-size: var(--txt-pequeno);
  font-weight: 500;
  color: var(--tinta-2);
  flex: 1 1 auto;
}
.wa-previa-quem { font-weight: 700; color: var(--tinta-3); }
.wa-previa svg { width: 14px; height: 14px; display: inline-block; vertical-align: -2px; margin-right: 4px; }

.wa-avatar {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  flex: none;
  border-radius: 50%;
  background: var(--carta-2);
  border: 1px solid var(--linha-2);
  color: var(--tinta-2);
  font-family: var(--fonte-titulo);
  font-size: var(--txt-pequeno);
  font-weight: 800;
  letter-spacing: .02em;
}
.wa-avatar svg { width: 20px; height: 20px; }
.wa-avatar.wa-avatar-p { width: 34px; height: 34px; font-size: var(--txt-legenda); }
.wa-linha[aria-current="true"] .wa-avatar { border-color: var(--indigo); color: var(--tinta); }

.wa-rodape-lista {
  flex: none;
  padding: var(--esp-12);
  border-top: 1px solid var(--linha);
  text-align: center;
}
.wa-sentinela { height: 1px; }

/* --- Conversa aberta ---------------------------------------------------- */
.wa-fluxo {
  flex: 1 1 auto;
  min-height: 0;
  margin: 0;
  padding: var(--esp-16);
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--esp-8);
  background:
    radial-gradient(1100px 380px at 50% -10%, rgba(91, 91, 214, .07), transparent 70%),
    var(--fundo);
}

.wa-dia {
  align-self: center;
  margin: var(--esp-8) 0 var(--esp-4);
  padding: 3px 12px;
  border-radius: var(--r-redondo);
  background: var(--carta-2);
  border: 1px solid var(--linha);
  color: var(--tinta-2);
  font-size: var(--txt-legenda);
  font-weight: 800;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.wa-balao {
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-width: min(76%, 580px);
  padding: 9px 12px 8px;
  border: 1px solid var(--linha);
  border-radius: 16px;
  background: var(--carta);
  box-shadow: var(--sombra-1);
}
.wa-balao[data-lado="tutor"] { align-self: flex-start; border-bottom-left-radius: 5px; }
.wa-balao[data-lado="clinica"] {
  align-self: flex-end;
  background: var(--veu-indigo);
  border-color: rgba(91, 91, 214, .34);
  border-bottom-right-radius: 5px;
}
.wa-balao[data-lado="indefinido"] {
  align-self: center;
  max-width: min(86%, 620px);
  border-style: dashed;
  border-color: var(--linha-2);
  background: var(--carta-2);
}

.wa-balao-alto { display: flex; align-items: baseline; gap: var(--esp-8); min-width: 0; }
.wa-quem {
  font-family: var(--fonte-titulo);
  font-size: var(--txt-legenda);
  font-weight: 800;
  letter-spacing: .03em;
  color: var(--indigo-cl);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wa-balao[data-lado="tutor"] .wa-quem { color: var(--verde); }
.wa-balao[data-lado="indefinido"] .wa-quem { color: var(--atencao); }
.wa-balao-hora {
  margin-left: auto;
  flex: none;
  font-size: var(--txt-legenda);
  font-weight: 700;
  color: var(--tinta-3);
  white-space: nowrap;
}
.wa-texto {
  font-size: var(--txt-base);
  font-weight: 500;
  line-height: 1.55;
  color: var(--tinta);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.wa-sem-texto { color: var(--tinta-3); font-style: italic; font-weight: 500; font-size: var(--txt-pequeno); }

/* Etiqueta discreta dentro do balão: "transcrito", "IA", "Recepção". */
.wa-etiquetas { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.wa-etiqueta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border-radius: var(--r-redondo);
  background: var(--veu-neutro);
  border: 1px solid var(--linha-2);
  color: var(--tinta-2);
  font-size: var(--txt-legenda);
  font-weight: 800;
  letter-spacing: .05em;
  text-transform: uppercase;
  white-space: nowrap;
}
.wa-etiqueta svg { width: 12px; height: 12px; }
.wa-etiqueta[data-tom="ia"] {
  background: var(--veu-indigo);
  border-color: rgba(91, 91, 214, .40);
  color: var(--indigo-cl);
}
.wa-etiqueta[data-tom="humano"] {
  background: var(--veu-ok);
  border-color: rgba(53, 208, 127, .30);
  color: var(--ok);
}
.wa-etiqueta[data-tom="atencao"] {
  background: var(--veu-atencao);
  border-color: rgba(255, 201, 60, .30);
  color: var(--atencao);
}

/* Mídia: só o metadado, nunca o arquivo. */
.wa-anexo {
  display: flex;
  align-items: center;
  gap: var(--esp-8);
  padding: var(--esp-8);
  border: 1px dashed var(--linha-2);
  border-radius: var(--r-p);
  background: var(--fundo-2);
}
.wa-anexo svg { width: 20px; height: 20px; color: var(--tinta-3); flex: none; }
.wa-anexo-texto { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.wa-anexo-tipo {
  font-family: var(--fonte-titulo);
  font-size: var(--txt-legenda);
  font-weight: 800;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--tinta-2);
}
.wa-anexo-meta { font-size: var(--txt-legenda); font-weight: 600; color: var(--tinta-3); }

.wa-rodape-conversa {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--esp-8) var(--esp-12);
  border-top: 1px solid var(--linha);
  background: var(--fundo-2);
}
.wa-nota {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  font-size: var(--txt-legenda);
  font-weight: 600;
  line-height: 1.5;
  color: var(--tinta-2);
}
.wa-nota svg { width: 14px; height: 14px; color: var(--tinta-3); margin-top: 2px; }

/* Botão que só aparece quando chegou mensagem e o usuário está lendo mais acima. */
.wa-novas {
  position: absolute;
  left: 50%;
  bottom: 86px;
  transform: translateX(-50%);
  z-index: var(--z-flutuante);
  box-shadow: var(--sombra-2);
}
.wa-novas[hidden] { display: none; }

/* --- Ficha do contato --------------------------------------------------- */
.wa-ficha { flex: 1 1 auto; min-height: 0; padding: var(--esp-12) var(--esp-16) var(--esp-16); }
.wa-ficha-topo {
  display: flex;
  align-items: center;
  gap: var(--esp-12);
  padding: var(--esp-8) 0 var(--esp-12);
  border-bottom: 1px solid var(--linha);
}
.wa-ficha-nome {
  font-family: var(--fonte-titulo);
  font-size: var(--txt-medio);
  font-weight: 700;
  color: var(--tinta);
  min-width: 0;
  overflow-wrap: anywhere;
}
.wa-ficha-linha {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: var(--esp-12) 0;
  border-bottom: 1px solid var(--linha);
}
.wa-ficha-valor {
  font-family: var(--fonte-titulo);
  font-size: var(--txt-medio);
  font-weight: 700;
  color: var(--tinta);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.wa-ficha-valor[data-medida="nao"] { color: var(--tinta-3); }
.wa-ficha-apoio { font-size: var(--txt-pequeno); font-weight: 500; color: var(--tinta-2); line-height: 1.5; }
.wa-ficha-aviso { margin-top: var(--esp-12); }

/* --- Esqueleto e estados ------------------------------------------------ */
.wa-carregando { display: flex; flex-direction: column; gap: var(--esp-8); padding: var(--esp-12); }
.wa-carregando .esqueleto.linha { width: 100%; }
.wa-carregando .esqueleto.linha.curta { width: 58%; }
.wa-centro {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--esp-16);
  overflow-y: auto;
}
.wa-centro .vazio { border: 0; background: transparent; }
.wa-escolha { display: flex; flex-wrap: wrap; gap: var(--esp-8); justify-content: center; margin-top: var(--esp-12); }
/* A faixa de erro vive dentro de um painel estreito: o botão nunca disputa a
   linha com o texto, senão vira uma coluna de sílabas. */
.wa-erro { margin: var(--esp-12); flex-wrap: wrap; }
.wa-erro > .cresce { flex: 1 1 100%; min-width: 0; }
.wa-erro .btn { margin-left: 0; width: 100%; }

/* --- 1180px: a ficha divide a coluna da conversa ------------------------- */
@media (max-width: 1180px) {
  .wa-quadro {
    grid-template-columns: minmax(236px, 300px) minmax(0, 1fr);
    grid-template-areas: "lista conversa";
    height: clamp(440px, calc(100dvh - 268px), 900px);
  }
  .wa-ficha-painel { grid-area: conversa; }
  .wa-quadro[data-painel="ficha"] .wa-conversa-painel { display: none; }
  .wa-quadro:not([data-painel="ficha"]) .wa-ficha-painel { display: none; }
  .wa-abrir-ficha { display: inline-flex; }
  .wa-ficha-painel .wa-voltar { display: inline-flex; }
  .wa-balao { max-width: min(84%, 520px); }
}

/* --- 720px: um painel por vez ------------------------------------------- */
@media (max-width: 720px) {
  .wa-quadro {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: "painel";
    height: clamp(420px, calc(100dvh - 252px), 860px);
  }
  .wa-lista-painel,
  .wa-conversa-painel,
  .wa-ficha-painel { grid-area: painel; display: flex; }
  .wa-quadro[data-painel="lista"] .wa-conversa-painel,
  .wa-quadro[data-painel="lista"] .wa-ficha-painel,
  .wa-quadro[data-painel="conversa"] .wa-lista-painel,
  .wa-quadro[data-painel="conversa"] .wa-ficha-painel,
  .wa-quadro[data-painel="ficha"] .wa-lista-painel,
  .wa-quadro[data-painel="ficha"] .wa-conversa-painel { display: none; }
  .wa-voltar { display: inline-flex; }
  .wa-balao { max-width: 90%; }
  .wa-fluxo { padding: var(--esp-12); }
  .wa-topo-selos { margin-left: 0; }
  .wa-novas { bottom: 96px; }
}

@media (max-width: 360px) {
  .wa-filtro { padding: 0 var(--esp-8); }
  .wa-avatar { width: 38px; height: 38px; }
}

/* --- Movimento ---------------------------------------------------------- */
@media (prefers-reduced-motion: no-preference) {
  @keyframes wa-sobe {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: none; }
  }
  /* Mensagem nova e conversa que subiu na lista: entrada curta, com motivo. */
  .wa-entrando { animation: wa-sobe 220ms var(--curva) both; }
}
`;

/* ═════════════════════════ 4. ESTADO DO MÓDULO ══════════════════════════ */

/* Um objeto só, criado em montar() e destruído em desmontar(). Nada de estado
   solto entre montagens: a tela que morre não pode mexer na tela que nasce. */
let estado = null;

function estadoNovo(raiz, ctx) {
  return {
    raiz: raiz,
    ctx: ctx,
    slug: ctx && ctx.unidadeAtual ? ctx.unidadeAtual : null,
    unidadeNome: null,

    /* lista */
    busca: '',
    filtro: 'todas',
    conversas: [],
    porId: new Map(),
    linhas: new Map(),
    pagina: 0,
    fim: false,
    carregandoPagina: false,
    recebeuPrimeira: false,
    erroLista: null,
    motivo: null,
    novas: new Set(),

    /* conversa aberta */
    conversaId: null,
    conversa: null,
    erroConversa: null,
    recebeuConversa: false,
    chaves: [],
    ultimoDia: null,
    pendentes: 0,

    /* assinaturas e limpeza */
    pararLista: null,
    pararConversa: null,
    observador: null,
    limpezas: [],
    esperaBusca: null,

    /* nós */
    nos: {},
  };
}

/** Registra uma função de limpeza; todas rodam em desmontar(). */
function aoLimpar(fn) {
  if (estado && typeof fn === 'function') estado.limpezas.push(fn);
}

/* ═════════════════════════ 5. UTILIDADES ════════════════════════════════ */

function criar(tag, classe, texto) {
  const no = document.createElement(tag);
  if (classe) no.className = classe;
  if (texto !== undefined && texto !== null) no.textContent = texto;
  return no;
}

/** Envelopa um ícone. `innerHTML` aqui só recebe constante deste arquivo. */
function icone(svg, classe) {
  const caixa = criar('span', classe || null);
  caixa.setAttribute('aria-hidden', 'true');
  caixa.style.display = 'inline-flex';
  caixa.innerHTML = svg;
  return caixa;
}

function botaoIcone(svg, rotulo, aoClicar, classe) {
  const botao = criar('button', 'btn-icone' + (classe ? ' ' + classe : ''));
  botao.type = 'button';
  botao.innerHTML = svg;
  botao.setAttribute('aria-label', rotulo);
  botao.title = rotulo;
  if (aoClicar) botao.addEventListener('click', aoClicar);
  return botao;
}

function vazio(tituloTexto, corpoTexto, svg) {
  const caixa = criar('div', 'vazio');
  caixa.appendChild(icone(svg || ICONES.vazio, 'vazio-icone'));
  caixa.appendChild(criar('p', 'vazio-titulo', tituloTexto));
  caixa.appendChild(criar('p', 'vazio-texto', corpoTexto));
  return caixa;
}

function avisoErro(erro, aoTentar) {
  const faixa = criar('div', 'aviso aviso-erro wa-erro');
  faixa.setAttribute('role', 'alert');
  faixa.appendChild(icone(ICONES.alerta));
  const corpo = criar('div', 'cresce');
  corpo.style.flex = '1 1 auto';
  corpo.style.minWidth = '0';
  corpo.appendChild(criar('span', 'aviso-titulo', 'Não consegui ler do servidor'));
  corpo.appendChild(criar('span', 'aviso-texto',
    (erro && erro.amigavel) || 'A consulta falhou e nenhum dado foi lido.'));
  faixa.appendChild(corpo);
  if (aoTentar) {
    const botao = criar('button', 'btn', 'Tentar de novo');
    botao.type = 'button';
    botao.addEventListener('click', aoTentar);
    faixa.appendChild(botao);
  }
  return faixa;
}

/** Texto sem acento e em minúsculas, para a busca local. */
function chaveBusca(texto) {
  const cru = String(texto || '').toLowerCase();
  try {
    return cru.normalize('NFD').replace(/[̀-ͯ]/g, '');
  } catch (e) {
    return cru;
  }
}

/** Só dígitos — para casar a busca com o telefone digitado de qualquer jeito. */
function soDigitos(texto) {
  return String(texto || '').replace(/\D+/g, '');
}

function doisDigitos(n) {
  return String(n).padStart(2, '0');
}

/** Data ISO → Date válido, ou null. Nunca "hoje" por engano. */
function paraData(iso) {
  if (iso === null || iso === undefined || iso === '') return null;
  const data = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(data.getTime()) ? null : data;
}

/** "14h02" no fuso do navegador. */
function horaDe(iso) {
  const data = paraData(iso);
  if (!data) return null;
  return doisDigitos(data.getHours()) + 'h' + doisDigitos(data.getMinutes());
}

function mesmoDia(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/** Rótulo do separador de dia: "Hoje", "Ontem", "18/09" ou "18/09/2025". */
function rotuloDoDia(iso) {
  const data = paraData(iso);
  if (!data) return null;
  const agora = new Date();
  if (mesmoDia(data, agora)) return 'Hoje';
  const ontem = new Date(agora.getTime());
  ontem.setDate(ontem.getDate() - 1);
  if (mesmoDia(data, ontem)) return 'Ontem';
  const curta = doisDigitos(data.getDate()) + '/' + doisDigitos(data.getMonth() + 1);
  return data.getFullYear() === agora.getFullYear() ? curta : curta + '/' + data.getFullYear();
}

/** "21/09/2026 às 14h02" — para o title de quem mostra o tempo relativo. */
function dataCompleta(iso) {
  const data = paraData(iso);
  if (!data) return null;
  return doisDigitos(data.getDate()) + '/' + doisDigitos(data.getMonth() + 1) + '/'
    + data.getFullYear() + ' às ' + doisDigitos(data.getHours()) + 'h' + doisDigitos(data.getMinutes());
}

function ehDeHoje(iso) {
  const data = paraData(iso);
  if (!data) return false;
  return mesmoDia(data, new Date());
}

/** Iniciais do nome. Sem nome, devolve '' e o avatar vira ícone — nunca inicial inventada. */
function iniciaisDe(nome) {
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '';
  const primeira = partes[0].charAt(0);
  const ultima = partes.length > 1 ? partes[partes.length - 1].charAt(0) : '';
  return (primeira + ultima).toUpperCase();
}

/** Avatar do contato: iniciais quando há nome, ícone de pessoa quando não há. */
function avatarDe(nome, pequeno) {
  const caixa = criar('span', 'wa-avatar' + (pequeno ? ' wa-avatar-p' : ''));
  const letras = iniciaisDe(nome);
  if (letras) {
    caixa.textContent = letras;
    caixa.setAttribute('aria-hidden', 'true');
  } else {
    caixa.innerHTML = ICONES.pessoa;
    caixa.setAttribute('aria-hidden', 'true');
    caixa.title = 'Este contato não tem nome salvo no banco.';
  }
  return caixa;
}

/**
 * Como chamar o contato na tela. Nome salvo > telefone formatado > aviso honesto.
 * Nunca devolve string vazia: balão anônimo é proibido nesta tela.
 */
function nomeDoContato(nome, telefone) {
  const limpo = String(nome || '').trim();
  if (limpo) return limpo;
  const tel = formatarTelefone(telefone, '');
  if (tel) return tel;
  return 'Contato sem nome nem telefone';
}

/** Primeiro nome para o balão. Cai no telefone quando não há nome. */
function nomeCurtoDoContato(nome, telefone) {
  const curto = primeiroNome(nome);
  if (curto) return curto;
  const tel = formatarTelefone(telefone, '');
  if (tel) return tel;
  return 'Contato sem nome';
}

/** Bytes em texto curto. Só aparece quando o metadado trouxe o tamanho. */
function formatarBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return formatarNumero(n / 1024, 0) + ' KB';
  return formatarNumero(n / (1024 * 1024), 1) + ' MB';
}

/** Segundos em "1min21" ou "43 s". */
function formatarSegundos(segundos) {
  const n = Number(segundos);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 60) return Math.round(n) + ' s';
  const min = Math.floor(n / 60);
  const resto = Math.round(n - min * 60);
  return min + 'min' + doisDigitos(resto);
}

/* ═════════════════════════ 6. LEITURA DA API ════════════════════════════
   Um lugar só para traduzir o que veio do servidor. Campo ausente vira null
   — e null nunca vira zero.
   ════════════════════════════════════════════════════════════════════════ */

/** Valor do primeiro campo presente. Mantém o 0 e o false. */
function campo(objeto, nomes) {
  if (!objeto) return null;
  for (let i = 0; i < nomes.length; i += 1) {
    const valor = objeto[nomes[i]];
    if (valor !== undefined && valor !== null && valor !== '') return valor;
  }
  return null;
}

/** Número puro, ou null. Texto numérico do PostgREST também entra. */
function numero(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

/**
 * De que lado o balão fica. A lista manda 'tutor', a RPC manda 'contato' e a
 * tabela crua manda 'entrada'/'saida'. Fora desses, devolve null — e o balão
 * assume que não sabe, em vez de chutar um lado.
 */
function ladoDaMensagem(m) {
  const cru = chaveBusca(campo(m, ['quem', 'direcao']) || '');
  if (cru === 'clinica' || cru === 'saida' || cru === 'clinic') return 'clinica';
  if (cru === 'tutor' || cru === 'contato' || cru === 'entrada') return 'tutor';
  return null;
}

/** Texto da mensagem (ou a transcrição do áudio), ou null. */
function textoDaMensagem(m) {
  const bruto = campo(m, ['texto', 'conteudo']);
  if (bruto === null) return null;
  const limpo = String(bruto).trim();
  if (!limpo) return null;
  // Sentinela gravada pela ingestão quando o Whisper não devolveu a transcrição.
  if (/^\(\s*[áa]udio\s+n[ãa]o\s+transcrito\s*\)$/i.test(limpo)) return null;
  return limpo;
}

/**
 * Três estados, de propósito:
 *   true      → o banco marcou `transcrito`
 *   false     → o banco marcou que NÃO transcreveu
 *   null      → a resposta não trouxe o campo; a tela não afirma nem nega
 */
function estadoDaTranscricao(m) {
  if (!m) return null;
  if (m.transcrito === true) return true;
  if (m.transcrito === false) return false;
  return null;
}

/** Chave estável de uma mensagem, para saber o que já está desenhado. */
function chaveMensagem(m, indice) {
  const id = campo(m, ['id', 'stevo_id', 'mensagem_id']);
  if (id) return String(id);
  const quando = campo(m, ['enviada_em', 'hora']) || '';
  const dia = campo(m, ['dia']) || '';
  const texto = textoDaMensagem(m) || '';
  return indice + '|' + dia + '|' + quando + '|' + (ladoDaMensagem(m) || '?') + '|' + texto.slice(0, 48);
}

/* ═════════════════════════ 7. MONTAGEM DA TELA ══════════════════════════ */

function instalarEstilo() {
  if (document.getElementById('wa-estilo')) return;
  const folha = criar('style');
  folha.id = 'wa-estilo';
  folha.textContent = ESTILO;
  document.head.appendChild(folha);
}

function montarArmacao(raiz) {
  const nos = estado.nos;

  const caixa = criar('div', 'wa');

  /* --- cabeçalho da tela --- */
  const topo = criar('div', 'wa-topo');
  const textoTopo = criar('div', 'wa-topo-texto');
  const h1 = criar('h1', null, 'WhatsApp ao vivo');
  textoTopo.appendChild(h1);
  nos.subtitulo = criar('p', 'wa-topo-sub', '');
  textoTopo.appendChild(nos.subtitulo);
  topo.appendChild(textoTopo);

  nos.selosTopo = criar('div', 'wa-topo-selos');
  topo.appendChild(nos.selosTopo);
  caixa.appendChild(topo);

  /* --- quadro de três painéis --- */
  nos.quadro = criar('div', 'wa-quadro');
  nos.quadro.dataset.painel = 'lista';

  nos.quadro.appendChild(montarPainelLista());
  nos.quadro.appendChild(montarPainelConversa());
  nos.quadro.appendChild(montarPainelFicha());

  caixa.appendChild(nos.quadro);

  /* Região que anuncia mensagem nova para quem usa leitor de tela. */
  nos.anuncio = criar('div', 'sr-apenas');
  nos.anuncio.setAttribute('role', 'status');
  nos.anuncio.setAttribute('aria-live', 'polite');
  caixa.appendChild(nos.anuncio);

  raiz.appendChild(caixa);
}

/* --- Painel 1: lista de conversas -------------------------------------- */

function montarPainelLista() {
  const nos = estado.nos;
  const painel = criar('aside', 'wa-painel wa-lista-painel');
  painel.setAttribute('aria-label', 'Lista de conversas');

  const cabeca = criar('div', 'wa-cabeca');
  const busca = criar('div', 'wa-busca');
  busca.appendChild(icone(ICONES.busca));
  nos.busca = criar('input');
  nos.busca.type = 'search';
  nos.busca.placeholder = 'Buscar por nome ou telefone';
  nos.busca.setAttribute('aria-label', 'Buscar conversa por nome do contato ou telefone');
  nos.busca.autocomplete = 'off';
  nos.busca.addEventListener('input', aoDigitarBusca);
  busca.appendChild(nos.busca);
  cabeca.appendChild(busca);
  painel.appendChild(cabeca);

  /* filtros */
  nos.filtros = criar('div', 'wa-filtros');
  nos.filtros.setAttribute('role', 'group');
  nos.filtros.setAttribute('aria-label', 'Filtros da lista de conversas');
  FILTROS.forEach(function (f) {
    const botao = criar('button', 'wa-filtro');
    botao.type = 'button';
    botao.dataset.filtro = f.id;
    botao.title = f.dica;
    botao.setAttribute('aria-pressed', f.id === estado.filtro ? 'true' : 'false');
    botao.appendChild(criar('span', null, f.rotulo));
    const conta = criar('span', 'wa-filtro-conta', '');
    conta.hidden = true;
    botao.appendChild(conta);
    botao.addEventListener('click', function () { trocarFiltro(f.id); });
    nos.filtros.appendChild(botao);
  });
  painel.appendChild(nos.filtros);

  /* contagem do que está carregado */
  const contaLinha = criar('div', 'wa-conta-linha');
  nos.contagem = criar('p', 'legenda', '');
  nos.contagem.setAttribute('role', 'status');
  contaLinha.appendChild(nos.contagem);
  painel.appendChild(contaLinha);
  nos.contaLinha = contaLinha;

  /* corpo rolável */
  nos.corpoLista = criar('div', 'wa-centro rolagem-fina');
  nos.corpoLista.style.display = 'block';
  nos.corpoLista.style.padding = '0';
  painel.appendChild(nos.corpoLista);

  nos.lista = criar('ul', 'wa-lista');
  nos.lista.setAttribute('aria-label', 'Conversas da unidade');
  nos.lista.addEventListener('keydown', teclaNaLista);

  nos.sentinela = criar('div', 'wa-sentinela');
  nos.rodapeLista = criar('div', 'wa-rodape-lista');

  return painel;
}

/* --- Painel 2: conversa aberta ----------------------------------------- */

function montarPainelConversa() {
  const nos = estado.nos;
  const painel = criar('section', 'wa-painel wa-conversa-painel');
  painel.setAttribute('aria-label', 'Conversa aberta');

  const cabeca = criar('div', 'wa-cabeca');
  nos.voltarLista = botaoIcone(ICONES.voltar, 'Voltar para a lista de conversas', function () {
    mostrarPainel('lista', true);
  }, 'wa-voltar');
  cabeca.appendChild(nos.voltarLista);

  nos.avatarConversa = avatarDe('', true);
  cabeca.appendChild(nos.avatarConversa);

  const texto = criar('div', 'wa-cabeca-texto');
  nos.nomeConversa = criar('h2', 'wa-cabeca-nome', 'Nenhuma conversa aberta');
  nos.subConversa = criar('span', 'wa-cabeca-sub', 'Escolha uma conversa na lista');
  texto.appendChild(nos.nomeConversa);
  texto.appendChild(nos.subConversa);
  cabeca.appendChild(texto);

  nos.abrirFicha = botaoIcone(ICONES.ficha, 'Abrir a ficha do contato', function () {
    mostrarPainel('ficha', true);
  }, 'wa-abrir-ficha');
  cabeca.appendChild(nos.abrirFicha);
  painel.appendChild(cabeca);

  nos.corpoConversa = criar('div', 'wa-centro rolagem-fina');
  painel.appendChild(nos.corpoConversa);

  nos.fluxo = criar('ol', 'wa-fluxo rolagem-fina');
  nos.fluxo.setAttribute('role', 'log');
  nos.fluxo.setAttribute('aria-label', 'Mensagens da conversa, da mais antiga para a mais recente');
  nos.fluxo.addEventListener('scroll', aoRolarFluxo, { passive: true });

  nos.novas = criar('button', 'btn btn-primario wa-novas');
  nos.novas.type = 'button';
  nos.novas.hidden = true;
  nos.novas.innerHTML = ICONES.descer;
  nos.novas.appendChild(criar('span', null, 'Mensagens novas'));
  nos.novas.addEventListener('click', function () {
    irParaOFim(true);
  });
  painel.appendChild(nos.novas);

  nos.rodapeConversa = criar('div', 'wa-rodape-conversa');
  nos.rodapeConversa.hidden = true;
  painel.appendChild(nos.rodapeConversa);

  return painel;
}

/* --- Painel 3: ficha do contato ---------------------------------------- */

function montarPainelFicha() {
  const nos = estado.nos;
  const painel = criar('aside', 'wa-painel wa-ficha-painel');
  painel.setAttribute('aria-label', 'Ficha do contato');

  const cabeca = criar('div', 'wa-cabeca');
  cabeca.appendChild(botaoIcone(ICONES.voltar, 'Voltar para a conversa', function () {
    mostrarPainel('conversa', true);
  }, 'wa-voltar'));
  const texto = criar('div', 'wa-cabeca-texto');
  texto.appendChild(criar('h2', 'wa-cabeca-nome', 'Ficha do contato'));
  texto.appendChild(criar('span', 'wa-cabeca-sub', 'O que o banco sabe deste número'));
  cabeca.appendChild(texto);
  painel.appendChild(cabeca);

  nos.corpoFicha = criar('div', 'wa-centro rolagem-fina');
  painel.appendChild(nos.corpoFicha);

  return painel;
}

/* ═════════════════════════ 8. NAVEGAÇÃO ENTRE PAINÉIS ═══════════════════ */

/** true quando a largura atual esconde o painel pedido atrás de outro. */
function painelEmpilhado(qual) {
  try {
    if (qual === 'ficha') return window.matchMedia('(max-width: 1180px)').matches;
    return window.matchMedia('(max-width: 720px)').matches;
  } catch (e) {
    return false;
  }
}

/**
 * No celular (e na ficha até 1180px) só um painel aparece por vez.
 * O foco só se move quando o painel estava mesmo escondido: em tela larga os
 * três convivem, e roubar o cursor de quem clicou seria atrapalhar.
 */
function mostrarPainel(qual, focar) {
  if (!estado || !estado.nos.quadro) return;
  estado.nos.quadro.dataset.painel = qual;
  if (!focar || !painelEmpilhado(qual)) return;

  const mapa = {
    lista: estado.nos.busca,
    conversa: estado.nos.nomeConversa,
    ficha: estado.nos.corpoFicha,
  };
  const alvo = mapa[qual];
  if (!alvo) return;
  try {
    if (alvo !== estado.nos.busca) alvo.setAttribute('tabindex', '-1');
    alvo.focus({ preventScroll: true });
  } catch (e) { /* navegador antigo: segue sem mover o foco */ }
}

/** Navegação por teclado dentro da lista de conversas. */
function teclaNaLista(evento) {
  if (evento.key !== 'ArrowDown' && evento.key !== 'ArrowUp') return;
  const linhas = estado.nos.lista.querySelectorAll('.wa-linha');
  if (!linhas.length) return;
  let indice = -1;
  for (let i = 0; i < linhas.length; i += 1) {
    if (linhas[i] === document.activeElement) { indice = i; break; }
  }
  evento.preventDefault();
  const proximo = evento.key === 'ArrowDown' ? indice + 1 : indice - 1;
  const alvo = Math.max(0, Math.min(proximo, linhas.length - 1));
  try { linhas[alvo].focus(); } catch (e) { /* segue */ }
}

/* ═════════════════════════ 9. UNIDADE E ASSINATURAS ═════════════════════ */

/** Recomeça tudo para a unidade atual. Chamado na montagem e a cada troca. */
function aplicarUnidade() {
  pararAssinaturas();

  estado.slug = estado.ctx && estado.ctx.unidadeAtual ? estado.ctx.unidadeAtual : null;
  estado.unidadeNome = null;
  estado.conversas = [];
  estado.porId = new Map();
  estado.linhas = new Map();
  estado.pagina = 0;
  estado.fim = false;
  estado.carregandoPagina = false;
  estado.recebeuPrimeira = false;
  estado.erroLista = null;
  estado.motivo = null;
  estado.novas = new Set();
  limparConversa();

  desenharTopo();
  desenharLista();
  desenharCabecaConversa();
  desenharConversa();
  desenharFicha();

  if (!estado.slug) return;   // sem unidade não há o que consultar
  assinarLista();
}

function assinarLista() {
  if (!estado.slug) return;
  const argumentos = {
    slug: estado.slug,
    busca: estado.busca ? estado.busca : undefined,
    pagina: 0,
  };
  estado.pararLista = assinarAtualizacao('conversas', argumentos, AO_VIVO_MS, function (dados, erro) {
    if (!estado) return;
    if (erro) {
      if (ehErroDeSessao(erro)) return;    // a casca trata pelo evento de sessão
      estado.erroLista = erro;
      estado.recebeuPrimeira = true;
      desenharLista();
      return;
    }
    estado.erroLista = null;
    absorverPagina(dados, 0);
    estado.recebeuPrimeira = true;
    desenharTopo();
    desenharLista();
  });
  aoLimpar(function () {
    if (estado && estado.pararLista) { estado.pararLista(); estado.pararLista = null; }
  });
}

function pararAssinaturas() {
  if (estado.pararLista) { estado.pararLista(); estado.pararLista = null; }
  if (estado.pararConversa) { estado.pararConversa(); estado.pararConversa = null; }
}

/* ═════════════════════════ 10. LISTA — DADOS ════════════════════════════ */

/**
 * Junta uma página de conversas ao que já está na tela.
 * Página 0 volta a cada 10 s: ela ATUALIZA quem já está na lista e insere quem
 * chegou agora — nunca apaga as conversas mais antigas já paginadas.
 */
function absorverPagina(dados, pagina) {
  const lista = dados && Array.isArray(dados.conversas) ? dados.conversas : [];

  if (dados && dados.unidade) estado.unidadeNome = dados.unidade;
  estado.motivo = dados && dados.motivo ? dados.motivo : null;

  // `fim` só vale para a página mais funda já carregada.
  if (pagina >= estado.pagina) {
    estado.pagina = pagina;
    estado.fim = !!(dados && dados.fim);
  }

  const primeiraCarga = !estado.recebeuPrimeira;

  lista.forEach(function (cv) {
    if (!cv || !cv.id) return;
    const guardada = estado.porId.get(cv.id);
    if (guardada) {
      Object.keys(cv).forEach(function (chave) { guardada[chave] = cv[chave]; });
      return;
    }
    estado.porId.set(cv.id, cv);
    estado.conversas.push(cv);
    // Só é "nova" quando entra depois da primeira leitura; senão a tela inteira
    // nasceria piscando sem motivo nenhum.
    if (!primeiraCarga) estado.novas.add(cv.id);
  });

  estado.conversas.sort(function (a, b) {
    const ta = paraData(a.ultima_mensagem_em);
    const tb = paraData(b.ultima_mensagem_em);
    return (tb ? tb.getTime() : 0) - (ta ? ta.getTime() : 0);
  });

  // A conversa aberta pode ter mudado de estado; o cabeçalho acompanha.
  if (estado.conversaId) desenharCabecaConversa();
}

/** Próxima página. Chamada pela rolagem infinita e pelo botão do rodapé. */
async function carregarMais() {
  if (!estado || !estado.slug) return;
  if (estado.carregandoPagina || estado.fim || !estado.recebeuPrimeira || estado.erroLista) return;

  estado.carregandoPagina = true;
  desenharRodapeLista();

  /* Guarda de identidade: entre o pedido e a resposta a tela pode ter sido
     desmontada e montada de novo. Dado velho não pode cair na tela nova. */
  const meu = estado;
  const alvo = estado.pagina + 1;
  const buscaDaVez = estado.busca;
  const slugDaVez = estado.slug;

  try {
    const dados = await api.conversas(
      slugDaVez,
      { busca: buscaDaVez ? buscaDaVez : undefined, pagina: alvo },
      { forcar: true }
    );
    if (estado !== meu || buscaDaVez !== estado.busca || slugDaVez !== estado.slug) return;
    absorverPagina(dados, alvo);
    desenharLista();
  } catch (erro) {
    if (estado !== meu) return;
    if (!ehErroDeSessao(erro)) {
      estado.erroLista = erro;
      desenharLista();
    }
  } finally {
    if (estado === meu) {
      estado.carregandoPagina = false;
      desenharRodapeLista();
    }
  }
}

/**
 * Busca aplicada sobre o que já está carregado. O servidor também filtra (é
 * assim que o contrato define a ação), mas quem já veio em páginas anteriores
 * continua respondendo à busca sem uma ida a mais ao n8n.
 */
function conversasBuscadas() {
  const alvo = chaveBusca(estado.busca);
  const digitos = soDigitos(estado.busca);
  if (!alvo) return estado.conversas.slice();

  return estado.conversas.filter(function (cv) {
    if (chaveBusca(cv.nome || '').indexOf(alvo) >= 0) return true;
    if (digitos && soDigitos(cv.telefone).indexOf(digitos) >= 0) return true;
    return false;
  });
}

/** true quando a conversa passa pelo filtro pedido. */
function passaNoFiltro(cv, filtro) {
  if (filtro === 'sem-resposta') return cv.aguardando_resposta === true;
  if (filtro === 'audio') return !!(cv.previa && cv.previa.tipo === 'audio');
  if (filtro === 'hoje') return ehDeHoje(cv.ultima_mensagem_em);
  return true;
}

/** O que está mesmo na tela agora: busca e filtro, nessa ordem. */
function conversasVisiveis() {
  const base = conversasBuscadas();
  if (estado.filtro === 'todas') return base;
  return base.filter(function (cv) { return passaNoFiltro(cv, estado.filtro); });
}

/* ═════════════════════════ 11. LISTA — DESENHO ══════════════════════════ */

function desenharTopo() {
  const nos = estado.nos;
  const unidade = estado.ctx ? estado.ctx.unidade : null;
  const nome = estado.unidadeNome || (unidade && unidade.nome) || estado.slug;

  nos.subtitulo.textContent = nome
    ? 'Conversas de ' + nome + ', como o WhatsApp da unidade recebeu.'
    : 'Escolha uma unidade para acompanhar as conversas.';

  nos.selosTopo.textContent = '';

  if (!estado.slug) return;

  const selo = criar('span', 'selo');
  if (unidade && unidade.capturando === true) {
    selo.className = 'selo selo-ok';
    selo.textContent = 'Captura ligada';
  } else if (unidade && unidade.capturando === false) {
    selo.className = 'selo selo-atencao';
    selo.textContent = 'Captura desligada';
  } else {
    selo.className = 'selo selo-neutro';
    selo.textContent = 'Captura não informada';
    selo.title = 'A ação visao_geral ainda não disse se esta unidade está capturando.';
  }
  nos.selosTopo.appendChild(selo);

  const vivo = criar('span', 'selo selo-neutro sem-ponto', 'Atualiza a cada 10 s');
  vivo.title = 'A lista e a conversa aberta reconsultam o servidor a cada 10 segundos.';
  nos.selosTopo.appendChild(vivo);
}

/**
 * Decide o que o painel da esquerda mostra agora. A ordem importa: cada saída
 * explica um motivo diferente, e nenhuma delas é "lista vazia sem contexto".
 */
function situacaoDaLista() {
  if (!estado.slug) return 'sem-unidade';
  if (estado.erroLista) return 'erro';
  if (!estado.recebeuPrimeira) return 'esperando';

  const unidade = estado.ctx ? estado.ctx.unidade : null;
  if (estado.motivo === 'captura_nao_ligada'
    || (unidade && unidade.capturando === false && !estado.conversas.length)) {
    return 'sem-captura';
  }
  if (!estado.conversas.length) return 'sem-conversa';
  if (!conversasVisiveis().length) return 'filtro-vazio';
  return 'lista';
}

/** Deixa o corpo do painel no modo "bloco de aviso centralizado". */
function modoAviso(corpo, bloco) {
  corpo.textContent = '';
  corpo.style.display = '';     /* volta ao flex centralizado de .wa-centro */
  corpo.style.padding = '';
  corpo.style.overflow = '';
  corpo.appendChild(bloco);
}

function desenharLista() {
  const nos = estado.nos;
  const corpo = nos.corpoLista;
  const situacao = situacaoDaLista();

  desenharContagem();
  nos.busca.disabled = situacao === 'sem-unidade';
  nos.filtros.hidden = situacao !== 'lista' && situacao !== 'filtro-vazio';
  nos.contaLinha.hidden = nos.filtros.hidden;

  if (situacao !== 'lista') {
    // Sai do modo lista: as linhas guardadas não servem mais a nada.
    nos.lista.textContent = '';
    estado.linhas = new Map();

    if (situacao === 'sem-unidade') modoAviso(corpo, blocoSemUnidade());
    else if (situacao === 'erro') {
      modoAviso(corpo, avisoErro(estado.erroLista, function () {
        estado.erroLista = null;
        desenharLista();
        pararAssinaturas();
        assinarLista();
      }));
    } else if (situacao === 'esperando') {
      corpo.textContent = '';
      corpo.style.display = 'block';
      corpo.style.padding = '0';
      corpo.appendChild(esqueletoDeLista());
    } else if (situacao === 'sem-captura') modoAviso(corpo, blocoSemCaptura());
    else if (situacao === 'sem-conversa') {
      modoAviso(corpo, vazio(
        'Nenhuma conversa gravada até agora',
        'A captura está ligada, mas ainda não chegou mensagem desta unidade. A primeira '
        + 'conversa aparece aqui sozinha — esta tela reconsulta o servidor a cada 10 segundos.',
        ICONES.balao
      ));
    } else modoAviso(corpo, blocoFiltroVazio());
    return;
  }

  /* Modo lista. A armação entra uma vez só: refazer o corpo inteiro a cada
     atualização de 10 s jogaria a rolagem de volta para o topo e tiraria o
     foco de quem está navegando pelo teclado. */
  if (nos.lista.parentNode !== corpo) {
    corpo.textContent = '';
    corpo.style.display = 'block';
    corpo.style.padding = '0';
    corpo.style.overflow = '';
    corpo.appendChild(nos.lista);
    corpo.appendChild(nos.sentinela);
    corpo.appendChild(nos.rodapeLista);
  }

  sincronizarLinhas(conversasVisiveis());
  desenharRodapeLista();
  ligarRolagemInfinita();
  estado.novas.clear();
}

/**
 * Põe na tela exatamente as conversas visíveis, reaproveitando o nó de cada
 * linha: o botão só é movido quando saiu mesmo de lugar (mover um nó com foco
 * dentro apaga o foco) e só é reconstruído por dentro quando o dado mudou.
 */
function sincronizarLinhas(visiveis) {
  const lista = estado.nos.lista;
  const vivos = new Set();
  let anterior = null;

  visiveis.forEach(function (cv) {
    vivos.add(cv.id);
    let botao = estado.linhas.get(cv.id);
    if (!botao) {
      botao = criarLinha(cv);
      estado.linhas.set(cv.id, botao);
    } else {
      preencherLinha(botao, cv);
    }
    const item = botao.parentNode;
    const esperado = anterior ? anterior.nextSibling : lista.firstChild;
    if (item !== esperado) lista.insertBefore(item, esperado);
    anterior = item;
  });

  // Conversa que saiu do filtro ou da busca sai da tela — sem deixar resto.
  const itens = Array.prototype.slice.call(lista.children);
  itens.forEach(function (item) {
    const id = item.dataset.id;
    if (vivos.has(id)) return;
    estado.linhas.delete(id);
    item.remove();
  });
}

function desenharContagem() {
  const nos = estado.nos;
  if (!estado.slug || !estado.recebeuPrimeira || !estado.conversas.length) {
    nos.contagem.textContent = '';
    FILTROS.forEach(function (f) { marcarContaDoFiltro(f.id, null); });
    return;
  }

  /* Os números dos filtros contam sobre o resultado da BUSCA, não sobre a lista
     inteira: chip dizendo 4 com uma linha na tela confunde mais do que informa. */
  const total = estado.conversas.length;
  const base = conversasBuscadas();

  if (estado.busca) {
    nos.contagem.textContent = formatarNumero(base.length) + ' de ' + formatarNumero(total)
      + (total === 1 ? ' conversa carregada' : ' conversas carregadas');
  } else {
    nos.contagem.textContent = formatarNumero(total)
      + (total === 1 ? ' conversa carregada' : ' conversas carregadas')
      + (estado.fim ? '' : ' até agora');
  }
  nos.contagem.title = 'O servidor entrega 40 conversas por página, da mais recente para a mais '
    + 'antiga. Role a lista até o fim para carregar a próxima página — a contagem é do que já '
    + 'foi carregado, não do banco inteiro.';

  FILTROS.forEach(function (f) {
    const quantas = f.id === 'todas'
      ? base.length
      : base.filter(function (c) { return passaNoFiltro(c, f.id); }).length;
    marcarContaDoFiltro(f.id, quantas);
  });
}

/** Número ao lado do filtro: é contagem do que está carregado, não do banco inteiro. */
function marcarContaDoFiltro(id, valor) {
  const botao = estado.nos.filtros.querySelector('.wa-filtro[data-filtro="' + id + '"]');
  if (!botao) return;
  const conta = botao.querySelector('.wa-filtro-conta');
  if (!conta) return;
  if (valor === null) { conta.hidden = true; conta.textContent = ''; return; }
  conta.hidden = false;
  conta.textContent = formatarNumero(valor);
}

function desenharRodapeLista() {
  const rodape = estado.nos.rodapeLista;
  if (!rodape) return;
  rodape.textContent = '';

  if (estado.carregandoPagina) {
    rodape.appendChild(criar('span', 'legenda texto-3', 'Carregando mais conversas…'));
    return;
  }
  if (estado.fim) {
    rodape.appendChild(criar('span', 'legenda texto-3',
      'Fim da lista: não há conversa mais antiga gravada.'));
    return;
  }
  const botao = criar('button', 'btn', 'Carregar mais conversas');
  botao.type = 'button';
  botao.addEventListener('click', carregarMais);
  rodape.appendChild(botao);
}

/** Observa o fim da lista para paginar sozinho; cai no botão se não houver suporte. */
function ligarRolagemInfinita() {
  if (estado.observador || typeof IntersectionObserver !== 'function') return;
  estado.observador = new IntersectionObserver(function (entradas) {
    for (let i = 0; i < entradas.length; i += 1) {
      if (entradas[i].isIntersecting) { carregarMais(); break; }
    }
  }, { root: estado.nos.corpoLista, rootMargin: MARGEM_PAGINA_PX + 'px 0px' });
  estado.observador.observe(estado.nos.sentinela);
  aoLimpar(function () {
    if (estado && estado.observador) { estado.observador.disconnect(); estado.observador = null; }
  });
}

/** Cria o nó de uma linha: <li> e <button> nascem aqui e não morrem mais. */
function criarLinha(cv) {
  const item = criar('li');
  item.dataset.id = cv.id;

  const botao = criar('button', 'wa-linha');
  botao.type = 'button';
  botao.dataset.id = cv.id;
  botao.addEventListener('click', function () { abrirConversa(cv.id); });
  if (estado.novas.has(cv.id)) botao.classList.add('wa-entrando');

  item.appendChild(botao);
  preencherLinha(botao, cv);
  return botao;
}

/**
 * Redesenha o conteúdo da linha. O botão continua o mesmo — e o foco também.
 * A assinatura evita refazer 40 linhas a cada 10 s quando nada mudou nelas.
 */
function preencherLinha(botao, cv) {
  botao.setAttribute('aria-current', cv.id === estado.conversaId ? 'true' : 'false');

  const p = cv.previa || {};
  const assinatura = [
    cv.nome, cv.telefone, cv.ultima_mensagem_em, cv.aguardando_resposta,
    p.quem, p.tipo, p.texto,
  ].join('');
  if (botao.dataset.assinatura === assinatura) return;
  botao.dataset.assinatura = assinatura;

  botao.textContent = '';
  botao.appendChild(avatarDe(cv.nome));

  const corpo = criar('div', 'wa-linha-corpo');

  const alto = criar('div', 'wa-linha-alto');
  const nome = criar('span', 'wa-linha-nome corta', nomeDoContato(cv.nome, cv.telefone));
  if (!cv.nome && cv.telefone) nome.title = 'Contato sem nome salvo; mostrando o telefone.';
  alto.appendChild(nome);

  const esperando = cv.aguardando_resposta === true;
  const hora = criar('span', 'wa-linha-hora numero');
  if (esperando) {
    hora.dataset.espera = 'sim';
    hora.appendChild(icone(ICONES.sino));
  }
  const quando = criar('span', 'wa-linha-quando', formatarQuando(cv.ultima_mensagem_em));
  quando.dataset.quando = cv.ultima_mensagem_em || '';
  hora.appendChild(quando);

  const completa = dataCompleta(cv.ultima_mensagem_em);
  if (!completa) {
    hora.title = 'A conversa não trouxe a data da última mensagem.';
  } else if (esperando) {
    hora.title = 'A última mensagem foi do tutor, em ' + completa
      + ', e a clínica ainda não respondeu — este é o tempo de espera.';
  } else {
    hora.title = 'Última mensagem em ' + completa;
  }
  alto.appendChild(hora);
  corpo.appendChild(alto);

  const baixo = criar('div', 'wa-linha-baixo');
  baixo.appendChild(previaDaConversa(cv));
  corpo.appendChild(baixo);

  botao.appendChild(corpo);

  const rotulo = nomeDoContato(cv.nome, cv.telefone)
    + '. Última mensagem ' + formatarQuando(cv.ultima_mensagem_em, 'sem data')
    + (cv.aguardando_resposta === true ? '. Sem resposta da clínica.' : '.');
  botao.setAttribute('aria-label', rotulo);
}

/** Prévia da última mensagem. Sem prévia, diz que não veio — não inventa reticências. */
function previaDaConversa(cv) {
  const caixa = criar('span', 'wa-previa corta');
  const p = cv.previa;

  if (!p) {
    caixa.textContent = 'Sem prévia da última mensagem na resposta do servidor.';
    caixa.classList.add('texto-3');
    return caixa;
  }

  if (p.quem === 'clinica') {
    caixa.appendChild(criar('span', 'wa-previa-quem', 'Clínica: '));
  }

  if (p.tipo && p.tipo !== 'texto') {
    caixa.appendChild(icone(iconeDoTipo(p.tipo)));
  }

  const texto = String(p.texto || '').trim();
  if (texto) {
    caixa.appendChild(document.createTextNode(texto));
  } else {
    const nome = TIPOS_DE_MENSAGEM[p.tipo] || 'Mensagem';
    const sem = criar('span', 'texto-3', nome + ' sem texto gravado');
    caixa.appendChild(sem);
  }
  return caixa;
}

function esqueletoDeLista() {
  const caixa = criar('div', 'wa-carregando');
  caixa.appendChild(criar('span', 'sr-apenas', 'Carregando as conversas da unidade…'));
  for (let i = 0; i < 6; i += 1) {
    const linha = criar('div', 'pilha-h sem-quebra');
    linha.appendChild(criar('div', 'esqueleto circulo'));
    const texto = criar('div', 'pilha espaco-8 cresce');
    texto.appendChild(criar('div', 'esqueleto linha'));
    texto.appendChild(criar('div', 'esqueleto linha curta'));
    linha.appendChild(texto);
    linha.style.padding = '6px 0';
    caixa.appendChild(linha);
  }
  return caixa;
}

/* --- Estados vazios da lista -------------------------------------------- */

function blocoSemUnidade() {
  const caixa = vazio(
    'Escolha uma unidade para ver as conversas',
    'Esta tela mostra uma unidade por vez, ao vivo. Use o seletor no topo da página para '
    + 'escolher qual unidade você quer acompanhar — enquanto nenhuma estiver escolhida, '
    + 'não há conversa nenhuma para carregar.',
    ICONES.balao
  );

  const unidades = estado.ctx && estado.ctx.unidades ? estado.ctx.unidades : [];
  if (unidades.length) {
    const atalhos = criar('div', 'wa-escolha');
    unidades.slice(0, 8).forEach(function (u) {
      if (!u || !u.slug) return;
      const botao = criar('button', 'btn', u.nome || u.slug);
      botao.type = 'button';
      botao.addEventListener('click', function () {
        if (estado.ctx && typeof estado.ctx.trocarUnidade === 'function') estado.ctx.trocarUnidade(u.slug);
      });
      atalhos.appendChild(botao);
    });
    caixa.appendChild(atalhos);
    if (unidades.length > 8) {
      caixa.appendChild(criar('p', 'vazio-texto texto-3',
        'As demais unidades estão no seletor do topo.'));
    }
  }
  return caixa;
}

function blocoSemCaptura() {
  const nome = estado.unidadeNome || (estado.ctx && estado.ctx.unidade ? estado.ctx.unidade.nome : null);
  return vazio(
    'A captura desta unidade não está ligada',
    'Nenhuma mensagem' + (nome ? ' de ' + nome : '') + ' está sendo gravada, então não existe '
    + 'conversa para mostrar aqui — e esta tela não preenche o espaço com exemplo. A captura '
    + 'começa quando a instância da unidade na Stevo passa a entregar as mensagens para a '
    + 'ingestão no n8n e a unidade recebe a data em captura_ligada_em. Enquanto isso não '
    + 'acontecer, a lista continua vazia.',
    ICONES.alerta
  );
}

/**
 * Quem esvaziou a lista: a busca ou o filtro? A tela diz qual dos dois, porque
 * "nenhum resultado" sem causa é exatamente o vazio sem contexto que o
 * contrato proíbe.
 */
function blocoFiltroVazio() {
  if (estado.busca && !conversasBuscadas().length) {
    return vazio(
      'Nenhuma conversa com esse nome ou telefone',
      'A busca vale para o nome salvo no contato e para o telefone, dentro das conversas já '
      + 'carregadas. Apague parte do texto para ver a lista inteira, ou role a lista para '
      + 'carregar conversas mais antigas antes de buscar de novo.',
      ICONES.busca
    );
  }

  const f = acharFiltro(estado.filtro);
  const bloco = vazio(f.vazioTitulo, f.vazioTexto, ICONES.vazio);
  if (estado.busca) {
    bloco.appendChild(criar('p', 'vazio-texto texto-3',
      'A busca por "' + estado.busca + '" também está valendo. Apague a busca para ver este '
      + 'filtro sobre a lista inteira.'));
  }
  return bloco;
}

function acharFiltro(id) {
  for (let i = 0; i < FILTROS.length; i += 1) {
    if (FILTROS[i].id === id) return FILTROS[i];
  }
  return FILTROS[0];
}

/* --- Busca e filtro ----------------------------------------------------- */

function aoDigitarBusca() {
  const valor = estado.nos.busca.value;
  if (estado.esperaBusca) clearTimeout(estado.esperaBusca);
  estado.esperaBusca = setTimeout(function () {
    estado.esperaBusca = null;
    aplicarBusca(valor);
  }, ESPERA_BUSCA_MS);
}

/**
 * A busca é feita no servidor (é assim que o contrato define a ação `conversas`)
 * e repetida aqui sobre o que já está carregado. A lista recomeça da página 0.
 */
function aplicarBusca(valor) {
  const limpo = String(valor || '').trim();
  if (limpo === estado.busca) return;
  estado.busca = limpo;
  estado.conversas = [];
  estado.porId = new Map();
  estado.linhas = new Map();
  estado.pagina = 0;
  estado.fim = false;
  estado.recebeuPrimeira = false;
  estado.erroLista = null;
  estado.novas = new Set();
  if (estado.observador) { estado.observador.disconnect(); estado.observador = null; }
  desenharLista();
  pararAssinaturas();
  assinarLista();
  if (estado.conversaId) assinarConversa(estado.conversaId);   // a conversa aberta continua aberta
}

function trocarFiltro(id) {
  if (estado.filtro === id) return;
  estado.filtro = id;
  const botoes = estado.nos.filtros.querySelectorAll('.wa-filtro');
  for (let i = 0; i < botoes.length; i += 1) {
    botoes[i].setAttribute('aria-pressed', botoes[i].dataset.filtro === id ? 'true' : 'false');
  }
  desenharLista();
}

/* ═════════════════════════ 12. CONVERSA — DADOS ═════════════════════════ */

function limparConversa() {
  if (estado.pararConversa) { estado.pararConversa(); estado.pararConversa = null; }
  estado.conversaId = null;
  estado.conversa = null;
  estado.erroConversa = null;
  estado.recebeuConversa = false;
  estado.chaves = [];
  estado.ultimoDia = null;
  estado.pendentes = 0;
  if (estado.nos.fluxo) estado.nos.fluxo.textContent = '';
  if (estado.nos.novas) estado.nos.novas.hidden = true;
}

function abrirConversa(id) {
  if (!id) return;
  if (estado.conversaId === id) { mostrarPainel('conversa', true); return; }

  limparConversa();
  estado.conversaId = id;

  // Marca a linha escolhida sem redesenhar a lista inteira.
  estado.linhas.forEach(function (botao, chave) {
    botao.setAttribute('aria-current', chave === id ? 'true' : 'false');
  });

  desenharCabecaConversa();
  desenharConversa();
  desenharFicha();
  assinarConversa(id);
  mostrarPainel('conversa', true);
}

function assinarConversa(id) {
  if (estado.pararConversa) { estado.pararConversa(); estado.pararConversa = null; }
  estado.pararConversa = assinarAtualizacao('conversa', { conversa_id: id }, AO_VIVO_MS,
    function (dados, erro) {
      if (!estado || estado.conversaId !== id) return;
      if (erro) {
        if (ehErroDeSessao(erro)) return;
        estado.erroConversa = erro;
        estado.recebeuConversa = true;
        desenharConversa();
        desenharFicha();
        return;
      }
      estado.erroConversa = null;
      estado.conversa = dados || null;
      estado.recebeuConversa = true;
      desenharCabecaConversa();
      desenharConversa();
      desenharFicha();
    });
  aoLimpar(function () {
    if (estado && estado.pararConversa) { estado.pararConversa(); estado.pararConversa = null; }
  });
}

/** Dados do contato: o que a conversa trouxe, completado pela linha da lista. */
function contatoDaConversa() {
  const d = estado.conversa || {};
  const linha = estado.conversaId ? estado.porId.get(estado.conversaId) : null;
  return {
    nome: campo(d, ['contato', 'nome']) || (linha ? linha.nome : null),
    telefone: campo(d, ['telefone']) || (linha ? linha.telefone : null),
    tipo: campo(d, ['tipo', 'tipo_contato']) || (linha ? linha.tipo_contato : null),
    tipo_motivo: campo(d, ['tipo_motivo']),
    iniciada_em: campo(d, ['iniciada_em']) || (linha ? linha.iniciada_em : null),
    primeiro_contato_em: campo(d, ['primeiro_contato_em']),
    total_conversas: numero(campo(d, ['total_conversas'])),
    primeira_resposta_min: numero(campo(d, ['primeira_resposta_min'])),
    maior_espera_min: numero(campo(d, ['maior_espera_min'])),
  };
}

function mensagensDaConversa() {
  const d = estado.conversa;
  return d && Array.isArray(d.mensagens) ? d.mensagens : [];
}

/* ═════════════════════════ 13. CONVERSA — DESENHO ═══════════════════════ */

/** Troca o avatar do cabeçalho mantendo a referência certa no estado. */
function trocarAvatarDaCabeca(nome) {
  const nos = estado.nos;
  const novo = avatarDe(nome, true);
  if (nos.avatarConversa && nos.avatarConversa.parentNode) {
    nos.avatarConversa.parentNode.replaceChild(novo, nos.avatarConversa);
  }
  nos.avatarConversa = novo;
}

function desenharCabecaConversa() {
  const nos = estado.nos;
  if (!estado.conversaId) {
    nos.nomeConversa.textContent = 'Nenhuma conversa aberta';
    nos.subConversa.textContent = 'Escolha uma conversa na lista';
    trocarAvatarDaCabeca('');
    nos.abrirFicha.disabled = true;
    return;
  }

  const c = contatoDaConversa();
  nos.nomeConversa.textContent = nomeDoContato(c.nome, c.telefone);
  trocarAvatarDaCabeca(c.nome);

  const linha = estado.porId.get(estado.conversaId);
  const partes = [];
  if (c.telefone) partes.push(formatarTelefone(c.telefone));
  const tipo = TIPOS_DE_CONTATO[c.tipo];
  if (tipo) partes.push(tipo.rotulo);
  if (linha && linha.aguardando_resposta === true) partes.push('sem resposta da clínica');
  nos.subConversa.textContent = partes.length ? partes.join(' · ') : 'Contato sem telefone na resposta';
  nos.abrirFicha.disabled = false;
}

function desenharConversa() {
  const nos = estado.nos;
  const corpo = nos.corpoConversa;

  /* nenhuma conversa aberta */
  if (!estado.conversaId) {
    modoAviso(corpo, vazio(
      'Escolha uma conversa na lista',
      'Aqui aparece a conversa inteira, mensagem por mensagem, com quem falou, a hora de '
      + 'cada mensagem e a transcrição dos áudios.',
      ICONES.balao
    ));
    nos.rodapeConversa.hidden = true;
    nos.novas.hidden = true;
    return;
  }

  /* falhou */
  if (estado.erroConversa) {
    const id = estado.conversaId;
    modoAviso(corpo, avisoErro(estado.erroConversa, function () {
      estado.erroConversa = null;
      desenharConversa();
      assinarConversa(id);
    }));
    nos.rodapeConversa.hidden = true;
    nos.novas.hidden = true;
    return;
  }

  /* esperando a primeira resposta */
  if (!estado.recebeuConversa) {
    corpo.textContent = '';
    corpo.style.display = 'block';
    corpo.style.padding = '';
    corpo.style.overflow = '';
    corpo.appendChild(esqueletoDeConversa());
    nos.rodapeConversa.hidden = true;
    nos.novas.hidden = true;
    return;
  }

  const mensagens = mensagensDaConversa();

  /* conversa sem mensagem gravada */
  if (!mensagens.length) {
    modoAviso(corpo, vazio(
      'Esta conversa não tem mensagem gravada',
      'A conversa existe na tabela, mas nenhuma mensagem dela foi gravada — ou todas saíram '
      + 'na purga do ciclo já congelado. Nada aqui será preenchido com exemplo.',
      ICONES.vazio
    ));
    nos.rodapeConversa.hidden = true;
    nos.novas.hidden = true;
    return;
  }

  /* o fluxo de balões */
  if (corpo.firstChild !== nos.fluxo) {
    corpo.textContent = '';
    corpo.style.display = 'block';
    corpo.style.padding = '0';
    corpo.style.overflow = 'hidden';
    nos.fluxo.style.height = '100%';
    corpo.appendChild(nos.fluxo);
    estado.chaves = [];
    estado.ultimoDia = null;
    nos.fluxo.textContent = '';
  }

  const primeiraVez = estado.chaves.length === 0;
  const colado = estaNoFim();
  const feito = sincronizarMensagens(mensagens);
  desenharRodapeMensagens(mensagens);

  if (!feito.entraram) return;

  // Primeira abertura e histórico refeito vão direto para o fim: é o que o
  // usuário espera ver. Só mensagem realmente nova disputa a rolagem.
  if (primeiraVez || feito.refeito) {
    irParaOFim(false);
    return;
  }

  if (colado) {
    irParaOFim(false);
  } else {
    // Quem está lendo mais acima não tem a rolagem arrastada embaixo do dedo.
    estado.pendentes += feito.entraram;
    // O botão pousa logo acima do rodapé, que muda de altura conforme as notas.
    nos.novas.style.bottom = (nos.rodapeConversa.hidden
      ? 16 : nos.rodapeConversa.offsetHeight + 12) + 'px';
    nos.novas.hidden = false;
    const texto = nos.novas.querySelector('span');
    if (texto) {
      texto.textContent = estado.pendentes === 1
        ? '1 mensagem nova' : estado.pendentes + ' mensagens novas';
    }
  }
  anunciar(feito.entraram === 1
    ? '1 mensagem nova nesta conversa'
    : feito.entraram + ' mensagens novas nesta conversa');
}

/**
 * Acrescenta ao fluxo só o que ainda não está desenhado. Se o histórico mudou
 * no meio (mensagem apagada, ordem diferente), refaz o fluxo inteiro.
 * Devolve { entraram, refeito }.
 */
function sincronizarMensagens(mensagens) {
  const nos = estado.nos;
  const chaves = mensagens.map(chaveMensagem);
  const antigas = estado.chaves;

  let comuns = 0;
  while (comuns < antigas.length && comuns < chaves.length && antigas[comuns] === chaves[comuns]) {
    comuns += 1;
  }

  const refeito = comuns < antigas.length;
  if (refeito) {
    nos.fluxo.textContent = '';
    estado.ultimoDia = null;
    comuns = 0;
  }

  const entrando = mensagens.slice(comuns);
  const animar = !refeito && antigas.length > 0;

  entrando.forEach(function (m) {
    const dia = rotuloDoDia(campo(m, ['enviada_em'])) || campo(m, ['dia']);
    if (dia && dia !== estado.ultimoDia) {
      const marca = criar('li', 'wa-dia', dia);
      marca.setAttribute('role', 'separator');
      nos.fluxo.appendChild(marca);
      estado.ultimoDia = dia;
    }
    nos.fluxo.appendChild(balaoDaMensagem(m, animar));
  });

  estado.chaves = chaves;
  return { entraram: entrando.length, refeito: refeito };
}

/** Um balão. A regra crítica desta tela mora aqui: ninguém fala sem nome. */
function balaoDaMensagem(m, animar) {
  const c = contatoDaConversa();
  const lado = ladoDaMensagem(m);
  const item = criar('li', 'wa-balao' + (animar ? ' wa-entrando' : ''));
  item.dataset.lado = lado || 'indefinido';

  /* quem falou + hora */
  const alto = criar('div', 'wa-balao-alto');

  let quem;
  if (lado === 'clinica') {
    quem = 'Clínica';
  } else if (lado === 'tutor') {
    quem = nomeCurtoDoContato(campo(m, ['push_name']) || c.nome, c.telefone);
  } else {
    quem = 'Autoria não informada';
  }
  const noQuem = criar('span', 'wa-quem', quem);
  if (!lado) {
    noQuem.title = 'A mensagem veio sem o campo `quem` (ou `direcao`), então não dá para dizer '
      + 'se quem falou foi o tutor ou a clínica.';
  } else if (lado === 'tutor' && !c.nome && !campo(m, ['push_name'])) {
    noQuem.title = 'Este contato não tem nome salvo no banco; mostrando o telefone.';
  }
  alto.appendChild(noQuem);

  const hora = horaDe(campo(m, ['enviada_em'])) || campo(m, ['hora']);
  const noHora = criar('span', 'wa-balao-hora numero', hora || TRACINHO);
  if (!hora) noHora.title = 'A mensagem veio sem horário na resposta do servidor.';
  else {
    const completa = dataCompleta(campo(m, ['enviada_em']));
    if (completa) noHora.title = completa;
  }
  alto.appendChild(noHora);
  item.appendChild(alto);

  /* corpo */
  const tipo = String(campo(m, ['tipo']) || 'texto');
  const texto = textoDaMensagem(m);
  const transcrito = estadoDaTranscricao(m);

  if (tipo === 'audio') {
    if (texto) {
      item.appendChild(criar('div', 'wa-texto', texto));
    } else {
      const sem = criar('div', 'wa-sem-texto',
        'Áudio sem transcrição no banco. O teor desta mensagem não foi medido.');
      item.appendChild(sem);
    }
  } else if (tipo === 'texto') {
    if (texto) item.appendChild(criar('div', 'wa-texto', texto));
    else item.appendChild(criar('div', 'wa-sem-texto', 'Mensagem de texto sem conteúdo gravado.'));
  } else {
    if (texto) item.appendChild(criar('div', 'wa-texto', texto));
    item.appendChild(anexoDaMensagem(m, tipo));
  }

  /* etiquetas discretas: áudio transcrito, IA, recepção */
  const etiquetas = criar('div', 'wa-etiquetas');

  if (tipo === 'audio') {
    const marca = criar('span', 'wa-etiqueta');
    marca.appendChild(icone(ICONES.audio));
    if (transcrito === true || (transcrito === null && texto)) {
      marca.appendChild(criar('span', null, transcrito === true ? 'transcrito' : 'áudio'));
      marca.title = transcrito === true
        ? 'O texto acima é a transcrição do áudio, feita pelo Whisper na ingestão.'
        : 'A resposta não trouxe o campo `transcrito`; o texto acima veio no conteúdo da mensagem.';
    } else {
      marca.appendChild(criar('span', null, 'sem transcrição'));
      marca.setAttribute('data-tom', 'atencao');
      marca.title = 'O áudio chegou, mas a transcrição não foi gravada.';
    }
    const duracao = formatarSegundos(m.midia && m.midia.segundos);
    if (duracao) marca.appendChild(criar('span', null, '· ' + duracao));
    etiquetas.appendChild(marca);
  }

  const autor = campo(m, ['autor']);
  const autoria = autor ? AUTORIAS[String(autor).toLowerCase()] : null;
  if (autoria) {
    const marca = criar('span', 'wa-etiqueta');
    marca.setAttribute('data-tom', String(autor).toLowerCase());
    marca.appendChild(criar('span', null, autoria.rotulo));
    marca.title = autoria.dica;
    etiquetas.appendChild(marca);
  }

  if (etiquetas.childNodes.length) item.appendChild(etiquetas);

  return item;
}

/** Bloco de mídia: só o metadado que o banco guarda. O arquivo não existe aqui. */
function anexoDaMensagem(m, tipo) {
  const caixa = criar('div', 'wa-anexo');
  caixa.appendChild(icone(iconeDoTipo(tipo)));

  const texto = criar('div', 'wa-anexo-texto');
  texto.appendChild(criar('span', 'wa-anexo-tipo', TIPOS_DE_MENSAGEM[tipo] || tipo));

  const partes = [];
  const midia = m.midia && typeof m.midia === 'object' ? m.midia : null;
  if (midia) {
    if (midia.mimetype) partes.push(String(midia.mimetype));
    const tamanho = formatarBytes(midia.bytes);
    if (tamanho) partes.push(tamanho);
    const duracao = formatarSegundos(midia.segundos);
    if (duracao) partes.push(duracao);
  }
  let semMeta = 'Sem metadado gravado para este arquivo.';
  if (tipo === 'localizacao') semMeta = 'A localização veio como texto, sem mapa nem coordenada à parte.';
  const meta = criar('span', 'wa-anexo-meta', partes.length ? partes.join(' · ') : semMeta);
  texto.appendChild(meta);
  caixa.appendChild(texto);
  return caixa;
}

/**
 * Rodapé da conversa: as duas explicações que só fazem sentido quando o dado
 * pede. Nada de legenda permanente para coisa que não está na tela.
 */
function desenharRodapeMensagens(mensagens) {
  const rodape = estado.nos.rodapeConversa;
  rodape.textContent = '';

  let temAutoria = false;
  let temMidia = false;
  for (let i = 0; i < mensagens.length; i += 1) {
    const tipo = String(campo(mensagens[i], ['tipo']) || 'texto');
    if (campo(mensagens[i], ['autor'])) temAutoria = true;
    if (tipo === 'imagem' || tipo === 'video' || tipo === 'documento') temMidia = true;
    if (temAutoria && temMidia) break;
  }

  if (temAutoria) {
    const nota = criar('div', 'wa-nota');
    nota.appendChild(icone(ICONES.relogio));
    nota.appendChild(criar('span', null,
      'Esta unidade tem agente de IA. O rótulo IA marca a mensagem enviada pelo agente e o '
      + 'rótulo Recepção marca a mensagem enviada por uma pessoa — o tempo de resposta dos '
      + 'balões com IA mede o agente, não a recepção.'));
    rodape.appendChild(nota);
  }

  if (temMidia) {
    const nota = criar('div', 'wa-nota');
    nota.appendChild(icone(ICONES.imagem));
    nota.appendChild(criar('span', null,
      'Imagem, vídeo e documento aparecem só como metadado: o banco guarda o tipo, o tamanho '
      + 'e a duração, nunca o arquivo.'));
    rodape.appendChild(nota);
  }

  rodape.hidden = !rodape.childNodes.length;
}

function esqueletoDeConversa() {
  const caixa = criar('div', 'wa-carregando');
  caixa.appendChild(criar('span', 'sr-apenas', 'Carregando a conversa…'));
  const larguras = ['62%', '44%', '75%', '52%'];
  for (let i = 0; i < larguras.length; i += 1) {
    const bloco = criar('div', 'esqueleto');
    bloco.style.height = '56px';
    bloco.style.width = larguras[i];
    bloco.style.alignSelf = i % 2 ? 'flex-end' : 'flex-start';
    bloco.style.marginLeft = i % 2 ? 'auto' : '0';
    caixa.appendChild(bloco);
  }
  return caixa;
}

/* --- Rolagem do fluxo ---------------------------------------------------- */

function estaNoFim() {
  const fluxo = estado.nos.fluxo;
  if (!fluxo || !fluxo.isConnected) return true;
  return (fluxo.scrollHeight - fluxo.scrollTop - fluxo.clientHeight) <= COLADO_PX;
}

function irParaOFim(suave) {
  const fluxo = estado.nos.fluxo;
  if (!fluxo) return;
  const reduzido = movimentoReduzido();
  try {
    if (suave && !reduzido && typeof fluxo.scrollTo === 'function') {
      fluxo.scrollTo({ top: fluxo.scrollHeight, behavior: 'smooth' });
    } else {
      fluxo.scrollTop = fluxo.scrollHeight;
    }
  } catch (e) {
    fluxo.scrollTop = fluxo.scrollHeight;
  }
  estado.pendentes = 0;
  estado.nos.novas.hidden = true;
}

function aoRolarFluxo() {
  if (!estado || !estado.pendentes) return;
  if (estaNoFim()) {
    estado.pendentes = 0;
    estado.nos.novas.hidden = true;
  }
}

function movimentoReduzido() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {
    return false;
  }
}

function anunciar(texto) {
  if (estado && estado.nos.anuncio) estado.nos.anuncio.textContent = texto;
}

/* ═════════════════════════ 14. FICHA DO CONTATO ═════════════════════════ */

function desenharFicha() {
  const corpo = estado.nos.corpoFicha;
  corpo.textContent = '';

  if (!estado.conversaId) {
    corpo.style.display = '';
    corpo.style.padding = '';
    corpo.appendChild(vazio(
      'A ficha aparece ao abrir uma conversa',
      'Aqui entram o telefone, o tipo do contato com o motivo da classificação, quando ele '
      + 'falou pela primeira vez e os tempos de resposta desta conversa.',
      ICONES.ficha
    ));
    return;
  }

  /* a conversa falhou: a ficha diz isso, em vez de virar uma coluna de tracinhos */
  if (estado.erroConversa && !estado.conversa) {
    corpo.style.display = '';
    corpo.style.padding = '';
    corpo.appendChild(vazio(
      'Não consegui ler a ficha deste contato',
      (estado.erroConversa.amigavel || 'A consulta da conversa falhou.')
      + ' A ficha vem na mesma resposta da conversa, então nada dela pode ser mostrado agora.',
      ICONES.alerta
    ));
    return;
  }

  if (!estado.recebeuConversa && !estado.conversa) {
    corpo.style.display = 'block';
    corpo.style.padding = '';
    const espera = criar('div', 'wa-carregando');
    for (let i = 0; i < 5; i += 1) {
      espera.appendChild(criar('div', 'esqueleto linha'));
      espera.appendChild(criar('div', 'esqueleto linha curta'));
    }
    corpo.appendChild(espera);
    return;
  }

  corpo.style.display = 'block';
  corpo.style.padding = '';
  const c = contatoDaConversa();
  const faltando = [];

  /* topo: avatar + nome */
  const topo = criar('div', 'wa-ficha-topo');
  topo.appendChild(avatarDe(c.nome));
  const nome = criar('div', 'wa-ficha-nome', nomeDoContato(c.nome, c.telefone));
  if (!c.nome) nome.title = 'Este contato não tem nome salvo no banco.';
  topo.appendChild(nome);
  corpo.appendChild(topo);

  /* telefone */
  corpo.appendChild(linhaDaFicha(
    'Telefone',
    c.telefone ? formatarTelefone(c.telefone) : null,
    'O campo telefone não veio na resposta da ação conversa.'
  ));
  if (!c.telefone) faltando.push('telefone');

  /* tipo do contato + motivo */
  const tipo = TIPOS_DE_CONTATO[c.tipo] || null;
  const linhaTipo = criar('div', 'wa-ficha-linha');
  linhaTipo.appendChild(criar('span', 'legenda', 'Tipo do contato'));
  if (tipo) {
    const selo = criar('span', 'selo ' + tipo.selo, tipo.rotulo);
    selo.style.alignSelf = 'flex-start';
    linhaTipo.appendChild(selo);
    if (c.tipo_motivo) {
      linhaTipo.appendChild(criar('p', 'wa-ficha-apoio', c.tipo_motivo));
    } else if (c.tipo === 'desconhecido') {
      linhaTipo.appendChild(criar('p', 'wa-ficha-apoio',
        'Ainda não classificado. Enquanto estiver assim, este número conta como público nas '
        + 'contas da análise, mesmo que seja laboratório, fornecedor ou a própria equipe.'));
    } else {
      linhaTipo.appendChild(criar('p', 'wa-ficha-apoio texto-3',
        'A classificação não veio acompanhada do motivo (campo tipo_motivo).'));
    }
  } else {
    const valor = criar('span', 'wa-ficha-valor', TRACINHO);
    valor.dataset.medida = 'nao';
    valor.title = 'A resposta não trouxe o tipo do contato.';
    linhaTipo.appendChild(valor);
    faltando.push('tipo');
  }
  corpo.appendChild(linhaTipo);

  /* primeira conversa */
  const primeira = c.primeiro_contato_em;
  corpo.appendChild(linhaDaFicha(
    'Primeira conversa',
    primeira ? formatarQuando(primeira) : null,
    'A ação conversa não devolveu primeiro_contato_em, então não dá para dizer desde quando '
    + 'este número fala com a unidade.',
    primeira ? dataCompleta(primeira) : null
  ));
  if (!primeira) faltando.push('primeiro_contato_em');

  /* total de conversas */
  corpo.appendChild(linhaDaFicha(
    'Total de conversas',
    c.total_conversas === null ? null : formatarNumero(c.total_conversas),
    'A ação conversa não devolveu total_conversas. A lista da esquerda mostra só as conversas '
    + 'já carregadas, então contar por aqui daria um número errado.'
  ));
  if (c.total_conversas === null) faltando.push('total_conversas');

  /* tempo de primeira resposta */
  corpo.appendChild(linhaDaFicha(
    'Tempo até a primeira resposta',
    c.primeira_resposta_min === null ? null : formatarMinutos(c.primeira_resposta_min),
    'A ação conversa não devolveu primeira_resposta_min.',
    c.primeira_resposta_min === null ? null
      : 'Do primeiro "oi" do contato até a primeira mensagem da clínica nesta conversa.'
  ));
  if (c.primeira_resposta_min === null) faltando.push('primeira_resposta_min');

  /* maior espera */
  corpo.appendChild(linhaDaFicha(
    'Maior espera desta conversa',
    c.maior_espera_min === null ? null : formatarMinutos(c.maior_espera_min),
    'A ação conversa não devolveu maior_espera_min.',
    c.maior_espera_min === null ? null
      : 'O maior intervalo entre uma mensagem do contato e a resposta da clínica.'
  ));
  if (c.maior_espera_min === null) faltando.push('maior_espera_min');

  /* o que falta, dito com nome de campo — para dar para consertar no servidor */
  if (faltando.length) {
    const aviso = criar('div', 'aviso aviso-atencao wa-ficha-aviso');
    aviso.appendChild(icone(ICONES.alerta));
    const texto = criar('div');
    texto.style.flex = '1 1 auto';
    texto.style.minWidth = '0';
    texto.appendChild(criar('span', 'aviso-titulo', 'Campos com tracinho não foram medidos'));
    texto.appendChild(criar('span', 'aviso-texto',
      'A resposta da ação conversa não trouxe: ' + faltando.join(', ') + '. Tracinho aqui '
      + 'significa "não medimos", nunca zero — a RPC conversa_completa precisa devolver esses '
      + 'campos para os números aparecerem.'));
    aviso.appendChild(texto);
    corpo.appendChild(aviso);
  }
}

/** Uma linha da ficha. Valor null vira tracinho com o motivo no title. */
function linhaDaFicha(rotulo, valor, motivoDaFalta, apoio) {
  const linha = criar('div', 'wa-ficha-linha');
  linha.appendChild(criar('span', 'legenda', rotulo));

  const no = criar('span', 'wa-ficha-valor', valor === null || valor === undefined ? TRACINHO : valor);
  if (valor === null || valor === undefined) {
    no.dataset.medida = 'nao';
    no.title = motivoDaFalta || 'Sem medida para este campo.';
  }
  linha.appendChild(no);

  if (apoio) linha.appendChild(criar('p', 'wa-ficha-apoio texto-3', apoio));
  return linha;
}

/* ═════════════════════════ 15. RELÓGIO DA LISTA ═════════════════════════ */

/** Reescreve os "há 8 min" sem consultar o servidor de novo. */
function atualizarHorarios() {
  if (!estado || !estado.nos.lista) return;
  const horas = estado.nos.lista.querySelectorAll('.wa-linha-quando');
  for (let i = 0; i < horas.length; i += 1) {
    const quando = horas[i].dataset.quando;
    if (quando) horas[i].textContent = formatarQuando(quando);
  }
}

/* ═════════════════════════ 16. INTERFACE DA TELA ════════════════════════ */

export const tela = {
  id: 'whatsapp',
  titulo: 'WhatsApp ao Vivo',
  icone: ICONES.balao,

  async montar(raiz, ctx) {
    instalarEstilo();
    estado = estadoNovo(raiz, ctx);

    montarArmacao(raiz);

    // A unidade pode trocar no seletor do topo sem remontar a tela.
    if (ctx && typeof ctx.aoTrocarUnidade === 'function') {
      const cancelar = ctx.aoTrocarUnidade(function () { aplicarUnidade(); });
      aoLimpar(cancelar);
    }

    // Relógio dos horários relativos da lista.
    const relogio = setInterval(atualizarHorarios, RELOGIO_MS);
    aoLimpar(function () { clearInterval(relogio); });

    // Em tela larga os três painéis convivem; abaixo de 720px a lista abre primeiro.
    mostrarPainel('lista');

    aplicarUnidade();
  },

  desmontar() {
    if (!estado) return;

    pararAssinaturas();
    if (estado.esperaBusca) { clearTimeout(estado.esperaBusca); estado.esperaBusca = null; }
    if (estado.observador) { estado.observador.disconnect(); estado.observador = null; }

    estado.limpezas.forEach(function (fn) {
      try { fn(); } catch (e) { console.error('[whatsapp] falha ao limpar', e); }
    });
    estado.limpezas = [];

    // O fluxo e a lista saem do DOM com a raiz; as referências morrem aqui.
    estado.linhas = new Map();
    estado.porId = new Map();
    estado.nos = {};
    estado = null;
  },
};
