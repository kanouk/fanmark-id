import { cva } from "class-variance-authority";

export const badgeVariants = cva(
  "badge",
  {
    variants: {
      variant: {
        default: "badge-primary",
        secondary: "badge-secondary",
        destructive: "badge-error",
        outline: "badge-outline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);
