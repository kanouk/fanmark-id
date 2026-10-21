import { createContext, useContext } from "react";

export type LotteryAction = 'applying' | 'cancelling';

export interface OverlayMeta {
  emoji?: string | null;
}

export interface OverlayState {
  visible: boolean;
  action: LotteryAction | null;
  emoji?: string | null;
  shownAt: number | null;
}

export interface LotteryActionOverlayContextValue {
  show: (action: LotteryAction, meta?: OverlayMeta) => void;
  hide: () => void;
  state: OverlayState;
}

export const LotteryActionOverlayContext = createContext<LotteryActionOverlayContextValue | undefined>(undefined);

export const useLotteryActionOverlay = () => {
  const context = useContext(LotteryActionOverlayContext);
  if (!context) {
    throw new Error('useLotteryActionOverlay must be used within a LotteryActionOverlayProvider');
  }
  return context;
};
