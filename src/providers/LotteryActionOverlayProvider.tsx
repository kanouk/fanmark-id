import { LotteryActionOverlayContext, type OverlayState, type LotteryAction, type OverlayMeta, type LotteryActionOverlayContextValue } from "@/hooks/useLotteryActionOverlay";
import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { createPortal } from 'react-dom';
import LotteryActionLoading from '@/components/LotteryActionLoading';

const MIN_DISPLAY_DURATION_MS = 500;
const initialState: OverlayState = {
  visible: false,
  action: null,
  emoji: null,
  shownAt: null,
};

export const LotteryActionOverlayProvider = ({ children }: PropsWithChildren) => {
  const [state, setState] = useState<OverlayState>(initialState);
  const [isMounted, setIsMounted] = useState(false);
  const hideTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setIsMounted(true);
    return () => {
      if (hideTimeoutRef.current) {
        window.clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
    };
  }, []);

  const show = useCallback((action: LotteryAction, meta?: OverlayMeta) => {
    if (hideTimeoutRef.current) {
      window.clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    setState({
      visible: true,
      action,
      emoji: meta?.emoji ?? null,
      shownAt: Date.now(),
    });
  }, []);

  const hide = useCallback(() => {
    setState(prev => {
      if (!prev.visible) {
        return prev;
      }

      const elapsed = prev.shownAt ? Date.now() - prev.shownAt : MIN_DISPLAY_DURATION_MS;
      if (elapsed >= MIN_DISPLAY_DURATION_MS) {
        return initialState;
      }

      if (hideTimeoutRef.current) {
        window.clearTimeout(hideTimeoutRef.current);
      }
      hideTimeoutRef.current = window.setTimeout(() => {
        setState(initialState);
        hideTimeoutRef.current = null;
      }, MIN_DISPLAY_DURATION_MS - elapsed);

      return prev;
    });
  }, []);

  const value = useMemo<LotteryActionOverlayContextValue>(
    () => ({
      show,
      hide,
      state,
    }),
    [show, hide, state],
  );

  return (
    <LotteryActionOverlayContext.Provider value={value}>
      {children}
      {isMounted && state.visible && state.action
        ? createPortal(
            <LotteryActionLoading action={state.action} emoji={state.emoji ?? undefined} />,
            document.body,
          )
        : null}
    </LotteryActionOverlayContext.Provider>
  );
};
