import { cva } from "class-variance-authority";

export const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-[calc(var(--radius)-2px)] text-sm font-semibold transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 shadow-[0_4px_12px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 active:translate-y-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_8px_20px_hsl(var(--primary)_/_0.25)]",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 shadow-[0_6px_16px_hsl(var(--secondary)_/_0.25)]",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-[0_6px_16px_hsl(var(--destructive)_/_0.25)]",
        outline:
          "border border-input bg-background text-foreground hover:bg-muted/60 shadow-[0_4px_10px_rgba(0,0,0,0.06)]",
        ghost: "bg-transparent hover:bg-muted/60 text-foreground shadow-none",
        accent:
          "bg-accent text-accent-foreground hover:bg-accent/90 shadow-[0_8px_20px_hsl(var(--accent)_/_0.3)]",
        link: "text-primary underline-offset-4 hover:underline shadow-none",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-[calc(var(--radius)-4px)] px-3",
        lg: "h-11 rounded-[calc(var(--radius)-1px)] px-6 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);
