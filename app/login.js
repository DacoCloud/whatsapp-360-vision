/**
 * Telas de entrada — login e carregamento.
 *
 * Réplica do mockup aprovado: coluna escura à esquerda com a marca e os campos,
 * foto à direita. Depois que a credencial passa, entra a tela de carregamento
 * (foto inteira, degradê quente, logo pulsando) e só então a casca aparece.
 *
 * O módulo não sabe para onde vai depois: chama ctx.irPara() e a casca decide,
 * inclusive respeitando um link que a pessoa tentou abrir antes de entrar.
 */

import { api, ErroApi } from './dados.js';

const IMG = 'app/img/';
const RODAPE = 'Software desenvolvido pela Daco Vet em parceria com Apaixonados Por Quatro Patas.';

/* Quanto a tela de carregamento fica no mínimo, para não dar um susto de
   piscada, e o teto depois do qual a espera vira mensagem de erro. */
const CARREGANDO_MIN_MS = 700;
const CARREGANDO_MAX_MS = 12000;

/* Depois disso a tela para de repetir "confira os dados" e manda falar com a
   Daco — quem errou três vezes normalmente não lembra a senha, não digitou mal. */
const TENTATIVAS_ATE_AVISAR = 3;

let estilosInjetados = false;
let tentativas = 0;

/* --------------------------------------------------------------------------
   Estilos do módulo. Prefixo lg- em tudo; tokens e componentes vêm do tema.
   -------------------------------------------------------------------------- */
