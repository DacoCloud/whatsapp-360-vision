-- =============================================================================
-- Purga por dia — substitui a purga por ciclo (não há mais ciclos)
--
-- Colar inteiro no SQL Editor do Supabase (é DDL: a service_role não faz).
--
-- Regra: uma mensagem só pode ser apagada quando o DIA dela, naquela unidade,
-- já tem linha em `metricas_diarias` — ou seja, quando a camada fria daquele
-- dia já foi escrita. Dia sem métrica é preservado e contado na resposta, para
-- o vigia avisar em vez de apagar às cegas.
--
-- Quem chama é a manutenção do n8n, uma vez por dia, com 60 dias. Até esta
-- função existir, nada é apagado — o que é seguro, só não libera espaço.
-- =============================================================================

create or replace function purgar_por_dia(p_dias int default 60)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_limite     date := (now() at time zone 'America/Sao_Paulo')::date - p_dias;
  v_corte      timestamptz := (v_limite::timestamp at time zone 'America/Sao_Paulo');
  v_apagadas   bigint := 0;
  v_preservados int := 0;
begin
  -- dias (por unidade) anteriores ao corte que ainda não têm métrica: ficam
  select count(*) into v_preservados
    from (
      select distinct cv.unidade_id,
             (m.enviada_em at time zone 'America/Sao_Paulo')::date as dia
        from mensagens m
        join conversas cv on cv.id = m.conversa_id
       where m.enviada_em < v_corte
    ) d
   where not exists (
     select 1 from metricas_diarias md
      where md.unidade_id = d.unidade_id and md.dia = d.dia);

  with alvo as (
    select m.id
      from mensagens m
      join conversas cv on cv.id = m.conversa_id
     where m.enviada_em < v_corte
       and exists (
         select 1 from metricas_diarias md
          where md.unidade_id = cv.unidade_id
            and md.dia = (m.enviada_em at time zone 'America/Sao_Paulo')::date)
  ),
  del as (
    delete from mensagens where id in (select id from alvo) returning 1
  )
  select count(*) into v_apagadas from del;

  return jsonb_build_object(
    'corte', v_limite,
    'apagadas', v_apagadas,
    'dias_sem_metrica_preservados', v_preservados);
end;
$$;

revoke execute on function purgar_por_dia(int) from public, anon, authenticated;

-- ensaio sem apagar nada (hoje não há mensagem com mais de 60 dias)
select purgar_por_dia(60);
