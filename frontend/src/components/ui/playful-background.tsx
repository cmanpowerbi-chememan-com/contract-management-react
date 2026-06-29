/**
 * PlayfulBackground — warm-cream dot-grid page + drifting confetti shapes.
 * Drop-in replacement for BackgroundGradientAnimation.
 * Purely presentational: renders children unchanged.
 */
import React from 'react';

interface Props {
  children: React.ReactNode;
}

/* Inline styles so this component carries no external CSS dependency */
const wrap: React.CSSProperties = {
  position: 'relative',
  maxWidth: '1370px',
  margin: '0 auto',
  padding: '40px 16px 80px',
};

const confettiBase: React.CSSProperties = {
  position: 'absolute',
  zIndex: 0,
  pointerEvents: 'none',
};

/* Individual confetti positions */
const c1Style: React.CSSProperties = {
  ...confettiBase,
  top: '18px',
  right: '60px',
  transformOrigin: 'center',
  animation: 'pg-drift-tri 13s linear infinite',
};

const c2Style: React.CSSProperties = {
  ...confettiBase,
  top: '240px',
  left: '-18px',
  transformOrigin: 'center',
  animation: 'pg-drift-green 9s linear 0.8s infinite',
};

const c3Style: React.CSSProperties = {
  ...confettiBase,
  bottom: '120px',
  right: '24px',
  /* c3 is intentionally NOT animated — static decorative pink square */
};

const c4Style: React.CSSProperties = {
  ...confettiBase,
  top: '90px',
  left: '42%',
  transformOrigin: 'center',
  animation: 'pg-drift-purple 16s linear 1.6s infinite',
};

const contentStyle: React.CSSProperties = {
  position: 'relative',
  zIndex: 2,
};

export function PlayfulBackground({ children }: Props) {
  return (
    <div style={{ minHeight: '100vh' }}>
      <div style={wrap}>
        {/* Confetti shapes — aria-hidden, purely decorative */}
        <svg style={c1Style} width="58" height="58" viewBox="0 0 58 58" aria-hidden="true">
          <polygon points="29,4 54,50 4,50" fill="#FBBF24" stroke="#1E293B" strokeWidth="2.5" />
        </svg>
        <svg style={c2Style} width="46" height="46" viewBox="0 0 46 46" aria-hidden="true">
          <circle cx="23" cy="23" r="19" fill="#34D399" stroke="#1E293B" strokeWidth="2.5" />
        </svg>
        <svg style={c3Style} width="52" height="52" viewBox="0 0 52 52" aria-hidden="true">
          <rect x="6" y="6" width="40" height="40" rx="8" transform="rotate(12 26 26)" fill="#F472B6" stroke="#1E293B" strokeWidth="2.5" />
        </svg>
        <svg style={c4Style} width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="20" cy="20" r="15" fill="#8B5CF6" stroke="#1E293B" strokeWidth="2.5" />
        </svg>

        <div style={contentStyle}>
          {children}
        </div>
      </div>
    </div>
  );
}