const CSS = `
/* A foto ocupa a tela inteira. A sombra (.lg-foto) sai da esquerda quase preta
   e vai sumindo até o meio; o texto e os campos ficam por cima dela, e a foto
   continua aparecendo por trás dos campos, como no mockup. */
.lg-tela {
  position: relative;
  display: block;
  min-height: 100dvh;
  background-color: #2A1E08;
  background-size: cover;
  background-position: 62% center;
  overflow: hidden;
}

/* ---- coluna da esquerda, por cima da sombra ---- */
.lg-lado {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(22px, 3.4vh, 40px);
  width: min(100%, 880px);
  min-height: 100dvh;
  padding: clamp(28px, 4.5vw, 64px) clamp(24px, 4vw, 60px);
  padding-bottom: clamp(84px, 11vh, 120px);
}
.lg-marca { display: flex; align-items: center; gap: 12px; }
/* O logo da rede no tamanho do mockup: grande, sem ser tímido. */
.lg-marca img { height: clamp(72px, 8vw, 128px); width: auto; display: block; filter: drop-shadow(0 6px 18px rgba(0,0,0,.35)); }
.lg-marca-vazia {
  font-family: var(--marca, "Outfit", system-ui, sans-serif);
  font-weight: 800; letter-spacing: -.02em; color: var(--verde);
  font-size: 20px; line-height: 1.1;
}

.lg-titulo {
  font-family: var(--disp, "Sora", system-ui, sans-serif);
  font-weight: 700;
  font-size: clamp(38px, 6.2vw, 78px);
  line-height: .98;
  letter-spacing: -.035em;
  color: var(--tinta);
  margin: 0;
}
/* Duas linhas fixas, como no mockup: "WhatsApp" em cima, "360° Vision" embaixo.
   A segunda não pode quebrar sozinha em coluna estreita. */
.lg-titulo span { display: block; }
.lg-titulo span span { display: inline; }
.lg-titulo .lg-linha2 { white-space: nowrap; }
.lg-titulo .lg-ouro { color: var(--ouro); }

.lg-boas-vindas {
  display: inline-flex; align-items: center; justify-content: center;
  align-self: flex-start;
  min-width: min(330px, 100%);
  padding: 18px 48px;
  border-radius: var(--r-p, 12px);
  background: linear-gradient(180deg, #C8202A 0%, #9E1119 100%);
  border: 1px solid rgba(255,255,255,.10);
  box-shadow: 0 10px 26px rgba(160,18,26,.28);
  color: #fff;
  font-family: var(--disp, "Sora", system-ui, sans-serif);
  font-weight: 600; font-size: 19px; letter-spacing: -.01em;
}

.lg-campos { display: flex; flex-direction: column; gap: 18px; max-width: min(800px, 100%); }

/* Campos do mockup: faixa translúcida azul-marinho por cima da foto (a pata do
   tapete aparece atrás), rótulo em caixa normal do lado esquerdo, altura alta. */
.lg-campos .campo {
  flex-direction: row;
  align-items: center;
  gap: 14px;
  min-height: 78px;
  padding: 0 30px;
  background: rgba(26, 30, 74, .62);
  border: 1px solid rgba(255, 255, 255, .06);
  border-radius: 16px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.06), 0 14px 30px rgba(0,0,0,.25);
}
.lg-campos .campo:focus-within {
  background: rgba(26, 30, 74, .78);
  border-color: rgba(123, 123, 234, .55);
}
.lg-campos .campo-rotulo {
  font-size: 22px;
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
  color: rgba(255, 255, 255, .92);
  white-space: nowrap;
}
.lg-campos .campo input { font-size: 20px; font-weight: 600; min-height: 30px; }

.lg-linha-extra { display: flex; gap: 40px; max-width: min(800px, 100%); flex-wrap: wrap; }

/* Os dois quadradinhos vermelhos do mockup: um é caixa de marcação de verdade,
   o outro é botão. Ambos operáveis por teclado. */
.lg-quadrado {
  flex: 0 0 auto;
  display: flex; align-items: center; gap: 16px;
  padding: 6px 4px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: transparent;
  color: rgba(255,255,255,.95);
  font-size: 22px; font-weight: 500;
  cursor: pointer;
  transition: background var(--rapido, 180ms) var(--curva, cubic-bezier(.22,.61,.36,1)),
              border-color var(--rapido, 180ms) var(--curva, cubic-bezier(.22,.61,.36,1)),
              color var(--rapido, 180ms) var(--curva, cubic-bezier(.22,.61,.36,1));
  text-align: left;
  font-family: inherit;
}
.lg-quadrado:hover { color: #fff; }
.lg-quadrado:hover .lg-caixa { filter: brightness(1.15); }
.lg-quadrado:focus-visible { outline: 2px solid var(--indigo-cl); outline-offset: 2px; }
.lg-caixa {
  width: 40px; height: 40px; flex: none;
  border-radius: 8px;
  background: linear-gradient(180deg, #C8202A 0%, #9E1119 100%);
  border: 1px solid rgba(255,255,255,.14);
  display: grid; place-items: center;
  color: #fff;
}
.lg-caixa svg { width: 20px; height: 20px; opacity: 0; transform: scale(.6); transition: opacity 140ms, transform 140ms; }
.lg-quadrado[aria-checked="true"] .lg-caixa svg { opacity: 1; transform: scale(1); }
.lg-quadrado[aria-checked="true"] { color: var(--tinta); border-color: rgba(200,32,42,.45); }

.lg-entrar { max-width: min(800px, 100%); min-height: 56px; font-size: 18px; }
.lg-erro { max-width: min(800px, 100%); }

/* rodapé no canto inferior esquerdo, alinhado com o texto, como no mockup */
.lg-rodape {
  position: absolute;
  left: clamp(24px, 4vw, 60px); right: 16px; bottom: 26px;
  text-align: left;
  font-size: 14px;
  color: rgba(255,255,255,.55);
  margin: 0;
  z-index: 3;
  pointer-events: none;
}

/* ---- a sombra ---- */
.lg-foto {
  position: absolute; inset: 0; z-index: 1;
  pointer-events: none;
  background:
    linear-gradient(90deg,
      rgba(4, 5, 9, .97) 0%,
      rgba(4, 5, 9, .93) 14%,
      rgba(4, 5, 9, .80) 28%,
      rgba(4, 5, 9, .52) 42%,
      rgba(4, 5, 9, .18) 54%,
      rgba(4, 5, 9, 0) 64%),
    linear-gradient(180deg, rgba(4,5,9,.10) 0%, rgba(4,5,9,0) 30%, rgba(4,5,9,.28) 100%);
}

/* ---- carregamento ---- */
.lg-carregando {
  position: fixed; inset: 0; z-index: 60;
  display: grid; place-items: center;
  background-color: #E8A81E;
  background-size: cover; background-position: center;
  animation: lg-entra 320ms var(--curva, cubic-bezier(.22,.61,.36,1)) both;
}
.lg-carregando::before {
  content: "";
  position: absolute; inset: 0;
  background: linear-gradient(160deg, rgba(255,201,60,.82) 0%, rgba(232,138,20,.86) 55%, rgba(226,120,16,.90) 100%);
}
.lg-carregando-miolo {
  position: relative; z-index: 1;
  display: flex; flex-direction: column; align-items: center; gap: 22px;
  text-align: center; padding: 24px;
}
.lg-carregando img { width: clamp(120px, 18vw, 190px); height: auto; display: block; filter: drop-shadow(0 12px 28px rgba(80,40,0,.35)); }
.lg-carregando-texto {
  font-family: var(--disp, "Sora", system-ui, sans-serif);
  font-weight: 700; font-size: clamp(26px, 4vw, 44px);
  color: #fff; letter-spacing: -.02em;
  text-shadow: 0 2px 14px rgba(120,60,0,.35);
}
@keyframes lg-entra { from { opacity: 0; } to { opacity: 1; } }
@keyframes lg-pulso {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.06); }
}
@keyframes lg-sobe { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }

@media (prefers-reduced-motion: no-preference) {
  .lg-carregando img { animation: lg-pulso 1600ms ease-in-out infinite; }
  .lg-lado > * { animation: lg-sobe 420ms var(--curva, cubic-bezier(.22,.61,.36,1)) both; }
  .lg-lado > *:nth-child(2) { animation-delay: 60ms; }
  .lg-lado > *:nth-child(3) { animation-delay: 110ms; }
  .lg-lado > *:nth-child(4) { animation-delay: 160ms; }
  .lg-lado > *:nth-child(5) { animation-delay: 210ms; }
}

/* ---- celular: a mesma foto, com a sombra subindo de baixo ---- */
@media (max-width: 860px) {
  .lg-tela { background-position: 70% 20%; }
  .lg-foto {
    background:
      linear-gradient(180deg, rgba(4,5,9,.25) 0%, rgba(4,5,9,.55) 26%, rgba(4,5,9,.92) 48%, rgba(4,5,9,.97) 100%);
  }
  .lg-lado { padding: 24px 20px 96px; justify-content: flex-end; gap: 18px; width: 100%; }
  .lg-campos .campo { min-height: 64px; padding: 0 20px; }
  .lg-campos .campo-rotulo { font-size: 18px; }
  .lg-campos .campo input { font-size: 17px; }
  .lg-quadrado { font-size: 17px; gap: 12px; }
  .lg-caixa { width: 30px; height: 30px; }
  .lg-linha-extra { gap: 18px; }
  .lg-boas-vindas { padding: 14px 32px; font-size: 17px; min-width: 0; }
  .lg-rodape { font-size: 12px; left: 20px; bottom: 16px; }
}
@media (max-width: 420px) {
  .lg-linha-extra { flex-direction: column; gap: 10px; }
}
`;

