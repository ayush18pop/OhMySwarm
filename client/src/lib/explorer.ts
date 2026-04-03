export function getTxExplorerUrl(txHash: string): string {
  const network = (
    process.env.NEXT_PUBLIC_PAYMENT_NETWORK ?? "sepolia"
  ).toLowerCase();

  if (network === "base" || network === "base-mainnet") {
    return `https://basescan.org/tx/${txHash}`;
  }
  if (network === "base-sepolia") {
    return `https://sepolia.basescan.org/tx/${txHash}`;
  }

  return `https://sepolia.etherscan.io/tx/${txHash}`;
}
