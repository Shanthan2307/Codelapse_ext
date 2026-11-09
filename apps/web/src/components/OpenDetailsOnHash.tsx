'use client';

import { useEffect } from 'react';

/** Opens every closed <details> around an element, so a link into a folded section still shows its target. */
function reveal(id: string): void {
  const target = document.getElementById(id);
  if (!target) return;
  for (let el: HTMLElement | null = target.parentElement; el; el = el.parentElement) {
    if (el instanceof HTMLDetailsElement && !el.open) el.open = true;
  }
  target.scrollIntoView({ block: 'start' });
}

/**
 * Makes in-page links (such as a question's link to its decision moment) work
 * when the target sits inside a collapsed section: on load, on hash changes,
 * and on clicks of links to the hash already in the address bar.
 */
export function OpenDetailsOnHash() {
  useEffect(() => {
    const fromHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (id) reveal(id);
    };
    const onClick = (event: MouseEvent) => {
      const link = (event.target as HTMLElement | null)?.closest('a[href^="#"]');
      const id = link ? decodeURIComponent(link.getAttribute('href')!.slice(1)) : '';
      if (id) {
        // Open first; the browser's own jump then lands on a visible element.
        const target = document.getElementById(id);
        for (let el = target?.parentElement ?? null; el; el = el.parentElement) {
          if (el instanceof HTMLDetailsElement && !el.open) el.open = true;
        }
        if (window.location.hash === `#${id}`) reveal(id);
      }
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('hashchange', fromHash);
      document.removeEventListener('click', onClick);
    };
  }, []);
  return null;
}
