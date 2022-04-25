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
        await this.__request("/me/player/pause", "PUT");
    }
    async previousTrack() {
        return (await this.__request("/me/player/previous", "POST")).__statusCode === 204;
    }
    async nextTrack() {
        return (await this.__request("/me/player/next", "POST")).__statusCode === 204;
    }
    async seekToPosition(msPosition) {
        if (typeof msPosition !== "number") throw new Error("No position specified");
        return (await this.__request("/me/player/seek", "PUT", {
            position_ms: msPosition
        })).__statusCode === 204;
    }
    async setVolume(volume) {
        if (volume < 1 && volume > 0) volume *= 100;
        if (typeof volume !== "number") throw new Error("No volume specified");
        return (await this.__request("/me/player/volume", "PUT", {
            volume_percent: Math.floor(volume)
        })).__statusCode === 204;
    }
    async setRepeat(state) {
        if (typeof state !== "string" || !["track", "context", "off"].includes(state.toLowerCase())) throw new Error("No repeat state specified");
        return (await this.__request("/me/player/repeat", "PUT", {
            state: state.toLowerCase()
        })).__statusCode === 204;
    }
    async setShuffle(state = false) {
        return (await this.__request("/me/player/shuffle", "PUT", {
            state: (!!state).toString()
        })).__statusCode === 204;
    }
}

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
function setSpotideckTrackProgress(progress = 0) {
    const sliderContainer = document.querySelector("#spotideck-track-progress");
    const slider = sliderContainer.querySelector(".gamepadslider_SliderControlAndNotches_23hjX");
    slider.setAttribute("style", "--normalized-slider-value:" + (progress > 1 ? 1 : progress < 0 ? 0 : progress) + ";");
}
function getSpotideckTrackProgress() {
    const sliderContainer = document.querySelector("#spotideck-track-progress");
    const slider = sliderContainer.querySelector(".gamepadslider_SliderControlAndNotches_23hjX");
    const styleAttr = slider.getAttribute("style");
    const normalizedValue = styleAttr.match(/--normalized-slider-value:([0-9.]+)/)[1];
    return normalizedValue;
}
window.setSpotideckTrackProgress = setSpotideckTrackProgress;
window.getSpotideckTrackProgress = getSpotideckTrackProgress;
function setSpotideckVolumePercentage(volume = 0) {
    const sliderContainer = document.querySelector("#spotideck-volume-slider");
    const iconContainer = sliderContainer.querySelector(".gamepadslider_Icon_K9V_G");
    const slider = sliderContainer.querySelector(".gamepadslider_SliderControlAndNotches_23hjX");

    const icon = volume === 1 ? 3 : volume === 0 ? 0 : (Math.floor((volume * 100) / 33) + 1);
    iconContainer.innerHTML = volumeLevels[icon];

    slider.setAttribute("style", "--normalized-slider-value:" + (volume > 1 ? 1 : volume < 0 ? 0 : volume) + ";");
}
function getSpotideckVolumePercentage() {
    const sliderContainer = document.querySelector("#spotideck-volume-slider");
    const slider = sliderContainer.querySelector(".gamepadslider_SliderControlAndNotches_23hjX");
    const styleAttr = slider.getAttribute("style");
    const normalizedValue = styleAttr.match(/--normalized-slider-value:([0-9.]+)/)[1];
    return normalizedValue;
}
window.setSpotideckVolumePercentage = setSpotideckVolumePercentage;
window.getSpotideckVolumePercentage = getSpotideckVolumePercentage;

function setToggleState(toggle, state) {
    const ENABLED_CLASS = "gamepaddialog_On_yLrDA";
    if (state && !toggle.classList.contains(ENABLED_CLASS)) toggle.classList.add(ENABLED_CLASS);
    if (!state && toggle.classList.contains(ENABLED_CLASS)) toggle.classList.remove(ENABLED_CLASS);
}
function getToggleState(toggle) {
    return toggle.classList.contains("gamepaddialog_On_yLrDA");
}

function setSpotideckShuffle(shuffle = false) {
    const shuffleButton = document.querySelector("#spotideck-shuffle-control");
    setToggleState(shuffleButton, shuffle);
}
function getSpotideckShuffle() {
    const shuffleButton = document.querySelector("#spotideck-shuffle-control");
    return getToggleState(shuffleButton);
}
window.setSpotideckShuffle = setSpotideckShuffle;
window.getSpotideckShuffle = getSpotideckShuffle;
function setSpotideckRepeat(repeat = false) {
    const repeatButton = document.querySelector("#spotideck-repeat-control");
    setToggleState(repeatButton, repeat);
}
function getSpotideckRepeat() {
    const repeatButton = document.querySelector("#spotideck-repeat-control");
    return getToggleState(repeatButton);
}
window.setSpotideckRepeat = setSpotideckRepeat;
window.getSpotideckRepeat = getSpotideckRepeat;

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
                    "X-SPOTIDECK-ACCESS-KEY": accessProtectionToken
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
// #endregion
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
    localStorage.setItem("SPOTIDECK_REFRESH_TOKEN", tokens.refresh_token);
    const client = new Spotify(tokens.refresh_token, tokens.access_token);
    client.addEventListener("refresh-token-updated", (evt) => localStorage.setItem("SPOTIDECK_REFRESH_TOKEN", evt.detail.refreshToken));
    return client;
}
async function initSpotifyControls() {
    const token = localStorage.getItem("SPOTIDECK_REFRESH_TOKEN");
    if (!token) {
        document.querySelector("#spotideck-controls").classList.add("spotideck-hidden");
        document.querySelector("#spotideck-track").classList.add("spotideck-hidden");
        spotifyAPI = null;
        document.querySelector("#spotideck-token-system").classList.remove("spotideck-hidden");
    } else {
        document.querySelector("#spotideck-token-system").classList.add("spotideck-hidden");
        spotifyAPI = new Spotify(token);
        spotifyAPI.addEventListener("refresh-token-updated", (evt) => localStorage.setItem("SPOTIDECK_REFRESH_TOKEN", evt.detail.refreshToken));
        document.querySelector("#spotideck-controls").classList.remove("spotideck-hidden");
        document.querySelector("#spotideck-track").classList.remove("spotideck-hidden");
    }
};
// #endregion

// #region Button Bindings
document.querySelector("#spotideck-login-button").addEventListener("click", async () => {
    spotifyAPI = await setupSpotifyClient();
    if (spotifyAPI) {
        document.querySelector("#spotideck-token-system").classList.add("spotideck-hidden");
        document.querySelector("#spotideck-controls").classList.remove("spotideck-hidden");
        document.querySelector("#spotideck-track").classList.remove("spotideck-hidden");
    }
});
document.querySelector("#force-token-logout a").addEventListener("click", (evt) => {
    localStorage.removeItem("SPOTIDECK_REFRESH_TOKEN");
    initSpotifyControls();
    evt.preventDefault();
});
document.querySelector("#spotideck-repeat-control").addEventListener("click", async (evt) => {
    setSpotideckRepeat(!getSpotideckRepeat());
    evt.preventDefault();
});
document.querySelector("#spotideck-shuffle-control").addEventListener("click", async (evt) => {
    setSpotideckShuffle(!getSpotideckShuffle());
    evt.preventDefault();
});
// #endregion
initSpotifyControls();
})();