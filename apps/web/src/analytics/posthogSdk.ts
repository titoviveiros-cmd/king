// O LADO DO SDK — carregado SOB DEMANDA, junto com o posthog-js, e só quando há configuração.
//
// Este arquivo é o único do KING que importa `posthog-js`, e ninguém o importa de forma estática:
// `posthog.ts` o traz por `import()` dinâmico. Resultado: a configuração, o filtro de saída e o
// SDK vivem num arquivo separado, que quem joga sem analytics configurado nunca baixa.
//
// QUAL SDK: `posthog-js/dist/module.slim.no-external`, na versão fixada no package.json. A
// variante slim traz só o núcleo (capturar e enviar); autocapture, gravação de sessão, surveys,
// heatmaps, web vitals, captura de exceções e toolbar são EXTENSÕES que ela não inclui e que aqui
// não são passadas. Quer dizer: além de desligadas na configuração, essas coletas não existem no
// código que roda. E a variante no-external não baixa script nenhum de terceiros depois.
//
// DUAS BARREIRAS DEPOIS DA NOSSA:
//   • a configuração (`configuracaoDoPostHog`) desliga tudo que é coleta automática, não pede
//     `/flags` (e com isso nenhuma configuração remota liga nada pelo painel) e não guarda
//     referrer nem parâmetros de campanha no aparelho;
//   • o `before_send` (`filtrarEventoDoPostHog`) reescreve o evento na saída: só os nossos
//     eventos, só as nossas propriedades revalidadas pelo esquema, e das propriedades do próprio
//     SDK só as técnicas — sem URL, sem referrer, sem propriedade de pessoa.
import posthog, { type CaptureResult, type PostHogConfig } from "posthog-js/dist/module.slim.no-external.js";
import { ESQUEMA, ESQUEMA_DO_CONTEXTO, aplicarEsquema, ehEvento, type Evento } from "./analytics.js";
import type { ClientePostHog } from "./posthog.js";

/**
 * Propriedades do PRÓPRIO SDK que sobrevivem ao `before_send`. São as que o PostHog precisa para
 * funcionar (token, id anônimo, sessão, deduplicação) e as técnicas que respondem pergunta de
 * produto sem identificar ninguém (sistema, navegador, tipo de aparelho). Todo o resto some —
 * em especial `$current_url`, `$referrer`, `$pathname`, `$host` e os `$initial_*`.
 */
export const PROPRIEDADES_DO_SDK = [
  "token",
  "distinct_id",
  "$device_id",
  "$session_id",
  "$window_id",
  "$insert_id",
  "$time",
  "$lib",
  "$lib_version",
  "$is_identified",
  "$os",
  "$os_version",
  "$browser",
  "$browser_version",
  "$device_type",
] as const;

/** Parâmetros de URL que, se aparecerem, o SDK mascara até no que guarda no próprio aparelho. */
export const PARAMETROS_MASCARADOS = [
  "nick", "apelido", "nome", "name", "email", "telefone", "phone", "cpf",
  "codigo", "code", "sala", "room", "token", "access_token", "refresh_token", "recovery",
];

/**
 * A última barreira, rodando DENTRO do SDK, no instante de enviar.
 *
 * Evento que não é nosso (`$pageview`, `$identify`, `$autocapture`, `$exception`, `$web_vitals`,
 * `$snapshot`, …) não sai. Evento nosso sai reconstruído do zero: propriedades técnicas do SDK
 * da lista acima, mais as nossas, revalidadas pelo esquema do evento e do contexto. `$set`,
 * `$set_once` e `$unset` somem, e `$process_person_profile` é sempre falso: nenhum perfil de
 * pessoa nasce destes eventos, mesmo que alguém um dia chame `identify` por engano.
 */
