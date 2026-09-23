/*
  analise.js — aba "Análise de Desempenho" do WhatsApp 360° Vision.

  É a tela que justifica a plataforma: diz onde a unidade acerta, onde erra e o
  que muda a conversão. A avaliação chega pronta do servidor em
  `api.analise(slug, dias)`; aqui ela é APRESENTADA com rigor.

  ── O que esta tela NUNCA faz ───────────────────────────────────────────────
  1. Inventar critério. A metodologia é a da seção 5 do CONTRATO.md — método 5C,
     temperatura do lead, os 4 indicadores de 30 dias com as metas oficiais e os
     8 compromissos do treinamento. Nada é ampliado aqui: o que o treinamento não
     define, esta tela só mostra se o servidor mandar o texto junto.
  2. Inventar número. Sem dado, entra o estado vazio dizendo o que falta.
  3. Misturar medida com julgamento. O bloco MEDIDO (borda fria) traz o que foi
     contado sobre as conversas; o bloco AVALIAÇÃO DA DACO (borda quente) traz
     nota, prioridade e recomendação. A nota, por ser julgamento, sai marcada
     como avaliação mesmo estando no cabeçalho.
  4. Classificar compromisso sem trecho que o sustente — vira "sem base
     suficiente", nunca uma nota.
  5. Citar outra unidade. A comparação com a rede usa só a referência agregada.

  ── O que a tela lê de api.analise(slug, dias) ──────────────────────────────
  A leitura é tolerante: cada campo é procurado por alguns nomes equivalentes e,
  não vindo nenhum, o pedaço correspondente aparece como ausência de medida.

    { unidade, periodo: { dias, de, ate },
      base: { conversas, mensagens, audios, leads, contatos_classificados,
              suficiente, minimo_conversas },
      nota, nota_criterio,
      indicadores: { cta_claro, orcamento_qualificado, follow_up,
                     comentario_interno },        // número ou
                                                  // { medido, meta, contagem, situacao, definicao }
      sla: { mediana_min, p90_min, pct_ate_5min, pct_respondidas },
      compromissos: [ { numero|chave, titulo, medido, contagem, situacao,
                        observacao, trechos: [ { conversa_id, quando, titulo,
                          mensagens: [ { quem, autor, nome, texto, tipo,
                                         transcrito, hora } ] } ] } ],
      correcoes: [ { titulo, impacto, o_que_acontece, o_que_fazer,
                     frase_pronta, indicador } ],
      temperatura: { frio, morno, quente, total },
      agente_ia: true|false,
      rede: { nota_mediana, sla_mediana_min, pct_ate_5min, pct_respondidas },
      funil: { total,
               estagios: [ { estagio, ordem, alcancaram } ],
               destinos: { acontece, trava, nao_acontece, andando },
               pct_convertidas, pct_travadas, pct_perdidas,
               maior_queda: { de, para, perdidos, pct },
               situacoes_texto: { <situacao>: { grupo, texto } },
               motivos: [ { motivo, texto, quantidade } ],
               a_clinica_deve: { quantidade, sem_resposta, sem_direcao, horas_mediana, casos },
               follow_up_pendente: { quantidade, casos } } }
                 // caso: { conversa_id, contato, telefone, estagio, estagio_nome, situacao,
                 //         motivo, bola, parada_horas, primeira_resposta_min, mensagens,
                 //         ultima_em, trecho: { mensagens: [ { quem, hora, tipo, texto } ] } }
                 // Sem `funil`, a seção de conversão simplesmente não é desenhada.

  ── Convivência (seção 6 do CONTRATO.md) ────────────────────────────────────
  Só classes com o prefixo `an-`, além das compartilhadas do tema.css. Nenhum
  token e nenhum componente do tema é redefinido aqui. Todo timer, listener,
  animação e assinatura entra em `estado.limpezas` e morre em `desmontar()`.
*/

import {
  api,
  assinarAtualizacao,
  ehErroDeSessao,
  formatarMinutos,
  formatarNumero,
  formatarPorcentagem,
  formatarQuando,
  formatarTelefone,
  primeiroNome,
  ou,
  TRACINHO,
} from './dados.js';
import { marca as identidade } from './marca.js';

/* ═════════════════════════ 1. METODOLOGIA E CONSTANTES ═══════════════════
   Tudo nesta seção vem da seção 5 do CONTRATO.md, que por sua vez vem dos
   treinamentos entregues à rede. Nenhum critério novo entra aqui.
   ════════════════════════════════════════════════════════════════════════ */

/** Períodos que o seletor oferece. O treinamento mede em 30 dias — é o padrão. */
const PERIODOS = [
  { dias: 7, rotulo: '7 dias' },
  { dias: 30, rotulo: '30 dias' },
  { dias: 90, rotulo: '90 dias' },
];
const PERIODO_PADRAO = 30;

/** De quanto em quanto tempo a análise é reconsultada. Igual ao cache de `analise`. */
const INTERVALO_MS = 300000;

/** Quanto tempo o botão de copiar fica confirmando a cópia. */
const AVISO_COPIA_MS = 2400;

/**
 * Os 4 indicadores de 30 dias, com as metas oficiais do treinamento.
 * `alvo: 'minimo'` → a meta é um piso (90%+). `alvo: 'maximo'` → é um teto (0).
 * `chaves` são os nomes que o servidor pode usar para o mesmo indicador.
 */
const INDICADORES = [
  {
    chave: 'cta_claro',
    chaves: ['cta_claro', 'leads_com_cta', 'cta', 'leads_cta'],
    rotulo: 'Leads com CTA claro',
    meta: 90,
    alvo: 'minimo',
    formato: 'pct',
    conta: 'leads',
  },
  {
    chave: 'orcamento_qualificado',
    chaves: ['orcamento_qualificado', 'orcamentos_com_qualificacao', 'qualificacao_antes', 'orcamento'],
    rotulo: 'Orçamentos com qualificação antes',
    meta: 100,
    alvo: 'minimo',
    formato: 'pct',
    conta: 'orçamentos',
  },
  {
    chave: 'follow_up',
    chaves: ['follow_up', 'followup', 'follow_ups', 'resposta_follow_up'],
    rotulo: 'Resposta aos follow-ups',
    meta: 40,
    alvo: 'minimo',
    formato: 'pct',
    conta: 'follow-ups',
  },
  {
    chave: 'comentario_interno',
    chaves: ['comentario_interno', 'comentarios_internos', 'comentario_interno_qtd'],
    rotulo: 'Comentários internos no WhatsApp',
    meta: 0,
    alvo: 'maximo',
    formato: 'contagem',
    conta: 'ocorrências',
  },
];

/**
 * Os 4 números de tempo de resposta. Não são meta: os quatro indicadores de 30
 * dias do treinamento são CTA, qualificação, follow-up e comentários internos.
 * O prazo de 5 minutos que o treinamento cobra é o do lead vindo da notificação
 * de campanha, e quem mede isso é a aba Leads.
 */
const TEMPOS = [
  {
    chave: 'mediana',
    chaves: ['mediana_min', 'sla_mediana_min', 'mediana', 'sla_mediano_min'],
    rotulo: 'Mediana de resposta',
    formato: 'minutos',
  },
  {
    chave: 'p90',
    chaves: ['p90_min', 'sla_p90_min', 'p90'],
    rotulo: 'P90 de resposta',
    formato: 'minutos',
  },
  {
    chave: 'pct_ate_5min',
    chaves: ['pct_ate_5min', 'pct_ate_5', 'ate_5min'],
    rotulo: 'Respondidas em até 5 min',
    formato: 'pct',
  },
  {
    chave: 'pct_respondidas',
    chaves: ['pct_respondidas', 'respondidas_pct', 'pct_respondida'],
    rotulo: 'Conversas respondidas',
    formato: 'pct',
  },
];

/** Os 8 compromissos, na ordem e com o texto do checklist final do treinamento. */
const COMPROMISSOS = [
  { numero: 1, chaves: ['intencao', 'identificar_intencao'], titulo: 'Identificar a intenção do lead' },
  { numero: 2, chaves: ['preco', 'perguntar_antes_do_preco'], titulo: 'Perguntar antes de passar preço' },
  { numero: 3, chaves: ['encerramento', 'nao_encerrar'], titulo: 'Não encerrar em "ok", "obrigado" ou "só trazer"' },
  { numero: 4, chaves: ['prazo', 'dar_prazo'], titulo: 'Dar prazo quando precisar verificar algo' },
  { numero: 5, chaves: ['audio', 'tratar_audio'], titulo: 'Tratar áudio com acolhimento e resgate' },
  { numero: 6, chaves: ['exame', 'resultado_exame'], titulo: 'Não terceirizar resultado de exame ao tutor' },
  { numero: 7, chaves: ['crm', 'registrar_crm'], titulo: 'Registrar lead e follow-up no CRM' },
  { numero: 8, chaves: ['area_publica', 'whatsapp_publico'], titulo: 'Tratar o WhatsApp como área pública da clínica' },
];

/**
 * Temperatura do lead. `sinal` é a definição do treinamento, copiada da tabela
 * do contrato. `passo` é o ponto do 5C (Conectar → Coletar → Contextualizar →
 * Converter → Continuar) em que a faixa está — a sequência é a do próprio
 * método, não um critério novo. Se o servidor mandar o texto dele, ele ganha.
 */
const TEMPERATURAS = [
  {
    chave: 'frio',
    rotulo: 'Frio',
    sinal: 'Pergunta ampla: horário, endereço, "vocês fazem?".',
    passo: 'Cobra Conectar e Coletar: responder e já perguntar do que o pet precisa.',
  },
  {
    chave: 'morno',
    rotulo: 'Morno',
    sinal: 'Necessidade definida: preço, sintoma, serviço específico.',
    passo: 'Cobra Contextualizar: peso, idade, porte ou sintoma antes do valor.',
  },
  {
    chave: 'quente',
    rotulo: 'Quente',
    sinal: 'Quer hoje, pede vaga ou data, manda foto, receita, dados ou forma de pagamento.',
    passo: 'Cobra Converter e Continuar: oferecer a vaga, confirmar e registrar o follow-up.',
  },
];

/** Comparação com a rede. Cada referência carrega o nome exato da estatística. */
const COMPARACOES = [
  {
    chave: 'nota',
    rotulo: 'Nota geral',
    formato: 'nota',
    maiorMelhor: true,
    lerUnidade: function (leitura) { return leitura.nota.valor; },
    camposRede: [
      { chaves: ['nota_mediana', 'mediana_nota'], rotulo: 'mediana da rede' },
      { chaves: ['nota_media'], rotulo: 'média da rede' },
    ],
    acima: 'nota acima da referência da rede',
    abaixo: 'nota abaixo da referência da rede',
  },
  {
    chave: 'sla_mediana_min',
    rotulo: 'Mediana de resposta',
    formato: 'minutos',
    maiorMelhor: false,
    lerUnidade: function (leitura) { return leitura.tempos.mediana; },
    camposRede: [{ chaves: ['sla_mediana_min', 'mediana_min'], rotulo: 'mediana da rede' }],
    acima: 'leva mais tempo que a referência até a primeira resposta',
    abaixo: 'leva menos tempo que a referência até a primeira resposta',
  },
  {
    chave: 'pct_ate_5min',
    rotulo: 'Respondidas em até 5 min',
    formato: 'pct',
    maiorMelhor: true,
    lerUnidade: function (leitura) { return leitura.tempos.pct_ate_5min; },
    camposRede: [{ chaves: ['pct_ate_5min', 'pct_ate_5'], rotulo: 'rede no mesmo recorte' }],
    acima: 'alcança mais conversas nos 5 primeiros minutos que a referência',
    abaixo: 'alcança menos conversas nos 5 primeiros minutos que a referência',
  },
  {
    chave: 'pct_respondidas',
    rotulo: 'Conversas respondidas',
    formato: 'pct',
    maiorMelhor: true,
    lerUnidade: function (leitura) { return leitura.tempos.pct_respondidas; },
    camposRede: [{ chaves: ['pct_respondidas'], rotulo: 'rede no mesmo recorte' }],
    acima: 'deixa menos conversa sem resposta que a referência',
    abaixo: 'deixa mais conversa sem resposta que a referência',
  },
];

/**
 * Estágios do funil de conversão, com o rótulo que a tela mostra no lugar da
 * chave. A ordem é a que o servidor manda em `ordem`; esta tabela só traduz.
 */
const ESTAGIOS_DO_FUNIL = {
  sem_resposta: 'Chegou',
  respondida: 'Respondida',
  qualificada: 'Qualificada',
  proposta: 'Proposta enviada',
  compromisso: 'Próximo passo dado',
  confirmada: 'Tutor confirmou',
  compareceu: 'Sinal de que veio',
};

/**
 * Os três destinos de uma conversa fechada. `grupo` casa com o `grupo` de
 * `situacoes_texto`, para a descrição de cada destino vir do servidor.
 * `explica` só entra quando o servidor não manda texto nenhum para o grupo.
 */
const DESTINOS = [
  {
    chave: 'acontece',
    chaves: ['acontece', 'convertidas', 'converteu'],
    pctChaves: ['pct_convertidas', 'pct_acontece'],
    rotulo: 'Acontece',
    tom: 'ok',
    explica: 'Chegou a um próximo passo e o tutor confirmou.',
  },
  {
    chave: 'trava',
    chaves: ['trava', 'travadas', 'travou'],
    pctChaves: ['pct_travadas', 'pct_trava'],
    rotulo: 'Trava',
    tom: 'atencao',
    explica: 'Parou sem o passo seguinte, de um lado ou do outro.',
  },
  {
    chave: 'nao_acontece',
    chaves: ['nao_acontece', 'perdidas', 'perdeu'],
    pctChaves: ['pct_perdidas', 'pct_nao_acontece'],
    rotulo: 'Não acontece',
    tom: 'risco',
    explica: 'Encerrou sem acontecer.',
  },
];

/**
 * As duas listas de conversa parada. São ações diferentes: na primeira a
 * recepção DEVE uma resposta; na segunda ela já respondeu e precisa retomar.
 * `situacoes` são as chaves de `situacao` que compõem cada lista.
 */
const DIVIDAS = [
  {
    chave: 'clinica',
    chaves: ['a_clinica_deve', 'clinica_deve'],
    rotulo: 'A clínica deve o próximo passo',
    situacoes: ['aguardando_clinica', 'sem_direcao'],
    acao: 'É dívida de resposta: a última palavra foi do tutor, ou a clínica encerrou sem dizer '
      + 'o passo seguinte. Cada caso abaixo está esperando a recepção.',
  },
  {
    chave: 'tutor',
    chaves: ['follow_up_pendente', 'followup_pendente'],
    rotulo: 'Follow-up pendente',
    situacoes: ['aguardando_tutor'],
    acao: 'É retomada, não dívida: a clínica deu o passo e o tutor não voltou. Cada caso abaixo '
      + 'está esperando uma mensagem de follow-up.',
  },
];

/** Quantos casos entram por vez na lista aberta. O resto vem em "mostrar mais". */
const CASOS_POR_LOTE = 8;

/**
 * Lados que a tela sabe nomear numa fala de caso parado. Mensagem com `quem`
 * fora desta lista derruba o trecho inteiro: citação sem autor não serve.
 */
const LADOS_CONHECIDOS = ['tutor', 'contato', 'cliente', 'clinica', 'recepcao', 'unidade', 'atendente', 'ia'];

/** Unidades com agente de IA. Usado SÓ se a API não marcar `tem_agente_ia` —
    a fonte de verdade é o servidor. Vem da identidade desta instalação para
    que nenhum nome de cliente fique preso no código compartilhado. */
const MARCAS_DE_IA = identidade.marcasDeIa;

/** Motivos que o servidor pode dar para não haver análise, com o que fazer. */
const MOTIVOS = {
  ciclo_aberto: {
    titulo: 'O ciclo desta unidade ainda não fechou',
    texto: 'A metodologia avalia um ciclo fechado de conversas. Enquanto o ciclo do período '
      + 'estiver aberto, a avaliação não é calculada — o resultado parcial mudaria a cada hora '
      + 'e não serviria para cobrar nada da recepção.',
  },
  sem_classificacao: {
    titulo: 'Os contatos desta unidade ainda não foram classificados',
    texto: 'Sem separar tutor de fornecedor e de equipe, a contagem de leads mistura quem nunca '
      + 'foi cliente com quem liga para vender. Classifique os contatos do período e a análise '
      + 'passa a ser calculada no próximo ciclo.',
  },
  captura_nao_ligada: {
    titulo: 'A captura desta unidade não está ligada',
    texto: 'Nada foi gravado no período, então não há conversa para medir. Ligue a captura da '
      + 'unidade e a primeira análise sai depois do primeiro ciclo fechado.',
  },
  base_insuficiente: {
    titulo: 'Base pequena demais para concluir',
    texto: 'Houve conversa no período, mas em quantidade que não sustenta percentual nem nota. '
      + 'Um número calculado sobre poucas conversas vira ruído, e ruído não vira cobrança.',
  },
};

/* ═════════════════════════ 2. ÍCONES ════════════════════════════════════
   24×24, traço em currentColor, sem fill fixo — como manda a seção 6.
   ════════════════════════════════════════════════════════════════════════ */

const SVG_ABRE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
  + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';

const ICONES = {
  analise: SVG_ABRE + '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M7 15.5 11 10l3.5 3L20 6"/>'
    + '<circle cx="11" cy="10" r="1.2"/></svg>',
  regua: SVG_ABRE + '<rect x="2.5" y="7" width="19" height="10" rx="2"/><path d="M7 7v3"/>'
    + '<path d="M11 7v4.5"/><path d="M15 7v3"/><path d="M19 7v4.5"/></svg>',
  selo: SVG_ABRE + '<path d="M12 3 4.5 6.4V12c0 4.3 3 7.8 7.5 9 4.5-1.2 7.5-4.7 7.5-9V6.4Z"/>'
    + '<path d="m9 12 2.2 2.2L15.4 10"/></svg>',
  lista: SVG_ABRE + '<path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/>'
    + '<path d="M4.5 6h.01"/><path d="M4.5 12h.01"/><path d="M4.5 18h.01"/></svg>',
  balao: SVG_ABRE + '<path d="M20.5 11.6a7.9 7.9 0 0 1-11.4 7.1L4 20l1.4-4.8A7.9 7.9 0 1 1 20.5 11.6Z"/></svg>',
  termometro: SVG_ABRE + '<path d="M13.5 13.6V5a1.5 1.5 0 0 0-3 0v8.6a4 4 0 1 0 3 0Z"/>'
    + '<path d="M12 17.5h.01"/></svg>',
  rede: SVG_ABRE + '<circle cx="12" cy="5" r="2.3"/><circle cx="5" cy="18" r="2.3"/>'
    + '<circle cx="19" cy="18" r="2.3"/><path d="M10.4 6.8 6.4 15.9"/><path d="M13.6 6.8l4 9.1"/>'
    + '<path d="M7.3 18h9.4"/></svg>',
  robo: SVG_ABRE + '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 5v3"/>'
    + '<circle cx="12" cy="4" r="1.2"/><path d="M9 13h.01"/><path d="M15 13h.01"/>'
    + '<path d="M10 16.4h4"/></svg>',
  alerta: SVG_ABRE + '<path d="M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3'
    + 'l-7.9-13.7a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4.5"/><path d="M12 17.2h.01"/></svg>',
  seta: SVG_ABRE + '<path d="m6 9 6 6 6-6"/></svg>',
  sobe: SVG_ABRE + '<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/></svg>',
  desce: SVG_ABRE + '<path d="M12 5v14"/><path d="m6 13 6 6 6-6"/></svg>',
  igual: SVG_ABRE + '<path d="M5 10h14"/><path d="M5 14h14"/></svg>',
  copiar: SVG_ABRE + '<rect x="9" y="9" width="11" height="11" rx="2"/>'
    + '<path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
  atualizar: SVG_ABRE + '<path d="M20 11a8 8 0 1 0-1.6 5.6"/><path d="M20 5v6h-6"/></svg>',
  relogio: SVG_ABRE + '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></svg>',
  funil: SVG_ABRE + '<path d="M3.5 4.5h17l-6.5 7.8v6.2l-4 2v-8.2Z"/></svg>',
  vazio: SVG_ABRE + '<path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5Z"/><path d="M12 12v9"/>'
    + '<path d="m4 7.5 8 4.5 8-4.5"/></svg>',
};

