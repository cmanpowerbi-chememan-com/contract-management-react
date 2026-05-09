'use client';
import { useRef, type ComponentProps } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';
import { cn } from '@/lib/utils';

type MagneticButtonProps = ComponentProps<'button'> & {
  strength?: number;
  radius?: number;
};

export function MagneticButton({
  children,
  className,
  strength = 0.38,
  radius = 90,
  disabled,
  ...props
}: MagneticButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const springX = useSpring(x, { stiffness: 200, damping: 14, mass: 0.1 });
  const springY = useSpring(y, { stiffness: 200, damping: 14, mass: 0.1 });

  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    if (Math.sqrt(dx * dx + dy * dy) < radius) {
      x.set(dx * strength);
      y.set(dy * strength);
    }
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.button
      ref={ref}
      style={{ x: springX, y: springY }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      whileHover={disabled ? {} : { scale: 1.04 }}
      whileTap={disabled ? {} : { scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      className={cn(className)}
      disabled={disabled}
      {...props}
    >
      {children}
    </motion.button>
  );
}