export function filtrarEventoDoPostHog(ev: CaptureResult | null): CaptureResult | null {
  try {
    if (!ev || !ehEvento(ev.event)) return null;
    const original = (ev.properties ?? {}) as Record<string, unknown>;
    const propriedades: Record<string, unknown> = {};
    for (const k of PROPRIEDADES_DO_SDK) {
      if (Object.prototype.hasOwnProperty.call(original, k)) propriedades[k] = original[k];
    }
    // `?? {}` de propósito: quem barra evento alheio é o `ehEvento` acima, e só ele. Sem isto, um
    // `$pageview` que escapasse do guarda ainda morreria por acidente (exceção aqui dentro), e a
    // proteção explícita não teria teste capaz de acusar a falta dela.
    const esquema = ESQUEMA[ev.event as Evento] ?? {};
    Object.assign(
      propriedades,
      aplicarEsquema(ESQUEMA_DO_CONTEXTO, soDoEsquema(original, ESQUEMA_DO_CONTEXTO), "contexto (saída)"),
      aplicarEsquema(esquema, soDoEsquema(original, esquema), `${ev.event} (saída)`),
    );
    propriedades.$process_person_profile = false;
    return { uuid: ev.uuid, event: ev.event, properties: propriedades, timestamp: ev.timestamp };
  } catch {
    return null; // na dúvida, não sai
  }
}

/** Separa as chaves que o esquema conhece — as do SDK não são "chave fora do esquema" nossa. */
function soDoEsquema(props: Record<string, unknown>, esquema: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const k of Object.keys(esquema)) if (Object.prototype.hasOwnProperty.call(props, k)) r[k] = props[k];
  return r;
}

/**
 * A configuração, explícita opção por opção. Cada nome foi conferido no tipo `PostHogConfig` da
 * versão instalada — e o TypeScript recusa qualquer nome que não exista nele.
 */
export function configuracaoDoPostHog(host: string): Partial<PostHogConfig> {
  return {
    api_host: host,
    // coleta automática: nenhuma
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    rageclick: false,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    capture_performance: false,
    capture_exceptions: false,
    disable_scroll_properties: true,
    // produtos que não usamos nesta fase
    disable_session_recording: true,
    disable_surveys: true,
    disable_surveys_automatic_display: true,
    disable_product_tours: true,
    disable_conversations: true,
    disable_web_experiments: true,
    // nada de fora: nem script externo, nem `/flags` (e, com ele, nenhuma config remota)
    disable_external_dependency_loading: true,
    advanced_disable_flags: true,
    advanced_disable_feature_flags: true,
    // anônimo: sem perfil de pessoa; id anônimo guardado só no localStorage, sem cookie
    person_profiles: "identified_only",
    persistence: "localStorage",
    save_referrer: false,
    save_campaign_params: false,
    // O SDK guarda a URL de entrada no localStorage (propriedades da sessão). Nada dela é enviado
    // — o before_send derruba —, mas também não precisa ficar gravado no aparelho: os ids de
    // clique (gclid, fbclid…) e os parâmetros que carregariam pessoa ou sala saem mascarados.
    mask_personal_data_properties: true,
    custom_personal_data_properties: PARAMETROS_MASCARADOS,
    // cada evento sai na hora: são poucos por sessão, e no celular o app pode ir para segundo
    // plano antes de um lote completar
    request_batching: false,
    before_send: filtrarEventoDoPostHog,
    debug: false,
  };
}

/** A interface mínima do SDK que este arquivo usa. Sem `identify`, `alias` nem `group`. */
export interface SdkPostHog {
  init(token: string, config: Partial<PostHogConfig>): unknown;
  capture(evento: string, propriedades?: Record<string, unknown>): unknown;
}

/**
 * Inicia o SDK com a configuração do KING e devolve só o `capture`. Recebe o SDK como parâmetro
 * para que os testes provem o contrato sem rede; em produção é sempre a instância do posthog-js.
 */
export function abrirPostHog(chave: string, host: string, sdk: SdkPostHog = posthog as unknown as SdkPostHog): ClientePostHog {
  sdk.init(chave, configuracaoDoPostHog(host));
  return { capture: (evento, propriedades) => { sdk.capture(evento, propriedades); } };
}
