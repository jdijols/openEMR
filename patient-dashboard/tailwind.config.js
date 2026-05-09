import forms from '@tailwindcss/forms'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // af-* design tokens — same family as the CUI's --af-* CSS variables.
      // Tailwind-derived (slate + sky + emerald + amber + red), evolved from
      // OpenEMR Bootstrap 4.6's warmer palette. Light-mode product, dark-mode
      // brand (OG image at branding/og-image.png), same family.
      colors: {
        af: {
          // Brand accents — reserved for emphasis (logos, signature moments).
          'accent-bright': '#4EA3FF',
          'accent-deep': '#0A2540',

          // Surfaces.
          surface: '#FFFFFF',
          'surface-alt': '#F8FAFC', // slate-50
          'surface-sunk': '#F1F5F9', // slate-100

          // Borders.
          border: '#E2E8F0', // slate-200
          'border-strong': '#CBD5E1', // slate-300

          // Text.
          text: '#0F172A', // slate-900 — deep ink, same family as accent-deep
          'text-subtle': '#475569', // slate-600
          'text-muted': '#64748B', // slate-500

          // Slate gray scale.
          'gray-50': '#F8FAFC',
          'gray-100': '#F1F5F9',
          'gray-200': '#E2E8F0',
          'gray-300': '#CBD5E1',
          'gray-400': '#94A3B8',
          'gray-500': '#64748B',
          'gray-600': '#475569',
          'gray-700': '#334155',
          'gray-800': '#1E293B',
          'gray-900': '#0F172A',

          // Primary — sky.
          primary: '#0284C7', // sky-600
          'primary-50': '#F0F9FF',
          'primary-600': '#0369A1', // sky-700
          'primary-700': '#075985', // sky-800

          // Success — emerald.
          success: '#059669',
          'success-50': '#ECFDF5',
          'success-700': '#047857',

          // Warning — amber.
          warning: '#D97706',
          'warning-50': '#FFFBEB',
          'warning-700': '#B45309',

          // Danger — red.
          danger: '#DC2626',
          'danger-50': '#FEF2F2',
          'danger-700': '#B91C1C',
        },
      },
      fontFamily: {
        sans: [
          'Lato',
          'Inter',
          '"Helvetica Neue"',
          'Helvetica',
          'Arial',
          'sans-serif',
          '"Apple Color Emoji"',
          '"Segoe UI Emoji"',
          '"Segoe UI Symbol"',
          '"Noto Color Emoji"',
        ],
      },
      borderRadius: {
        // CUI parity: 8px cards, 6px controls, 4px sm. Tailwind defaults
        // are close enough that we just lean on `rounded-lg` (8px) for cards
        // instead of `rounded-2xl` (16px); explicit aliases for the rest.
        'af-card': '8px',
        'af-control': '6px',
      },
      boxShadow: {
        'af-card': '0 1px 2px rgba(15, 23, 42, 0.04)',
        'af-card-hover':
          '0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px -12px rgba(15, 23, 42, 0.12)',
      },
      keyframes: {
        // Shimmer loading: gradient sweeps left-to-right across skeleton bars.
        // Cleaner than `animate-pulse` — communicates "data loading" instead of
        // a static placeholder. WCAG: respects prefers-reduced-motion (loaders
        // remain visible but the sweep stops via the media query in index.css).
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [forms],
}
