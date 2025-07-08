import { cn } from '../lib/utils';

interface FloatingCharacterProps {
  color: 'cyan' | 'red' | 'purple' | 'yellow' | 'green' | 'orange';
  position:
    | 'top-left'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-right'
    | 'center-left'
    | 'center-right';
  size?: 'sm' | 'md' | 'lg';
  delay?: number;
}

const positionClasses = {
  'top-left': 'top-16 left-16',
  'top-right': 'top-20 right-20',
  'bottom-left': 'bottom-20 left-20',
  'bottom-right': 'bottom-16 right-16',
  'center-left': 'top-1/2 left-12 -translate-y-1/2',
  'center-right': 'top-1/2 right-12 -translate-y-1/2',
};

const sizeClasses = {
  sm: 'w-16 h-20',
  md: 'w-20 h-24',
  lg: 'w-24 h-28',
};

const colorClasses = {
  cyan: 'text-cyan',
  red: 'text-red',
  purple: 'text-purple',
  yellow: 'text-yellow',
  green: 'text-green',
  orange: 'text-orange',
};

export const FloatingCharacter = ({
  color,
  position,
  size = 'md',
  delay = 0,
}: FloatingCharacterProps) => {
  return (
    <div
      className={cn(
        'absolute z-10 animate-float',
        positionClasses[position],
        sizeClasses[size]
      )}
      style={{ animationDelay: `${delay}s` }}
    >
      <svg
        viewBox="0 0 100 120"
        className={cn('w-full h-full drop-shadow-lg', colorClasses[color])}
        fill="currentColor"
      >
        {/* Among Us character body */}
        <path d="M50 20 C30 20, 15 35, 15 55 L15 90 C15 100, 25 110, 35 110 L65 110 C75 110, 85 100, 85 90 L85 55 C85 35, 70 20, 50 20 Z" />

        {/* Visor/glass */}
        <ellipse cx="50" cy="45" rx="22" ry="18" fill="rgba(255,255,255,0.9)" />

        {/* Inner visor reflection */}
        <ellipse cx="45" cy="40" rx="8" ry="6" fill="rgba(255,255,255,0.6)" />

        {/* Legs */}
        <rect x="25" y="105" width="15" height="12" rx="7" />
        <rect x="60" y="105" width="15" height="12" rx="7" />
      </svg>
    </div>
  );
};
