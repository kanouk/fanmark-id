import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { routeModuleForPath, routeModules } from '@/lib/route-modules';

/** Only preload the requested route; keep private data behind readiness gates. */
export function RouteModulePreload() {
  const { pathname } = useLocation();
  useEffect(() => {
    const module = routeModuleForPath(pathname);
    if (module) {
      // Speculative failure is handled by the route's normal error boundary
      // if that route is rendered. Never replace the readiness/error gates.
      void routeModules[module]().catch(() => undefined);
    }
  }, [pathname]);
  return null;
}