/* ═════════════════════════ 3. ESTILO DO MÓDULO ══════════════════════════
   Só o que é exclusivo desta tela. Cartão, selo, barra, métrica, vazio,
   aviso e utilitários de layout vêm do tema.css e não são redefinidos.
   ════════════════════════════════════════════════════════════════════════ */

const ESTILO = `
.an { display: flex; flex-direction: column; gap: var(--esp-16); min-width: 0; }

/* --- Peças de texto repetidas ------------------------------------------ */
.an-legenda { font-size: var(--txt-legenda); font-weight: 600; color: var(--tinta-3); line-height: 1.5; }
.an-rodape-nota { font-size: var(--txt-pequeno); font-weight: 500; color: var(--tinta-2); line-height: 1.55; }
.an-quando { font-size: var(--txt-legenda); font-weight: 600; color: var(--tinta-3); }
/* O .cresce do tema só vale dentro de .pilha/.pilha-h; estas faixas são flex
   por conta do .aviso, então o miolo de texto recebe aqui o mesmo comportamento. */
.an-aviso-corpo { flex: 1 1 auto; min-width: 0; }
.an-vazio-lista {
  max-width: 46ch;
  margin: 0;
  padding-left: 20px;
  text-align: left;
  font-size: var(--txt-pequeno);
  font-weight: 500;
  color: var(--tinta-2);
  line-height: 1.6;
}
.an-vazio-lista li + li { margin-top: var(--esp-4); }
/* Envelope padrão de ícone: quem precisa de tamanho próprio tem regra abaixo.
   Ícone dentro de .btn, .aviso, .vazio e .an-rotulo já é dimensionado por lá. */
.an-icone { display: inline-flex; align-items: center; flex: none; }
.an-trecho-icone { display: inline-flex; flex: none; color: var(--tinta-3); }
.an-trecho-icone svg { width: 16px; height: 16px; }

/* --- Controles do topo -------------------------------------------------- */
.an-controles { display: flex; align-items: center; flex-wrap: wrap; gap: var(--esp-12); }
.an-periodo {
  display: inline-flex;
  border: 1px solid var(--linha);
  border-radius: var(--r-p);
  background: var(--fundo-2);
  overflow: hidden;
}
.an-periodo-btn {
  min-height: var(--alvo-toque);
  padding: 0 var(--esp-16);
  background: transparent;
  border: 0;
  border-right: 1px solid var(--linha);
  color: var(--tinta-2);
  font-family: var(--fonte-texto);
  font-size: var(--txt-pequeno);
  font-weight: 700;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--transicao), color var(--transicao);
}
.an-periodo-btn:last-child { border-right: 0; }
.an-periodo-btn:hover { background: var(--carta); color: var(--tinta); }
.an-periodo-btn[aria-pressed="true"] { background: var(--veu-indigo); color: var(--tinta); }
.an-periodo-btn:focus-visible { outline: 2px solid var(--indigo-cl); outline-offset: -2px; }

/* --- Cabeçalho ---------------------------------------------------------- */
.an-topo { display: flex; align-items: stretch; flex-wrap: wrap; gap: var(--esp-24); }
.an-topo-id { display: flex; flex-direction: column; gap: var(--esp-4); flex: 1 1 320px; min-width: 0; }
.an-titulo { font-size: var(--txt-titulo); }
.an-periodo-texto { font-size: var(--txt-pequeno); font-weight: 600; color: var(--tinta-2); }

.an-base {
  display: flex;
  flex-wrap: wrap;
  gap: var(--esp-8) var(--esp-24);
  margin-top: var(--esp-8);
  padding-top: var(--esp-12);
  border-top: 1px solid var(--linha);
}
.an-base-item { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.an-base-valor {
  font-family: var(--fonte-titulo);
  font-size: var(--txt-medio);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--tinta);
}
.an-base-item[data-vazio="sim"] .an-base-valor { color: var(--tinta-3); }
.an-base-rotulo { font-size: var(--txt-pequeno); font-weight: 600; color: var(--tinta-2); }

/* Caixa da nota: é julgamento, então sai marcada como avaliação da Daco. */
.an-nota-caixa {
  flex: 0 1 300px;
  display: flex;
  flex-direction: column;
  gap: var(--esp-8);
  padding: var(--esp-16);
  border: 1px solid rgba(255, 90, 31, .30);
  border-left: 3px solid var(--daco-laranja);
  border-radius: var(--r-p);
  background: rgba(255, 90, 31, .06);
  min-width: 0;
}
.an-nota-linha { display: flex; align-items: baseline; gap: var(--esp-8); }
.an-nota-valor {
  font-family: var(--fonte-titulo);
  font-size: var(--txt-numero);
  font-weight: 800;
  line-height: 1;
  letter-spacing: -.03em;
  font-variant-numeric: tabular-nums;
}
.an-nota-escala { font-size: var(--txt-pequeno); font-weight: 700; color: var(--tinta-2); }
.an-nota-criterio { font-size: var(--txt-pequeno); font-weight: 500; color: var(--tinta-2); line-height: 1.5; }
.an-nota-caixa[data-tom="ok"] .an-nota-valor { color: var(--ok); }
.an-nota-caixa[data-tom="atencao"] .an-nota-valor { color: var(--atencao); }
.an-nota-caixa[data-tom="risco"] .an-nota-valor { color: var(--risco); }
.an-nota-caixa[data-tom="sem"] .an-nota-valor { color: var(--tinta-3); font-size: var(--txt-medio); }

/* --- Rótulos dos dois blocos ------------------------------------------- */
.an-rotulo {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: var(--r-redondo);
  border: 1px solid transparent;
  font-size: var(--txt-legenda);
  font-weight: 800;
  letter-spacing: .1em;
  text-transform: uppercase;
  white-space: nowrap;
}
.an-rotulo svg { width: 14px; height: 14px; }
.an-rotulo-medido { background: var(--veu-indigo); border-color: rgba(91, 91, 214, .42); color: var(--indigo-cl); }
.an-rotulo-avaliacao { background: rgba(255, 90, 31, .13); border-color: rgba(255, 90, 31, .42); color: var(--daco-laranja); }

.an-bloco-cabeca { display: flex; align-items: center; flex-wrap: wrap; gap: var(--esp-12); }
.an-bloco-cabeca h2 { min-width: 0; }
.an-bloco-nota {
  width: 100%;
  font-size: var(--txt-pequeno);
  font-weight: 500;
  color: var(--tinta-2);
  line-height: 1.55;
}

/* Bloco frio: o que foi medido. Bloco quente: a avaliação da Daco. */
.an-bloco { display: flex; flex-direction: column; gap: var(--esp-16); }
.an-bloco-medido { border-left: 3px solid var(--indigo); }
.an-bloco-avaliacao { border-left: 3px solid var(--daco-laranja); }
@supports (background: linear-gradient(180deg, #000, #000)) {
  .an-bloco-medido { background: linear-gradient(180deg, rgba(91, 91, 214, .05), rgba(91, 91, 214, 0) 140px), var(--carta); }
  .an-bloco-avaliacao { background: linear-gradient(180deg, rgba(255, 90, 31, .05), rgba(255, 90, 31, 0) 140px), var(--carta); }
}

/* --- Indicadores -------------------------------------------------------- */
.an-inds { display: flex; flex-direction: column; gap: var(--esp-16); }
.an-ind { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.an-ind-topo { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--esp-8); }
.an-ind-nome { font-family: var(--fonte-titulo); font-size: var(--txt-base); font-weight: 700; min-width: 0; }
.an-ind-meta {
  font-size: var(--txt-legenda);
  font-weight: 700;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--tinta-2);
  white-space: nowrap;
}
.an-ind-valor {
  margin-left: auto;
  font-family: var(--fonte-titulo);
  font-size: var(--txt-numero-p);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
}
.an-ind[data-tom="ok"] .an-ind-valor { color: var(--ok); }
.an-ind[data-tom="atencao"] .an-ind-valor { color: var(--atencao); }
.an-ind[data-tom="risco"] .an-ind-valor { color: var(--risco); }
.an-ind[data-tom="sem"] .an-ind-valor { color: var(--tinta-3); }
.an-ind-pe {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--esp-8);
  font-size: var(--txt-pequeno);
  font-weight: 600;
  color: var(--tinta-2);
}
.an-ind-explica { width: 100%; font-weight: 500; color: var(--tinta-2); line-height: 1.5; }

/* --- Tempos de resposta ------------------------------------------------- */
.an-tempos { --grade-min: 170px; }
.an-tempo {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--esp-12);
  border: 1px solid var(--linha);
  border-radius: var(--r-p);
  background: var(--fundo-2);
  min-width: 0;
}

/* --- Compromissos ------------------------------------------------------- */
.an-comps { display: flex; flex-direction: column; gap: var(--esp-8); }
.an-comp {
  border: 1px solid var(--linha);
  border-radius: var(--r-p);
  background: var(--fundo-2);
  overflow: hidden;
  transition: border-color var(--transicao);
}
.an-comp[data-aberto="sim"] { border-color: var(--linha-2); }
.an-comp-cabeca {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: var(--esp-12);
  padding: var(--esp-12);
}
.an-comp-num {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  flex: none;
  margin-top: 1px;
  border-radius: 50%;
  border: 1px solid var(--linha-2);
  background: var(--carta-2);
  color: var(--tinta-2);
  font-family: var(--fonte-titulo);
  font-size: var(--txt-legenda);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.an-comp[data-tom="ok"] .an-comp-num { border-color: rgba(53, 208, 127, .45); color: var(--ok); }
.an-comp[data-tom="atencao"] .an-comp-num { border-color: rgba(255, 201, 60, .45); color: var(--atencao); }
.an-comp[data-tom="risco"] .an-comp-num { border-color: rgba(255, 90, 90, .45); color: var(--risco); }
.an-comp-corpo { flex: 1 1 260px; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.an-comp-titulo { font-family: var(--fonte-titulo); font-size: var(--txt-base); font-weight: 700; }
.an-comp-linha { display: flex; align-items: center; flex-wrap: wrap; gap: var(--esp-8); }
.an-comp-res {
  font-family: var(--fonte-titulo);
  font-size: var(--txt-base);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.an-comp[data-tom="ok"] .an-comp-res { color: var(--ok); }
.an-comp[data-tom="atencao"] .an-comp-res { color: var(--atencao); }
.an-comp[data-tom="risco"] .an-comp-res { color: var(--risco); }
.an-comp-conta, .an-comp-obs { font-size: var(--txt-pequeno); font-weight: 500; color: var(--tinta-2); }
.an-comp-obs { line-height: 1.55; }
.an-comp-acao { margin-left: auto; align-self: center; }
/* A seta gira quando os trechos estão abertos: movimento com significado. */
.an-comp-acao .btn svg { transition: transform var(--transicao); }
.an-comp-acao .btn[aria-expanded="true"] svg { transform: rotate(180deg); }

.an-comp-trechos {
  display: flex;
  flex-direction: column;
  gap: var(--esp-12);
  padding: var(--esp-12);
  border-top: 1px solid var(--linha);
  background: var(--carta);
}
.an-comp-trechos[hidden] { display: none; }

/* --- Trecho de conversa ------------------------------------------------- */
.an-trecho {
  display: flex;
  flex-direction: column;
  gap: var(--esp-8);
  padding: var(--esp-12);
  border: 1px solid var(--linha);
  border-radius: var(--r-p);
  background: var(--fundo-2);
}
.an-trecho-cabeca {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--esp-8);
  font-size: var(--txt-legenda);
  font-weight: 700;
  letter-spacing: .05em;
  text-transform: uppercase;
  color: var(--tinta-2);
}
.an-trecho-titulo {
  width: 100%;
  font-family: var(--fonte-texto);
  font-size: var(--txt-pequeno);
  font-weight: 600;
  letter-spacing: 0;
  text-transform: none;
  color: var(--tinta);
  line-height: 1.5;
}
.an-trecho > .btn { align-self: flex-start; }
.an-falas { display: flex; flex-direction: column; gap: var(--esp-8); }
.an-fala { display: flex; flex-direction: column; gap: 3px; max-width: 100%; }
.an-fala-tutor { align-items: flex-start; }
.an-fala-clinica { align-items: flex-end; }
.an-quem {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--txt-legenda);
  font-weight: 800;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--tinta-2);
}
.an-quem-papel { font-weight: 700; color: var(--tinta-3); letter-spacing: .04em; }
.an-balao {
  max-width: min(92%, 62ch);
  padding: 8px 12px;
  border: 1px solid var(--linha);
  border-radius: 14px;
  background: var(--carta-2);
}
.an-fala-tutor .an-balao { border-bottom-left-radius: 5px; }
.an-fala-clinica .an-balao {
  background: var(--veu-indigo);
  border-color: rgba(91, 91, 214, .34);
  border-bottom-right-radius: 5px;
}
.an-fala-ia .an-balao { background: var(--veu-neutro); border-color: var(--linha-2); }
.an-balao-texto {
  font-size: var(--txt-pequeno);
  font-weight: 500;
  color: var(--tinta);
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.an-balao-texto.an-sem-texto { color: var(--tinta-3); font-style: italic; }
.an-balao-pe {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: var(--txt-legenda);
  font-weight: 600;
  color: var(--tinta-3);
}

/* --- Correções (avaliação da Daco) -------------------------------------- */
.an-cors { display: flex; flex-direction: column; gap: var(--esp-12); }
.an-cor {
  display: flex;
  flex-direction: column;
  gap: var(--esp-8);
  padding: var(--esp-16);
  border: 1px solid var(--linha);
  border-radius: var(--r-p);
  background: var(--fundo-2);
}
.an-cor-cabeca { display: flex; align-items: flex-start; flex-wrap: wrap; gap: var(--esp-8); }
.an-cor-ordem {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  flex: none;
  border-radius: var(--r-p);
  background: rgba(255, 90, 31, .14);
  border: 1px solid rgba(255, 90, 31, .38);
  color: var(--daco-laranja);
  font-family: var(--fonte-titulo);
  font-size: var(--txt-legenda);
  font-weight: 800;
}
.an-cor-titulo { flex: 1 1 240px; font-family: var(--fonte-titulo); font-size: var(--txt-medio); font-weight: 700; min-width: 0; }
.an-cor-secao { display: flex; flex-direction: column; gap: 3px; }
.an-cor-rotulo {
  font-size: var(--txt-legenda);
  font-weight: 800;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--tinta-3);
}
.an-cor-rotulo-largo { width: 100%; }
.an-cor-texto { font-size: var(--txt-pequeno); font-weight: 500; color: var(--tinta-2); line-height: 1.6; }
.an-frase {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: var(--esp-12);
  padding: var(--esp-12);
  border: 1px solid var(--linha-2);
  border-left: 3px solid var(--daco-verde);
  border-radius: var(--r-p);
  background: var(--carta-2);
}
.an-frase-texto {
  flex: 1 1 240px;
  font-size: var(--txt-pequeno);
  font-weight: 600;
  color: var(--tinta);
  line-height: 1.6;
  min-width: 0;
  overflow-wrap: anywhere;
}
.an-frase .btn { flex: none; }

/* --- Temperatura -------------------------------------------------------- */
.an-temp-barra {
  display: flex;
  width: 100%;
  height: 14px;
  border: 1px solid var(--linha);
  border-radius: var(--r-redondo);
  overflow: hidden;
  background: var(--fundo-2);
}
.an-temp-fatia {
  height: 100%;
  width: 0;
  transition: width var(--t-numero) var(--curva);
}
.an-temp-fatia[data-faixa="frio"] { background: linear-gradient(90deg, var(--indigo), var(--indigo-cl)); }
.an-temp-fatia[data-faixa="morno"] { background: linear-gradient(90deg, #D9A417, var(--atencao)); }
.an-temp-fatia[data-faixa="quente"] { background: linear-gradient(90deg, #C9421A, var(--daco-laranja)); }
.an-temps { --grade-min: 240px; }
.an-temp {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--esp-12);
  border: 1px solid var(--linha);
  border-top-width: 3px;
  border-radius: var(--r-p);
  background: var(--fundo-2);
}
.an-temp[data-faixa="frio"] { border-top-color: var(--indigo-cl); }
.an-temp[data-faixa="morno"] { border-top-color: var(--atencao); }
.an-temp[data-faixa="quente"] { border-top-color: var(--daco-laranja); }
.an-temp-topo { display: flex; align-items: baseline; gap: var(--esp-8); }
.an-temp-nome { font-family: var(--fonte-titulo); font-size: var(--txt-base); font-weight: 700; }
.an-temp-valor {
  margin-left: auto;
  font-family: var(--fonte-titulo);
  font-size: var(--txt-numero-p);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.an-temp-linha { font-size: var(--txt-pequeno); font-weight: 500; color: var(--tinta-2); line-height: 1.55; }
.an-temp-passo { font-size: var(--txt-pequeno); font-weight: 600; color: var(--tinta); line-height: 1.55; }

/* --- Comparação com a rede ---------------------------------------------- */
.an-rede-grupos { --grade-min: 300px; }
.an-rede-grupo { display: flex; flex-direction: column; gap: var(--esp-8); }
.an-rede-item {
  display: flex;
  align-items: flex-start;
  gap: var(--esp-12);
  padding: var(--esp-12);
  border: 1px solid var(--linha);
  border-radius: var(--r-p);
  background: var(--fundo-2);
}
.an-rede-icone { flex: none; margin-top: 1px; color: var(--tinta-2); }
.an-rede-icone svg { width: 18px; height: 18px; }
.an-rede-item[data-tom="ok"] .an-rede-icone { color: var(--ok); }
.an-rede-item[data-tom="atencao"] .an-rede-icone { color: var(--atencao); }
.an-rede-texto { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.an-rede-nome { font-family: var(--fonte-titulo); font-size: var(--txt-base); font-weight: 700; }
.an-rede-numeros { font-size: var(--txt-pequeno); font-weight: 600; color: var(--tinta); font-variant-numeric: tabular-nums; }
.an-rede-leitura { font-size: var(--txt-pequeno); font-weight: 500; color: var(--tinta-2); line-height: 1.55; }

/* --- Conversão: os três destinos ---------------------------------------- */
.an-destinos { --grade-min: 190px; }
.an-destino {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--esp-16);
  border: 1px solid var(--linha);
  border-top-width: 3px;
  border-radius: var(--r-p);
  background: var(--fundo-2);
  min-width: 0;
}
.an-destino[data-tom="ok"] { border-top-color: var(--ok); }
.an-destino[data-tom="atencao"] { border-top-color: var(--atencao); }
.an-destino[data-tom="risco"] { border-top-color: var(--risco); }
.an-destino-nome {
  font-size: var(--txt-legenda);
  font-weight: 800;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--tinta-2);
}
.an-destino-linha { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--esp-8); }
.an-destino-valor {
  font-family: var(--fonte-titulo);
  font-size: var(--txt-numero);
  font-weight: 800;
  line-height: 1;
  letter-spacing: -.03em;
  font-variant-numeric: tabular-nums;
}
.an-destino[data-tom="ok"] .an-destino-valor { color: var(--ok); }
.an-destino[data-tom="atencao"] .an-destino-valor { color: var(--atencao); }
.an-destino[data-tom="risco"] .an-destino-valor { color: var(--risco); }
.an-destino[data-vazio="sim"] .an-destino-valor { color: var(--tinta-3); }
.an-destino-pct {
  font-family: var(--fonte-titulo);
  font-size: var(--txt-medio);
  font-weight: 700;
  color: var(--tinta-2);
  font-variant-numeric: tabular-nums;
}
.an-destino-texto { font-size: var(--txt-pequeno); font-weight: 500; color: var(--tinta-2); line-height: 1.5; }
.an-andando {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
  font-size: var(--txt-pequeno);
  font-weight: 600;
  color: var(--tinta-2);
}
.an-andando-valor {
  font-family: var(--fonte-titulo);
  font-size: var(--txt-base);
  font-weight: 800;
  color: var(--tinta);
  font-variant-numeric: tabular-nums;
}

/* --- Conversão: o funil por estágio ------------------------------------- */
.an-funil { display: flex; flex-direction: column; gap: var(--esp-8); }
.an-estagio { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.an-estagio-topo { display: flex; align-items: baseline; gap: var(--esp-8); min-width: 0; }
.an-estagio-nome { font-size: var(--txt-pequeno); font-weight: 700; color: var(--tinta); min-width: 0; }
.an-estagio[data-queda="sim"] .an-estagio-nome { color: var(--atencao); }
.an-estagio-valor {
  margin-left: auto;
  font-family: var(--fonte-titulo);
  font-size: var(--txt-base);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.an-estagio-pct {
  font-size: var(--txt-legenda);
  font-weight: 600;
  color: var(--tinta-3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.an-queda {
  display: flex;
  align-items: flex-start;
  gap: var(--esp-8);
  padding: var(--esp-12);
  border: 1px solid rgba(255, 201, 60, .30);
  border-left: 3px solid var(--atencao);
  border-radius: var(--r-p);
  background: var(--veu-atencao);
}
.an-queda-icone { display: inline-flex; flex: none; margin-top: 1px; color: var(--atencao); }
.an-queda-icone svg { width: 18px; height: 18px; }
.an-queda-texto { font-size: var(--txt-pequeno); font-weight: 600; color: var(--tinta); line-height: 1.55; }

/* --- Conversão: de quem é o próximo passo ------------------------------- */
.an-dividas { --grade-min: 300px; }
.an-divida {
  display: flex;
  flex-direction: column;
  gap: var(--esp-8);
  padding: var(--esp-16);
  border: 1px solid var(--linha);
  border-left: 3px solid var(--linha-2);
  border-radius: var(--r-p);
  background: var(--fundo-2);
  min-width: 0;
}
.an-divida[data-lado="clinica"] { border-left-color: var(--risco); }
.an-divida[data-lado="tutor"] { border-left-color: var(--atencao); }
/* Com os casos abertos o cartão toma a linha inteira: trecho espremido em meia coluna não se lê. */
.an-divida[data-aberto="sim"] { grid-column: 1 / -1; }
.an-divida-topo { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--esp-8); }
.an-divida-nome { font-family: var(--fonte-titulo); font-size: var(--txt-base); font-weight: 700; min-width: 0; }
.an-divida-valor {
  margin-left: auto;
  font-family: var(--fonte-titulo);
  font-size: var(--txt-numero-p);
  font-weight: 800;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.an-divida[data-lado="clinica"] .an-divida-valor { color: var(--risco); }
.an-divida[data-lado="tutor"] .an-divida-valor { color: var(--atencao); }
.an-divida[data-vazio="sim"] .an-divida-valor { color: var(--tinta-3); }
.an-divida-detalhes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--esp-4) var(--esp-16);
  font-size: var(--txt-pequeno);
  font-weight: 600;
  color: var(--tinta-2);
}
.an-divida-detalhe b {
  font-family: var(--fonte-titulo);
  font-weight: 800;
  color: var(--tinta);
  font-variant-numeric: tabular-nums;
}
.an-divida-acao { font-size: var(--txt-pequeno); font-weight: 600; color: var(--tinta); line-height: 1.55; }
.an-divida > .btn { align-self: flex-start; }
.an-divida > .btn svg { transition: transform var(--transicao); }
.an-divida > .btn[aria-expanded="true"] svg { transform: rotate(180deg); }
.an-divida-casos {
  display: flex;
  flex-direction: column;
  gap: var(--esp-12);
  padding-top: var(--esp-12);
  border-top: 1px solid var(--linha);
}
.an-divida-casos[hidden] { display: none; }
.an-casos { display: flex; flex-direction: column; gap: var(--esp-12); }
.an-divida-casos > .btn { align-self: flex-start; }

/* --- Conversão: um caso parado ------------------------------------------ */
.an-caso {
  display: flex;
  flex-direction: column;
  gap: var(--esp-8);
  padding: var(--esp-12);
  border: 1px solid var(--linha);
  border-radius: var(--r-p);
  background: var(--carta);
}
.an-caso-cabeca { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--esp-8); }
.an-caso-nome { font-family: var(--fonte-titulo); font-size: var(--txt-base); font-weight: 700; min-width: 0; }
.an-caso-parada {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  font-size: var(--txt-pequeno);
  font-weight: 700;
  color: var(--atencao);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.an-caso-parada[data-vazio="sim"] { color: var(--tinta-3); }
.an-caso-icone { display: inline-flex; flex: none; }
.an-caso-icone svg { width: 14px; height: 14px; }
.an-caso-linha {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--esp-4) var(--esp-12);
  font-size: var(--txt-pequeno);
  font-weight: 500;
  color: var(--tinta-2);
}
.an-caso-linha b { font-weight: 700; color: var(--tinta); }

/* --- Conversão: motivos da trava ---------------------------------------- */
.an-motivos { display: flex; flex-direction: column; gap: var(--esp-8); }
.an-motivo { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.an-motivo-topo { display: flex; align-items: baseline; gap: var(--esp-8); min-width: 0; }
.an-motivo-texto { font-size: var(--txt-pequeno); font-weight: 600; color: var(--tinta); min-width: 0; }
.an-motivo-valor {
  margin-left: auto;
  font-family: var(--fonte-titulo);
  font-size: var(--txt-base);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.an-motivo-pct {
  font-size: var(--txt-legenda);
  font-weight: 600;
  color: var(--tinta-3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* --- Carregamento ------------------------------------------------------- */
.an-carregando { display: flex; flex-direction: column; gap: var(--esp-16); }
.an-carregando .esqueleto.bloco { height: 160px; }

/* --- Responsivo --------------------------------------------------------- */
@media (max-width: 1180px) {
  .an-nota-caixa { flex: 1 1 260px; }
  .an-balao { max-width: 100%; }
}

@media (max-width: 720px) {
  .an-topo { gap: var(--esp-12); }
  .an-nota-caixa { flex: 1 1 100%; }
  .an-ind-valor { margin-left: 0; }
  .an-comp-acao { margin-left: 0; width: 100%; }
  .an-comp-acao .btn { width: 100%; }
  .an-periodo { width: 100%; }
  .an-periodo-btn { flex: 1 1 0; padding: 0 var(--esp-8); }
  .an-frase .btn { width: 100%; }
  .an-temp-valor { margin-left: auto; }
  .an-divida > .btn, .an-divida-casos > .btn { width: 100%; }
  .an-caso-parada { margin-left: 0; width: 100%; }
}
`;

