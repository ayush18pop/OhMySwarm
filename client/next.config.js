/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_API_URL:
      process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001",
    NEXT_PUBLIC_WS_URL:
      process.env.NEXT_PUBLIC_WS_URL || "http://localhost:3001",
    NEXT_PUBLIC_PAYMENT_NETWORK:
      process.env.NEXT_PUBLIC_PAYMENT_NETWORK ||
      process.env.PAYMENT_NETWORK ||
      "sepolia",
  },
};
module.exports = nextConfig;
