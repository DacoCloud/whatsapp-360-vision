/**
 * Identidade desta instalação do painel.
 *
 * É o ÚNICO arquivo que muda entre o painel do dono da rede Apaixonados e o
 * painel interno da Daco. Todo o resto (casca, dados, WhatsApp, análise, leads,
 * preferências) é o mesmo código nos dois — por isso nada aqui pode ser lido
 * de dentro deles a não ser por este módulo.
 */

export const marca = {
  /** Nome do produto, usado no título da aba e na marca do trilho. */
  app: 'WhatsApp 360° Vision',

  /** Como o nome aparece no trilho, em duas partes. */
  appCurto: 'WhatsApp 360°',

  /** De quem é o painel. Vai como subtítulo, embaixo do nome. */
  dono: 'Apaixonados Por Quatro Patas',

  /** Assinatura no rodapé do trilho e das telas de entrada. */
  assinatura: 'Software desenvolvido pela Daco Vet em parceria com Apaixonados Por Quatro Patas.',
  assinaturaCurta: 'Software Daco Vet',

  /**
   * Escopo que este painel enxerga. O servidor decide pelo papel do token;
   * isto aqui é só para o texto da tela não mentir sobre o que está listando.
   */
  escopo: 'rede',
  escopoTexto: 'as unidades da rede',

  /**
   * Unidades com agente de IA, usado SÓ quando a API não manda
   * `tem_agente_ia`. A fonte de verdade é o servidor, que deriva isso dos
   * bancos de agente configurados.
   */
  marcasDeIa: ['botafogo', 'catete'],
};