/* ═════════════════════════ 4. ESTADO DO MÓDULO ══════════════════════════
   Um objeto só, criado em montar() e destruído em desmontar(). A tela que
   morre não pode mexer na tela que nasce.
   ════════════════════════════════════════════════════════════════════════ */

let estado = null;

function estadoNovo(raiz, ctx) {
  return {
    raiz: raiz,
    ctx: ctx,
    slug: ctx && ctx.unidadeAtual ? ctx.unidadeAtual : null,
    dias: PERIODO_PADRAO,

    dados: null,          /* resposta crua da API */
    assinatura: '',       /* JSON da última resposta desenhada, para não redesenhar igual */
    erro: null,           /* ErroApi da última consulta */
    recebeu: false,       /* já houve UMA resposta (com dado ou com erro) */

    abertos: new Set(),   /* compromissos (número) e listas de casos ('funil-…') abertos */
    casosVisiveis: {},    /* quantos casos de cada lista já foram mostrados */
    parar: null,          /* cancela a assinatura de `analise` */
    limpezas: [],         /* vida inteira da tela */
    limpezasDesenho: [],  /* só do desenho atual: morrem no próximo desenho */
    nos: {},
  };
}

/** Registra uma limpeza da vida da tela. Roda em desmontar(). */
function aoLimpar(fn) {
  if (estado && typeof fn === 'function') estado.limpezas.push(fn);
}

/**
 * Registra uma limpeza do desenho atual (quadro de animação, timer de aviso).
 * A tela redesenha a cada atualização; sem esta separação a lista cresceria
 * para sempre numa aba aberta o dia inteiro.
 */
function aoLimparDesenho(fn) {
  if (estado && typeof fn === 'function') estado.limpezasDesenho.push(fn);
}

function rodarLimpezasDesenho() {
  if (!estado) return;
  const lista = estado.limpezasDesenho;
  estado.limpezasDesenho = [];
  lista.forEach(function (fn) {
    try { fn(); } catch (e) { console.error('[analise] falha ao limpar o desenho anterior', e); }
  });
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
  const caixa = criar('span', classe || 'an-icone');
  caixa.setAttribute('aria-hidden', 'true');
  caixa.innerHTML = svg;
  return caixa;
}

function botao(classe, texto) {
  const no = criar('button', classe, texto);
  no.type = 'button';
  return no;
}

function limpar(no) {
  while (no && no.firstChild) no.removeChild(no.firstChild);
}

/** true quando o usuário pediu menos movimento no sistema. */
function movimentoReduzido() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {
    return false;
  }
}

/** Texto sem acento e em minúsculas, para comparar chave de API com a nossa. */
function chaveSimples(texto) {
  const cru = String(texto === null || texto === undefined ? '' : texto).toLowerCase();
  let limpo;
  try {
    limpo = cru.normalize('NFD').replace(/[̀-ͯ]/g, '');
  } catch (e) {
    limpo = cru;
  }
  return limpo.replace(/[^a-z0-9]+/g, '_');
}

/**
 * Lê o primeiro campo existente entre vários nomes equivalentes.
 * null que veio da API é resposta ("não medimos") e volta como null;
 * campo ausente também vira null — quem desenha trata os dois igual.
 */
function pegar(objeto, nomes) {
  if (!objeto || typeof objeto !== 'object') return null;
  const lista = Array.isArray(nomes) ? nomes : [nomes];
  for (let i = 0; i < lista.length; i += 1) {
    const nome = lista[i];
    if (Object.prototype.hasOwnProperty.call(objeto, nome) && objeto[nome] !== undefined) {
      return objeto[nome];
    }
  }
  return null;
}

/** Número finito ou null. O 0 passa — é medida. */
function numeroOuNulo(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

/** Texto não vazio ou null. Nunca devolve string de enfeite. */
function textoOuNulo(valor) {
  if (valor === null || valor === undefined) return null;
  const t = String(valor).trim();
  return t ? t : null;
}

function listaOuVazio(valor) {
  return Array.isArray(valor) ? valor.filter(function (x) { return !!x; }) : [];
}

/** Data curta (18/09). Sem data legível devolve null — nunca "hoje" por engano. */
function dataCurta(iso) {
  if (!iso) return null;
  const quando = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(quando.getTime())) return null;
  const dia = String(quando.getDate()).padStart(2, '0');
  const mes = String(quando.getMonth() + 1).padStart(2, '0');
  return dia + '/' + mes;
}

/** Formata um valor conforme o tipo do indicador. null vira o tracinho. */
function formatarPorTipo(valor, formato) {
  if (valor === null || valor === undefined) return TRACINHO;
  if (formato === 'pct') return formatarPorcentagem(valor, valor !== null && valor % 1 !== 0 ? 1 : 0);
  if (formato === 'minutos') return formatarMinutos(valor);
  if (formato === 'nota') return formatarNumero(valor, 1);
  return formatarNumero(valor, 0);
}

/**
 * Conta até o valor em 600ms (seção 4 do contrato). Quem pediu menos movimento
 * recebe o número final direto. O texto final é sempre o valor exato.
 */
function animarNumero(no, alvo, formato) {
  const final = formatarPorTipo(alvo, formato);
  if (alvo === null || !Number.isFinite(alvo) || movimentoReduzido()
    || typeof window.requestAnimationFrame !== 'function') {
    no.textContent = final;
    return;
  }

  let id = 0;
  let inicio = null;
  function passo(agora) {
    if (inicio === null) inicio = agora;
    const t = Math.min(1, (agora - inicio) / 600);
    const suave = 1 - Math.pow(1 - t, 3);
    if (t < 1) {
      no.textContent = formatarPorTipo(alvo * suave, formato);
      id = window.requestAnimationFrame(passo);
    } else {
      no.textContent = final;
    }
  }
  no.classList.add('conta-numero');
  id = window.requestAnimationFrame(passo);
  aoLimparDesenho(function () {
    window.cancelAnimationFrame(id);
    no.textContent = final;
  });
}

/**
 * Desenha uma barra do tema com o valor medido e o traço da meta.
 * Sem medida, a barra fica listrada (.sem-medida) e não finge valor nenhum.
 */
function montarBarra(pct, meta, tom, rotulo) {
  const barra = criar('div', 'barra alta');
  barra.setAttribute('role', 'img');
  barra.setAttribute('aria-label', rotulo);

  if (meta !== null && meta !== undefined) {
    barra.setAttribute('data-meta', String(meta));
    barra.style.setProperty('--meta', Math.max(0, Math.min(100, meta)) + '%');
  }

  if (pct === null) {
    barra.classList.add('sem-medida');
    return barra;
  }

  const preenchida = criar('span', 'barra-preenchida');
  if (tom) preenchida.setAttribute('data-tom', tom);
  barra.appendChild(preenchida);

  const largura = Math.max(0, Math.min(100, pct)) + '%';
  if (movimentoReduzido() || typeof window.requestAnimationFrame !== 'function') {
    preenchida.style.width = largura;
  } else {
    // Um quadro depois, para a transição de largura do tema acontecer.
    const id = window.requestAnimationFrame(function () { preenchida.style.width = largura; });
    aoLimparDesenho(function () {
      window.cancelAnimationFrame(id);
      preenchida.style.width = largura;
    });
  }
  return barra;
}

/** Selo do tema com o texto certo. `tom` aceita ok / atencao / risco / neutro. */
function selo(texto, tom, semPonto) {
  const classe = 'selo selo-' + (tom || 'neutro') + (semPonto ? ' sem-ponto' : '');
  return criar('span', classe, texto);
}

/** Região que o leitor de tela anuncia (cópia da frase, recarga da análise). */
function anunciar(texto) {
  if (estado && estado.nos.vivo) estado.nos.vivo.textContent = texto;
}

/* ═════════════════════════ 6. LEITURA TOLERANTE DA API ══════════════════
   Nada aqui inventa: cada função devolve o número que veio ou null. Onde há
   conta, ela é aritmética sobre o que a API mandou (percentual a partir da
   contagem), nunca uma estimativa.
   ════════════════════════════════════════════════════════════════════════ */

/** { ok, total } de um objeto de contagem, com os nomes que a API pode usar. */
function lerContagem(fonte) {
  const cru = pegar(fonte, ['contagem', 'contagens', 'de', 'base']);
  const alvo = (cru && typeof cru === 'object' && !Array.isArray(cru)) ? cru : fonte;
  const ok = numeroOuNulo(pegar(alvo, ['ok', 'atendidos', 'com', 'sim', 'quantidade', 'ocorrencias', 'casos']));
  const total = numeroOuNulo(pegar(alvo, ['total', 'de', 'avaliados', 'base', 'conversas']));
  if (ok === null && total === null) return null;
  return { ok: ok, total: total };
}

/** Período analisado: dias pedidos, mais as datas quando o servidor mandar. */
function lerPeriodo(dados, diasPedidos) {
  const fonte = pegar(dados, ['periodo', 'janela']) || dados;
  return {
    dias: numeroOuNulo(pegar(fonte, ['dias', 'periodo_dias'])) || diasPedidos,
    de: textoOuNulo(pegar(fonte, ['de', 'inicio', 'desde'])),
    ate: textoOuNulo(pegar(fonte, ['ate', 'fim', 'ultimo'])),
  };
}

/** A base crua da análise. É o que autoriza (ou não) concluir qualquer coisa. */
function lerBase(dados) {
  const fonte = pegar(dados, ['base', 'volume', 'cru']) || dados;

  let suficienteCru = pegar(dados, ['base_suficiente', 'suficiente']);
  if (suficienteCru === null) suficienteCru = pegar(fonte, ['base_suficiente', 'suficiente']);

  let minimo = numeroOuNulo(pegar(fonte, ['minimo_conversas', 'minimo']));
  if (minimo === null) minimo = numeroOuNulo(pegar(dados, ['minimo_conversas', 'minimo']));

  return {
    conversas: numeroOuNulo(pegar(fonte, ['conversas', 'conversas_total', 'total_conversas'])),
    mensagens: numeroOuNulo(pegar(fonte, ['mensagens', 'mensagens_total', 'total_mensagens'])),
    audios: numeroOuNulo(pegar(fonte, ['audios', 'audios_total', 'total_audios'])),
    leads: numeroOuNulo(pegar(fonte, ['leads', 'leads_total'])),
    classificados: numeroOuNulo(pegar(fonte, ['contatos_classificados', 'classificados'])),
    minimo: minimo,
    suficiente: suficienteCru === true ? true : (suficienteCru === false ? false : null),
  };
}

/** A nota é AVALIAÇÃO da Daco, não medida — quem desenha marca isso na tela. */
function lerNota(dados, base) {
  const cru = pegar(dados, ['nota', 'nota_geral']);
  let valor = null;
  let criterio = textoOuNulo(pegar(dados, ['nota_criterio', 'criterio', 'criterio_nota']));
  let motivo = textoOuNulo(pegar(dados, ['nota_motivo', 'motivo_sem_nota']));

  if (cru && typeof cru === 'object' && !Array.isArray(cru)) {
    valor = numeroOuNulo(pegar(cru, ['valor', 'nota', 'medido']));
    criterio = criterio || textoOuNulo(pegar(cru, ['criterio', 'descricao']));
    motivo = motivo || textoOuNulo(pegar(cru, ['motivo']));
  } else {
    valor = numeroOuNulo(cru);
  }

  // Base insuficiente declarada pelo servidor derruba a nota, mesmo que venha um número.
  const semBase = base.suficiente === false;
  return {
    valor: semBase ? null : valor,
    criterio: criterio,
    motivo: motivo,
    semBase: semBase,
  };
}

