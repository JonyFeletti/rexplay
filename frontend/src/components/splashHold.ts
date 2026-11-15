import { createContext, useContext, useEffect } from "react";

// Permite que una pantalla le pida al splash que espere mientras ella carga sus datos.
export const SplashHoldContext = createContext<(delta: number) => void>(() => {});

export function useSplashHold(hold: boolean) {
  const adjust = useContext(SplashHoldContext);
  useEffect(() => {
    if (!hold) return;
    adjust(1);
    return () => adjust(-1);
  }, [hold, adjust]);
}
