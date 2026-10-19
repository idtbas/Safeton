import { useSyncExternalStore } from 'react';
import { App as PreviewApp } from './preview/App';
import { ShellApp } from './shell/ShellApp';

function subscribeHash(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}
const getHash = () => window.location.hash;

/** Internal tools (#/preview, #/components) keep their own surface; everything else is the OS shell. */
export function Root() {
  const hash = useSyncExternalStore(subscribeHash, getHash);
  const internal = hash.startsWith('#/preview') || hash.startsWith('#/components');
  return internal ? <PreviewApp /> : <ShellApp />;
}
