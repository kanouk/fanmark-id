import { useCallback, useRef } from 'react';

type EventTargetElement = HTMLInputElement | HTMLTextAreaElement;

interface UseImeAwareSubmitOptions {
  onSubmit?: (event: React.KeyboardEvent<EventTargetElement>) => void;
  isDisabled?: boolean;
  preventDefault?: boolean;
}

export const useImeAwareSubmit = ({
  onSubmit,
  isDisabled = false,
  preventDefault = true,
}: UseImeAwareSubmitOptions = {}) => {
  const isComposingRef = useRef(false);

  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    // Composition end fires just before the confirming Enter keydown on some browsers
    // Delay to the next tick so the Enter handler can read the updated flag.
    window.requestAnimationFrame(() => {
      isComposingRef.current = false;
    });
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<EventTargetElement>) => {
      if (event.key !== 'Enter') {
        return;
      }

      const nativeEvent = event.nativeEvent as KeyboardEvent;
      const isComposingNative = nativeEvent?.isComposing ?? false;
      const isComposing = isComposingNative || isComposingRef.current;

      if (isComposing || isDisabled) {
        return;
      }

      if (preventDefault) {
        event.preventDefault();
      }

      onSubmit?.(event);
    },
    [isDisabled, onSubmit, preventDefault],
  );

  return {
    onCompositionStart: handleCompositionStart,
    onCompositionEnd: handleCompositionEnd,
    onKeyDown: handleKeyDown,
  } as const;
};