/** Tom da nota. Faixas de leitura da própria escala 0–10, sem critério novo. */
function tomDaNota(valor) {
  if (valor === null) return 'sem';
  if (valor >= 8) return 'ok';
  if (valor >= 6) return 'atencao';
  return 'risco';
}

/** Um dos 4 indicadores, já com meta, tom e a frase que descreve a situação. */
function lerIndicador(dados, def) {
  const fonte = pegar(dados, ['indicadores', 'indicadores_30d', 'metas']) || dados;
  const cru = pegar(fonte, def.chaves);

  let medido = null;
  let contagem = null;
  let meta = def.meta;
  let situacao = null;
  let explicacao = null;

  if (cru && typeof cru === 'object' && !Array.isArray(cru)) {
    medido = numeroOuNulo(pegar(cru, ['medido', 'valor', 'pct', 'percentual', 'resultado', 'quantidade']));
    contagem = lerContagem(cru);
    situacao = chaveSimples(textoOuNulo(pegar(cru, ['situacao', 'estado', 'tom'])) || '') || null;
    explicacao = textoOuNulo(pegar(cru, ['definicao', 'descricao', 'como_medido', 'observacao']));
    const metaApi = numeroOuNulo(pegar(cru, ['meta']));
    if (metaApi !== null) meta = metaApi;
  } else {
    medido = numeroOuNulo(cru);
  }

  // Percentual a partir da contagem é aritmética sobre o dado que veio, não estimativa.
  // As DUAS pontas precisam existir: com `ok` nulo e `total` preenchido, a conta
  // daria 0 — e 0 na tela significa "medimos e deu zero", que é o contrário de
  // "não medimos". Uma ausência de medida viraria acusação, com barra vermelha.
  if (medido === null && contagem && contagem.ok !== null && contagem.total) {
    medido = def.formato === 'pct'
      ? (contagem.ok / contagem.total) * 100
      : contagem.ok;
  }

  const dentro = medido === null
    ? null
    : (def.alvo === 'maximo' ? medido <= meta : medido >= meta);

  let tom = 'sem';
  if (situacao === 'ok' || situacao === 'bom' || situacao === 'dentro') tom = 'ok';
  else if (situacao === 'risco' || situacao === 'critico') tom = 'risco';
  else if (situacao === 'atencao') tom = 'atencao';
  else if (dentro === true) tom = 'ok';
  else if (dentro === false) tom = 'atencao';

  return {
    def: def,
    medido: medido,
    meta: meta,
    contagem: contagem,
    dentro: dentro,
    tom: tom,
    explicacao: explicacao,
  };
}

/** Os quatro tempos. Sem meta oficial no treinamento — ficam sem tom. */
function lerTempos(dados) {
  const fonte = pegar(dados, ['sla', 'tempos', 'resposta']) || dados;
  const saida = {};
  TEMPOS.forEach(function (def) {
    saida[def.chave] = numeroOuNulo(pegar(fonte, def.chaves));
  });
  return saida;
}

/** Acha o item da API que corresponde a um compromisso do checklist. */
function acharCompromisso(lista, def, indice) {
  for (let i = 0; i < lista.length; i += 1) {
    const item = lista[i];
    if (!item || typeof item !== 'object') continue;
    const numero = numeroOuNulo(pegar(item, ['numero', 'n', 'ordem', 'indice']));
    if (numero !== null && numero === def.numero) return item;
  }
  for (let i = 0; i < lista.length; i += 1) {
    const item = lista[i];
    if (!item || typeof item !== 'object') continue;
    const chave = chaveSimples(pegar(item, ['chave', 'id', 'codigo', 'slug']) || '');
    if (!chave) continue;
    for (let j = 0; j < def.chaves.length; j += 1) {
      if (chave === chaveSimples(def.chaves[j])) return item;
    }
  }
  // Sem identificador nenhum, só a ordem do checklist resta — e só quando a
  // lista tem exatamente os 8 itens, na ordem do treinamento.
  if (lista.length === 8) {
    const item = lista[indice];
    if (item && typeof item === 'object') {
      const temId = pegar(item, ['numero', 'n', 'ordem', 'chave', 'id', 'codigo', 'slug']);
      if (temId === null) return item;
    }
  }
  return null;
}

/** Normaliza uma mensagem de trecho. Quem falou nunca fica anônimo. */
function lerMensagem(cru, trecho) {
  if (!cru || typeof cru !== 'object') return null;

  const quemCru = chaveSimples(pegar(cru, ['quem', 'lado', 'de', 'origem']) || '');
  const autor = chaveSimples(pegar(cru, ['autor', 'por']) || '') || null;
  const ladoClinica = quemCru === 'clinica' || quemCru === 'recepcao' || quemCru === 'unidade'
    || quemCru === 'atendente' || quemCru === 'ia';

  const nomeCru = textoOuNulo(pegar(cru, ['nome', 'push_name', 'contato', 'autor_nome']));
  const nomeTrecho = trecho ? textoOuNulo(pegar(trecho, ['tutor', 'contato', 'nome'])) : null;
  // Sem nome salvo, o tutor é chamado pelo telefone do trecho — nunca por um rótulo vazio.
  const telefoneTrecho = trecho ? formatarTelefone(pegar(trecho, ['telefone']), '') : '';

  let quem;
  let papel = null;
  if (ladoClinica) {
    if (autor === 'ia' || quemCru === 'ia') {
      quem = 'Agente de IA';
      papel = 'antes da recepção';
    } else if (autor === 'humano' || autor === 'recepcao') {
      quem = nomeCru || 'Recepção';
    } else {
      quem = nomeCru || 'Clínica';
    }
  } else {
    quem = primeiroNome(nomeCru || nomeTrecho) || telefoneTrecho || 'Tutor';
  }

  const tipo = chaveSimples(pegar(cru, ['tipo']) || '') || 'texto';
  const texto = textoOuNulo(pegar(cru, ['texto', 'conteudo', 'mensagem', 'transcricao']));
  const enviada = textoOuNulo(pegar(cru, ['enviada_em', 'em', 'quando']));
  // `hora` pode vir pronta ("14h02") ou como data completa; a data completa é formatada aqui.
  const horaCrua = textoOuNulo(pegar(cru, ['hora']));
  const hora = (horaCrua && /^\d{4}-\d{2}-\d{2}/.test(horaCrua) ? formatarQuando(horaCrua) : horaCrua)
    || (enviada ? formatarQuando(enviada) : null);

  return {
    lado: ladoClinica ? 'clinica' : 'tutor',
    ia: autor === 'ia' || quemCru === 'ia',
    quem: quem,
    papel: papel,
    tipo: tipo,
    texto: texto,
    transcrito: pegar(cru, ['transcrito']) === true,
    segundos: numeroOuNulo(pegar(cru, ['segundos'])),
    hora: hora,
  };
}

/** Normaliza um trecho: cabeçalho + as falas em ordem. */
function lerTrecho(cru) {
  if (!cru || typeof cru !== 'object') return null;
  const mensagensCruas = listaOuVazio(pegar(cru, ['mensagens', 'falas', 'conversa']));
  const mensagens = [];
  mensagensCruas.forEach(function (m) {
    const lida = lerMensagem(m, cru);
    if (lida) mensagens.push(lida);
  });
  if (!mensagens.length) return null;   // trecho sem fala não sustenta nada
  return {
    id: textoOuNulo(pegar(cru, ['conversa_id', 'id'])),
    quando: textoOuNulo(pegar(cru, ['quando', 'em', 'data'])),
    titulo: textoOuNulo(pegar(cru, ['titulo', 'rotulo', 'resumo'])),
    mensagens: mensagens,
  };
}

/**
 * Os 8 compromissos, sempre os 8. `avaliado` só é true quando existe trecho que
 * sustente o resultado — é a regra da seção 5 do contrato.
 */
function lerCompromissos(dados) {
  const cru = pegar(dados, ['compromissos', 'checklist']);
  const lista = Array.isArray(cru) ? cru : [];
  const mapa = (cru && typeof cru === 'object' && !Array.isArray(cru)) ? cru : null;

  return COMPROMISSOS.map(function (def, indice) {
    let item = null;
    if (mapa) {
      item = pegar(mapa, def.chaves.concat([String(def.numero)]));
      if (item !== null && typeof item !== 'object') item = { medido: item };
    } else {
      item = acharCompromisso(lista, def, indice);
    }

    const trechos = [];
    listaOuVazio(pegar(item, ['trechos', 'provas', 'evidencias'])).forEach(function (t) {
      const lido = lerTrecho(t);
      if (lido) trechos.push(lido);
    });

    const medido = numeroOuNulo(pegar(item, ['medido', 'pct', 'percentual', 'valor', 'resultado']));
    const contagem = item ? lerContagem(item) : null;
    const situacao = chaveSimples(textoOuNulo(pegar(item, ['situacao', 'estado', 'tom'])) || '') || null;

    let pct = medido;
    if (pct === null && contagem && contagem.ok !== null && contagem.total) {
      pct = (contagem.ok / contagem.total) * 100;
    }

    // O tom só vem do servidor. Os 8 compromissos do treinamento não têm faixa
    // de corte: a seção 5 do contrato define meta para os 4 INDICADORES, não
    // para os compromissos. Pintar de vermelho por um corte inventado aqui
    // seria avaliação da Daco disfarçada de medição — e ainda por cima dentro
    // do bloco rotulado "Medido". Sem situação do servidor, o número sai cru.
    let tom = 'sem';
    if (situacao === 'ok' || situacao === 'bom') tom = 'ok';
    else if (situacao === 'risco' || situacao === 'critico') tom = 'risco';
    else if (situacao === 'atencao') tom = 'atencao';

    return {
      def: def,
      titulo: textoOuNulo(pegar(item, ['titulo', 'rotulo'])) || def.titulo,
      pct: pct,
      contagem: contagem,
      observacao: textoOuNulo(pegar(item, ['observacao', 'nota', 'comentario'])),
      trechos: trechos,
      /* Sem trecho, não há avaliação: o compromisso aparece como sem base. */
      avaliado: trechos.length > 0 && (pct !== null || contagem !== null || situacao !== null),
      tom: trechos.length ? tom : 'sem',
    };
  });
}

/** Ordem de impacto financeiro declarada pela API. Sem ela, a ordem é a dela. */
function pesoDoImpacto(texto) {
  const chave = chaveSimples(texto || '');
  if (chave === 'alto' || chave === 'alta' || chave === 'critico') return 3;
  if (chave === 'medio' || chave === 'media') return 2;
  if (chave === 'baixo' || chave === 'baixa') return 1;
  return 0;
}

function lerCorrecoes(dados) {
  const lista = listaOuVazio(pegar(dados, ['correcoes', 'prioridades', 'recomendacoes']));
  const lidas = lista.map(function (cru, indice) {
    const impactoTexto = textoOuNulo(pegar(cru, ['impacto', 'prioridade', 'nivel']));
    const ordem = numeroOuNulo(pegar(cru, ['impacto_ordem', 'ordem', 'posicao']));
    return {
      indice: indice,
      titulo: textoOuNulo(pegar(cru, ['titulo', 'nome'])),
      impacto: impactoTexto,
      peso: ordem !== null ? 1000 - ordem : pesoDoImpacto(impactoTexto),
      acontece: textoOuNulo(pegar(cru, ['o_que_acontece', 'acontece', 'diagnostico', 'situacao'])),
      fazer: textoOuNulo(pegar(cru, ['o_que_fazer', 'fazer', 'acao', 'recomendacao'])),
      frase: textoOuNulo(pegar(cru, ['frase_pronta', 'frase', 'script', 'modelo'])),
      indicador: textoOuNulo(pegar(cru, ['indicador', 'metrica', 'base'])),
    };
  }).filter(function (c) { return !!c.titulo; });

  // Ordenação estável: peso maior primeiro, empate mantém a ordem da API.
  lidas.sort(function (a, b) {
    if (b.peso !== a.peso) return b.peso - a.peso;
    return a.indice - b.indice;
  });
  return lidas;
}

/** Temperatura dos leads. Só conclui proporção quando há total maior que zero. */
function lerTemperatura(dados) {
  const fonte = pegar(dados, ['temperatura', 'temperaturas', 'leads_temperatura']);
  if (!fonte || typeof fonte !== 'object') return null;

  const faixas = TEMPERATURAS.map(function (def) {
    const cru = pegar(fonte, [def.chave, def.chave + 's']);
    let quantidade = numeroOuNulo(cru);
    let pct = null;
    let exige = null;
    if (cru && typeof cru === 'object') {
      quantidade = numeroOuNulo(pegar(cru, ['quantidade', 'total', 'leads', 'n']));
      pct = numeroOuNulo(pegar(cru, ['pct', 'percentual', 'proporcao']));
      exige = textoOuNulo(pegar(cru, ['exige', 'acao', 'orientacao']));
    }
    return { def: def, quantidade: quantidade, pct: pct, exige: exige };
  });

  let total = numeroOuNulo(pegar(fonte, ['total', 'classificados', 'leads']));
  if (total === null) {
    let soma = 0;
    let temAlgum = false;
    faixas.forEach(function (f) {
      if (f.quantidade !== null) { soma += f.quantidade; temAlgum = true; }
    });
    total = temAlgum ? soma : null;
  }

  faixas.forEach(function (f) {
    if (f.pct === null && f.quantidade !== null && total) f.pct = (f.quantidade / total) * 100;
  });

  const temMedida = faixas.some(function (f) { return f.quantidade !== null || f.pct !== null; });
  if (!temMedida) return null;
  return { faixas: faixas, total: total };
}

/* --- Conversão (funil) -------------------------------------------------- */

/** Rótulo legível de um estágio: o do servidor, o da tabela ou a chave sem sublinhado. */
function rotuloDoEstagio(chave, nomeServidor) {
  if (nomeServidor) return nomeServidor;
  const simples = chaveSimples(chave || '');
  if (ESTAGIOS_DO_FUNIL[simples]) return ESTAGIOS_DO_FUNIL[simples];
  return simples ? simples.replace(/_/g, ' ') : null;
}

/** Horas paradas em texto curto ("40 min", "3h10", "5d 2h"). null vira o tracinho. */
function textoDeHoras(horas) {
  if (horas === null) return TRACINHO;
  return formatarMinutos(horas * 60);
}

/**
 * Um caso parado (a clínica deve, ou follow-up pendente) com o trecho que o
 * mostra. O trecho só entra com quem falou nomeado em CADA mensagem: uma fala
 * sem lado conhecido derruba o trecho inteiro, e o caso fica só na contagem.
 */
function lerCaso(cru, textosDosMotivos, textosDasSituacoes) {
  if (!cru || typeof cru !== 'object') return null;
  const contato = textoOuNulo(pegar(cru, ['contato', 'nome', 'tutor']));
  const telefone = textoOuNulo(pegar(cru, ['telefone']));
  const id = textoOuNulo(pegar(cru, ['conversa_id', 'id']));
  if (!contato && !telefone && !id) return null;   // sem como identificar, não é caso

  const motivo = chaveSimples(textoOuNulo(pegar(cru, ['motivo'])) || '') || null;
  const situacao = chaveSimples(textoOuNulo(pegar(cru, ['situacao'])) || '') || null;
  const bola = chaveSimples(textoOuNulo(pegar(cru, ['bola'])) || '') || null;
  const ultimaEm = textoOuNulo(pegar(cru, ['ultima_em', 'ultima_mensagem_em']));

  let trecho = null;
  let trechoRecusado = false;
  const trechoCru = pegar(cru, ['trecho', 'conversa']);
  if (trechoCru && typeof trechoCru === 'object') {
    const mensagens = listaOuVazio(pegar(trechoCru, ['mensagens', 'falas']));
    const todasComLado = mensagens.length > 0 && mensagens.every(function (m) {
      const lado = chaveSimples(textoOuNulo(pegar(m, ['quem', 'lado', 'de', 'origem'])) || '');
      return LADOS_CONHECIDOS.indexOf(lado) >= 0;
    });
    if (todasComLado) {
      trecho = lerTrecho(Object.assign({}, trechoCru, {
        contato: textoOuNulo(pegar(trechoCru, ['contato', 'tutor', 'nome'])) || contato,
        telefone: textoOuNulo(pegar(trechoCru, ['telefone'])) || telefone,
        conversa_id: textoOuNulo(pegar(trechoCru, ['conversa_id', 'id'])) || id,
        quando: ultimaEm,
      }));
    } else if (mensagens.length) {
      trechoRecusado = true;
    }
  }

  return {
    id: id,
    contato: contato,
    telefone: telefone,
    ultimaEm: ultimaEm,
    mensagens: numeroOuNulo(pegar(cru, ['mensagens', 'total_mensagens'])),
    estagio: rotuloDoEstagio(textoOuNulo(pegar(cru, ['estagio'])), textoOuNulo(pegar(cru, ['estagio_nome']))),
    situacaoTexto: situacao && textosDasSituacoes[situacao] ? textosDasSituacoes[situacao].texto : null,
    motivoTexto: motivo ? (textosDosMotivos[motivo] || motivo.replace(/_/g, ' ')) : null,
    bola: bola,
    paradaHoras: numeroOuNulo(pegar(cru, ['parada_horas', 'horas_parada'])),
    primeiraRespostaMin: numeroOuNulo(pegar(cru, ['primeira_resposta_min'])),
    trecho: trecho,
    trechoRecusado: trechoRecusado,
  };
}

/**
 * O funil de conversão. Sem o objeto `funil` na resposta devolve null, e a
 * seção inteira deixa de existir na tela — nenhum cartão vazio no lugar.
 * Percentual só é calculado aqui quando o servidor não mandou o dele e as
 * duas pontas (quantidade e total) existem: aritmética, não estimativa.
 */
