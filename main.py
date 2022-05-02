import time
from http.server import ThreadingHTTPServer
from threading import Thread
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs
from urllib.parse import urlencode
from random import choices
import string
import json
from hashlib import sha256
from base64 import b64encode

SPDCK_HOST_NAME = "localhost"
SPDCK_PORT_NUMBER = 49983

spdck_access_code_cache = {}
class Spdck_AccessServerHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200, "ok")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "X-SPDCK-ACCESS-KEY, Content-Type")
        self.end_headers()
        return
    def do_GET(self):
        global spdck_access_code_cache
        if (self.path == "/"):
            self.send_response(302)
            self.send_header("Location", "https://accounts.spotify.com/authorize?" + urlencode({
                "response_type": "code",
                "client_id": "39419929d0af4ecd9823ddaf925da504",
                "scope": "user-modify-playback-state user-read-playback-state user-read-currently-playing",
                "redirect_uri": "http://" + SPDCK_HOST_NAME + ":" + str(SPDCK_PORT_NUMBER) + "/callback",
                "state": self.__state,
                "code_challenge_method": "S256",
                "code_challenge": b64encode(sha256(self.__code_challenge.encode()).digest()).decode().replace("=", "").replace("+", "-").replace("/", "_"),
                "show_dialog": "false"
            }))
            self.end_headers()
        elif (self.path == "/heartbeat"):
            self.respond({"status": "ok"})
        elif (self.path.startswith("/callback")):
            query = parse_qs(self.path.split("?")[1])
            if (query["state"][0] != self.__state):
                self.respond({"error": "invalid_state"}, 403)
                return
            if ("error" in query and query["error"][0] != ""):
                self.respond({"error": query["error"][0]}, 403)
                return
            spdck_access_code_cache[self.__access_protection_code] = query["code"][0]
            self.respond(
                """
                <html>
                    <body>
                        <h1>Spotify authenticated!</h1>
                        Return back to the quick access panel!<br>
                        This tab will close in 5 seconds...
                        <script type='text/javascript'>
                            setTimeout(window.close, 5000);
                        </script>
                    </body>
                </html>
                """
            , 200, "text/html")
        elif (self.path == "/access_code"):
            if (self.__access_protection_code != None and self.__access_protection_code != self.headers["X-SPDCK-ACCESS-KEY"]):
                self.respond({
                    "error": "invalid_access_key"
                })
                return
            try:
                if (spdck_access_code_cache[self.__access_protection_code] is None):
                    self.respond({})
                else:
                    self.respond({
                        "access_code": spdck_access_code_cache[self.__access_protection_code],
                        "code_challenge": self.__code_challenge
                    })
            except AttributeError as e:
                self.respond(repr(e))
            except Exception as e:
                self.respond(repr(e))
        else:
            self.respond({
                "error": "invalid_route"
            }, 404)
    def respond(self, content = {}, status = 200, contentType = "application/json"):
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-type", contentType)
        self.end_headers()
        if (contentType == "application/json"):
            self.wfile.write(json.dumps(content).encode("utf-8"))
        else:
            self.wfile.write(content.encode("utf-8"))
        return
    def set_access_protection_key(self, key = None):
        if (key == None):
            return
        self.__access_protection_code = key
    def set_state(self, state: string):
        if (state == None):
            return
        self.__state = state
    def set_challenge(self, challenge: string):
        if (challenge == None):
            return
        self.__code_challenge = challenge

def Spdck_createHandler(access_protection_key: string):
    handler = Spdck_AccessServerHandler
    spdck_access_code_cache[access_protection_key] = None
    handler.set_access_protection_key(handler, access_protection_key)
    handler.set_state(handler, "".join(choices(string.ascii_letters + string.digits, k=16)))
    handler.set_challenge(handler, "".join(choices(string.ascii_letters + string.digits + "_.-", k=128)))
    return handler

class Spdck_ThreadedServer(Thread):
    __thread = None
    __server = None
    __serverHandler = None
    def run(self, access_protection_key = ""):
        self.__serverHandler = Spdck_createHandler(access_protection_key)
        self.__server = ThreadingHTTPServer((SPDCK_HOST_NAME, SPDCK_PORT_NUMBER), self.__serverHandler)
        self.__thread = Thread(target=self.__server.serve_forever)
        self.__thread.start()
    def shutdown(self):
        self.__server.shutdown()
        self.__server.server_close()

class Plugin:
    # A normal method. It can be called from JavaScript using call_plugin_function("method_1", argument1, argument2)
    async def start_access_server(self, accessProtectionToken ):
        if (self.__active_server != None):
            self.__active_server.shutdown()
        self.__active_server = Spdck_ThreadedServer()
        self.__active_server.run(access_protection_key = accessProtectionToken)
        return (time.asctime(), "Spdck Login Server UP - %s:%s" % (SPDCK_HOST_NAME, SPDCK_PORT_NUMBER))

    # A normal method. It can be called from JavaScript using call_plugin_function("method_2", argument1, argument2)
    async def stop_access_server(self, *args):
        if (self.__active_server == None):
            return False
        self.__active_server.shutdown()
        self.__active_server = None
        return (time.asctime(), "Spdck Login Server DOWN - %s:%s" % (SPDCK_HOST_NAME, SPDCK_PORT_NUMBER))

    # Asyncio-compatible long-running code, executed in a task when the plugin is loaded
    async def _main(self):
        self.__active_server = None