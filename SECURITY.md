# Security

Rewind uses a browser-only OAuth PKCE client. There is no Client Secret or backend
credential to configure. Each listener must use their own app and account. Never
put Spotify tokens, callback URLs containing a code, .env files, exported browser
storage, or personal library screenshots into an issue or pull request.

The site restricts scripts to its own assets and Spotify's Web Playback SDK.
It sets a Content Security Policy, denies framing, suppresses referrers, disables
unused browser capabilities and uses HTTPS. Album images, links and pagination
URLs are validated; API authorization is only sent to Spotify's API origin.
The original tab remains the owner of playback when the iPod is popped out.

These controls reduce risk but are not a guarantee against every vulnerability.
Browser extensions, a compromised host, or an XSS vulnerability could still read
browser storage. Disconnect when finished on a shared device and revoke the app
on Spotify if a token may have been exposed.

## Reporting

Use the repository's **Security → Report a vulnerability** feature if private
reporting is enabled. Otherwise open an issue describing only the affected
component and ask for a private reporting channel. Do not post exploit payloads
that include credentials or personal data.

## Publishing and contributing

- Run `npm run check` and `npm test` before publishing.
- Deploy only `dist/`. Do not publish your working directory or local configuration.
- Use neutral screenshots made from the sample collection.
- Use a GitHub noreply email or a project identity for commits if you do not want
  a personal name or email in public Git history. Check `git log --format=fuller`.
- A history rewrite cannot remove copies in forks, clones or all cached views.
  Rotate any leaked credentials and follow GitHub's sensitive-data removal guide.
