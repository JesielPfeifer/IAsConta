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
  saved.current = callback;
  const polled = useRef(options.onPoll ?? callback);
  polled.current = options.onPoll ?? callback;
  const { pollMs, enabled = false } = options;

  useEffect(() => {
    // fetch inicial
    saved.current();

    const handler = () => {
      saved.current();
    };
    window.addEventListener(DATA_CHANGED_EVENT, handler);

    let timer: number | undefined;
    if (enabled && pollMs && pollMs > 0) {
      timer = window.setInterval(() => {
        // Aba em segundo plano não busca — economiza rede e CPU do servidor.
        if (document.visibilityState === 'visible') polled.current();
      }, pollMs);
    }

    return () => {
      window.removeEventListener(DATA_CHANGED_EVENT, handler);
      if (timer) window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, pollMs]);
}
