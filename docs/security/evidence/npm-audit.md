# Evidencia · npm audit (ejecutado 2026-07-20T23:33:32+02:00)

## server/backend
```

picomatch  4.0.0 - 4.0.3
Severity: high
Picomatch: Method Injection in POSIX Character Classes causes incorrect Glob Matching - https://github.com/advisories/GHSA-3v7f-55p6-f55p
Picomatch has a ReDoS vulnerability via extglob quantifiers - https://github.com/advisories/GHSA-c2c7-rcm5-vvqj
fix available via `npm audit fix --force`
Will install @nestjs/schematics@11.1.0, which is outside the stated dependency range
node_modules/picomatch

uuid  <11.1.1
Severity: moderate
uuid: Missing buffer bounds check in v3/v5/v6 when buf is provided - https://github.com/advisories/GHSA-w5hq-g745-h8pq
fix available via `npm audit fix --force`
Will install uuid@11.1.1, which is outside the stated dependency range
node_modules/uuid

webpack  5.49.0 - 5.104.0
webpack buildHttp: allowedUris allow-list bypass via URL userinfo (@) leading to build-time SSRF behavior - https://github.com/advisories/GHSA-8fgc-7cc6-rx7x
webpack buildHttp HttpUriPlugin allowedUris bypass via HTTP redirects → SSRF + cache persistence - https://github.com/advisories/GHSA-38r7-794h-5758
fix available via `npm audit fix --force`
Will install @nestjs/cli@11.0.24, which is outside the stated dependency range
node_modules/webpack

23 vulnerabilities (1 low, 10 moderate, 12 high)

To address issues that do not require attention, run:
  npm audit fix

To address all issues, run:
  npm audit fix --force
```

## server/frontend
```
found 0 vulnerabilities
```

## server/worker
```
# npm audit report

effect  <3.20.0
Severity: high
Effect `AsyncLocalStorage` context lost/contaminated inside Effect fibers under concurrent load with RPC - https://github.com/advisories/GHSA-38f7-945m-qr2g
fix available via `npm audit fix --force`
Will install prisma@6.19.3, which is outside the stated dependency range
node_modules/effect
  @prisma/config  6.13.0-dev.1 - 6.19.2 || 6.20.0-dev.1 - 7.6.0-integration-feat-prisma-bootstrap.13
  Depends on vulnerable versions of effect
  node_modules/@prisma/config
    prisma  6.13.0-dev.1 - 6.19.2 || 6.20.0-dev.1 - 7.6.0-integration-feat-prisma-bootstrap.13
    Depends on vulnerable versions of @prisma/config
    node_modules/prisma

3 high severity vulnerabilities

To address all issues, run:
  npm audit fix --force
```

## simulators
```
# npm audit report

esbuild  <=0.24.2
Severity: moderate
esbuild enables any website to send any requests to the development server and read the response - https://github.com/advisories/GHSA-67mh-4wv8-2f99
fix available via `npm audit fix --force`
Will install vitest@4.1.10, which is a breaking change
node_modules/vite/node_modules/esbuild
  vite  <=6.4.2
  Depends on vulnerable versions of esbuild
  node_modules/vite
    @vitest/mocker  <=3.0.0-beta.4
    Depends on vulnerable versions of vite
    node_modules/@vitest/mocker
      vitest  <=3.2.5
      Depends on vulnerable versions of @vitest/mocker
      Depends on vulnerable versions of vite
      Depends on vulnerable versions of vite-node
      node_modules/vitest
    vite-node  <=2.2.0-beta.2
    Depends on vulnerable versions of vite
    node_modules/vite-node



5 vulnerabilities (3 moderate, 1 high, 1 critical)

To address all issues (including breaking changes), run:
  npm audit fix --force
```
