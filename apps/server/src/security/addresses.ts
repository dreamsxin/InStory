/**
 * Address questions that decide who is believed. Both of these used to live inline -
 * `readTrustProxy` in `main.ts`, which no test can import because it starts a server on
 * load, and `isLoopbackAddress` in `app.ts`, reachable only through a request. They are
 * the kind of parsing where a wrong answer quietly hands trust to a caller, so they sit
 * here with tests of their own.
 */

/**
 * Which proxies may speak for the client. Per-address rate limits are only meaningful
 * if the address is real; behind a proxy every request arrives from the proxy, so the
 * limiter would either lock all readers out together or let one exhaust everyone's
 * budget.
 *
 * A hop count is deliberately refused. fastify 5.12 dropped it - GHSA-3m5p-2c4r-xxw2
 * was precisely about X-Forwarded-* spoofing under hop-count trust - so a number here
 * would be a configuration that reads as if it works and does not. A refused value
 * falls back to trusting nothing, which over-limits rather than believing a header the
 * caller wrote.
 */
export function readTrustProxy(
  value: string | undefined,
  onWarning: (message: string) => void = console.warn
): boolean | string[] {
  const addresses = (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (addresses.length === 0) {
    return false;
  }

  if (addresses.some((entry) => /^\d+$/.test(entry))) {
    onWarning(
      `TRUST_PROXY=${value} 被忽略：不再支持"信任 N 层代理"，请改成代理的地址或 CIDR（例如 172.16.0.0/12）。`
    );
    return false;
  }

  return addresses;
}

/**
 * Whether the connection came from this machine. Used to keep the token-less admin
 * console (local development only) off the network. Callers must pass the socket's own
 * address, never a forwarded header: `request.ip` honours X-Forwarded-For under
 * trustProxy, and a header the caller writes must not be able to claim loopback.
 */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) {
    return false;
  }

  // Node reports IPv4 clients on a dual-stack socket as ::ffff:127.0.0.1.
  const plain = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;

  // The whole 127.0.0.0/8 block is loopback, not just 127.0.0.1.
  return plain === "::1" || /^127\.\d+\.\d+\.\d+$/.test(plain);
}
