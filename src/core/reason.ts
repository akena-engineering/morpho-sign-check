// "The contract function … reverted with the following reason:\nERC20: …" → "ERC20: …".
export function revertReason(message: string): string {
  const m = message.match(/reverted with the following reason:\s*\n\s*(.+)/)
  return (m?.[1] ?? message.split("\n")[0] ?? message).trim()
}
