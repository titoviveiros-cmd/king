-- ROLLBACK de 20261025120000_cadastro_so_convidado.sql
--
-- ORDEM OBRIGATÓRIA:
--   1. No painel do Supabase: Authentication → Hooks → "Before User Created" → DESLIGAR.
--   2. Só então rodar este arquivo.
--
-- Ao contrário, o Auth chamaria uma função que não existe mais e TODO cadastro falharia — inclusive
-- o do convidado. Nenhum usuário, perfil ou progresso é tocado por este arquivo.
drop function if exists public.king_antes_de_criar_usuario(jsonb);
