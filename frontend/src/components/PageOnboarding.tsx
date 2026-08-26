import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Check, X, EyeOff, Compass } from 'lucide-react';

/**
 * Onboarding interativo por página.
 *
 * Uso (via hook):
 *   const steps: OnboardingStep[] = [...];
 *   useOnboarding('dashboard', steps);  // renderiza sozinho quando ativo
 *
 * Persistência em localStorage:
 *   chave `iasconta.onboarding.<pageKey>` = "done" → não exibe novamente.
 *   resetOnboarding()            → limpa TODAS as chaves (reexibe tudo).
 *   resetOnboarding(pageKey)     → limpa só aquela página.
 */

export interface OnboardingStep {
  /** Seletor CSS opcional do elemento a destacar. Sem target = passo informativo central. */
  target?: string;
  title: string;
  description: string;
}

const STORAGE_PREFIX = 'iasconta.onboarding.';
const SCROLL_MARGIN = 90;

export function isOnboardingDone(pageKey: string): boolean {
  try {
    return localStorage.getItem(STORAGE_PREFIX + pageKey) === 'done';
  } catch {
    return false;
  }
}

export function resetOnboarding(pageKey?: string) {
  try {
    if (pageKey) {
      localStorage.removeItem(STORAGE_PREFIX + pageKey);
      return;
    }
    const removed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX)) removed.push(k);
    }
    removed.forEach((k) => localStorage.removeItem(k));
  } catch {
    // localStorage indisponível — ignora silenciosamente
  }
}

/** Marca como concluído sem exibir o tour. */
function markDone(pageKey: string) {
  try {
    localStorage.setItem(STORAGE_PREFIX + pageKey, 'done');
  } catch {
    // ignora
  }
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

function measureTarget(selector?: string): Rect | null {
  if (!selector) return null;
  try {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return { top: r.top, left: r.left, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
  } catch {
    return null;
  }
}

export function PageOnboarding({
  pageKey,
  steps,
}: {
  pageKey: string;
  steps: OnboardingStep[];
}) {
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (steps.length > 0 && !isOnboardingDone(pageKey)) {
      setVisible(true);
      setIndex(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey]);

  const step = visible ? steps[index] : undefined;

  const updateRect = useCallback(() => {
    if (!step) return;
    setRect(measureTarget(step.target));
  }, [step]);

  // Mede após o layout da página estar pronto e reage a resize/scroll.
  useLayoutEffect(() => {
    if (!visible || !step) return;
    updateRect();
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    const t1 = setTimeout(updateRect, 250);
    const t2 = setTimeout(updateRect, 900);
    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [visible, step?.target, index, updateRect, step]);

  // Rola o elemento alvo para dentro da viewport quando o passo muda.
  useEffect(() => {
    if (!step?.target) return;
    try {
      document.querySelector(step.target)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    } catch {
      // seletor inválido — segue com passo centralizado
    }
  }, [index, step]);

  function finish() {
    markDone(pageKey);
    setVisible(false);
  }

  if (!visible || !step) return null;

  const isLast = index === steps.length - 1;
  const pad = 8;
  const hasTarget = Boolean(rect);

  // Retângulo de recorte do elemento destacado (coordenadas fixas).
  const clipPath = hasTarget
    ? `polygon(
        0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
        ${rect!.left - pad}px ${rect!.top - pad}px,
        ${rect!.left - pad}px ${rect!.bottom + pad}px,
        ${rect!.right + pad}px ${rect!.bottom + pad}px,
        ${rect!.right + pad}px ${rect!.top - pad}px,
        ${rect!.left - pad}px ${rect!.top - pad}px
      )`
    : undefined;

  // Posição do tooltip: abaixo do alvo; se não couber, acima; sem alvo, centro.
  let tipStyle: React.CSSProperties;
  if (hasTarget) {
    const below =
      rect!.top + rect!.height + 16 + 220 < window.innerHeight ||
      rect!.top - 16 - 220 < 0;
    tipStyle = {
      position: 'fixed',
      maxWidth: 340,
      zIndex: 9999,
      ...(below
        ? { top: Math.min(rect!.bottom + pad + 12, window.innerHeight - 190) }
        : { bottom: window.innerHeight - rect!.top + pad + 12 }),
      left: Math.max(
        16,
        Math.min(rect!.left, window.innerWidth - 340 - 16)
      ),
    };
  } else {
    tipStyle = {
      position: 'fixed',
      maxWidth: 380,
      zIndex: 9999,
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    };
  }

  const ringStyle: React.CSSProperties = hasTarget
    ? {
        position: 'fixed',
        top: rect!.top - pad,
        left: rect!.left - pad,
        width: rect!.width + pad * 2,
        height: rect!.height + pad * 2,
        zIndex: 9998,
        pointerEvents: 'none',
        boxShadow: '0 0 0 3px rgba(52, 211, 153, 0.85), 0 0 24px rgba(52, 211, 153, 0.45)',
        borderRadius: 14,
        transition: 'all 0.25s ease',
      }
    : {};

  function next() {
    if (isLast) finish();
    else setIndex((i) => i + 1);
  }

  function prev() {
    setIndex((i) => Math.max(0, i - 1));
  }

  return (
    <div className="fixed inset-0" style={{ zIndex: 9997 }} role="dialog" aria-modal="true">
      {/* Overlay escuro com furo no elemento alvo */}
      <div
        className="absolute inset-0 bg-black/70 transition-all duration-200"
        style={clipPath ? { clipPath } : undefined}
        onClick={finish}
      />

      {/* Anel de destaque */}
      {hasTarget && <div style={ringStyle} />}

      {/* Tooltip */}
      <div
        style={tipStyle}
        className="rounded-2xl border border-emerald-500/30 bg-gray-900 shadow-2xl shadow-emerald-500/10 p-5"
      >
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
            <Compass className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-wider text-emerald-400/80 font-medium">
              Passo {index + 1} de {steps.length}
            </p>
            <h3 className="text-sm font-semibold text-white mt-0.5">{step.title}</h3>
            <p className="text-sm text-gray-300 leading-relaxed mt-1.5">{step.description}</p>
          </div>
          <button
            onClick={finish}
            aria-label="Fechar tour"
            className="p-1 rounded-lg text-gray-500 hover:text-white hover:bg-white/5 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 mt-4">
          <button
            onClick={() => {
              markDone(pageKey);
              setVisible(false);
            }}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
          >
            <EyeOff className="w-3.5 h-3.5" /> Não mostrar novamente
          </button>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <button
                onClick={prev}
                className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm text-gray-300 hover:text-white hover:bg-white/5 border border-white/10 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" /> Anterior
              </button>
            )}
            <button
              onClick={next}
              className={`flex items-center gap-1 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                isLast
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-gray-950 shadow-lg shadow-emerald-500/20'
                  : 'bg-white/[0.07] hover:bg-white/[0.12] text-white border border-white/10'
              }`}
            >
              {isLast ? (
                <>
                  <Check className="w-4 h-4" /> Entendi
                </>
              ) : (
                <>
                  Próximo <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
