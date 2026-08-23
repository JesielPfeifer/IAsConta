import { useEffect, useRef } from 'react';
import { DATA_CHANGED_EVENT } from '../api/client';

/**
 * Executa `callback` no mount e toda vez que qualquer dado mudar em qualquer
 * tela (evento global `iasconta:data-changed` disparado pelo api client após
 * POST/PUT/DELETE). Garante que edições feitas em outro lugar (ex.: ChatBot,
 * outra aba da aplicação) reflitam na tela atual sem reload.
 *
 * O callback é guardado em ref para não re-registrar o listener a cada render.
 */
export function useAutoRefresh(callback: () => void | Promise<void>, deps: unknown[] = []) {
  const saved = useRef(callback);
  saved.current = callback;

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
}
