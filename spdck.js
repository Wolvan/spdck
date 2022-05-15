"use strict";
(() => {
const CLIENT_ID = "39419929d0af4ecd9823ddaf925da504";
const ACCESS_SERVER_URI = "http://localhost:49983";

let spotifyAPI = null;
function randomString(length = 16, charset = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789") {
    let result = "";
    for (let i = 0; i < length; i++) {
        result += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return result;
}
class Spotify extends EventTarget {
    _refreshToken = null;
    _accessToken = null;
    _apiEndpoint = null;
    _trackCache = {};
    _currentTrackId = null;
    _shuffle = false;
    _repeatMode = "off";
    _playing = false;
    _volume = 0;
    _autoUpdateInterval = 0;

    currentPlaybackTime = 0;
    constructor(refreshToken = "", accessToken = "", spotifyAPIEndpoint = "https://api.spotify.com/v1") {
        super();
        if (!refreshToken) throw new Error("No refresh token specified");
        this._refreshToken = refreshToken;
        this._accessToken = accessToken;
        this._apiEndpoint = spotifyAPIEndpoint;
    }
    async __request(url, method = "GET", body, __retries = 0) {
        if (!this._accessToken && __retries < 3) await this.getAccessToken();
        else if (!this._accessToken && __retries >= 3) throw new Error("No access token available");
        const response = await fetch(this._apiEndpoint + url, {
            method,
            headers: {
                "Authorization": `Bearer ${this._accessToken}`,
                "Content-Type": "application/json"
            },
            body: body ? JSON.stringify(body) : undefined
        });
        if (response.status === 401) {
            this._accessToken = null;
            return await this.__request(url, method, body);
        } else if (response.status === 403) {
            throw new Error("Access denied");
        } else if (response.status === 404) {
            throw new Error("Not found");
        } else if (response.status === 429) {
            await new Promise(resolve => setTimeout(resolve, response.headers.get("Retry-After") * 1000));
            return await this.__request(url, method, body, __retries++);
        } else if (response.status === 500) {
            throw new Error("Internal server error");
        } else if (response.status >= 300) {
            throw new Error(`Unexpected status code: ${response.status}`);
        }
        try {
            const json = await response.json();
            json.__statusCode = response.status;
            return json;
        } catch (error) {
            const body = {};
            body.__statusCode = response.status;
            return body;
        }
    }
    async getAccessToken() {
        if (!this._refreshToken) throw new Error("No refresh token specified");
        const response = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
                client_id: CLIENT_ID,
                grant_type: "refresh_token",
                refresh_token: this._refreshToken
            })
        });
        const data = await response.json();
        this._accessToken = data.access_token;
        if (data.refresh_token && data.refresh_token !== this._refreshToken) {
            this._refreshToken = data.refresh_token;
            this.dispatchEvent(new CustomEvent("refresh-token-updated", {
                detail: {
                    refreshToken: this._refreshToken
                }
            }))
        }
        return this._accessToken;
    }

    async getPlaybackState() {
        const playbackResult = await this.__request("/me/player");
        if (playbackResult.__statusCode === 204) return null;
        else return playbackResult;
    }
    
    async getDevices() {
        const devicesResult = await this.__request("/me/player/devices");
        return devicesResult.devices;
    }
    async transferPlayback(deviceId, play = true) {
        if (!deviceId || typeof deviceId !== "string") throw new Error("No device id specified");
        const transferResult = await this.__request(`/me/player`, "PUT", {
            "device_ids": [deviceId],
            play
        });
        return transferResult.__statusCode === 204;
    }

    async pausePlayback() {
        return (await this.__request("/me/player/pause", "PUT")).__statusCode === 204;
    }
    async startPlayback() {
        return (await this.__request("/me/player/play", "PUT")).__statusCode === 204;
    }
    async previousTrack() {
        return (await this.__request("/me/player/previous", "POST")).__statusCode === 204;
    }
    async nextTrack() {
        return (await this.__request("/me/player/next", "POST")).__statusCode === 204;
    }
    async seekToPosition(msPosition) {
        if (typeof msPosition !== "number") throw new Error("No position specified");
        return (await this.__request("/me/player/seek?position_ms=" + Math.floor(msPosition), "PUT", {})).__statusCode === 204;
    }
    async setVolume(volume) {
        if (volume < 1 && volume > 0) volume *= 100;
        if (typeof volume !== "number") throw new Error("No volume specified");
        return (await this.__request("/me/player/volume?volume_percent=" + Math.floor(volume), "PUT", {})).__statusCode === 204;
    }
    async setRepeat(state) {
        if (typeof state !== "string" || !["track", "context", "off"].includes(state.toLowerCase())) throw new Error("No repeat state specified");
        return (await this.__request("/me/player/repeat?state=" + state.toLowerCase(), "PUT", {})).__statusCode === 204;
    }
    async setShuffle(state = false) {
        return (await this.__request("/me/player/shuffle?state=" + (!!state).toString(), "PUT", {})).__statusCode === 204;
    }
    async getTrackInformation(trackId) {
        if (!trackId) throw new Error("No track id specified");
        if (this._trackCache[trackId]) {
            this._trackCache[trackId].__lastUsed = new Date();
            return this._trackCache[trackId];
        }
        const trackResult = this._trackCache[trackId] = await this.__request(`/tracks/${trackId}`);
        this._trackCache[trackId].__lastUsed = new Date();

        if (Object.keys(this._trackCache).length > 100) {
            const oldest = Object.keys(this._trackCache).reduce((a, b) => this._trackCache[a].__lastUsed < this._trackCache[b].__lastUsed ? a : b);
            delete this._trackCache[oldest];
        }
        return trackResult;
    }

    async __triggerUpdate(forceEventTriggers = false) {
        const playbackState = await this.getPlaybackState();
        if (playbackState) {
            if (playbackState.item && typeof playbackState.item.id === "string" && (this._currentTrackId !== playbackState.item.id || forceEventTriggers)) {
                this._currentTrackId = playbackState.item.id;
                this._trackCache[this._currentTrackId] = playbackState.item;
                this.dispatchEvent(new CustomEvent("track-changed", {
                    detail: {
                        track: await this.getTrackInformation(this._currentTrackId)
                    }
                }));
            }
            if (playbackState.repeat_state !== this._repeatMode || forceEventTriggers) {
                this._repeatMode = playbackState.repeat_state;
                this.dispatchEvent(new CustomEvent("repeat-mode-changed", {
                    detail: {
                        repeatMode: this._repeatMode
                    }
                }));
            }
            if (playbackState.shuffle_state !== this._shuffle || forceEventTriggers) {
                this._shuffle = playbackState.shuffle_state;
                this.dispatchEvent(new CustomEvent("shuffle-mode-changed", {
                    detail: {
                        shuffle: this._shuffle
                    }
                }));
            }
            if (playbackState.is_playing !== this._playing || forceEventTriggers) {
                this._playing = playbackState.is_playing;
                this.dispatchEvent(new CustomEvent("playback-state-changed", {
                    detail: {
                        playing: this._playing
                    }
                }));
            }
            if (playbackState.device && playbackState.device.volume_percent !== this._volume || forceEventTriggers) {
                this._volume = playbackState.device.volume_percent / 100;
                this.dispatchEvent(new CustomEvent("volume-changed", {
                    detail: {
                        volume: this._volume
                    }
                }));
            }
            if (playbackState.item) {
                this.currentPlaybackTime = playbackState.progress_ms;
                this.dispatchEvent(new CustomEvent("current-time", {
                    detail: {
                        currentTime: playbackState.progress_ms,
                        duration: playbackState.item.duration_ms
                    }
                }));
            }
        } else {
            this.dispatchEvent(new CustomEvent("playback-cleared"));
            this._currentTrackId = null;
            this._playing = false;
            this._repeatMode = "off";
            this._shuffle = false;
            this._volume = 1;
        }
    }
    enablePlaybackUpdates(intervalTime = 500) {
        const update = async (forceEventTriggers) => {
            if (!this._autoUpdateInterval) return;
            try {
                await this.__triggerUpdate(forceEventTriggers);
            } catch (error) {
                console.warn(error);
            }
            setTimeout(update.bind(this, false), this._autoUpdateInterval);
        };
        const alreadyRunning = !!this._autoUpdateInterval;
        this._autoUpdateInterval = intervalTime;
        if(!alreadyRunning) update(true);
    }
    disablePlaybackUpdates() {
        this._autoUpdateInterval = 0;
    }
}

