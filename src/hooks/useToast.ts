import { toast } from "sonner"

type ToastProps = {
  title?: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
}

export const useToast = () => {
  return {
    toast: (props: ToastProps) => {
      if (props.title) {
        toast(props.title, {
          description: props.description,
          action: props.action ? {
            label: props.action.label,
            onClick: props.action.onClick,
          } : undefined,
        })
      } else {
        toast(props.description || "")
      }
    },
    dismiss: toast.dismiss,
  }
}

export { toast }