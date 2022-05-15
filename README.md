# SPDCK
### (Pronounced es-pee-deck)
Control your Spotify Playback from the SteamOS Quick Access Menu.<br>
Built using [SteamOS Plugin Loader](https://github.com/SteamDeckHomebrew/PluginLoader).
### Why the weird name?
Because Spotify doesn't allow anything sounding even remotely close to the word Spotify. Not that it really matters.

## Usage
1. Make sure you have [Steamdeck Pluginloader](https://github.com/SteamDeckHomebrew/PluginLoader#installation) installed
2. Go to the [PluginLoader store](https://beta.deckbrew.xyz/) and press `Install v0.1.0` or download/`git clone` this repo into the `/home/deck/homebrew/plugins` folder on your Steam Deck (see [**Branches** below](#branches))
3. Have a spotify client running (on your PC, on the deck, on your phone, etc)
4. Access the plugins in the quick access menu and select Spdck
5. Click the login button and authorize the app, then start using it

Found any problems or have suggestions? Go ahead and open an [issue](https://github.com/Wolvan/spdck/issues) or submit a pull request!

## Branches
`main` - Stable branch with tagged releases<br>
`dev` - Unstable and bleeding-edge in development branch

If you want to use git to get the plugin, you can use the following commands.<br>
**ATTENTION**: Installation via the PluginLoader store is recommended.<br>
The branch of the plugin can be selected by cloning with the `-b` parameter:<br>
**Stable:** `git clone -b main https://github.com/Wolvan/spdck.git /home/deck/homebrew/plugins/spdck`<br>
**Development:** `git clone -b dev https://github.com/Wolvan/spdck.git /home/deck/homebrew/plugins/spdck`

## Issues
- Steamdeck UI sometimes crashes to blackscreen when closing in-built browser. Steam issue? Rebooting the device fixes this.

## Support
Like what I am doing? Share this around so more people know about it.<br>
You can also buy me a [Ko-Fi](https://ko-fi.com/wolvan), if you really want.