type AppRoute = 'host' | 'screen';

function normalizeBase(base: string): string {
  const path = base.replace(/^\/+|\/+$/g, '');
  return path ? `/${path}/` : '/';
}

/** Local installations keep their original URLs; static project sites use hashes. */
export function appUrl(route: AppRoute, base = import.meta.env.BASE_URL): string {
  const prefix = normalizeBase(base);
  return prefix === '/' ? `/${route}` : `${prefix}#/${route}`;
}

export function resolveAppRoute(pathname: string, hash: string, base = import.meta.env.BASE_URL): AppRoute {
  const path = normalizeBase(base) === '/' ? pathname : hash.replace(/^#/, '');
  return path.replace(/\/+$/, '') === '/screen' ? 'screen' : 'host';
}

/** Suffix shared by storage, broadcasts and locks, with unchanged local names. */
export function appNamespace(base = import.meta.env.BASE_URL): string {
  const prefix = normalizeBase(base);
  return prefix === '/' ? '' : `:${encodeURIComponent(prefix)}`;
}
