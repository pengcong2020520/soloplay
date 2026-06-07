/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer, webpack }) => {
    if (isServer) {
      // 可选解析依赖（mammoth/pdf-parse）：未安装时不应阻断构建，
      // 运行时通过 try/catch 动态加载并给出友好提示。
      config.plugins.push(
        new webpack.IgnorePlugin({
          resourceRegExp: /^(mammoth|pdf-parse)$/,
        })
      );
    }
    return config;
  },
};

export default nextConfig;
