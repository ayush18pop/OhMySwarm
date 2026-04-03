/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg:       '#010b0f',
        surface:  '#051a24',
        surface2: '#0a2535',
        border:   '#0e3d52',
        cyan:     '#00f5ff',
        green:    '#00ff88',
        yellow:   '#ffe600',
        red:      '#ff2d55',
        primary:  '#c8f0f8',
        muted:    '#4a8fa8',
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        cyan:  '0 0 12px rgba(0,245,255,0.4)',
        green: '0 0 12px rgba(0,255,136,0.4)',
        red:   '0 0 12px rgba(255,45,85,0.4)',
      },
      animation: {
        'blink':       'blink 1s step-end infinite',
        'pulse-slow':  'pulse 3s ease-in-out infinite',
        'ring-pulse':  'ringPulse 1.8s ease-out infinite',
        'node-spawn':  'nodeSpawn 0.55s cubic-bezier(0.22,0.61,0.36,1) forwards',
        'check-flash': 'checkFlash 0.4s ease-out forwards',
        'radar':       'radarSweep 3s linear infinite',
        'glow-breath': 'glowBreath 2s ease-in-out infinite',
        'dash-flow':   'dashFlow 0.8s linear infinite',
      },
      keyframes: {
        blink:       { '0%,100%': { opacity: '1' }, '50%': { opacity: '0' } },
        ringPulse:   { '0%': { transform: 'scale(1)', opacity: '0.7' }, '50%': { transform: 'scale(1.18)', opacity: '0' }, '100%': { transform: 'scale(1)', opacity: '0' } },
        nodeSpawn:   { '0%': { opacity: '0', transform: 'scale(0.4) translateY(-12px)', filter: 'brightness(3)' }, '40%': { opacity: '1', transform: 'scale(1.08) translateY(2px)', filter: 'brightness(1.6)' }, '60%': { transform: 'scale(0.97) translateY(0)' }, '80%': { transform: 'scale(1.02)' }, '100%': { opacity: '1', transform: 'scale(1) translateY(0)', filter: 'brightness(1)' } },
        checkFlash:  { '0%': { opacity: '0', transform: 'scale(0.5)' }, '40%': { opacity: '1', transform: 'scale(1.3)' }, '100%': { opacity: '1', transform: 'scale(1)' } },
        radarSweep:  { from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } },
        glowBreath:  { '0%,100%': { boxShadow: '0 0 6px var(--glow-color, #00f5ff40), inset 0 0 8px var(--glow-color, #00f5ff10)' }, '50%': { boxShadow: '0 0 18px var(--glow-color, #00f5ff70), inset 0 0 16px var(--glow-color, #00f5ff20)' } },
        dashFlow:    { to: { strokeDashoffset: '-40' } },
      },
    },
  },
  plugins: [],
}
