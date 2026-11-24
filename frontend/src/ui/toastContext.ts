import { createContext, useContext } from "react";

export type ToastTone = "success" | "error";
export interface ToastAction {
  label: string;
  onClick: () => void;
}
export interface ToastOptions {
  tone?: ToastTone;
  action?: ToastAction;
}

/** show(message) / show(message, "error") / show(message, { action: { label: "Undo", onClick } }) */
export type ShowToast = (message: string, options?: ToastTone | ToastOptions) => void;

export const ToastContext = createContext<ShowToast | null>(null);

export function useToast(): ShowToast {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast must be used inside <ToastProvider>");
  return show;
}