function lerFunil(dados) {
  const fonte = pegar(dados, ['funil', 'conversao']);
  if (!fonte || typeof fonte !== 'object' || Array.isArray(fonte)) return null;

  const total = numeroOuNulo(pegar(fonte, ['total', 'conversas']));

  /* Textos das situações, prontos do servidor, indexados pela chave. */
  const textosDasSituacoes = {};
  const situacoesCru = pegar(fonte, ['situacoes_texto', 'situacoes']);
  if (situacoesCru && typeof situacoesCru === 'object' && !Array.isArray(situacoesCru)) {
    Object.keys(situacoesCru).forEach(function (chave) {
      const item = situacoesCru[chave];
      const texto = item && typeof item === 'object'
        ? textoOuNulo(pegar(item, ['texto', 'descricao']))
        : textoOuNulo(item);
      if (!texto) return;
      textosDasSituacoes[chaveSimples(chave)] = {
        texto: texto,
        grupo: item && typeof item === 'object' ? chaveSimples(textoOuNulo(pegar(item, ['grupo'])) || '') : '',
      };
    });
  }

  /* Motivos da trava: mais frequente primeiro, empate mantém a ordem da API. */
  const motivos = listaOuVazio(pegar(fonte, ['motivos', 'motivos_trava'])).map(function (cru, indice) {
    const chave = chaveSimples(textoOuNulo(pegar(cru, ['motivo', 'chave'])) || '') || null;
    return {
      indice: indice,
      chave: chave,
      texto: textoOuNulo(pegar(cru, ['texto', 'descricao'])) || (chave ? chave.replace(/_/g, ' ') : null),
      quantidade: numeroOuNulo(pegar(cru, ['quantidade', 'total', 'conversas'])),
    };
  }).filter(function (m) { return !!m.texto; });
  motivos.sort(function (a, b) {
    const qa = a.quantidade === null ? -1 : a.quantidade;
    const qb = b.quantidade === null ? -1 : b.quantidade;
    if (qb !== qa) return qb - qa;
    return a.indice - b.indice;
  });
  const textosDosMotivos = {};
  motivos.forEach(function (m) { if (m.chave) textosDosMotivos[m.chave] = m.texto; });

  /* Estágios, na ordem que o servidor numerou. */
  const estagios = listaOuVazio(pegar(fonte, ['estagios', 'etapas'])).map(function (cru, indice) {
    const chave = chaveSimples(textoOuNulo(pegar(cru, ['estagio', 'chave', 'nome'])) || '') || null;
    return {
      indice: indice,
      chave: chave,
      ordem: numeroOuNulo(pegar(cru, ['ordem', 'posicao'])),
      rotulo: rotuloDoEstagio(chave, textoOuNulo(pegar(cru, ['rotulo', 'estagio_nome']))),
      alcancaram: numeroOuNulo(pegar(cru, ['alcancaram', 'conversas', 'quantidade'])),
    };
  }).filter(function (e) { return !!e.rotulo; });
  estagios.sort(function (a, b) {
    const oa = a.ordem === null ? a.indice : a.ordem;
    const ob = b.ordem === null ? b.indice : b.ordem;
    if (oa !== ob) return oa - ob;
    return a.indice - b.indice;
  });
  // Base do percentual de cada estágio: o total, ou o primeiro estágio quando o total não veio.
  const baseFunil = total !== null
    ? total
    : (estagios.length && estagios[0].alcancaram !== null ? estagios[0].alcancaram : null);
  estagios.forEach(function (e) {
    e.pct = e.alcancaram !== null && baseFunil ? (e.alcancaram / baseFunil) * 100 : null;
  });

  /* Os três destinos e o "em andamento". */
  const destinosCru = pegar(fonte, ['destinos', 'destino']) || {};
  const destinos = DESTINOS.map(function (def) {
    const quantidade = numeroOuNulo(pegar(destinosCru, def.chaves));
    let pct = numeroOuNulo(pegar(fonte, def.pctChaves));
    if (pct === null) pct = numeroOuNulo(pegar(destinosCru, def.pctChaves));
    if (pct === null && quantidade !== null && total) pct = (quantidade / total) * 100;
    const textos = [];
    Object.keys(textosDasSituacoes).forEach(function (chave) {
      if (textosDasSituacoes[chave].grupo === def.chave) textos.push(textosDasSituacoes[chave].texto);
    });
    return { def: def, quantidade: quantidade, pct: pct, textos: textos };
  });
  const andando = numeroOuNulo(pegar(destinosCru, ['andando', 'em_andamento']));

  /* Onde o funil mais vaza. Só com as duas pontas nomeadas. */
  let maiorQueda = null;
  const quedaCru = pegar(fonte, ['maior_queda', 'queda']);
  if (quedaCru && typeof quedaCru === 'object') {
    const de = textoOuNulo(pegar(quedaCru, ['de', 'origem']));
    const para = textoOuNulo(pegar(quedaCru, ['para', 'destino']));
    if (de && para) {
      maiorQueda = {
        rotuloDe: rotuloDoEstagio(de, null),
        rotuloPara: rotuloDoEstagio(para, null),
        chavePara: chaveSimples(para),
        perdidos: numeroOuNulo(pegar(quedaCru, ['perdidos', 'quantidade'])),
        pct: numeroOuNulo(pegar(quedaCru, ['pct', 'percentual'])),
      };
    }
  }

  /* As duas listas de conversa parada. A contagem vem da lista; faltando,
     vem da soma das situações que a compõem (aritmética sobre o que veio). */
  const situacaoCru = pegar(fonte, ['situacao', 'situacoes_contagem']) || {};
  const dividas = DIVIDAS.map(function (def) {
    const cru = pegar(fonte, def.chaves);
    let quantidade = numeroOuNulo(pegar(cru, ['quantidade', 'total']));
    if (quantidade === null) {
      let soma = 0;
      let temAlguma = false;
      def.situacoes.forEach(function (chave) {
        const n = numeroOuNulo(pegar(situacaoCru, [chave]));
        if (n !== null) { soma += n; temAlguma = true; }
      });
      if (temAlguma) quantidade = soma;
    }
    const casos = [];
    listaOuVazio(pegar(cru, ['casos', 'conversas'])).forEach(function (c) {
      const lido = lerCaso(c, textosDosMotivos, textosDasSituacoes);
      if (lido) casos.push(lido);
    });
    // Texto pronto do servidor para cada situação que compõe a lista.
    const textos = {};
    def.situacoes.forEach(function (chave) {
      if (textosDasSituacoes[chave]) textos[chave] = textosDasSituacoes[chave].texto;
    });
    return {
      def: def,
      quantidade: quantidade,
      semResposta: numeroOuNulo(pegar(cru, ['sem_resposta'])),
      semDirecao: numeroOuNulo(pegar(cru, ['sem_direcao'])),
      horasMediana: numeroOuNulo(pegar(cru, ['horas_mediana', 'mediana_horas', 'parada_mediana_horas'])),
      textos: textos,
      casos: casos,
    };
  });

  const temMedida = total !== null
    || estagios.some(function (e) { return e.alcancaram !== null; })
    || destinos.some(function (d) { return d.quantidade !== null; })
    || dividas.some(function (d) { return d.quantidade !== null || d.casos.length > 0; })
    || motivos.some(function (m) { return m.quantidade !== null; });
  if (!temMedida) return null;

  return {
    total: total,
    estagios: estagios,
    destinos: destinos,
    andando: andando,
    maiorQueda: maiorQueda,
    motivos: motivos,
    dividas: dividas,
  };
}

/** true quando esta unidade tem agente de IA respondendo antes da recepção. */
function temAgenteIa(dados, slug, nome) {
  const marcado = pegar(dados, ['agente_ia', 'tem_agente_ia', 'com_ia', 'ia']);
  if (marcado === true) return true;
  if (marcado === false) return false;
  const alvo = chaveSimples(String(slug || '') + '_' + String(nome || ''));
  return MARCAS_DE_IA.some(function (marca) { return alvo.indexOf(marca) >= 0; });
}

/**
 * Comparação com a rede. A referência vem da própria análise quando o servidor
 * manda; senão, do objeto `rede` do painel — e aí a tela DIZ que o recorte pode
 * ser outro, em vez de comparar períodos diferentes em silêncio.
 */
function lerComparacao(dados, leitura, ctx) {
  const daAnalise = pegar(dados, ['rede', 'referencia', 'comparacao']);
  const fonteAnalise = (daAnalise && typeof daAnalise === 'object' && !Array.isArray(daAnalise))
    ? daAnalise : null;
  const doPainel = ctx && ctx.rede && typeof ctx.rede === 'object' ? ctx.rede : null;

  const linhas = [];
  COMPARACOES.forEach(function (def) {
    const valor = def.lerUnidade(leitura);
    if (valor === null) return;

    let referencia = null;
    let rotuloRef = null;
    let fonte = null;

    for (let i = 0; i < def.camposRede.length && referencia === null; i += 1) {
      const campo = def.camposRede[i];
      if (fonteAnalise) {
        const v = numeroOuNulo(pegar(fonteAnalise, campo.chaves));
        if (v !== null) { referencia = v; rotuloRef = campo.rotulo; fonte = 'analise'; }
      }
    }
    for (let i = 0; i < def.camposRede.length && referencia === null; i += 1) {
      const campo = def.camposRede[i];
      if (doPainel) {
        const v = numeroOuNulo(pegar(doPainel, campo.chaves));
        if (v !== null) { referencia = v; rotuloRef = campo.rotulo; fonte = 'painel'; }
      }
    }
    if (referencia === null) return;

    const diferenca = valor - referencia;
    const acima = Math.abs(diferenca) < 0.0001 ? null : diferenca > 0;
    const melhor = acima === null ? null : (acima === def.maiorMelhor);

    linhas.push({
      def: def,
      valor: valor,
      referencia: referencia,
      rotuloRef: rotuloRef,
      fonte: fonte,
      acima: acima,
      melhor: melhor,
    });
  });
  return linhas;
}

/** Junta tudo numa leitura só — é o que as funções de desenho recebem. */
function interpretar(dados, dias, ctx, slug) {
  const base = lerBase(dados);
  const leitura = {
    nome: textoOuNulo(pegar(dados, ['unidade', 'nome', 'unidade_nome'])),
    periodo: lerPeriodo(dados, dias),
    base: base,
    nota: lerNota(dados, base),
    indicadores: INDICADORES.map(function (def) { return lerIndicador(dados, def); }),
    tempos: lerTempos(dados),
    compromissos: lerCompromissos(dados),
    correcoes: lerCorrecoes(dados),
    temperatura: lerTemperatura(dados),
    funil: lerFunil(dados),
    motivo: chaveSimples(textoOuNulo(pegar(dados, ['motivo', 'sem_analise', 'situacao'])) || '') || null,
  };
  leitura.ia = temAgenteIa(dados, slug, leitura.nome);
  leitura.comparacao = lerComparacao(dados, leitura, ctx);
  return leitura;
}

/** true quando a resposta não tem nada que sustente uma análise. */
function analiseVazia(leitura) {
  const temIndicador = leitura.indicadores.some(function (i) { return i.medido !== null; });
  const temTempo = TEMPOS.some(function (d) { return leitura.tempos[d.chave] !== null; });
  const temCompromisso = leitura.compromissos.some(function (c) { return c.avaliado; });
  return !temIndicador && !temTempo && !temCompromisso
    && !leitura.correcoes.length && !leitura.temperatura && leitura.nota.valor === null;
}

/* ═════════════════════════ 7. ARMAÇÃO DA TELA ═══════════════════════════ */

function instalarEstilo() {
  if (document.getElementById('an-estilo')) return;
  const folha = criar('style');
  folha.id = 'an-estilo';
  folha.textContent = ESTILO;
  document.head.appendChild(folha);
}

/** Barra de controles: período analisado e recarga manual. */
function montarControles() {
  const nos = estado.nos;

  const barra = criar('div', 'an-controles');

  const grupo = criar('div', 'an-periodo');
  grupo.setAttribute('role', 'group');
  grupo.setAttribute('aria-label', 'Período da análise');
  nos.periodoBotoes = [];

  PERIODOS.forEach(function (opcao) {
    const btn = botao('an-periodo-btn', opcao.rotulo);
    btn.setAttribute('aria-pressed', opcao.dias === estado.dias ? 'true' : 'false');
    btn.title = 'Analisar os últimos ' + opcao.rotulo + ' desta unidade';
    btn.addEventListener('click', function () { trocarPeriodo(opcao.dias); });
    grupo.appendChild(btn);
    nos.periodoBotoes.push({ dias: opcao.dias, no: btn });
  });
  barra.appendChild(grupo);

  const atualizar = botao('btn', 'Atualizar');
  atualizar.appendChild(icone(ICONES.atualizar));
  atualizar.title = 'Buscar a análise de novo no servidor, sem usar o resultado guardado.';
  atualizar.addEventListener('click', function () { recarregar(); });
  barra.appendChild(atualizar);
  nos.atualizar = atualizar;

  const quando = criar('span', 'an-quando');
  barra.appendChild(quando);
  nos.quando = quando;

  return barra;
}

function montarArmacao(raiz) {
  const nos = estado.nos;

  const caixa = criar('div', 'an');

  caixa.appendChild(montarControles());

  const corpo = criar('div', 'pilha espaco-16');
  caixa.appendChild(corpo);
  nos.corpo = corpo;

  const vivo = criar('div', 'sr-apenas');
  vivo.setAttribute('role', 'status');
  vivo.setAttribute('aria-live', 'polite');
  caixa.appendChild(vivo);
  nos.vivo = vivo;

  raiz.appendChild(caixa);
}

/** Placa de carregamento. Não é dado: nunca fica no lugar de um valor que falhou. */
function desenharCarregando() {
  const caixa = criar('div', 'an-carregando');
  caixa.appendChild(criar('span', 'sr-apenas', 'Carregando a análise desta unidade…'));

  const topo = criar('div', 'carta pilha espaco-12');
  topo.appendChild(criar('div', 'esqueleto titulo'));
  topo.appendChild(criar('div', 'esqueleto linha'));
  caixa.appendChild(topo);

  for (let i = 0; i < 2; i += 1) {
    const bloco = criar('div', 'carta');
    bloco.appendChild(criar('div', 'esqueleto bloco'));
    caixa.appendChild(bloco);
  }
  return caixa;
}

/* ═════════════════════════ 8. CARREGAMENTO ══════════════════════════════
   A análise é cara de montar (cache de 5 min no dados.js). Em vez de bater no
   servidor a cada segundo, a tela assina a ação com o mesmo intervalo do cache:
   `assinarAtualizacao` já segura a aba escondida, aumenta a espera quando o
   servidor cai e cancela sozinho quando a sessão morre.
   ════════════════════════════════════════════════════════════════════════ */

function pararAssinatura() {
  if (estado && estado.parar) {
    try { estado.parar(); } catch (e) { /* já cancelada */ }
    estado.parar = null;
  }
}

/** (Re)liga a assinatura da análise da unidade e do período atuais. */
function ligarAssinatura() {
  pararAssinatura();
  if (!estado || !estado.slug) return;

  const slug = estado.slug;
  const dias = estado.dias;

  estado.parar = assinarAtualizacao('analise', { slug: slug, dias: dias }, INTERVALO_MS,
    function (dados, erro) {
      if (!estado || estado.slug !== slug || estado.dias !== dias) return;
      estado.recebeu = true;
      if (erro) {
        estado.erro = erro;
        // Só apaga o que estava na tela se não havia nada — um erro passageiro
        // não pode roubar a análise que o usuário está lendo.
        if (!estado.dados) desenhar();
        else marcarFalhaDeAtualizacao(erro);
        return;
      }
      estado.erro = null;
      const assinatura = assinaturaDe(dados);
      if (estado.dados && assinatura === estado.assinatura) {
        marcarAtualizado();
        return;   // nada mudou: não redesenha por cima de quem está lendo
      }
      estado.dados = dados;
      estado.assinatura = assinatura;
      desenhar();
    });
  // Quem cancela é `pararAssinatura`, chamado aqui a cada religada e em desmontar().
}

/** Assinatura barata do payload, para não redesenhar conteúdo idêntico. */
function assinaturaDe(dados) {
  try {
    return JSON.stringify(dados);
  } catch (e) {
    return String(Date.now());
  }
}

/** Recarrega agora, ignorando o resultado guardado. */
async function recarregar() {
  if (!estado || !estado.slug) return;
  const slug = estado.slug;
  const dias = estado.dias;

  if (estado.nos.atualizar) estado.nos.atualizar.setAttribute('aria-disabled', 'true');
  anunciar('Buscando a análise no servidor.');

  try {
    const dados = await api.analise(slug, dias, { forcar: true });
    if (!estado || estado.slug !== slug || estado.dias !== dias) return;
    estado.recebeu = true;
    estado.erro = null;
    estado.dados = dados;
    estado.assinatura = assinaturaDe(dados);
    desenhar();
    anunciar('Análise atualizada.');
  } catch (erro) {
    if (!estado || estado.slug !== slug || estado.dias !== dias) return;
    estado.recebeu = true;
    estado.erro = erro;
    if (!estado.dados) desenhar();
    else marcarFalhaDeAtualizacao(erro);
  } finally {
    if (estado && estado.nos.atualizar) estado.nos.atualizar.removeAttribute('aria-disabled');
  }
}

/** Troca o período e refaz a consulta. */
function trocarPeriodo(dias) {
  if (!estado || estado.dias === dias) return;
  estado.dias = dias;
  estado.dados = null;
  estado.assinatura = '';
  estado.erro = null;
  estado.recebeu = false;
  estado.abertos = new Set();
  estado.casosVisiveis = {};

  (estado.nos.periodoBotoes || []).forEach(function (item) {
    item.no.setAttribute('aria-pressed', item.dias === dias ? 'true' : 'false');
  });

  desenhar();
  ligarAssinatura();
  anunciar('Período da análise: ' + dias + ' dias.');
}

/** A unidade mudou no seletor do topo: recomeça sem remontar a tela. */
function aplicarUnidade() {
  if (!estado) return;
  const novo = estado.ctx && estado.ctx.unidadeAtual ? estado.ctx.unidadeAtual : null;
  if (novo === estado.slug && estado.recebeu) return;
  estado.slug = novo;
  estado.dados = null;
  estado.assinatura = '';
  estado.erro = null;
  estado.recebeu = false;
  estado.abertos = new Set();
  estado.casosVisiveis = {};
  desenhar();
  ligarAssinatura();
}

/** Marca a hora da última leitura boa no canto dos controles. */
function marcarAtualizado() {
  if (!estado || !estado.nos.quando) return;
  estado.nos.quando.textContent = 'Lida ' + formatarQuando(new Date());
  estado.nos.quando.title = 'Momento em que esta análise foi lida do servidor.';
}

/** Falha na atualização com análise já na tela: avisa sem apagar o que está lido. */
function marcarFalhaDeAtualizacao(erro) {
  if (!estado || !estado.nos.quando) return;
  if (ehErroDeSessao(erro)) return;   // a casca trata a sessão
  estado.nos.quando.textContent = 'Última atualização falhou';
  estado.nos.quando.title = (erro && erro.amigavel)
    ? erro.amigavel
    : 'Não consegui atualizar a análise agora. O que está na tela é a leitura anterior.';
}

/* ═════════════════════════ 9. DESENHO GERAL ═════════════════════════════ */

function desenhar() {
  if (!estado) return;
  // Os quadros de animação e timers do desenho anterior morrem antes do novo.
  rodarLimpezasDesenho();
  const corpo = estado.nos.corpo;
  limpar(corpo);

  if (!estado.slug) {
    corpo.appendChild(vazioSemUnidade());
    return;
  }
  if (!estado.recebeu && !estado.dados) {
    corpo.appendChild(desenharCarregando());
    return;
  }
  if (estado.erro && !estado.dados) {
    corpo.appendChild(blocoErro(estado.erro));
    return;
  }
  if (!estado.dados) {
    corpo.appendChild(vazioSemAnalise(null));
    return;
  }

  const leitura = interpretar(estado.dados, estado.dias, estado.ctx, estado.slug);
  marcarAtualizado();

  // Sem nada medido, a tela diz o que falta em vez de desenhar cartões ocos.
  if (analiseVazia(leitura)) {
    if (leitura.base.conversas !== null || leitura.base.mensagens !== null) {
      corpo.appendChild(desenharCabecalho(leitura));
    }
    // O funil é medição por conta própria: se veio, aparece mesmo sem o resto.
    if (leitura.funil) corpo.appendChild(desenharConversao(leitura));
    corpo.appendChild(vazioSemAnalise(leitura));
    return;
  }

  corpo.appendChild(desenharCabecalho(leitura));
  if (leitura.ia) corpo.appendChild(desenharAvisoIa(leitura));
  corpo.appendChild(desenharMedido(leitura));
  corpo.appendChild(desenharCompromissos(leitura));
  // Sem `funil` na resposta, a seção de conversão não existe — nem vazia.
  if (leitura.funil) corpo.appendChild(desenharConversao(leitura));
  corpo.appendChild(desenharAvaliacao(leitura));
  corpo.appendChild(desenharTemperatura(leitura));
  corpo.appendChild(desenharRede(leitura));
}