// #region Version functions
async function getGithubReleases(owner = "", repository = "") {
    if (!owner || !repository) return null;
    const response = await fetch(`https://api.github.com/repos/${owner}/${repository}/releases`);
    const json = await response.json();
    return json.map(release => release.tag_name);
}
function parseVersion(versionString = "") {
    versionString = versionString.trim();
    const compareRegex = /^v?(\d+)\.(\d+)\.(\d+)(?:-([a-z0-9-\.]+))?(?:\+([a-z0-9-\.]+))?$/i;
    if (!versionString.match(compareRegex)) throw new Error("Version string is not SemVer compliant");
    let [, major, minor, patch, prerelease, build] = versionString.match(compareRegex);
    if (prerelease && prerelease.startsWith(".")) prerelease = prerelease.substr(1);
    if (prerelease && prerelease.endsWith(".")) prerelease = prerelease.substr(0, prerelease.length - 1);
    if (build && build.startsWith(".")) build = build.substr(1);
    if (build && build.endsWith(".")) build = build.substr(0, build.length - 1);
    return {
        major: parseInt(major),
        minor: parseInt(minor),
        patch: parseInt(patch),
        prerelease: prerelease,
        build: build
    };
}
/*
    -1 = b has presedence over a
     0 = a and b have the same presedence
     1 = a has presedence over b
*/
function compareVersions(aVersionString = "", bVersionString = "") {
    const a = parseVersion(aVersionString);
    const b = parseVersion(bVersionString);
    if (a.major > b.major) return 1;
    if (a.major < b.major) return -1;
    if (a.minor > b.minor) return 1;
    if (a.minor < b.minor) return -1;
    if (a.patch > b.patch) return 1;
    if (a.patch < b.patch) return -1;
    if (!a.prerelease && b.prerelease) return 1;
    if (a.prerelease && !b.prerelease) return -1;
    if (a.prerelease && b.prerelease) {
        const aParts = a.prerelease.split(".");
        const bParts = b.prerelease.split(".");
        let aPart = aParts.shift();
        let bPart = bParts.shift();
        while (typeof aPart !== "undefined" && typeof bPart !== "undefined") {
            if (aPart.match(/^\d+$/) && bPart.match(/^\d+$/)) {
                if (parseInt(aPart) > parseInt(bPart)) return 1;
                if (parseInt(aPart) < parseInt(bPart)) return -1;
            }
            else if (aPart.match(/^\d+$/) && !bPart.match(/^\d+$/)) return -1;
            else if (!aPart.match(/^\d+$/) && bPart.match(/^\d+$/)) return 1;
            else {
                const compareValue = aPart.localeCompare(bPart);
                if (compareValue !== 0) return compareValue;
            }
            aPart = aParts.shift();
            bPart = bParts.shift();
        }
        if (typeof aPart === "undefined" && typeof bPart !== "undefined") return -1;
        if (typeof aPart === "undefined" && typeof bPart === "undefined") return 0;
        if (typeof aPart !== "undefined" && typeof bPart === "undefined") return 1;
    }
    return 0;
}
async function getLatestGithubRelease(owner = "", repository = "") {
    if (!owner || !repository) return null;
    const releases = await getGithubReleases(owner, repository);
    if (!releases) return null;
    const latestRelease = releases.sort(compareVersions).reverse()[0];
    return latestRelease || null;
}
// #endregion Version functions
// #region UI Update
const volumeLevels = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="none">
        <path d="M5.63636 13L10 7H13V29H10L5.63636 23H2V13H5.63636Z" fill="currentColor"></path>
        <path d="M27.8284 18L33.4142 23.5858L30.5858 26.4142L25 20.8285L19.4142 26.4142L16.5858 23.5858L22.1716 18L16.5858 12.4142L19.4142 9.58578L25 15.1716L30.5858 9.58578L33.4142 12.4142L27.8284 18Z" fill="currentColor"></path>
    </svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="none">
        <path d="M5.63636 13L10 7H13V29H10L5.63636 23H2V13H5.63636Z" fill="currentColor"></path>
        <path opacity="0.5" d="M24.7279 30.7279C31.7573 23.6985 31.7573 12.3015 24.7279 5.27209L27.5563 2.44366C36.1479 11.0352 36.1479 24.9648 27.5563 33.5564L24.7279 30.7279Z" fill="currentColor"></path>
        <path opacity="0.5" d="M20.4853 9.51471C25.1716 14.201 25.1716 21.799 20.4853 26.4853L23.3137 29.3137C29.5621 23.0653 29.5621 12.9347 23.3137 6.68628L20.4853 9.51471Z" fill="currentColor"></path>
        <path d="M16.2426 13.7574C18.5858 16.1005 18.5858 19.8995 16.2426 22.2426L19.071 25.0711C22.9763 21.1658 22.9763 14.8342 19.071 10.9289L16.2426 13.7574Z" fill="currentColor"></path>
    </svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="none">
        <path d="M5.63636 13L10 7H13V29H10L5.63636 23H2V13H5.63636Z" fill="currentColor"></path>
        <path opacity="0.5" d="M24.7279 30.7279C31.7573 23.6985 31.7573 12.3015 24.7279 5.27209L27.5563 2.44366C36.1479 11.0352 36.1479 24.9648 27.5563 33.5564L24.7279 30.7279Z" fill="currentColor"></path>
        <path d="M20.4853 9.51471C25.1716 14.201 25.1716 21.799 20.4853 26.4853L23.3137 29.3137C29.5621 23.0653 29.5621 12.9347 23.3137 6.68628L20.4853 9.51471Z" fill="currentColor"></path>
        <path d="M16.2426 13.7574C18.5858 16.1005 18.5858 19.8995 16.2426 22.2426L19.071 25.0711C22.9763 21.1658 22.9763 14.8342 19.071 10.9289L16.2426 13.7574Z" fill="currentColor"></path>
    </svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="none">
        <path d="M5.63636 13L10 7H13V29H10L5.63636 23H2V13H5.63636Z" fill="currentColor"></path>
        <path d="M24.7279 30.7279C31.7573 23.6985 31.7573 12.3015 24.7279 5.27209L27.5563 2.44366C36.1479 11.0352 36.1479 24.9648 27.5563 33.5564L24.7279 30.7279Z" fill="currentColor"></path>
        <path d="M20.4853 9.51471C25.1716 14.201 25.1716 21.799 20.4853 26.4853L23.3137 29.3137C29.5621 23.0653 29.5621 12.9347 23.3137 6.68628L20.4853 9.51471Z" fill="currentColor"></path>
        <path d="M16.2426 13.7574C18.5858 16.1005 18.5858 19.8995 16.2426 22.2426L19.071 25.0711C22.9763 21.1658 22.9763 14.8342 19.071 10.9289L16.2426 13.7574Z" fill="currentColor"></path>
    </svg>`
];
function setSpdckTrackProgress(progress = 0) {
    const sliderContainer = document.querySelector("#spdck-track-progress");
    const slider = sliderContainer.querySelector(".gamepadslider_SliderControlAndNotches_1Cccx");
    slider.setAttribute("style", "--normalized-slider-value:" + (progress > 1 ? 1 : progress < 0 ? 0 : progress) + ";");
}
function getSpdckTrackProgress() {
    const sliderContainer = document.querySelector("#spdck-track-progress");
    const slider = sliderContainer.querySelector(".gamepadslider_SliderControlAndNotches_1Cccx");
    const styleAttr = slider.getAttribute("style");
    const normalizedValue = styleAttr.match(/--normalized-slider-value:([0-9.]+)/)[1];
    return normalizedValue;
}
let volumeLocked = false;
function setSpdckVolumePercentage(volume = 0) {
    if (volumeLocked) return;
    const sliderContainer = document.querySelector("#spdck-volume-slider");
    const iconContainer = sliderContainer.querySelector(".gamepadslider_Icon_21uKi");
    const slider = sliderContainer.querySelector(".gamepadslider_SliderControlAndNotches_1Cccx");

    const icon = volume === 1 ? 3 : volume === 0 ? 0 : (Math.floor((volume * 100) / 33) + 1);
    iconContainer.innerHTML = volumeLevels[icon];

    slider.setAttribute("style", "--normalized-slider-value:" + (volume > 1 ? 1 : volume < 0 ? 0 : volume) + ";");
}
function getSpdckVolumePercentage() {
    const sliderContainer = document.querySelector("#spdck-volume-slider");
    const slider = sliderContainer.querySelector(".gamepadslider_SliderControlAndNotches_1Cccx");
    const styleAttr = slider.getAttribute("style");
    const normalizedValue = styleAttr.match(/--normalized-slider-value:([0-9.]+)/)[1];
    return normalizedValue;
}

function setToggleState(toggle, state) {
    const ENABLED_CLASS = "gamepaddialog_On_3ld7T";
    if (state && !toggle.classList.contains(ENABLED_CLASS)) toggle.classList.add(ENABLED_CLASS);
    if (!state && toggle.classList.contains(ENABLED_CLASS)) toggle.classList.remove(ENABLED_CLASS);
}
function getToggleState(toggle) {
    return toggle.classList.contains("gamepaddialog_On_3ld7T");
}

function setSpdckShuffle(shuffle = false) {
    const shuffleButton = document.querySelector("#spdck-shuffle-control");
    setToggleState(shuffleButton, shuffle);
}
function getSpdckShuffle() {
    const shuffleButton = document.querySelector("#spdck-shuffle-control");
    return getToggleState(shuffleButton);
}
function setSpdckRepeat(repeat = false) {
    const repeatButton = document.querySelector("#spdck-repeat-control");
    setToggleState(repeatButton, repeat);
}
function getSpdckRepeat() {
    const repeatButton = document.querySelector("#spdck-repeat-control");
    return getToggleState(repeatButton);
}

function setSpdckBacklink(backlink = "") {
    if (!backlink) backlink = "https://www.spotify.com/";
    document.querySelector("#spdck-backlink").href = backlink;
}
function setSpdckCover(coverURL) {
    document.querySelector("#spdck-track-artwork img").src = coverURL || "";
}
function setSpdckTitle(title = "No track playing") {
    const element = document.querySelector("#spdck-track-info .track-info-title");
    element.textContent = title || "No track playing";
}
function setSpdckArtist(artist = "") {
    const element = document.querySelector("#spdck-track-info .track-info-artist");
    element.textContent = artist || "";
}
function setSpdckIsPlaying(isPlaying = false) {
    const element = document.querySelector("#spdck-play-pause");
    if (isPlaying) element.classList.add("is-playing");
    else element.classList.remove("is-playing");
}
// #endregion UI Update
// #region Access Server functions
async function startAccessServer(accessProtectionToken = randomString(32)) {
    console.log(await call_plugin_method("start_access_server", { accessProtectionToken }));
    return accessProtectionToken;
}
async function stopAccessServer() {
    console.log(await call_plugin_method("stop_access_server"));
}
async function isAccessServerOnline() {
    try {
        const res = await fetch(ACCESS_SERVER_URI + "/heartbeat");
        return (await res.json()).status === "ok";
    } catch (error) {
        return false;
    }
}
function waitForAccessServer(timeout = 0) {
    let checkPromResolver = () => {};
    let checkPromRejector = () => {};
    const checkProm = new Promise((res, rej) => {
        checkPromResolver = res;
        checkPromRejector = rej;
    });

    let cancelled = false;
    let tOut = null;
    
    function abort() {
        cancelled = true;
        if (tOut) clearTimeout(tOut);
        checkPromResolver(false);
    }
    if (timeout) tOut = setTimeout(abort, timeout);

    async function check() {
        if (cancelled) return;
        if (await isAccessServerOnline()) return checkPromResolver(true);
        else setTimeout(check, 500);
    }
    check();

    checkProm.abort = abort;
    return checkProm;
}
async function getAccessTokenFromBackend(accessProtectionToken = "") {
    let accessCode = null;
    let pcke = null;
    while (!accessCode || !pcke) {
        try {
            const res = await fetch(ACCESS_SERVER_URI + "/access_code", {
                headers: {
                    "Content-Type": "application/json",
                    "X-SPDCK-ACCESS-KEY": accessProtectionToken
                }
            });
            const json = await res.json();
            if (json.error) return {
                error: json.error
            };
            if (json.access_code) accessCode = json.access_code;
            if (json.code_challenge) pcke = json.code_challenge;
        } catch (error) {
            console.warn(error);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return {
        accessCode,
        pcke
    }
}
// #endregion Access Server functions
// #region SpotifyAPI Init
async function getTokens(code, pcke) {
    const fetched = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
            client_id: CLIENT_ID,
            code,
            redirect_uri: ACCESS_SERVER_URI + "/callback",
            grant_type: "authorization_code",
            code_verifier: pcke
        })
    });

    try {
        return await fetched.json();
    } catch (error) {
        return {
            error
        }
    }
}

function hookSpotifyEvents(client) {
    client.addEventListener("refresh-token-updated", (evt) => call_plugin_method("store_token", { refresh_token: evt.detail.refreshToken }));
    client.addEventListener("current-time", (evt) => setSpdckTrackProgress(evt.detail.currentTime / evt.detail.duration));
    client.addEventListener("repeat-mode-changed", (evt) => setSpdckRepeat(evt.detail.repeatMode !== "off"));
    client.addEventListener("shuffle-mode-changed", (evt) => setSpdckShuffle(evt.detail.shuffle));
    client.addEventListener("playback-state-changed", (evt) => setSpdckIsPlaying(evt.detail.playing));
    client.addEventListener("volume-changed", (evt) => setSpdckVolumePercentage(evt.detail.volume));
    client.addEventListener("track-changed", (evt) => {
        setSpdckCover(evt.detail.track.album.images.sort((a, b) => b.height - a.height)[0].url);
        setSpdckTitle(evt.detail.track.name);
        if (Array.isArray(evt.detail.track.artists)) setSpdckArtist(evt.detail.track.artists.map(a => a.name).join(", "));
        else setSpdckArtist("N / A");
        setSpdckBacklink((evt.detail.track.external_urls || {}).spotify);
    });
    client.addEventListener("playback-cleared", () => {
        setSpdckCover(null);
        setSpdckTitle(null);
        setSpdckArtist(null);
        setSpdckTrackProgress(0);
        setSpdckVolumePercentage(0);
        setSpdckRepeat(false);
        setSpdckShuffle(false);
        setSpdckIsPlaying(false);
        setSpdckBacklink(null);
    });
    client.enablePlaybackUpdates(250);
}
async function setupSpotifyClient(openNewWindow = true) {
    const accessKey = await startAccessServer();
    await waitForAccessServer();
    if (openNewWindow) window.open('http://localhost:49983/', '_blank');
    const {
        accessCode,
        pcke,
        error
    } = await getAccessTokenFromBackend(accessKey);
    if (error) throw new Error(error);
    await stopAccessServer();
    const tokens = await getTokens(accessCode, pcke);
    if (tokens.error) throw new Error(tokens.error);
    await call_plugin_method("store_token", { refresh_token: tokens.refresh_token });
    const client = new Spotify(tokens.refresh_token, tokens.access_token);
    hookSpotifyEvents(client);
    return client;
}
async function initSpotifyControls() {
    const token = await call_plugin_method("load_token");
    if (!token) {
        document.querySelector("#spdck-controls").classList.add("spdck-hidden");
        document.querySelector("#spdck-track").classList.add("spdck-hidden");
        spotifyAPI = null;
        document.querySelector("#spdck-token-system").classList.remove("spdck-hidden");
    } else {
        document.querySelector("#spdck-token-system").classList.add("spdck-hidden");
        spotifyAPI = new Spotify(token);
        hookSpotifyEvents(spotifyAPI);
        document.querySelector("#spdck-controls").classList.remove("spdck-hidden");
        document.querySelector("#spdck-track").classList.remove("spdck-hidden");
    }
};
// #endregion SpotifyAPI Init

// #region Button Bindings
document.querySelector("#spdck-login-button").addEventListener("click", async () => {
    spotifyAPI = await setupSpotifyClient();
    if (spotifyAPI) {
        document.querySelector("#spdck-token-system").classList.add("spdck-hidden");
        document.querySelector("#spdck-controls").classList.remove("spdck-hidden");
        document.querySelector("#spdck-track").classList.remove("spdck-hidden");
    }
});
document.querySelector("#force-token-logout a").addEventListener("click", (evt) => {
    call_plugin_method("remove_token");
    initSpotifyControls();
    evt.preventDefault();
});
document.querySelector("#spdck-repeat-control").addEventListener("click", async (evt) => {
    const isRepeat = !getSpdckRepeat();
    setSpdckRepeat(isRepeat);
    if (spotifyAPI) await spotifyAPI.setRepeat(isRepeat ? "context" : "off");
    evt.preventDefault();
});
document.querySelector("#spdck-shuffle-control").addEventListener("click", async (evt) => {
    const isShuffle = !getSpdckShuffle();
    setSpdckShuffle(isShuffle);
    if (spotifyAPI) await spotifyAPI.setShuffle(isShuffle);
    evt.preventDefault();
});
document.querySelector("#spdck-play-pause").addEventListener("click", async (evt) => {
    if (spotifyAPI) {
        if (spotifyAPI._playing) await spotifyAPI.pausePlayback();
        else await spotifyAPI.startPlayback();
        await spotifyAPI.__triggerUpdate();
    }
    evt.preventDefault();
});
document.querySelector("#spdck-previous-button").addEventListener("click", async (evt) => {
    if (spotifyAPI) {
        if (spotifyAPI.currentPlaybackTime <= 3000) await spotifyAPI.previousTrack();
        else await spotifyAPI.seekToPosition(0);
        await spotifyAPI.__triggerUpdate();
    }
    evt.preventDefault();
});
document.querySelector("#spdck-next-button").addEventListener("click", async (evt) => {
    if (spotifyAPI) {
        await spotifyAPI.nextTrack();
        await spotifyAPI.__triggerUpdate();
    }
    evt.preventDefault();
});
document.querySelector("#spdck-volume-slider .gamepadslider_SliderControlAndNotches_1Cccx").addEventListener("click", async (evt) => {
    const offset = evt.offsetX;
    const width = evt.target.clientWidth;
    const percentage = offset / width;
    const volume = Math.round(percentage * 100);
    const adjustedVolume = volume > 95 ? 100 : volume - (volume % 5);
    volumeLocked = false;
    setSpdckVolumePercentage(adjustedVolume / 100);
    volumeLocked = true;
    try {
        if (spotifyAPI) {
            await spotifyAPI.setVolume(adjustedVolume);
            await spotifyAPI.__triggerUpdate();
        }
    } catch (error) {
        // meh
    }
    volumeLocked = false;
});
// #endregion Button Bindings
initSpotifyControls();
})();