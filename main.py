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
import socket

SPDCK_HOST_NAME = "0.0.0.0"
SPDCK_PORT_NUMBER = 49983

spdck_access_code_cache = {}
spdck_client_id_cache = {}
def Spdck_get_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(0)
    try:
        # doesn't even have to be reachable
        s.connect(('10.255.255.255', 1))
        IP = s.getsockname()[0]
    except Exception:
        IP = '127.0.0.1'
    finally:
        s.close()
    return IP

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
        if (self.path == "/redirect"):
            if (self.__access_protection_code in spdck_client_id_cache):
                self.send_response(302)
                self.send_header("Location", "https://accounts.spotify.com/authorize?" + urlencode({
                    "response_type": "code",
                    "client_id": spdck_client_id_cache[self.__access_protection_code],
                    "scope": "user-modify-playback-state user-read-playback-state user-read-currently-playing",
                    "redirect_uri": "http://localhost:" + str(SPDCK_PORT_NUMBER) + "/callback",
                    "state": self.__state,
                    "code_challenge_method": "S256",
                    "code_challenge": b64encode(sha256(self.__code_challenge.encode()).digest()).decode().replace("=", "").replace("+", "-").replace("/", "_"),
                    "show_dialog": "false"
                }))
                self.end_headers()
            else: 
                self.respond("""
                    <html>
                        <body>
                            <h1>Client ID required</h1>
                            To log in to spotify, a client id is required.<br>
                            Please <a href="/">click here</a> to try again.
                        </body>
                    </html>
                    """
                , 200, "text/html")
        elif (self.path == "/heartbeat"):
            self.respond({"status": "ok"})
        elif (self.path.startswith("/callback")):
            if ("?" not in self.path):
                self.respond(
                    """
                    <html>
                        <body>
                            <h1>Missing parameters</h1>
                            Callback was called with missing parameters.<br>
                            Please <a href="/">click here</a> to try again.
                        </body>
                    </html>
                    """
                , 200, "text/html")
            else:
                query = parse_qs(self.path.split("?")[1])
                if (query["state"][0] != self.__state):
                    self.respond(
                        """
                        <html>
                            <body>
                                <h1>Invalid state</h1>
                                Callback was called with a state parameter that doesn't match what was expected.<br>
                                Please <a href="/">click here</a> to try again.
                            </body>
                        </html>
                        """
                    , 200, "text/html")
                    return
                if ("error" in query and query["error"][0] != ""):
                    self.respond(
                    """
                        <html>
                            <body>
                                <h1>Error while authorising Spotify</h1>
                                """ + query["error"][0] + """<br>
                                Please <a href="/">click here</a> to try again.
                            </body>
                        </html>
                        """
                    , 200, "text/html")
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
        elif (self.path.startswith("/setclientid")):
            if (self.__access_protection_code in spdck_client_id_cache):
                self.respond("""
                    <html>
                        <body>
                            <h1>Client ID already set!</h1>
                            Return back to the steamdeck and finish authorisation!<br>
                            This tab will close in 5 seconds...
                            <script type='text/javascript'>
                                setTimeout(window.close, 5000);
                            </script>
                        </body>
                    </html>
                """
                , 200, "text/html")
            elif ("?" not in self.path):
                self.respond(
                    """
                    <html>
                        <body>
                            <h1>Missing parameters</h1>
                            SetClientId was called with missing parameters.<br>
                            Please <a href="/">click here</a> to try again.
                        </body>
                    </html>
                    """
                , 200, "text/html")
            else:
                query = parse_qs(self.path.split("?")[1])
                if ("clientid" not in query or query["clientid"][0] == ""):
                    self.respond(
                        """
                        <html>
                            <body>
                                <h1>Missing parameters</h1>
                                SetClientId was called with missing parameters.<br>
                                Please <a href="/">click here</a> to try again.
                            </body>
                        </html>
                        """
                    , 200, "text/html")
                    return
                spdck_client_id_cache[self.__access_protection_code] = query["clientid"][0]
                self.respond("""
                    <html>
                        <body>
                            <h1>Client ID set!</h1>
                            Return back to the steamdeck and finish authorisation!<br>
                            You can now close this tab.
                            <script type='text/javascript'>
                                setTimeout(window.close, 5000);
                            </script>
                        </body>
                    </html>
                """
                , 200, "text/html")
        elif (self.path == "/"):
            if (self.__access_protection_code in spdck_client_id_cache):
                client_id_val = spdck_client_id_cache[self.__access_protection_code]
            else:
                client_id_val = ""
            client_id_form_text = ""
            if (client_id_val == ""):
                client_id_form_text = """
                    <form method="GET" action="/setclientid">
                        <input type="text" name="clientid" placeholder="Client ID" required pattern="[0-9a-f]{"\{32\}"}"><br>
                        <input type="submit" value="Set token">
                        <button onClick="window.location.reload();">Refresh Page</button>
                    </form>
                """
            else:
                client_id_form_text = """
                    <a href="/redirect">Finish login</a>
                """
            self.respond(
                """
                <html>
                    <head>
                        <title>SPDCK</title>
                        <style type="text/css">
                            body {
                                font-family: sans-serif;
                                font-size: 1em;
                                background-color: #fafafa;
                                color: #000;
                            }
                        </style>
                    </head>
                    <body>
                        <h1>SPDCK</h1>
                        <h2>Authorisation</h2>
                        <p>
                            The next steps are best performed on a computer.<br>
                            If you already use a computer browser, or wish to continue on the Steamdeck, follow the steps below.<br>
                            <br>
                            Otherwise connect to the same network as this Steamdeck with your computer and browse to the following address:<br>
                            <code>
                                http://""" + Spdck_get_ip() + ":" + str(self.server.server_port or 80) + """/
                            </code>
                        </p>
                        <p>
                            <b>Step 1:</b> <a href="https://developer.spotify.com/dashboard/login" target="_blank">Click here</a> to go to the Spotify Developer website and create an application.<br>
                            <b>Step 2:</b> Once the application is created, click on <b>USERS AND ACCESS</b> at the top of the page.<br>
                            <b>Step 3:</b> Click on <b>ADD NEW USER</b>, add your Spotify Account E-Mail and a name.<br>
                            <b>Step 4:</b> Copy the client id above <b>Users and Access</b> and paste it into the text field below.<br>
                            <b>Step 5:</b> Click on <b>Set token</b> below to initiate spotify authorisation.<br>
                            <b>Step 6:</b> Return back to your Steamdeck, refresh the page and finish authorisation.<br>
                        """ + client_id_form_text + """
                        </p>
                    </body>
                </html>
                """
            , 200, "text/html")
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