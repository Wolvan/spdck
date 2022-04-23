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
    async pausePlayback() {
        await this.__request("/me/player/pause", "PUT");
    }

}

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

async function setupSpotifyClient() {
    const accessKey = await startAccessServer();
    await waitForAccessServer();
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
        document.querySelector("#spotify-controls").classList.add("hidden");
        spotifyAPI = null;
        document.querySelector("#token-system").classList.remove("hidden");
        spotifyAPI = await setupSpotifyClient();
        if (spotifyAPI) {
            document.querySelector("#token-system").classList.add("hidden");
            document.querySelector("#spotify-controls").classList.remove("hidden");
        }
    } else {
        document.querySelector("#token-system").classList.add("hidden");
        spotifyAPI = new Spotify(token);
        spotifyAPI.addEventListener("refresh-token-updated", (evt) => localStorage.setItem("SPOTIDECK_REFRESH_TOKEN", evt.detail.refreshToken));
        document.querySelector("#spotify-controls").classList.remove("hidden");
    }
};

document.querySelector("#force-token-logout a").addEventListener("click", (evt) => {
    localStorage.removeItem("SPOTIDECK_REFRESH_TOKEN");
    initSpotifyControls();
    evt.preventDefault();
});
initSpotifyControls();
})();