function injetarEstilos() {
  if (estilosInjetados) return;
  const el = document.createElement('style');
  el.id = 'lg-estilos';
  el.textContent = CSS;
  document.head.appendChild(el);
  estilosInjetados = true;
}

/* --------------------------------------------------------------------------
   Ajudantes de DOM
   -------------------------------------------------------------------------- */
function criar(tag, classe, texto) {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (texto !== undefined && texto !== null) el.textContent = texto;
  return el;
}

/** Imagem que não deixa buraco: se o arquivo não existir, some e o degradê fica. */
function imagemOpcional(arquivo, alt, aoFalhar) {
  const img = criar('img');
  img.src = IMG + arquivo;
  img.alt = alt;
  img.decoding = 'async';
  img.addEventListener('error', function () {
    img.remove();
    if (aoFalhar) aoFalhar();
  });
  return img;
}

/** Fundo de foto aplicado só se a imagem carregar. */
function fundoOpcional(el, arquivo) {
  const teste = new Image();
  teste.addEventListener('load', function () {
    el.style.backgroundImage = 'url("' + IMG + arquivo + '")';
  });
  teste.src = IMG + arquivo;
}

const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5"/></svg>';

/** Campo com o rótulo dentro, no estilo do mockup. */
function montarCampo(id, rotulo, tipo, autocomplete) {
  const caixa = criar('label', 'campo');
  caixa.setAttribute('for', id);

  const rot = criar('span', 'campo-rotulo', rotulo);
  const input = criar('input');
  input.id = id;
  input.type = tipo;
  input.name = id;
  input.autocomplete = autocomplete;
  input.spellcheck = false;
  if (tipo === 'email') input.inputMode = 'email';

  caixa.appendChild(rot);
  caixa.appendChild(input);
  return { caixa: caixa, input: input };
}

