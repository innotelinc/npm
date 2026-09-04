---
# NPM Edge — VitePress documentation
layout: home

hero:
  name: "NPM Edge"
  tagline: Route safely. Recover quickly.
  image:
    src: /logo.svg
    alt: NPM Edge logo
  actions:
    - theme: brand
      text: Get Started
      link: /setup/
    - theme: alt
      text: GitHub
      link: https://github.com/innotelinc/npm

features:
  - title: Reverse Proxy
    details: Forward public hostnames to private services with proxy hosts, redirects, streams, and custom Nginx policies.
  - title: TLS at the Edge
    details: Issue, renew, and attach Let's Encrypt or custom certificates to the hosts that need them.
  - title: Access Control
    details: Apply access lists and optional HTTP authentication before traffic reaches an application.
  - title: Recoverable State
    details: Use the bundled backup-ui to snapshot the NPM database, /data configuration, and certificate material together.
  - title: Local-BIND Component
    details: Cerulean starts this complete NPM, MariaDB, and backup-ui stack only when BIND_MODE=local and NPM_MODE=local.
  - title: Platform Ready
    details: Integrate Cerulean for trust, Infisical for secrets, and any Innotel application behind the edge.
---
