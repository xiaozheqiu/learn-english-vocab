export default {
  plugins: {
    // Tailwind 4 起，PostCSS 插件从 tailwindcss 拆到 @tailwindcss/postcss，
    // 且 autoprefixer 已内置（v4 自带 vendor prefix），不再单独配置
    "@tailwindcss/postcss": {},
  },
};
