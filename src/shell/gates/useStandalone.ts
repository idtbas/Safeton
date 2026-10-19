import { useSyncExternalStore } from 'react';
import { STANDALONE_QUERIES, isStandaloneDisplay } from '../../os/platform';

function subscribeStandalone(cb: () => void) {
  const mqs = STANDALONE_QUERIES.map((q) => matchMedia(q));
  for (const mq of mqs) mq.addEventListener('change', cb);
  return () => {
    for (const mq of mqs) mq.removeEventListener('change', cb);
  };
}

/** Whether the page runs as an installed application; follows display-mode changes live. */
export function useStandalone(): boolean {
  return useSyncExternalStore(subscribeStandalone, isStandaloneDisplay, () => false);
}
