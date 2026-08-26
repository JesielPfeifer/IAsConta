import { useEffect, useState } from 'react';
import { PageOnboarding, isOnboardingDone, type OnboardingStep } from '../components/PageOnboarding';

/**
 * Decide se o tour da página deve ser exibido:
 * mostra apenas na primeira visita (sem `iasconta.onboarding.<pageKey>` = done).
 */
export function useOnboarding(pageKey: string, steps: OnboardingStep[]) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (steps.length > 0 && !isOnboardingDone(pageKey)) setShow(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey]);

  return show ? <PageOnboarding pageKey={pageKey} steps={steps} /> : null;
}
