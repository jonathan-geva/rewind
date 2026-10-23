# Privacy

Rewind is a static website. It has no application server, database, analytics,
advertising, or application-managed cookies. It does not bundle an operator's
Spotify app identifier, Spotify account, tokens, or personal music collection.
The preview collection is a fixed sample and plays no audio.

## Connecting your account

You supply the public Client ID of your own Spotify developer app. Do not supply
a Client Secret. Spotify handles sign-in and consent on accounts.spotify.com.
Rewind exchanges the authorization code directly with Spotify using OAuth 2.0
Authorization Code with PKCE, a random state value, and a ten-minute attempt
lifetime. The callback query is removed from the address bar before exchange.

Access tokens, refresh tokens, the Client ID, the pending login attempt and the
selected playlist are stored in sessionStorage on this website's origin, scoped
to the browser tab. They are never embedded in a share link, committed to the
repository, or sent to a Rewind application server. The library, search results
and playback state are held in memory. Only click-sound and backlight preferences
use localStorage. Legacy account storage from earlier builds is discarded.

Rewind does not request your profile through the Web API or display your account
name or email. Spotify's Web Playback SDK requires the streaming, user-read-email
and user-read-private scopes. Additional permissions let you read your saved songs
and playlists, save or unsave a song, and read or control playback. Spotify's SDK
may process account information under Spotify's own policies.

## Clear your session

Choose **Settings → Disconnect** on the iPod. This clears Rewind's session data,
stops its player, and returns to the sample library. Closing the tab normally
ends its session, but browser session restore and duplicated tabs can preserve
sessionStorage. Use Disconnect on a shared computer. To revoke authorization
with Spotify itself, remove the app from [Spotify's app settings](https://www.spotify.com/account/apps/).
Disconnect does not sign you out of Spotify's own website.

## Third parties

Your browser connects to Spotify for authentication, API requests, album images
and streaming. The hosting provider serves the website and may process IP
addresses and request logs. Spotify and the hosting provider have their own
privacy policies. Rewind cannot promise anonymity from those providers.

The floating player stays on this origin and uses the original tab's controller.
It does not send account data to another origin or start a second Spotify player.
