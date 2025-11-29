import sparklingImage from '@/assets/sparkling.png';
import { cn } from '@/lib/utils';

interface BrandIconProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizeClasses = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-16 w-16',
  xl: 'h-20 w-20 sm:h-24 sm:w-24',
};

export const BrandIcon = ({ size = 'md', className }: BrandIconProps) => {
  return (
    <img
      src={sparklingImage}
      alt="Fanmark"
      className={cn(sizeClasses[size], 'object-contain', className)}
    />
  );
};
