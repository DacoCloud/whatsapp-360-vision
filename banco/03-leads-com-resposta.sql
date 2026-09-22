-- =============================================================================
-- Cruzamento lead × conversas — aplicado em 22/09/2026 (migração leads_com_resposta)
--
-- Para cada lead: existe contato com aquele telefone na unidade? A clínica
-- falou depois da notificação? Em quantos minutos? O tutor voltou depois?
--
-- O treinamento pede contato em até 5 minutos; quem julga é a tela. Aqui só
-- se mede. Na resposta:
--   resposta.medido = true sempre (o cruzamento rodou)
--   resposta.respondido_em nulo + motivo 'sem_resposta'  → há conversa, ninguém falou depois do lead
--   resposta.respondido_em nulo + motivo 'sem_conversa'  → nunca houve mensagem com esse telefone
--
-- Formato do agente: a IA fala ANTES de avisar o grupo, então só conta saída
-- 20 s depois da notificação e, com autoria marcada, só 'humano'. GoHighLevel:
-- a abordagem pode anteceder o aviso por segundos — 2 min de tolerância.
-- =============================================================================

create or replace function leads_com_resposta(p_slug text default null, p_desde timestamptz default null, p_limite int default 300)
returns jsonb
language sql security definer set search_path = public
as $$
  with base as (
    select l.* from leads l
     where (p_slug is null or l.unidade_slug = p_slug)
       and (p_desde is null or l.recebido_em >= p_desde)
     order by l.recebido_em desc
     limit greatest(1, least(coalesce(p_limite, 300), 1000))
  ),
  cruz as (
    select b.id as lead_id,
           (select ct.id from contatos ct
             where ct.unidade_id = b.unidade_id and ct.telefone = b.telefone
             order by ct.primeiro_contato_em limit 1) as contato_id
      from base b
  ),
  resp as (
    select b.id as lead_id, c.contato_id,
      (select min(m.enviada_em)
         from mensagens m join conversas cv on cv.id = m.conversa_id
        where cv.contato_id = c.contato_id
          and m.direcao = 'saida'
          and (m.autor is null or m.autor = 'humano')
          and m.enviada_em >= case when b.origem = 'agente' then b.recebido_em + interval '20 seconds'
                                   else b.recebido_em - interval '2 minutes' end) as clinica_em,
      (select cv.id from conversas cv where cv.contato_id = c.contato_id
        order by cv.ultima_mensagem_em desc limit 1) as conversa_id
    from base b join cruz c on c.lead_id = b.id
  ),
  volta as (
    select r.lead_id,
      (select min(m.enviada_em)
         from mensagens m join conversas cv on cv.id = m.conversa_id
        where r.clinica_em is not null
          and cv.contato_id = r.contato_id
          and m.direcao = 'entrada'
          and m.enviada_em > r.clinica_em) as tutor_em
    from resp r
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'unidade_slug', b.unidade_slug, 'origem', b.origem, 'recebido_em', b.recebido_em,
    'tutor', b.tutor, 'pet', b.pet, 'interesse', b.interesse, 'telefone', b.telefone,
    'resumo', b.resumo, 'texto_bruto', b.texto_bruto, 'grupo_jid', b.grupo_jid,
    'contato_id', r.contato_id, 'conversa_id', r.conversa_id,
    'contato_encontrado', r.contato_id is not null,
    'resposta', jsonb_build_object(
       'medido', true,
       'respondido_em', r.clinica_em,
       'minutos', case when r.clinica_em is null then null
                       else round((greatest(0, extract(epoch from (r.clinica_em - b.recebido_em))) / 60)::numeric, 1) end,
       'autor', case when r.clinica_em is null then null else 'clinica' end,
       'motivo', case when r.contato_id is null then 'sem_conversa'
                      when r.clinica_em is null then 'sem_resposta' else null end,
       'tutor_respondeu', v.tutor_em is not null,
       'tutor_respondeu_em', v.tutor_em)
  ) order by b.recebido_em desc), '[]'::jsonb)
  from base b
  join resp r on r.lead_id = b.id
  join volta v on v.lead_id = b.id;
$$;

revoke execute on function leads_com_resposta(text, timestamptz, int) from public, anon, authenticated;

-- confere na hora
select leads_com_resposta(null, null, 5);
