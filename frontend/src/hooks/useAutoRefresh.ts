import { useEffect, useRef } from 'react';
import { DATA_CHANGED_EVENT } from '../api/client';

interface AutoRefreshOptions {
  /** Intervalo de polling em ms (usado só quando `enabled`). */
  pollMs?: number;
  /** Liga o polling (ex.: sync automático da Pluggy ativo). */
  enabled?: boolean;
  /** Callback do polling — permite atualização silenciosa (sem spinner). */
  onPoll?: () => void | Promise<void>;
}

/**
 * Executa `callback` no mount e toda vez que qualquer dado mudar em qualquer
 * tela (evento global `iasconta:data-changed` disparado pelo api client após
 * POST/PUT/DELETE). Garante que edições feitas em outro lugar (ex.: ChatBot,
 * outra aba da aplicação) reflitam na tela atual sem reload.
 *
 * Com `enabled` + `pollMs`, também busca em intervalo fixo — só com a aba
 * visível — usando `onPoll` (ou o próprio callback). Serve para o caso em que
 * os dados mudam no SERVIDOR sem ação do usuário: sync automático da Pluggy
 * (webhook). Sem o sync ativo não há motivo para polling, e ele fica desligado.
 */
export function useAutoRefresh(
  callback: () => void | Promise<void>,
  deps: unknown[] = [],
  options: AutoRefreshOptions = {}
) {
  const saved = useRef(callback);
  const polled = useRef(options.onPoll ?? callback);
  const { pollMs, enabled = false } = options;

  // Refs sincronizadas em efeito, nunca durante o render: React pode descartar
  // um render e o valor vazaria para o timer/handler.
  useEffect(() => {
    saved.current = callback;
    polled.current = options.onPoll ?? callback;
  });

  // Busca inicial + recarga em qualquer mudança global de dados.
  useEffect(() => {
    // fetch inicial
    saved.current();

    const handler = () => {
      saved.current();
    };
    window.addEventListener(DATA_CHANGED_EVENT, handler);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Polling em efeito separado: ligar/desligar o auto-sync só inicia/para o
  // timer, sem refazer a busca inicial. (`enabled` começa false e vira true
  // quando o /status carrega — juntar os efeitos repetiria todas as requests
  // da tela nesse momento.)
  useEffect(() => {
    if (!enabled || !pollMs || pollMs <= 0) return;
    const timer = window.setInterval(() => {
      // Aba em segundo plano não busca — economiza rede e CPU do servidor.
      if (document.visibilityState === 'visible') polled.current();
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [enabled, pollMs]);
}