/* --- Estados vazios e erro ---------------------------------------------- */

function blocoVazio(iconeSvg, titulo, texto, acao) {
  const caixa = criar('div', 'vazio');
  caixa.appendChild(icone(iconeSvg, 'vazio-icone'));
  caixa.appendChild(criar('p', 'vazio-titulo', titulo));
  caixa.appendChild(criar('p', 'vazio-texto', texto));
  if (acao) caixa.appendChild(acao);
  return caixa;
}

function vazioSemUnidade() {
  return blocoVazio(
    ICONES.analise,
    'Escolha uma unidade para analisar',
    'A análise é sempre de uma unidade: ela mede as conversas daquele WhatsApp contra as metas '
    + 'do treinamento. Use o seletor no topo da tela para escolher qual unidade avaliar.'
  );
}

/**
 * Sem análise para esta unidade. O texto diz exatamente o que falta — nunca
 * uma avaliação inventada para preencher a tela.
 */
function vazioSemAnalise(leitura) {
  const motivo = leitura && leitura.motivo ? MOTIVOS[leitura.motivo] : null;

  if (motivo) {
    const caixa = blocoVazio(ICONES.vazio, motivo.titulo, motivo.texto);
    if (leitura && leitura.base.conversas !== null) {
      caixa.appendChild(criar('p', 'an-legenda',
        'Base lida no período: ' + formatarNumero(leitura.base.conversas) + ' conversas.'));
    }
    return caixa;
  }

  const caixa = criar('div', 'vazio');
  caixa.appendChild(icone(ICONES.vazio, 'vazio-icone'));
  caixa.appendChild(criar('p', 'vazio-titulo', 'Ainda não há análise desta unidade neste período'));
  caixa.appendChild(criar('p', 'vazio-texto',
    'O servidor respondeu, mas não devolveu nenhuma avaliação para os últimos '
    + estado.dias + ' dias. A análise só é calculada quando duas coisas estão prontas:'));

  const lista = criar('ul', 'an-vazio-lista');
  lista.appendChild(criar('li', null,
    'o ciclo do período precisa estar fechado — em ciclo aberto o resultado mudaria a cada hora;'));
  lista.appendChild(criar('li', null,
    'os contatos precisam estar classificados — sem separar tutor de fornecedor e de equipe, '
    + 'a contagem de leads mistura quem nunca foi cliente com quem liga para vender.'));
  caixa.appendChild(lista);

  caixa.appendChild(criar('p', 'an-legenda',
    'Enquanto isso não estiver pronto, esta tela não inventa nota nem percentual.'));

  const acao = botao('btn', 'Tentar de novo');
  acao.addEventListener('click', function () { recarregar(); });
  caixa.appendChild(acao);
  return caixa;
}

/** Faixa de erro de leitura. Sessão expirada é assunto da casca, não daqui. */
function blocoErro(erro) {
  const caixa = criar('div', 'aviso aviso-erro');
  caixa.setAttribute('role', 'alert');
  caixa.appendChild(icone(ICONES.alerta));

  const texto = criar('div', 'an-aviso-corpo');
  texto.appendChild(criar('span', 'aviso-titulo', 'Não consegui ler a análise desta unidade'));
  texto.appendChild(criar('span', 'aviso-texto',
    (erro && erro.amigavel) ? erro.amigavel : 'A consulta falhou antes de trazer a avaliação.'));
  caixa.appendChild(texto);

  if (!ehErroDeSessao(erro)) {
    const acao = botao('btn', 'Tentar de novo');
    acao.addEventListener('click', function () { recarregar(); });
    caixa.appendChild(acao);
  }
  return caixa;
}

/* ═════════════════════════ 10. CABEÇALHO ════════════════════════════════ */

/** Nome da unidade: o da API, o do painel ou, em último caso, o identificador. */
function nomeDaUnidade(leitura) {
  if (leitura.nome) return leitura.nome;
  const doPainel = estado.ctx && estado.ctx.unidade ? estado.ctx.unidade.nome : null;
  return doPainel || estado.slug || 'Unidade';
}

/** Uma medida crua do cabeçalho. null vira tracinho com o porquê no title. */
function itemDaBase(valor, singular, plural) {
  const item = criar('div', 'an-base-item');
  const numero = criar('span', 'an-base-valor numero');
  if (valor === null) {
    item.setAttribute('data-vazio', 'sim');
    numero.textContent = TRACINHO;
    item.title = 'A API não devolveu esta contagem no período — não é zero, é ausência de medida.';
  } else {
    numero.textContent = formatarNumero(valor);
  }
  item.appendChild(numero);
  item.appendChild(criar('span', 'an-base-rotulo', valor === 1 ? singular : plural));
  return item;
}

function textoDoPeriodo(periodo) {
  const dias = periodo.dias || estado.dias;
  let texto = 'Últimos ' + formatarNumero(dias) + ' dias';
  const de = dataCurta(periodo.de);
  const ate = dataCurta(periodo.ate);
  if (de && ate) texto += ' · ' + de + ' a ' + ate;
  else if (ate) texto += ' · até ' + ate;
  return texto;
}

function desenharCabecalho(leitura) {
  const carta = criar('div', 'carta an-topo');

  /* --- Identificação e base crua (medida) --- */
  const id = criar('div', 'an-topo-id');
  const titulo = criar('h1', 'an-titulo', nomeDaUnidade(leitura));
  id.appendChild(titulo);
  id.appendChild(criar('p', 'an-periodo-texto', textoDoPeriodo(leitura.periodo)));

  const base = criar('div', 'an-base');
  base.appendChild(itemDaBase(leitura.base.conversas, 'conversa', 'conversas'));
  base.appendChild(itemDaBase(leitura.base.mensagens, 'mensagem', 'mensagens'));
  base.appendChild(itemDaBase(leitura.base.audios, 'áudio', 'áudios'));
  if (leitura.base.leads !== null) {
    base.appendChild(itemDaBase(leitura.base.leads, 'lead', 'leads'));
  }
  if (leitura.base.classificados !== null) {
    base.appendChild(itemDaBase(leitura.base.classificados, 'contato classificado', 'contatos classificados'));
  }
  id.appendChild(base);

  id.appendChild(criar('p', 'an-legenda',
    'Base da análise: números crus lidos das conversas do período, sem filtro de qualidade.'));

  carta.appendChild(id);
  carta.appendChild(desenharNota(leitura));
  return carta;
}

/**
 * A nota é julgamento da Daco, não medida. Por isso mora numa caixa de borda
 * quente com o rótulo "avaliação da Daco", mesmo estando no cabeçalho.
 */
function desenharNota(leitura) {
  const caixa = criar('div', 'an-nota-caixa');
  const nota = leitura.nota;
  caixa.setAttribute('data-tom', tomDaNota(nota.valor));

  const rotulo = criar('span', 'an-rotulo an-rotulo-avaliacao');
  rotulo.appendChild(icone(ICONES.selo));
  rotulo.appendChild(criar('span', null, 'Avaliação da Daco'));
  caixa.appendChild(rotulo);

  if (nota.valor === null) {
    // Base pequena demais: a tela diz isso NO LUGAR da nota.
    const linha = criar('div', 'an-nota-linha');
    linha.appendChild(criar('span', 'an-nota-valor', 'Sem nota'));
    caixa.appendChild(linha);

    let texto;
    if (nota.motivo) {
      texto = nota.motivo;
    } else if (nota.semBase || leitura.base.suficiente === false) {
      texto = 'A base do período não sustenta uma nota: '
        + (leitura.base.conversas !== null
          ? formatarNumero(leitura.base.conversas) + ' conversas'
          : 'a contagem de conversas nem veio')
        + (leitura.base.minimo !== null
          ? ', e o mínimo para fechar nota é ' + formatarNumero(leitura.base.minimo) + '.'
          : '.')
        + ' Percentual sobre pouca conversa vira ruído, e ruído não vira cobrança.';
    } else {
      texto = 'O servidor não devolveu nota para este período. Nenhum número foi arbitrado aqui '
        + 'para ocupar o lugar dela.';
    }
    caixa.appendChild(criar('p', 'an-nota-criterio', texto));
    return caixa;
  }

  const linha = criar('div', 'an-nota-linha');
  const valor = criar('span', 'an-nota-valor numero');
  linha.appendChild(valor);
  linha.appendChild(criar('span', 'an-nota-escala', 'de 0 a 10'));
  caixa.appendChild(linha);
  animarNumero(valor, nota.valor, 'nota');

  caixa.appendChild(criar('p', 'an-nota-criterio', nota.criterio
    ? nota.criterio
    : 'A API não informou o critério desta nota. Sem o critério, a nota vale como leitura da '
      + 'Daco sobre o período — não como número auditável.'));
  return caixa;
}

/* ═════════════════════════ 11. AVISO DAS UNIDADES COM IA ════════════════ */

/**
 * Obrigatório nas unidades com agente de IA (seção 5 do contrato). Sem esta
 * faixa, o tempo de resposta seria lido como mérito da recepção.
 */
function desenharAvisoIa(leitura) {
  const faixa = criar('div', 'aviso aviso-atencao');
  faixa.setAttribute('role', 'note');
  faixa.appendChild(icone(ICONES.robo));

  const texto = criar('div', 'an-aviso-corpo');
  texto.appendChild(criar('span', 'aviso-titulo', 'Esta unidade tem agente de IA respondendo antes da recepção'));
  texto.appendChild(criar('span', 'aviso-texto',
    'O tempo de resposta medido aqui é o da IA, não o da recepção: o agente responde em segundos '
    + 'e puxa a mediana para baixo. O foco desta avaliação é o atendimento DEPOIS que a recepção '
    + 'assume — a notificação "Cliente pronto para atendimento" marca essa passagem, e é dela em '
    + 'diante que os compromissos do treinamento são cobrados.'));
  faixa.appendChild(texto);
  return faixa;
}

/* ═════════════════════════ 12. BLOCO "O QUE FOI MEDIDO" ═════════════════
   Borda fria e rótulo "medido": aqui só entra o que foi contado sobre as
   conversas do período. Nota, prioridade e recomendação ficam no outro bloco.
   ════════════════════════════════════════════════════════════════════════ */

/** Cabeça de um dos dois blocos, com o rótulo que diz o que ele é. */
function cabecaDeBloco(tipo, titulo, nota, iconeSvg) {
  const cabeca = criar('div', 'an-bloco-cabeca');

  const rotulo = criar('span', 'an-rotulo an-rotulo-' + tipo);
  rotulo.appendChild(icone(iconeSvg));
  rotulo.appendChild(criar('span', null, tipo === 'medido' ? 'Medido' : 'Avaliação'));
  cabeca.appendChild(rotulo);

  cabeca.appendChild(criar('h2', null, titulo));
  if (nota) cabeca.appendChild(criar('p', 'an-bloco-nota', nota));
  return cabeca;
}

/** Texto da meta oficial, do jeito que o treinamento a enuncia. */
function textoDaMeta(ind) {
  if (ind.def.alvo === 'maximo') return 'Meta ' + formatarNumero(ind.meta);
  return 'Meta ' + formatarNumero(ind.meta) + '%+';
}

/** Como a situação é dita na tela. A crítica é do indicador, nunca da unidade. */
function textoDaSituacao(ind) {
  if (ind.dentro === null) return 'não medimos';
  if (ind.def.alvo === 'maximo') return ind.dentro ? 'dentro da meta' : 'fora da meta';
  return ind.dentro ? 'na meta' : 'abaixo da meta';
}

function seloDaSituacao(ind) {
  if (ind.dentro === null) return selo('não medimos', 'neutro', true);
  return selo(textoDaSituacao(ind), ind.tom === 'sem' ? 'neutro' : ind.tom);
}

function desenharIndicador(ind) {
  const caixa = criar('div', 'an-ind');
  caixa.setAttribute('data-tom', ind.tom);

  const topo = criar('div', 'an-ind-topo');
  topo.appendChild(criar('span', 'an-ind-nome', ind.def.rotulo));
  topo.appendChild(criar('span', 'an-ind-meta', textoDaMeta(ind)));

  const valor = criar('span', 'an-ind-valor numero');
  if (ind.medido === null) {
    valor.textContent = TRACINHO;
    valor.title = 'A API não devolveu este indicador no período. Não é zero: é ausência de medida.';
  }
  topo.appendChild(valor);
  caixa.appendChild(topo);
  if (ind.medido !== null) animarNumero(valor, ind.medido, ind.def.formato);

  /* Barra: percentual real contra a meta. No indicador de contagem a meta é
     zero, então a barra é binária — e a legenda abaixo diz isso. */
  let pctBarra = ind.medido;
  let metaBarra = ind.meta;
  if (ind.def.formato === 'contagem') {
    metaBarra = null;
    pctBarra = ind.medido === null ? null : (ind.medido > 0 ? 100 : 0);
  }
  const rotuloBarra = ind.def.rotulo + ': '
    + (ind.medido === null ? 'sem medida' : formatarPorTipo(ind.medido, ind.def.formato))
    + ', ' + textoDaMeta(ind).toLowerCase() + ' — ' + textoDaSituacao(ind);
  caixa.appendChild(montarBarra(pctBarra, metaBarra, ind.tom === 'sem' ? null : ind.tom, rotuloBarra));

  const pe = criar('div', 'an-ind-pe');
  pe.appendChild(seloDaSituacao(ind));

  /* Cuidado com a leitura da contagem: no indicador de contagem o total é o
     universo (conversas), não o número de ocorrências. "3 de 412 ocorrências"
     seria mentira — o certo é "3 ocorrências em 412 conversas". */
  if (ind.def.formato === 'contagem') {
    const ocorrencias = ind.medido !== null
      ? ind.medido
      : (ind.contagem && ind.contagem.ok !== null ? ind.contagem.ok : null);
    if (ocorrencias !== null) {
      const universo = ind.contagem && ind.contagem.total !== null
        ? ' em ' + formatarNumero(ind.contagem.total) + ' conversas'
        : ' no período';
      pe.appendChild(criar('span', null, formatarNumero(ocorrencias) + ' ' + ind.def.conta + universo));
    }
  } else if (ind.contagem && ind.contagem.total !== null) {
    const ok = ind.contagem.ok === null ? TRACINHO : formatarNumero(ind.contagem.ok);
    const no = criar('span', null,
      ok + ' de ' + formatarNumero(ind.contagem.total) + ' ' + ind.def.conta);
    if (ind.contagem.ok === null) {
      no.title = 'O servidor devolveu o total, mas não a contagem atendida. ' +
                 'Não é zero: é ausência de medida.';
    }
    pe.appendChild(no);
  }

  if (ind.def.formato === 'contagem') {
    pe.appendChild(criar('span', 'an-ind-explica an-legenda',
      'A barra aqui é binária: a meta é zero, então qualquer ocorrência já fica fora dela.'));
  }
  if (ind.medido === null) {
    pe.appendChild(criar('span', 'an-ind-explica',
      'Sem este indicador no período, ele fica em branco — nenhum valor foi arbitrado no lugar.'));
  }
  if (ind.explicacao) {
    pe.appendChild(criar('span', 'an-ind-explica', ind.explicacao));
  }
  caixa.appendChild(pe);
  return caixa;
}

/** Métrica do tema com o valor já formatado; null vira tracinho explicado. */
function metricaSimples(valor, formato, rotulo, dica) {
  const caixa = criar('div', 'metrica compacta');
  const numero = criar('span', 'metrica-valor numero');
  if (valor === null) {
    caixa.classList.add('sem-medida');
    numero.textContent = TRACINHO;
    caixa.title = dica || 'A API não devolveu esta medida no período. Não é zero: é ausência de medida.';
  } else {
    numero.textContent = formatarPorTipo(valor, formato);
  }
  caixa.appendChild(numero);
  caixa.appendChild(criar('span', 'metrica-rotulo', rotulo));
  return caixa;
}

function desenharMedido(leitura) {
  const carta = criar('div', 'carta an-bloco an-bloco-medido');

  carta.appendChild(cabecaDeBloco('medido', 'O que foi medido',
    'Contado sobre as conversas do período. As quatro metas ao lado são as oficiais do '
    + 'treinamento, definidas para 30 dias'
    + (estado.dias === 30 ? '.' : ' — neste recorte de ' + estado.dias
      + ' dias elas servem de referência, não de nota.'),
    ICONES.regua));

  const inds = criar('div', 'an-inds');
  leitura.indicadores.forEach(function (ind) { inds.appendChild(desenharIndicador(ind)); });
  carta.appendChild(inds);

  carta.appendChild(criar('hr', 'separador'));

  const subtitulo = criar('h3', null, 'Tempo de resposta');
  carta.appendChild(subtitulo);

  const grade = criar('div', 'grade an-tempos');
  TEMPOS.forEach(function (def) {
    const caixa = criar('div', 'an-tempo');
    caixa.appendChild(metricaSimples(leitura.tempos[def.chave], def.formato, def.rotulo));
    grade.appendChild(caixa);
  });
  carta.appendChild(grade);

  carta.appendChild(criar('p', 'an-rodape-nota',
    'O tempo de resposta não está entre os quatro indicadores de 30 dias do treinamento, '
    + 'então estes números são leitura do período e não entram como meta aqui. Os 5 minutos '
    + 'que o treinamento cobra valem para o lead que chega pela notificação de campanha, '
    + 'medido na aba Leads.'
    + (leitura.ia ? ' Nesta unidade eles medem o agente de IA, que responde antes da recepção.' : '')));

  return carta;
}

/* ═════════════════════════ 13. OS 8 COMPROMISSOS ════════════════════════
   Um por linha, com o resultado medido, a contagem e os trechos que o
   sustentam. Compromisso sem trecho NÃO aparece como avaliado — aparece como
   "sem base suficiente". É a regra da seção 5 do contrato.
   ════════════════════════════════════════════════════════════════════════ */

/** Um balão de fala. Nunca anônimo: quem falou vem escrito em cima. */
function desenharFala(msg) {
  const fala = criar('div', 'an-fala an-fala-' + msg.lado + (msg.ia ? ' an-fala-ia' : ''));

  const quem = criar('div', 'an-quem');
  quem.appendChild(criar('span', null, msg.quem));
  if (msg.papel) quem.appendChild(criar('span', 'an-quem-papel', '· ' + msg.papel));
  fala.appendChild(quem);

  const balao = criar('div', 'an-balao');
  const texto = criar('p', 'an-balao-texto');
  if (msg.texto) {
    texto.textContent = msg.texto;
  } else {
    texto.classList.add('an-sem-texto');
    texto.textContent = msg.tipo === 'audio'
      ? 'Áudio sem transcrição' + (msg.segundos !== null ? ' (' + formatarNumero(msg.segundos) + ' s)' : '')
      : 'Mensagem de ' + (msg.tipo || 'tipo não informado') + ' — o banco guarda só o metadado';
  }
  balao.appendChild(texto);

  const pe = criar('div', 'an-balao-pe');
  let temPe = false;
  if (msg.hora) { pe.appendChild(criar('span', null, msg.hora)); temPe = true; }
  if (msg.tipo === 'audio' && msg.transcrito) {
    pe.appendChild(criar('span', null, '· áudio transcrito'));
    temPe = true;
  }
  if (temPe) balao.appendChild(pe);

  fala.appendChild(balao);
  return fala;
}

