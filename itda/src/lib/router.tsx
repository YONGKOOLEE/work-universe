import React, { createContext, useContext, useEffect, useState } from 'react';

// 아티팩트(샌드박스 iframe)에서도 동작하도록 메모리 라우터 + 해시 동기화(가능한 경우)
interface RouterCtx {
  path: string;
  query: URLSearchParams;
  nav: (to: string) => void;
  /** 지금 주소를 바꿔치기(뒤로 가기 기록을 쌓지 않음) */
  replace: (to: string) => void;
  back: () => void;
  canBack: boolean;
}
const Ctx = createContext<RouterCtx | null>(null);

function initial() {
  try {
    const h = window.location.hash.replace(/^#/, '');
    if (h.startsWith('/')) return h;
  } catch {
    /* noop */
  }
  return '/dashboard';
}

export function RouterProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<string[]>([initial()]);
  const cur = stack[stack.length - 1];
  useEffect(() => {
    try {
      if (window.location.hash !== '#' + cur) window.history.replaceState(null, '', '#' + cur);
    } catch {
      /* noop */
    }
    const main = document.getElementById('main-scroll');
    const anchor = new URLSearchParams(cur.split('?')[1] ?? '').get('anchor');
    if (!anchor) main?.scrollTo({ top: 0 });
  }, [cur]);
  // 주소의 #경로를 바꾸면 그 화면으로(바로 가기·점검 도구용). 앱이 맞춘 해시와 같으면 무시
  useEffect(() => {
    const on = () => {
      const h = window.location.hash.replace(/^#/, '');
      if (h.startsWith('/')) setStack((s) => (s[s.length - 1] === h ? s : [...s.slice(-30), h]));
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const [pathname, qs] = cur.split('?');
  const value: RouterCtx = {
    path: pathname,
    query: new URLSearchParams(qs ?? ''),
    nav: (to) => setStack((s) => (s[s.length - 1] === to ? s : [...s.slice(-30), to])),
    replace: (to) => setStack((s) => (s[s.length - 1] === to ? s : [...s.slice(0, -1), to])),
    back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    canBack: stack.length > 1,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRouter() {
  const c = useContext(Ctx);
  if (!c) throw new Error('RouterProvider missing');
  return c;
}

export function Link({ to, className, children, title }: { to: string; className?: string; children: React.ReactNode; title?: string }) {
  const { nav } = useRouter();
  return (
    <a
      href={'#' + to}
      title={title}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        nav(to);
      }}
    >
      {children}
    </a>
  );
}
