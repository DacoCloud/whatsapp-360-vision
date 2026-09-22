-- =============================================================================
-- Leads capturados dos grupos de WhatsApp — projeto meiolvmwmoyzkxrcxstg
--
-- Colar inteiro no SQL Editor do Supabase (é DDL: a service_role não faz).
--
-- Dois formatos chegam nos grupos e a ingestão normaliza os dois:
--   'ghl'    → "🔥 Novo Lead cadastrado!"  (GoHighLevel: Nome, Pet, Interesse, WhatsApp)
--   'agente' → "*Cliente pronto para atendimento* 📢" (a IA passando para a recepção)
--
-- A mensagem de grupo NUNCA entra em `mensagens`/`conversas`: aqui é outra
-- tabela, para não sujar o tempo de resposta nem a conversão.
-- =============================================================================

create table if not exists leads (
  id            uuid primary key default gen_random_uuid(),
  unidade_id    uuid not null references unidades(id),
  unidade_slug  text not null,
  origem        text not null check (origem in ('ghl', 'agente')),
  stevo_id      text unique,               -- id da mensagem no grupo: evita gravar duas vezes
  grupo_jid     text,
  recebido_em   timestamptz not null,
  tutor         text,
  pet           text,
  interesse     text,
  telefone      text,                      -- só dígitos, com 55
  resumo        text,                      -- só no formato do agente
  texto_bruto   text not null,
  criado_em     timestamptz not null default now()
);

create index if not exists leads_unidade_recebido_idx on leads (unidade_id, recebido_em desc);
create index if not exists leads_telefone_idx on leads (telefone);

alter table leads enable row level security;   -- sem policy: só a service_role entra

-- Gravação usada pela ingestão. Resolve a unidade pelo nome da instância,
-- igual à ingerir_mensagem, e ignora repetição pelo stevo_id.
create or replace function gravar_lead(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_unidade unidades%rowtype;
  v_id uuid;
begin
  select * into v_unidade from unidades where stevo_instance_name = p->>'instancia';
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'instancia sem unidade', 'instancia', p->>'instancia');
  end if;

  insert into leads (unidade_id, unidade_slug, origem, stevo_id, grupo_jid, recebido_em,
                     tutor, pet, interesse, telefone, resumo, texto_bruto)
  values (v_unidade.id, v_unidade.slug, p->>'origem', p->>'stevo_id', p->>'grupo',
          (p->>'recebido_em')::timestamptz,
          nullif(p->>'tutor', ''), nullif(p->>'pet', ''), nullif(p->>'interesse', ''),
          nullif(regexp_replace(coalesce(p->>'telefone', ''), '\D', '', 'g'), ''),
          nullif(p->>'resumo', ''), p->>'texto')
  on conflict (stevo_id) do nothing
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'duplicado', v_id is null, 'unidade', v_unidade.slug);
end;
$$;

revoke execute on function gravar_lead(jsonb) from public, anon, authenticated;

-- confere na hora
select count(*) as leads_gravados from leads;