/** Um trecho inteiro: cabeçalho da conversa e as falas em ordem. */
function desenharTrecho(trecho) {
  const caixa = criar('div', 'an-trecho');

  const cabeca = criar('div', 'an-trecho-cabeca');
  cabeca.appendChild(icone(ICONES.balao, 'an-trecho-icone'));
  if (trecho.quando) cabeca.appendChild(criar('span', null, formatarQuando(trecho.quando)));
  if (trecho.id) {
    const id = criar('span', 'mono texto-3', 'conversa ' + trecho.id);
    id.title = 'Identificador da conversa no banco — dá para procurar por ele na aba WhatsApp ao Vivo.';
    cabeca.appendChild(id);
  }
  if (trecho.titulo) cabeca.appendChild(criar('p', 'an-trecho-titulo', trecho.titulo));
  caixa.appendChild(cabeca);

  const falas = criar('div', 'an-falas');
  trecho.mensagens.forEach(function (msg) { falas.appendChild(desenharFala(msg)); });
  caixa.appendChild(falas);

  const abrir = botao('btn btn-fantasma', 'Abrir o WhatsApp desta unidade');
  abrir.title = 'Vai para a aba WhatsApp ao Vivo desta unidade. A lista abre inteira: use o '
    + 'identificador acima para achar esta conversa.';
  abrir.addEventListener('click', function () {
    if (estado && estado.ctx && typeof estado.ctx.irPara === 'function') {
      estado.ctx.irPara('whatsapp', estado.slug);
    }
  });
  caixa.appendChild(abrir);

  return caixa;
}

/** Resultado de um compromisso, do jeito certo conforme haja base ou não. */
function desenharLinhaDoCompromisso(comp) {
  const linha = criar('div', 'an-comp-linha');

  if (!comp.avaliado) {
    linha.appendChild(selo('sem base suficiente', 'neutro', true));
    return linha;
  }

  if (comp.pct !== null) {
    linha.appendChild(criar('span', 'an-comp-res', formatarPorcentagem(comp.pct, comp.pct % 1 ? 1 : 0)));
  }
  if (comp.contagem && comp.contagem.total !== null) {
    const ok = comp.contagem.ok === null ? TRACINHO : formatarNumero(comp.contagem.ok);
    const no = criar('span', 'an-comp-conta',
      ok + ' de ' + formatarNumero(comp.contagem.total) + ' conversas');
    if (comp.contagem.ok === null) {
      no.title = 'O servidor devolveu o total, mas não a contagem atendida. ' +
                 'Não é zero: é ausência de medida.';
    }
    linha.appendChild(no);
  } else if (comp.contagem && comp.contagem.ok !== null) {
    linha.appendChild(criar('span', 'an-comp-conta', formatarNumero(comp.contagem.ok) + ' conversas'));
  }
  linha.appendChild(criar('span', 'an-comp-conta',
    comp.trechos.length === 1 ? '1 trecho sustenta' : comp.trechos.length + ' trechos sustentam'));
  return linha;
}

function desenharCompromisso(comp, indice) {
  const caixa = criar('div', 'an-comp');
  caixa.setAttribute('data-tom', comp.tom);

  const cabeca = criar('div', 'an-comp-cabeca');
  cabeca.appendChild(criar('span', 'an-comp-num', String(comp.def.numero)));

  const corpo = criar('div', 'an-comp-corpo');
  corpo.appendChild(criar('span', 'an-comp-titulo', comp.titulo));
  corpo.appendChild(desenharLinhaDoCompromisso(comp));

  if (!comp.avaliado) {
    corpo.appendChild(criar('p', 'an-comp-obs',
      'Nenhum trecho do período sustenta este compromisso, então ele não entra como avaliado. '
      + 'Sem a conversa junto, o número seria só um palpite com cara de medida.'));
  } else if (comp.observacao) {
    corpo.appendChild(criar('p', 'an-comp-obs', comp.observacao));
  }
  cabeca.appendChild(corpo);

  if (comp.trechos.length) {
    const idTrechos = 'an-trechos-' + comp.def.numero + '-' + indice;
    const aberto = estado.abertos.has(comp.def.numero);

    const acao = criar('div', 'an-comp-acao');
    const btn = botao('btn', aberto ? 'Esconder trechos' : 'Ver trechos (' + comp.trechos.length + ')');
    btn.appendChild(icone(ICONES.seta));
    btn.setAttribute('aria-expanded', aberto ? 'true' : 'false');
    btn.setAttribute('aria-controls', idTrechos);
    acao.appendChild(btn);
    cabeca.appendChild(acao);
    caixa.appendChild(cabeca);

    const painel = criar('div', 'an-comp-trechos');
    painel.id = idTrechos;
    painel.hidden = !aberto;
    comp.trechos.forEach(function (trecho) { painel.appendChild(desenharTrecho(trecho)); });
    caixa.appendChild(painel);
    caixa.setAttribute('data-aberto', aberto ? 'sim' : 'nao');

    btn.addEventListener('click', function () {
      const abrindo = painel.hidden;
      painel.hidden = !abrindo;
      btn.setAttribute('aria-expanded', abrindo ? 'true' : 'false');
      btn.firstChild.textContent = abrindo
        ? 'Esconder trechos'
        : 'Ver trechos (' + comp.trechos.length + ')';
      caixa.setAttribute('data-aberto', abrindo ? 'sim' : 'nao');
      if (abrindo) estado.abertos.add(comp.def.numero);
      else estado.abertos.delete(comp.def.numero);
      anunciar(abrindo
        ? 'Trechos do compromisso ' + comp.def.numero + ' abertos.'
        : 'Trechos do compromisso ' + comp.def.numero + ' fechados.');
    });
  } else {
    caixa.appendChild(cabeca);
  }

  return caixa;
}

function desenharCompromissos(leitura) {
  const carta = criar('div', 'carta an-bloco an-bloco-medido');

  const avaliados = leitura.compromissos.filter(function (c) { return c.avaliado; }).length;
  carta.appendChild(cabecaDeBloco('medido', 'Os 8 compromissos do treinamento',
    'Cada linha é um compromisso do checklist final, medido sobre as conversas do período. '
    + avaliados + ' de 8 têm trecho que sustente o resultado; os outros ficam como sem base '
    + 'suficiente, sem virar nota.',
    ICONES.lista));

  const lista = criar('div', 'an-comps');
  leitura.compromissos.forEach(function (comp, indice) {
    lista.appendChild(desenharCompromisso(comp, indice));
  });
  carta.appendChild(lista);
  return carta;
}

/* ═════════════════════════ 14. CONVERSÃO ════════════════════════════════
   Medição, não avaliação: por onde cada conversa do período passou e onde
   parou, lido só do WhatsApp. A plataforma não vê a agenda nem o caixa — por
   isso "acontece" é "o tutor confirmou", nunca "pagou". Sem `funil` na
   resposta, nada disto é desenhado. Os ouvintes daqui vivem nos nós que
   `desenhar()` remove; não há timer novo.
   ════════════════════════════════════════════════════════════════════════ */

/** Um dos três destinos: número, percentual e a descrição que o servidor deu. */
function desenharDestino(item) {
  const caixa = criar('div', 'an-destino');
  caixa.setAttribute('data-tom', item.def.tom);
  caixa.appendChild(criar('span', 'an-destino-nome', item.def.rotulo));

  const linha = criar('div', 'an-destino-linha');
  const valor = criar('span', 'an-destino-valor numero');
  if (item.quantidade === null) {
    caixa.setAttribute('data-vazio', 'sim');
    valor.textContent = TRACINHO;
    caixa.title = 'A API não devolveu esta contagem no período. Não é zero: é ausência de medida.';
  }
  linha.appendChild(valor);
  if (item.pct !== null) {
    linha.appendChild(criar('span', 'an-destino-pct', formatarPorcentagem(item.pct, 0)));
  } else if (item.quantidade !== null) {
    caixa.title = 'O total do funil não veio na resposta; sem ele não há percentual.';
  }
  caixa.appendChild(linha);
  if (item.quantidade !== null) animarNumero(valor, item.quantidade, 'contagem');

  caixa.appendChild(criar('p', 'an-destino-texto',
    item.textos.length ? item.textos.join(' · ') : item.def.explica));
  return caixa;
}

/** Um estágio do funil: rótulo legível, quantas chegaram e a barra sobre o total. */
function desenharEstagio(estagio, destaque) {
  const caixa = criar('div', 'an-estagio');
  if (destaque) caixa.setAttribute('data-queda', 'sim');

  const topo = criar('div', 'an-estagio-topo');
  topo.appendChild(criar('span', 'an-estagio-nome', estagio.rotulo));
  const valor = criar('span', 'an-estagio-valor numero');
  if (estagio.alcancaram === null) {
    valor.textContent = TRACINHO;
    valor.title = 'A API não devolveu quantas conversas chegaram a este estágio. Não é zero: é ausência de medida.';
  } else {
    valor.textContent = formatarNumero(estagio.alcancaram);
  }
  topo.appendChild(valor);
  if (estagio.pct !== null) {
    topo.appendChild(criar('span', 'an-estagio-pct', formatarPorcentagem(estagio.pct, 0)));
  }
  caixa.appendChild(topo);

  const rotulo = estagio.rotulo + ': '
    + (estagio.alcancaram === null ? 'sem medida' : formatarNumero(estagio.alcancaram) + ' conversas')
    + (estagio.pct !== null ? ' (' + formatarPorcentagem(estagio.pct, 0) + ' das que chegaram)' : '');
  caixa.appendChild(montarBarra(estagio.pct, null, destaque ? 'atencao' : null, rotulo));
  return caixa;
}

/** A frase do degrau em que o funil mais vaza. */
function desenharQueda(queda) {
  const faixa = criar('div', 'an-queda');
  faixa.setAttribute('role', 'note');
  faixa.appendChild(icone(ICONES.desce, 'an-queda-icone'));

  let frase = 'Onde o funil mais vaza: entre ' + queda.rotuloDe + ' e ' + queda.rotuloPara + '. ';
  if (queda.perdidos === null) {
    frase += 'A API não devolveu quantas conversas ficam nesse degrau.';
  } else {
    frase += formatarNumero(queda.perdidos)
      + (queda.perdidos === 1 ? ' conversa fica' : ' conversas ficam') + ' nesse degrau'
      + (queda.pct !== null
        ? ' — ' + formatarPorcentagem(queda.pct, 0) + ' das que tinham chegado a ' + queda.rotuloDe
        : '')
      + '.';
  }
  faixa.appendChild(criar('p', 'an-queda-texto', frase));
  return faixa;
}

/** Como chamar o caso: nome salvo, senão o telefone formatado, senão o identificador. */
function nomeDoCaso(caso) {
  if (caso.contato) return caso.contato;
  const tel = formatarTelefone(caso.telefone, '');
  if (tel) return tel;
  return 'conversa ' + caso.id;
}

/** Um caso parado: quem, há quanto tempo, onde parou, por quê — e o trecho com quem falou. */
function desenharCaso(caso) {
  const caixa = criar('div', 'an-caso');

  const cabeca = criar('div', 'an-caso-cabeca');
  const nome = criar('span', 'an-caso-nome', nomeDoCaso(caso));
  if (!caso.contato && caso.telefone) nome.title = 'Contato sem nome salvo; mostrando o telefone.';
  cabeca.appendChild(nome);
  if (caso.contato && caso.telefone) {
    cabeca.appendChild(criar('span', 'mono texto-3', formatarTelefone(caso.telefone)));
  }

  const parada = criar('span', 'an-caso-parada');
  parada.appendChild(icone(ICONES.relogio, 'an-caso-icone'));
  if (caso.paradaHoras === null) {
    parada.setAttribute('data-vazio', 'sim');
    parada.appendChild(criar('span', null, 'parada há ' + TRACINHO));
    parada.title = 'A API não devolveu há quanto tempo esta conversa está parada.';
  } else {
    parada.appendChild(criar('span', null, 'parada há ' + textoDeHoras(caso.paradaHoras)));
    if (caso.ultimaEm) parada.title = 'Última mensagem ' + formatarQuando(caso.ultimaEm) + '.';
  }
  cabeca.appendChild(parada);
  caixa.appendChild(cabeca);

  const linha = criar('div', 'an-caso-linha');
  if (caso.estagio) {
    const em = criar('span');
    em.appendChild(document.createTextNode('parou em '));
    em.appendChild(criar('b', null, caso.estagio));
    linha.appendChild(em);
  }
  if (caso.motivoTexto) linha.appendChild(criar('span', null, caso.motivoTexto));
  else if (caso.situacaoTexto) linha.appendChild(criar('span', null, caso.situacaoTexto));
  if (caso.mensagens !== null) {
    linha.appendChild(criar('span', null,
      formatarNumero(caso.mensagens) + (caso.mensagens === 1 ? ' mensagem' : ' mensagens')));
  }
  if (caso.primeiraRespostaMin !== null) {
    linha.appendChild(criar('span', null, 'primeira resposta em ' + formatarMinutos(caso.primeiraRespostaMin)));
  }
  if (caso.bola === 'clinica') linha.appendChild(selo('bola com a clínica', 'risco', true));
  else if (caso.bola === 'tutor') linha.appendChild(selo('bola com o tutor', 'atencao', true));
  if (linha.childNodes.length) caixa.appendChild(linha);

  if (caso.trecho) {
    caixa.appendChild(desenharTrecho(caso.trecho));
  } else {
    caixa.appendChild(criar('p', 'an-rodape-nota', caso.trechoRecusado
      ? 'O trecho desta conversa veio sem quem falou em cada mensagem e não é mostrado: citação sem '
        + 'autor não sustenta nada.'
      : 'O trecho desta conversa não veio na resposta. O caso fica na contagem, sem a conversa junto.'));
  }
  return caixa;
}

/** A lista de casos de uma dívida, em lotes: ninguém precisa de 200 trechos de uma vez. */
function desenharListaDeCasos(chave, casos) {
  const painel = criar('div', 'an-divida-casos');
  const lista = criar('div', 'an-casos');
  painel.appendChild(lista);

  let mais = null;
  function preencher() {
    const alvo = Math.min(casos.length, estado.casosVisiveis[chave] || CASOS_POR_LOTE);
    while (lista.children.length < alvo) {
      lista.appendChild(desenharCaso(casos[lista.children.length]));
    }
    const restam = casos.length - lista.children.length;
    if (mais) {
      mais.hidden = restam <= 0;
      if (restam > 0) {
        mais.firstChild.textContent = 'Mostrar mais ' + Math.min(restam, CASOS_POR_LOTE)
          + ' (' + formatarNumero(restam) + (restam === 1 ? ' restante)' : ' restantes)');
      }
    }
  }

  if (casos.length > CASOS_POR_LOTE) {
    mais = botao('btn btn-fantasma', 'Mostrar mais');
    mais.appendChild(icone(ICONES.seta));
    mais.addEventListener('click', function () {
      if (!estado) return;
      estado.casosVisiveis[chave] = Math.min(casos.length, lista.children.length + CASOS_POR_LOTE);
      preencher();
      anunciar('Mostrando ' + lista.children.length + ' de ' + casos.length + ' casos.');
    });
    painel.appendChild(mais);
  }
  preencher();
  return painel;
}

/** Um dos dois cartões de conversa parada, com o botão que abre os casos. */
function desenharDivida(divida) {
  const caixa = criar('div', 'an-divida');
  caixa.setAttribute('data-lado', divida.def.chave);

  const topo = criar('div', 'an-divida-topo');
  topo.appendChild(criar('span', 'an-divida-nome', divida.def.rotulo));
  const valor = criar('span', 'an-divida-valor numero');
  if (divida.quantidade === null) {
    caixa.setAttribute('data-vazio', 'sim');
    valor.textContent = TRACINHO;
    valor.title = 'A API não devolveu esta contagem no período. Não é zero: é ausência de medida.';
  }
  topo.appendChild(valor);
  caixa.appendChild(topo);
  if (divida.quantidade !== null) animarNumero(valor, divida.quantidade, 'contagem');

  const detalhes = criar('div', 'an-divida-detalhes');
  function detalhe(valorTexto, rotulo, dica, vazio) {
    const item = criar('span', 'an-divida-detalhe');
    item.appendChild(criar('b', null, valorTexto));
    item.appendChild(document.createTextNode(' ' + rotulo));
    if (vazio) item.title = 'A API não devolveu esta parte da contagem. Não é zero: é ausência de medida.';
    else if (dica) item.title = dica;
    detalhes.appendChild(item);
  }
  if (divida.def.chave === 'clinica') {
    detalhe(divida.semResposta === null ? TRACINHO : formatarNumero(divida.semResposta),
      'sem resposta', divida.textos.aguardando_clinica, divida.semResposta === null);
    detalhe(divida.semDirecao === null ? TRACINHO : formatarNumero(divida.semDirecao),
      'sem direção', divida.textos.sem_direcao, divida.semDirecao === null);
    detalhe(textoDeHoras(divida.horasMediana), 'parada, na mediana',
      'Metade dos casos está parada há mais tempo que isso.', divida.horasMediana === null);
  } else if (divida.textos.aguardando_tutor) {
    detalhes.appendChild(criar('span', 'an-divida-detalhe', divida.textos.aguardando_tutor));
  }
  if (detalhes.childNodes.length) caixa.appendChild(detalhes);

  caixa.appendChild(criar('p', 'an-divida-acao', divida.def.acao));

  const chave = 'funil-' + divida.def.chave;
  if (divida.casos.length) {
    const idPainel = 'an-casos-' + divida.def.chave;
    const aberto = estado.abertos.has(chave);
    const rotuloFechado = 'Ver os casos (' + formatarNumero(divida.casos.length) + ')';

    const btn = botao('btn', aberto ? 'Esconder os casos' : rotuloFechado);
    btn.appendChild(icone(ICONES.seta));
    btn.setAttribute('aria-expanded', aberto ? 'true' : 'false');
    btn.setAttribute('aria-controls', idPainel);
    caixa.appendChild(btn);

    const painel = desenharListaDeCasos(chave, divida.casos);
    painel.id = idPainel;
    painel.hidden = !aberto;
    caixa.appendChild(painel);
    caixa.setAttribute('data-aberto', aberto ? 'sim' : 'nao');

    btn.addEventListener('click', function () {
      if (!estado) return;
      const abrindo = painel.hidden;
      painel.hidden = !abrindo;
      btn.setAttribute('aria-expanded', abrindo ? 'true' : 'false');
      btn.firstChild.textContent = abrindo ? 'Esconder os casos' : rotuloFechado;
      caixa.setAttribute('data-aberto', abrindo ? 'sim' : 'nao');
      if (abrindo) estado.abertos.add(chave);
      else estado.abertos.delete(chave);
      anunciar((abrindo ? 'Casos abertos: ' : 'Casos fechados: ') + divida.def.rotulo + '.');
    });

    if (divida.quantidade !== null && divida.casos.length < divida.quantidade) {
      caixa.appendChild(criar('p', 'an-legenda',
        'A resposta trouxe ' + formatarNumero(divida.casos.length) + ' dos '
        + formatarNumero(divida.quantidade) + ' casos.'));
    }
  } else if (divida.quantidade === 0) {
    caixa.appendChild(criar('p', 'an-legenda', 'Nenhum caso no período.'));
  } else if (divida.quantidade !== null) {
    caixa.appendChild(criar('p', 'an-rodape-nota',
      'Os casos não vieram na resposta — a contagem fica sem a lista.'));
  }
  return caixa;
}