/* --------------------------------------------------------------------------
   Tela
   -------------------------------------------------------------------------- */
export const tela = {
  id: 'login',
  titulo: 'Entrar',
  icone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></svg>',

  async montar(raiz, ctx) {
    injetarEstilos();
    this._ctx = ctx;
    this._vivo = true;
    this._timers = [];

    const tela = criar('div', 'lg-tela');

    /* ---------- esquerda ---------- */
    const lado = criar('div', 'lg-lado');

    const marca = criar('div', 'lg-marca');
    marca.appendChild(imagemOpcional('logo-apaixonados.png', 'Apaixonados Por Quatro Patas', function () {
      marca.appendChild(criar('div', 'lg-marca-vazia', 'Apaixonados\nPor Quatro Patas'));
    }));
    lado.appendChild(marca);

    const titulo = criar('h1', 'lg-titulo');
    titulo.appendChild(criar('span', null, 'WhatsApp'));
    const linha2 = criar('span', 'lg-linha2');
    linha2.appendChild(document.createTextNode('360° '));
    linha2.appendChild(criar('span', 'lg-ouro', 'Vision'));
    titulo.appendChild(linha2);
    lado.appendChild(titulo);

    lado.appendChild(criar('div', 'lg-boas-vindas', 'Bem-vindo!'));

    /* ---------- formulário ---------- */
    const forma = criar('form', 'lg-campos');
    forma.noValidate = true;

    const cLogin = montarCampo('lg-login', 'Login:', 'email', 'username');
    const cSenha = montarCampo('lg-senha', 'Senha:', 'password', 'current-password');
    forma.appendChild(cLogin.caixa);
    forma.appendChild(cSenha.caixa);

    const erro = criar('div', 'campo-erro lg-erro');
    erro.setAttribute('role', 'alert');
    erro.hidden = true;
    forma.appendChild(erro);

    const botao = criar('button', 'btn btn-primario lg-entrar', 'Entrar');
    botao.type = 'submit';
    forma.appendChild(botao);

    lado.appendChild(forma);

    /* ---------- lembrar / redefinir ---------- */
    const extra = criar('div', 'lg-linha-extra');

    const lembrar = criar('button', 'lg-quadrado');
    lembrar.type = 'button';
    lembrar.setAttribute('role', 'checkbox');
    lembrar.setAttribute('aria-checked', 'false');
    const caixaCheck = criar('span', 'lg-caixa');
    caixaCheck.innerHTML = CHECK;
    lembrar.appendChild(caixaCheck);
    lembrar.appendChild(criar('span', null, 'Lembrar de mim'));
    lembrar.addEventListener('click', function () {
      const agora = lembrar.getAttribute('aria-checked') !== 'true';
      lembrar.setAttribute('aria-checked', agora ? 'true' : 'false');
    });

    const redefinir = criar('button', 'lg-quadrado');
    redefinir.type = 'button';
    const caixaChave = criar('span', 'lg-caixa');
    caixaChave.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
      'stroke-linecap="round" aria-hidden="true" style="opacity:1;transform:none">' +
      '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9"/><path d="M17 6l2 2"/></svg>';
    redefinir.appendChild(caixaChave);
    redefinir.appendChild(criar('span', null, 'Redefinir senha'));
    redefinir.addEventListener('click', function () {
      mostrarErro(erro, 'A redefinição de senha é feita pela Daco. Fale com a equipe para receber uma nova.', 'aviso');
    });

    extra.appendChild(lembrar);
    extra.appendChild(redefinir);
    lado.appendChild(extra);

    /* ---------- direita ---------- */
    // A foto ocupa a tela inteira; `.lg-foto` é só a sombra que sai da esquerda
    // e vai sumindo até o meio, como no mockup.
    fundoOpcional(tela, 'login.webp');
    const foto = criar('div', 'lg-foto');

    tela.appendChild(lado);
    tela.appendChild(foto);
    tela.appendChild(criar('p', 'lg-rodape', RODAPE));
    raiz.appendChild(tela);

    /* ---------- comportamento ---------- */
    const self = this;

    async function entrar(evento) {
      if (evento) evento.preventDefault();
      if (botao.disabled) return;

      const login = cLogin.input.value.trim();
      const senha = cSenha.input.value;
      if (!login || !senha) {
        mostrarErro(erro, 'Preencha o login e a senha para entrar.');
        (login ? cSenha : cLogin).input.focus();
        return;
      }

      erro.hidden = true;
      botao.disabled = true;
      botao.setAttribute('aria-busy', 'true');
      botao.textContent = 'Entrando…';

      try {
        await api.login(login, senha, lembrar.getAttribute('aria-checked') === 'true');
        tentativas = 0;
        if (!self._vivo) return;
        await self._carregar(raiz, ctx);
      } catch (e) {
        if (!self._vivo) return;
        tentativas++;
        botao.disabled = false;
        botao.removeAttribute('aria-busy');
        botao.textContent = 'Entrar';

        // Nunca dizer qual dos dois está errado: isso confirma um login válido
        // para quem estiver tentando adivinhar.
        let texto;
        if (e instanceof ErroApi && e.codigo === 'credencial_invalida') {
          texto = 'Login ou senha não conferem. Confira e tente de novo.';
        } else if (e && e.amigavel) {
          texto = e.amigavel;
        } else {
          texto = 'Não consegui entrar agora. Tente de novo em instantes.';
        }
        if (tentativas >= TENTATIVAS_ATE_AVISAR) {
          texto = 'Login ou senha não conferem. Depois de três tentativas, o mais rápido ' +
                  'é pedir uma nova senha à Daco.';
        }
        mostrarErro(erro, texto);
        cSenha.input.select();
      }
    }

    forma.addEventListener('submit', entrar);
    this._entrar = entrar;

    // foco no primeiro campo, sem roubar a rolagem
    const t = setTimeout(function () { try { cLogin.input.focus({ preventScroll: true }); } catch (e) { cLogin.input.focus(); } }, 60);
    this._timers.push(t);
  },

  /** Tela de carregamento. Fica no mínimo o suficiente para não piscar. */
  async _carregar(raiz, ctx) {
    const capa = criar('div', 'lg-carregando');
    fundoOpcional(capa, 'recepcao-larga.webp');

    const miolo = criar('div', 'lg-carregando-miolo');
    // no carregamento é só a cabeça do cachorro, como no mockup
    miolo.appendChild(imagemOpcional('cachorro.png', ''));
    miolo.appendChild(criar('div', 'lg-carregando-texto', 'carregando…'));
    capa.appendChild(miolo);
    capa.setAttribute('role', 'status');
    capa.setAttribute('aria-live', 'polite');
    document.body.appendChild(capa);
    this._capa = capa;

    const comecou = Date.now();
    let falhou = null;

    // Puxa a visão geral já aqui: quando a casca montar, o painel abre cheio.
    try {
      await Promise.race([
        api.visaoGeral(),
        new Promise(function (_, rejeitar) {
          setTimeout(function () { rejeitar(new Error('demorou')); }, CARREGANDO_MAX_MS);
        }),
      ]);
    } catch (e) {
      falhou = e;
    }

    const resta = CARREGANDO_MIN_MS - (Date.now() - comecou);
    if (resta > 0) await new Promise(function (r) { setTimeout(r, resta); });
    if (!this._vivo) return;

    if (falhou) {
      // A credencial passou; quem não veio foram os dados. Dizer isso, em vez
      // de devolver a pessoa para o login como se a senha estivesse errada.
      miolo.textContent = '';
      const aviso = criar('div', 'aviso aviso-erro');
      aviso.appendChild(criar('strong', null, 'Entrei, mas os dados não vieram.'));
      aviso.appendChild(criar('span', null,
        ' O servidor do painel não respondeu a tempo. Isso não é a sua senha — é a conexão com o monitoramento.'));
      miolo.appendChild(aviso);
      const tentar = criar('button', 'btn btn-primario', 'Tentar de novo');
      const self = this;
      tentar.addEventListener('click', function () {
        capa.remove();
        self._capa = null;
        self._carregar(raiz, ctx);
      });
      miolo.appendChild(tentar);
      return;
    }

    capa.remove();
    this._capa = null;
    ctx.irPara('visao-geral');
  },

  desmontar() {
    this._vivo = false;
    (this._timers || []).forEach(clearTimeout);
    this._timers = [];
    if (this._capa) { this._capa.remove(); this._capa = null; }
    this._entrar = null;
    this._ctx = null;
  },
};

/** Mensagem abaixo dos campos. `tom` 'aviso' usa cor neutra em vez de erro. */
function mostrarErro(el, texto, tom) {
  el.textContent = texto;
  el.hidden = false;
  el.dataset.tom = tom || 'erro';
}
