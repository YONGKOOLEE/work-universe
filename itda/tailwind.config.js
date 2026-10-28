/** @type {import('tailwindcss').Config} */
const v = (n) => `rgb(var(--${n}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'), surface: v('surface'), sunken: v('sunken'), line: v('line'), line2: v('line2'),
        ink: v('ink'), muted: v('muted'), faint: v('faint'),
        navy: v('navy'), onbrand: v('onbrand'), brand: v('brand'), brandsoft: v('brandsoft'),
        fact: v('fact'), factsoft: v('factsoft'), infer: v('infer'), infersoft: v('infersoft'),
        warn: v('warn'), warnsoft: v('warnsoft'), owner: v('owner'), ownersoft: v('ownersoft'),
        danger: v('danger'), dangersoft: v('dangersoft'), ok: v('ok'), oksoft: v('oksoft'),
        side: v('side'), sideink: v('sideink'), sidemuted: v('sidemuted'), sideactive: v('sideactive'),
      },
      fontFamily: {
        sans: ['"Malgun Gothic"', '"Apple SD Gothic Neo"', 'system-ui', 'sans-serif'],
        mono: ['Consolas', '"D2Coding"', 'monospace'],
      },
      fontSize: { '2xs': ['11px', '16px'] },
      boxShadow: { card: '0 1px 2px rgb(var(--shadow) / 0.06), 0 1px 1px rgb(var(--shadow) / 0.03)', pop: '0 12px 32px rgb(var(--shadow) / 0.18)' },
    },
  },
  plugins: [],
};