/** Motivos da trava em barras proporcionais ao total de travadas (ou ao maior motivo). */
function desenharMotivos(funil) {
  const lista = criar('div', 'an-motivos');

  const trava = funil.destinos.filter(function (d) { return d.def.chave === 'trava'; })[0];
  const baseTrava = trava && trava.quantidade ? trava.quantidade : null;
  let maior = null;
  funil.motivos.forEach(function (m) {
    if (m.quantidade !== null && (maior === null || m.quantidade > maior)) maior = m.quantidade;
  });
  const base = baseTrava !== null ? baseTrava : maior;

  funil.motivos.forEach(function (m) {
    const item = criar('div', 'an-motivo');
    const topo = criar('div', 'an-motivo-topo');
    topo.appendChild(criar('span', 'an-motivo-texto', m.texto));

    const valor = criar('span', 'an-motivo-valor numero');
    if (m.quantidade === null) {
      valor.textContent = TRACINHO;
      valor.title = 'A API não devolveu a quantidade deste motivo. Não é zero: é ausência de medida.';
    } else {
      valor.textContent = formatarNumero(m.quantidade);
    }
    topo.appendChild(valor);

    const pct = m.quantidade !== null && base ? (m.quantidade / base) * 100 : null;
    if (pct !== null && baseTrava !== null) {
      topo.appendChild(criar('span', 'an-motivo-pct', formatarPorcentagem(pct, 0) + ' das travadas'));
    }
    item.appendChild(topo);

    const rotulo = m.texto + ': '
      + (m.quantidade === null ? 'sem medida' : formatarNumero(m.quantidade) + ' conversas')
      + (pct !== null && baseTrava !== null ? ' (' + formatarPorcentagem(pct, 0) + ' das travadas)' : '');
    item.appendChild(montarBarra(pct, null, 'atencao', rotulo));
    lista.appendChild(item);
  });
  return lista;
}

function desenharConversao(leitura) {
  const funil = leitura.funil;
  const carta = criar('div', 'carta an-bloco an-bloco-medido');

  carta.appendChild(cabecaDeBloco('medido', 'Conversão',
    'Contado sobre '
    + (funil.total !== null ? 'as ' + formatarNumero(funil.total) + ' conversas' : 'as conversas')
    + ' do período: por onde cada uma passou e onde parou, lido só do WhatsApp. A plataforma '
    + 'não vê a agenda nem o caixa.',
    ICONES.funil));

  /* --- Os três destinos --- */
  const destinos = criar('div', 'grade an-destinos');
  funil.destinos.forEach(function (d) { destinos.appendChild(desenharDestino(d)); });
  carta.appendChild(destinos);

  const andando = criar('p', 'an-andando');
  const valorAndando = criar('span', 'an-andando-valor numero');
  if (funil.andando === null) {
    valorAndando.textContent = TRACINHO;
    andando.title = 'A API não devolveu quantas conversas ainda estão em andamento. Não é zero: é ausência de medida.';
  } else {
    valorAndando.textContent = formatarNumero(funil.andando);
  }
  andando.appendChild(valorAndando);
  andando.appendChild(criar('span', null,
    (funil.andando === 1 ? 'conversa em andamento' : 'conversas em andamento')
    + ' — mexeram nas últimas 24 h e ainda não têm destino.'));
  carta.appendChild(andando);

  carta.appendChild(criar('p', 'an-rodape-nota',
    '"Acontece" é a conversa que chegou a um próximo passo e o tutor confirmou. Não quer dizer que '
    + 'pagou: a plataforma lê o WhatsApp, não a agenda nem o caixa.'));

  carta.appendChild(criar('hr', 'separador'));

  /* --- O funil por estágio --- */
  carta.appendChild(criar('h3', null, 'Por onde as conversas passam'));
  if (funil.estagios.length) {
    const lista = criar('div', 'an-funil');
    funil.estagios.forEach(function (e) {
      const destaque = !!(funil.maiorQueda && funil.maiorQueda.chavePara === e.chave);
      lista.appendChild(desenharEstagio(e, destaque));
    });
    carta.appendChild(lista);
    if (funil.maiorQueda) carta.appendChild(desenharQueda(funil.maiorQueda));
  } else {
    carta.appendChild(criar('p', 'an-rodape-nota',
      'A API não devolveu os estágios do funil neste período — a barra por estágio fica de fora '
      + 'em vez de ser inventada.'));
  }

  carta.appendChild(criar('hr', 'separador'));

  /* --- De quem é o próximo passo --- */
  carta.appendChild(criar('h3', null, 'De quem é o próximo passo'));
  carta.appendChild(criar('p', 'an-bloco-nota',
    'Duas listas, duas ações diferentes: na primeira a recepção deve uma resposta; na segunda ela '
    + 'já respondeu e precisa retomar.'));
  const dividas = criar('div', 'grade an-dividas');
  funil.dividas.forEach(function (d) { dividas.appendChild(desenharDivida(d)); });
  carta.appendChild(dividas);

  carta.appendChild(criar('hr', 'separador'));

  /* --- Motivos da trava --- */
  carta.appendChild(criar('h3', null, 'Por que travam'));
  if (funil.motivos.length) {
    carta.appendChild(desenharMotivos(funil));
  } else {
    carta.appendChild(criar('p', 'an-rodape-nota',
      'A API não devolveu os motivos da trava neste período.'));
  }

  return carta;
}

/* ═════════════════════════ 15. BLOCO "AVALIAÇÃO DA DACO" ════════════════
   Borda quente e rótulo "avaliação": daqui para baixo é leitura da Daco sobre
   o que foi medido — prioridade, recomendação e a frase que a recepção usa.
   ════════════════════════════════════════════════════════════════════════ */

/** Copia para a área de transferência. Devolve true só quando de fato copiou. */
async function copiarTexto(texto) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch (e) {
    /* área de transferência bloqueada: tenta o caminho antigo */
  }
  try {
    const area = document.createElement('textarea');
    area.value = texto;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const deu = document.execCommand('copy');
    document.body.removeChild(area);
    return !!deu;
  } catch (e) {
    return false;
  }
}

/** Selo do impacto financeiro, como a API o declarou. */
function seloDoImpacto(impacto) {
  const peso = pesoDoImpacto(impacto);
  const tom = peso === 3 ? 'risco' : (peso === 2 ? 'atencao' : (peso === 1 ? 'neutro' : 'neutro'));
  return selo('impacto ' + String(impacto).toLowerCase(), tom, peso === 0);
}

function secaoDeTexto(rotulo, texto) {
  const caixa = criar('div', 'an-cor-secao');
  caixa.appendChild(criar('span', 'an-cor-rotulo', rotulo));
  caixa.appendChild(criar('p', 'an-cor-texto', texto));
  return caixa;
}

function desenharCorrecao(correcao, posicao) {
  const caixa = criar('div', 'an-cor');

  const cabeca = criar('div', 'an-cor-cabeca');
  cabeca.appendChild(criar('span', 'an-cor-ordem', String(posicao)));
  cabeca.appendChild(criar('h3', 'an-cor-titulo', correcao.titulo));
  if (correcao.impacto) cabeca.appendChild(seloDoImpacto(correcao.impacto));
  caixa.appendChild(cabeca);

  if (correcao.acontece) caixa.appendChild(secaoDeTexto('O que está acontecendo', correcao.acontece));
  if (correcao.fazer) caixa.appendChild(secaoDeTexto('O que fazer', correcao.fazer));

  if (correcao.indicador) {
    caixa.appendChild(criar('p', 'an-legenda', 'Sai do indicador: ' + correcao.indicador));
  }

  if (correcao.frase) {
    const frase = criar('div', 'an-frase');
    const texto = criar('p', 'an-frase-texto');
    texto.textContent = '“' + correcao.frase + '”';
    frase.appendChild(texto);

    const copiar = botao('btn', 'Copiar frase');
    copiar.appendChild(icone(ICONES.copiar));
    copiar.title = 'Copia a frase pronta para colar no WhatsApp da unidade.';
    copiar.addEventListener('click', async function () {
      const deu = await copiarTexto(correcao.frase);
      if (!estado) return;
      copiar.firstChild.textContent = deu ? 'Frase copiada' : 'Não consegui copiar';
      anunciar(deu
        ? 'Frase copiada para a área de transferência.'
        : 'Não consegui copiar; selecione a frase na tela e copie à mão.');
      const relogio = setTimeout(function () {
        if (copiar.firstChild) copiar.firstChild.textContent = 'Copiar frase';
      }, AVISO_COPIA_MS);
      aoLimparDesenho(function () { clearTimeout(relogio); });
    });
    frase.appendChild(copiar);

    caixa.appendChild(criar('span', 'an-cor-rotulo an-cor-rotulo-largo',
      'Frase pronta para a recepção usar'));
    caixa.appendChild(frase);
  } else {
    caixa.appendChild(criar('p', 'an-rodape-nota',
      'A API não enviou a frase pronta desta correção — e nenhuma foi escrita aqui no lugar dela.'));
  }

  return caixa;
}

function desenharAvaliacao(leitura) {
  const carta = criar('div', 'carta an-bloco an-bloco-avaliacao');

  const temOrdem = leitura.correcoes.some(function (c) { return c.peso > 0; });
  carta.appendChild(cabecaDeBloco('avaliacao', 'Avaliação da Daco',
    'Leitura da Daco sobre o que foi medido acima. As correções vêm em ordem de impacto '
    + 'financeiro' + (temOrdem ? '' : ' — nesta resposta o servidor não declarou o impacto de cada '
      + 'uma, então vale a ordem em que ele as mandou') + '.',
    ICONES.selo));

  if (!leitura.correcoes.length) {
    carta.appendChild(blocoVazio(ICONES.selo, 'Nenhuma correção veio para este período',
      'O servidor devolveu a análise sem lista de correções. Pode ser que os indicadores do '
      + 'período estejam dentro das metas, ou que a avaliação ainda não tenha sido fechada. '
      + 'Nenhuma recomendação foi escrita aqui para ocupar o espaço.'));
    return carta;
  }

  const lista = criar('div', 'an-cors');
  leitura.correcoes.forEach(function (correcao, i) {
    lista.appendChild(desenharCorrecao(correcao, i + 1));
  });
  carta.appendChild(lista);
  return carta;
}

/* ═════════════════════════ 16. TEMPERATURA DOS LEADS ════════════════════
   A proporção é medida. O sinal de cada faixa é a definição do treinamento; o
   passo é o ponto do 5C que a faixa cobra. Nada além disso é acrescentado.
   ════════════════════════════════════════════════════════════════════════ */

function desenharFaixaDeTemperatura(faixa, total) {
  const caixa = criar('div', 'an-temp');
  caixa.setAttribute('data-faixa', faixa.def.chave);

  const topo = criar('div', 'an-temp-topo');
  topo.appendChild(criar('span', 'an-temp-nome', faixa.def.rotulo));

  const valor = criar('span', 'an-temp-valor numero');
  if (faixa.pct === null) {
    valor.textContent = TRACINHO;
    caixa.title = 'A API não devolveu a proporção desta faixa. Não é zero: é ausência de medida.';
  }
  topo.appendChild(valor);
  caixa.appendChild(topo);
  if (faixa.pct !== null) animarNumero(valor, faixa.pct, 'pct');

  if (faixa.quantidade !== null) {
    caixa.appendChild(criar('p', 'an-temp-linha',
      formatarNumero(faixa.quantidade) + (faixa.quantidade === 1 ? ' lead' : ' leads')
      + (total ? ' de ' + formatarNumero(total) + ' classificados' : '')));
  }

  caixa.appendChild(criar('p', 'an-temp-linha', faixa.def.sinal));
  caixa.appendChild(criar('p', 'an-temp-passo', faixa.exige || faixa.def.passo));
  return caixa;
}

function desenharTemperatura(leitura) {
  const carta = criar('div', 'carta an-bloco an-bloco-medido');

  carta.appendChild(cabecaDeBloco('medido', 'Temperatura dos leads',
    'Proporção medida no período. O sinal de cada faixa é o do treinamento; a linha em destaque '
    + 'é o passo do 5C (Conectar, Coletar, Contextualizar, Converter, Continuar) que a faixa cobra.',
    ICONES.termometro));

  if (!leitura.temperatura) {
    carta.appendChild(blocoVazio(ICONES.termometro, 'Os leads do período não vieram classificados por temperatura',
      'A API devolveu a análise sem a separação entre frio, morno e quente. Ela depende dos '
      + 'contatos classificados no período: sem isso, a proporção não é calculada — e não é '
      + 'estimada aqui.'));
    return carta;
  }

  const temp = leitura.temperatura;

  /* Barra empilhada: só entra fatia com proporção medida. */
  const temProporcao = temp.faixas.some(function (f) { return f.pct !== null; });
  if (temProporcao) {
    const barra = criar('div', 'an-temp-barra');
    barra.setAttribute('role', 'img');
    barra.setAttribute('aria-label', 'Proporção dos leads: ' + temp.faixas.map(function (f) {
      return f.def.rotulo + ' ' + formatarPorTipo(f.pct, 'pct');
    }).join(', ') + '.');

    temp.faixas.forEach(function (faixa) {
      if (faixa.pct === null) return;
      const fatia = criar('span', 'an-temp-fatia');
      fatia.setAttribute('data-faixa', faixa.def.chave);
      const largura = Math.max(0, Math.min(100, faixa.pct)) + '%';
      if (movimentoReduzido() || typeof window.requestAnimationFrame !== 'function') {
        fatia.style.width = largura;
      } else {
        const id = window.requestAnimationFrame(function () { fatia.style.width = largura; });
        aoLimparDesenho(function () {
          window.cancelAnimationFrame(id);
          fatia.style.width = largura;
        });
      }
      barra.appendChild(fatia);
    });
    carta.appendChild(barra);
  }

  const grade = criar('div', 'grade an-temps');
  temp.faixas.forEach(function (faixa) {
    grade.appendChild(desenharFaixaDeTemperatura(faixa, temp.total));
  });
  carta.appendChild(grade);

  if (temp.total !== null) {
    carta.appendChild(criar('p', 'an-legenda', 'Base da proporção: '
      + formatarNumero(temp.total) + ' leads classificados no período.'));
  }
  return carta;
}

/* ═════════════════════════ 17. COMPARAÇÃO COM A REDE ════════════════════
   Sempre contra a referência agregada. Nenhuma outra unidade é citada — nem
   como exemplo, nem como comparação (seção 1 do contrato).
   ════════════════════════════════════════════════════════════════════════ */

function desenharLinhaDaRede(linha) {
  const item = criar('div', 'an-rede-item');
  item.setAttribute('data-tom', linha.melhor ? 'ok' : 'atencao');

  item.appendChild(icone(linha.acima ? ICONES.sobe : ICONES.desce, 'an-rede-icone'));

  const texto = criar('div', 'an-rede-texto');
  texto.appendChild(criar('span', 'an-rede-nome', linha.def.rotulo));
  texto.appendChild(criar('span', 'an-rede-numeros',
    formatarPorTipo(linha.valor, linha.def.formato)
    + ' · referência ' + formatarPorTipo(linha.referencia, linha.def.formato)
    + ' (' + linha.rotuloRef + ')'));
  texto.appendChild(criar('span', 'an-rede-leitura',
    'O indicador ' + (linha.acima ? linha.def.acima : linha.def.abaixo) + '.'));
  item.appendChild(texto);
  return item;
}

function grupoDaRede(titulo, linhas) {
  const grupo = criar('div', 'an-rede-grupo');
  const cabeca = criar('h3', null, titulo);
  grupo.appendChild(cabeca);
  linhas.forEach(function (linha) { grupo.appendChild(desenharLinhaDaRede(linha)); });
  return grupo;
}

function desenharRede(leitura) {
  const carta = criar('div', 'carta an-bloco an-bloco-medido');

  const doPainel = leitura.comparacao.some(function (l) { return l.fonte === 'painel'; });
  carta.appendChild(cabecaDeBloco('medido', 'Onde esta unidade está acima e abaixo da rede',
    'Comparação contra a referência agregada da rede. Nenhuma outra unidade é citada aqui.',
    ICONES.rede));

  if (!leitura.comparacao.length) {
    carta.appendChild(blocoVazio(ICONES.rede, 'A referência da rede não veio para este período',
      'Sem o valor agregado da rede, comparar seria inventar um ponto de apoio. A comparação '
      + 'volta assim que a API devolver a referência junto com a análise.'));
    return carta;
  }

  const acima = leitura.comparacao.filter(function (l) { return l.acima === true; });
  const abaixo = leitura.comparacao.filter(function (l) { return l.acima === false; });
  const iguais = leitura.comparacao.filter(function (l) { return l.acima === null; });

  const grade = criar('div', 'grade an-rede-grupos');
  if (acima.length) grade.appendChild(grupoDaRede('Acima da referência', acima));
  if (abaixo.length) grade.appendChild(grupoDaRede('Abaixo da referência', abaixo));
  carta.appendChild(grade);

  if (iguais.length) {
    const nomes = iguais.map(function (l) { return l.def.rotulo; }).join(', ');
    carta.appendChild(criar('p', 'an-rede-leitura', 'Empatado com a referência: ' + nomes + '.'));
  }

  if (doPainel) {
    carta.appendChild(criar('p', 'an-legenda',
      'Parte da referência veio do painel da rede, não desta análise: o recorte de tempo pode '
      + 'não ser o mesmo dos ' + estado.dias + ' dias avaliados aqui.'));
  }
  return carta;
}

/* ═════════════════════════ 18. INTERFACE DA TELA ════════════════════════ */

export const tela = {
  id: 'analise',
  titulo: 'Análise de Desempenho',
  icone: ICONES.analise,

  async montar(raiz, ctx) {
    instalarEstilo();
    estado = estadoNovo(raiz, ctx);

    montarArmacao(raiz);

    // A unidade pode trocar no seletor do topo sem remontar a tela.
    if (ctx && typeof ctx.aoTrocarUnidade === 'function') {
      const cancelar = ctx.aoTrocarUnidade(function () { aplicarUnidade(); });
      aoLimpar(cancelar);
    }

    desenhar();
    ligarAssinatura();
  },

  desmontar() {
    if (!estado) return;

    pararAssinatura();

    // Quadros de animação e timers do desenho que está na tela.
    rodarLimpezasDesenho();

    // Ouvintes e timers registrados ao longo da vida da tela.
    estado.limpezas.forEach(function (fn) {
      try { fn(); } catch (e) { console.error('[analise] falha ao limpar', e); }
    });
    estado.limpezas = [];

    estado.abertos = new Set();
    estado.casosVisiveis = {};
    estado.dados = null;
    estado.nos = {};
    estado = null;
  },
};
